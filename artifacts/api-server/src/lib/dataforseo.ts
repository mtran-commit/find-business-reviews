import type { Logger } from "pino";

/**
 * DataForSEO v3 client.
 *
 * DataForSEO exposes per-product POST endpoints that all take an ARRAY of task
 * objects and return a `tasks[]` array. We use:
 *   - business_data/google/my_business_info/live  : Google business profile + rating (sync)
 *   - serp/google/maps/live/advanced              : nearby/similar businesses (sync)
 *   - business_data/tripadvisor/search/live       : TripAdvisor aggregate rating (sync)
 *   - business_data/google/reviews/task_post/get  : Google review snippets (ASYNC — poll)
 *   - serp/google/organic/live/advanced           : Google organic (branding slug discovery, sync)
 *
 * Auth is HTTP Basic (login:password base64). Credentials come from the
 * DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD secrets and never reach the browser.
 *
 * Docs: https://docs.dataforseo.com/v3/
 */

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

/** DataForSEO Basic-auth credentials (server-side only). */
export interface DataforseoCreds {
  login: string;
  password: string;
}

/**
 * Read DataForSEO credentials from the environment. Returns null when either
 * secret is missing so callers can surface a clean "not configured" error
 * (mirroring the SerpApi key check).
 */
export function getDataforseoCreds(): DataforseoCreds | null {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) return null;
  return { login, password };
}

function authHeader(creds: DataforseoCreds): string {
  const token = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

/** Low-level DataForSEO request. `body` undefined → GET (used for task_get). */
async function dfsFetch(
  path: string,
  body: unknown,
  creds: DataforseoCreds,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const init: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${DATAFORSEO_BASE}${path}`, init);
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof json["status_message"] === "string"
        ? (json["status_message"] as string)
        : `DataForSEO responded with status ${res.status}`;
    throw new Error(message);
  }
  return json;
}

/** Throw when the top-level or first-task status is not 20000 ("Ok."). */
function assertTaskOk(json: Record<string, unknown>): void {
  const topCode = json["status_code"];
  if (typeof topCode === "number" && topCode !== 20000) {
    throw new Error(
      `DataForSEO error ${topCode}: ${String(json["status_message"] ?? "")}`,
    );
  }
  const tasks = json["tasks"];
  const t0 = Array.isArray(tasks) ? tasks[0] : null;
  if (t0 && typeof t0 === "object") {
    const tc = (t0 as Record<string, unknown>)["status_code"];
    if (typeof tc === "number" && tc !== 20000) {
      throw new Error(
        `DataForSEO task error ${tc}: ${String(
          (t0 as Record<string, unknown>)["status_message"] ?? "",
        )}`,
      );
    }
  }
}

/** Extract `tasks[0].result[0].items[]` (objects only), robust to shape drift. */
export function resultItems(
  json: Record<string, unknown>,
): Record<string, unknown>[] {
  const tasks = json["tasks"];
  if (!Array.isArray(tasks) || !tasks[0] || typeof tasks[0] !== "object")
    return [];
  const result = (tasks[0] as Record<string, unknown>)["result"];
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object")
    return [];
  const r0 = result[0] as Record<string, unknown>;
  const items = r0["items"];
  if (Array.isArray(items)) {
    return items.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object",
    );
  }
  return [];
}

/**
 * Call a synchronous DataForSEO endpoint with a single task and return its
 * result items. Throws on a non-OK status so the caller can log and degrade.
 */
export async function dataforseoLive(
  path: string,
  task: Record<string, unknown>,
  creds: DataforseoCreds,
  _log?: Logger,
  timeoutMs = 20000,
): Promise<Record<string, unknown>[]> {
  const json = await dfsFetch(path, [task], creds, timeoutMs);
  assertTaskOk(json);
  return resultItems(json);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// DataForSEO status codes that mean "the task exists but is not finished yet".
const IN_PROGRESS_CODES = new Set([40100, 40601, 40602]);

/**
 * Run the ASYNCHRONOUS Google Reviews flow: submit a task, then poll
 * `task_get/{id}` with backoff until the result is ready or the overall
 * deadline passes. Degrades gracefully to `[]` on timeout or any error — a
 * missing/late review payload must never abort report generation.
 */
export async function dataforseoReviews(
  task: Record<string, unknown>,
  creds: DataforseoCreds,
  log?: Logger,
  overallTimeoutMs = 75000,
): Promise<Record<string, unknown>[]> {
  let id = "";
  try {
    const post = await dfsFetch(
      "/business_data/google/reviews/task_post",
      [task],
      creds,
      20000,
    );
    assertTaskOk(post);
    const tasks = post["tasks"];
    const t0 = Array.isArray(tasks) ? tasks[0] : null;
    if (t0 && typeof t0 === "object") {
      const tid = (t0 as Record<string, unknown>)["id"];
      if (typeof tid === "string") id = tid;
    }
  } catch (err) {
    log?.warn({ err }, "DataForSEO reviews task_post failed");
    return [];
  }
  if (!id) return [];

  const deadline = Date.now() + overallTimeoutMs;
  let delay = 2000;
  while (Date.now() < deadline) {
    await sleep(delay);
    try {
      const get = await dfsFetch(
        `/business_data/google/reviews/task_get/${id}`,
        undefined,
        creds,
        20000,
      );
      const tasks = get["tasks"];
      const t0 =
        Array.isArray(tasks) && tasks[0] && typeof tasks[0] === "object"
          ? (tasks[0] as Record<string, unknown>)
          : null;
      const code = t0 ? t0["status_code"] : undefined;
      if (typeof code === "number" && code === 20000) {
        const items = resultItems(get);
        if (items.length > 0) return items;
        // 20000 with no items yet can happen briefly; keep polling.
      } else if (typeof code === "number" && !IN_PROGRESS_CODES.has(code)) {
        // Terminal error (bad request, not found, etc.) — stop early.
        log?.warn(
          { code, message: t0?.["status_message"] },
          "DataForSEO reviews task_get returned a terminal error",
        );
        return [];
      }
    } catch (err) {
      log?.warn({ err }, "DataForSEO reviews task_get poll failed");
      // Transient — keep trying until the deadline.
    }
    delay = Math.min(delay + 1000, 6000);
  }
  log?.warn("DataForSEO reviews polling timed out; continuing without snippets");
  return [];
}
