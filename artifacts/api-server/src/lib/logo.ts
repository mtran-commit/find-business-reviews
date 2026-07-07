import type { Logger } from "pino";

/**
 * Business logo resolution from the business's OWN official website.
 *
 * The zero-tolerance trust rule for this app is: NEVER show a wrong or generic
 * logo (a website builder's mark, a review platform icon, a placeholder, or
 * another business's logo). The one source we can trust confidently is the
 * business's own website — a logo declared there is, by definition, that
 * business's brand mark. So we fetch the homepage HTML and read, in order of
 * reliability:
 *
 *   1. schema.org / JSON-LD `logo`   -> high   (an explicit brand-mark field)
 *   2. <link rel="apple-touch-icon"> -> high   (almost always the brand icon)
 *   3. <link rel="icon"> (png/svg)   -> medium (a real, self-hosted site icon)
 *   4. og:image / twitter:image      -> medium (brand-ish, sometimes a photo)
 *
 * Every candidate is host/path-validated against a banned list of website
 * builders, review platforms and favicon/placeholder services, and must resolve
 * to an absolute http(s) URL. Anything uncertain returns null so the UI shows
 * initials instead of a wrong mark. Results (including misses) are cached in
 * memory for 24h so we never refetch the same site during a session.
 */

export type LogoConfidence = "high" | "medium" | "low" | "none";

/**
 * Where a logo came from. Only the `website_*` and `favicon` sources are
 * actually produced by this scraper (the business's own domain = our allow
 * list). `google`/`facebook` exist in the union so downstream code and future
 * confidence-gated brand sources can be represented, but platform images are
 * NEVER auto-trusted here — see the banned list below.
 */
export type LogoSource =
  | "website_schema"
  | "website_icon"
  | "website_og"
  | "favicon"
  | "google"
  | "facebook"
  | "fallback";

export interface ResolvedLogo {
  /** Absolute http(s) URL, or null when nothing trustworthy was found. */
  url: string | null;
  source: LogoSource;
  confidence: LogoConfidence;
  /** Human-readable explanation of the decision, for logging/debugging. */
  reason: string;
}

/** The "no trustworthy logo" result — the UI shows initials for this. */
function fallbackLogo(reason: string): ResolvedLogo {
  return { url: null, source: "fallback", confidence: "none", reason };
}

/**
 * Hosts / path fragments that must NEVER be used as a business's brand mark:
 * website builders (their CDNs also serve generic platform art), review
 * platforms, social CDNs, favicon services and placeholder/avatar services.
 */
const BANNED = [
  "wordpress.com",
  "wix",
  "wixstatic",
  "parastorage",
  "pfavico",
  "squarespace",
  "shopify",
  "weebly",
  "godaddy",
  "google",
  "gstatic",
  "ggpht",
  "googleusercontent",
  "fbcdn",
  "facebook",
  "instagram",
  "cdninstagram",
  "tripadvisor",
  "yelp",
  "trustpilot",
  "gravatar",
  "s2/favicons",
  "placeholder",
  "placehold",
  "default-avatar",
  "sprite",
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { value: ResolvedLogo; expires: number }>();

const FETCH_TIMEOUT_MS = 3000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;

/**
 * SSRF guard: reject non-public hosts before fetching. Blocks localhost, the
 * `.local`/`.internal` TLDs, cloud metadata (169.254.169.254), and any private,
 * loopback, link-local or reserved IP literal (v4 and v6). We fetch remote
 * business websites, so every hop must resolve to a genuinely public host.
 */
function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  )
    return false;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local + metadata endpoint
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast / reserved
    )
      return false;
    return true;
  }
  if (h.includes(":")) {
    // IPv6 literal: block loopback, unspecified, link-local, ULA, v4-mapped.
    if (h === "::1" || h === "::") return false;
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return false;
    if (h.startsWith("::ffff:")) return false;
    return true;
  }
  return true;
}

/** Normalise a website value into an absolute http(s) URL, or "" if unusable. */
function normalizeSite(website: string): string {
  const raw = (website || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * True when a resolved absolute URL is safe to use as a logo: http(s), on a
 * public host, and not on a banned builder/platform/placeholder CDN.
 * `requireImageExt` additionally requires an image file extension — enforced
 * for icon/apple-touch/JSON-LD candidates, relaxed only for og/twitter images
 * which are legitimately served extensionless from CDNs.
 */
function isAllowed(absUrl: string, requireImageExt: boolean): boolean {
  let u: URL;
  try {
    u = new URL(absUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!isPublicHost(u.hostname)) return false;
  const hay = (u.host + u.pathname).toLowerCase();
  for (const bad of BANNED) if (hay.includes(bad)) return false;
  if (requireImageExt && !/\.(png|jpe?g|svg|webp|gif)(?:$|[?#])/i.test(u.pathname))
    return false;
  return true;
}

/** Resolve a possibly-relative URL against the page URL; "" on failure. */
function absolutize(candidate: string, base: string): string {
  const c = (candidate || "").trim();
  if (!c || c.startsWith("data:")) return "";
  try {
    return new URL(c, base).toString();
  } catch {
    return "";
  }
}

/** True when the two URLs share the same host (or a subdomain of it). */
function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).host.toLowerCase();
    const hb = new URL(b).host.toLowerCase();
    // Exact host, or one is a subdomain of the other. This avoids the
    // public-suffix trap (e.g. two unrelated `*.com.au` domains) that a naive
    // "last two labels" comparison would wrongly treat as the same site.
    return ha === hb || ha.endsWith("." + hb) || hb.endsWith("." + ha);
  } catch {
    return false;
  }
}

/** Extract the first schema.org/JSON-LD `logo` URL from the HTML, if any. */
function findJsonLdLogo(html: string): string {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!blocks) return "";
  for (const block of blocks) {
    const jsonText = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const found = searchLogo(parsed);
    if (found) return found;
  }
  return "";
}

/** Recursively look for a `logo` (string or {url}) anywhere in a JSON-LD node. */
function searchLogo(node: unknown, depth = 0): string {
  if (!node || depth > 6) return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const f = searchLogo(item, depth + 1);
      if (f) return f;
    }
    return "";
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const logo = obj["logo"];
    if (typeof logo === "string" && logo.trim()) return logo.trim();
    if (logo && typeof logo === "object") {
      const url = (logo as Record<string, unknown>)["url"];
      if (typeof url === "string" && url.trim()) return url.trim();
    }
    for (const key of Object.keys(obj)) {
      const f = searchLogo(obj[key], depth + 1);
      if (f) return f;
    }
  }
  return "";
}

/** Return the href of the largest apple-touch-icon link, if any. */
function findAppleTouchIcon(html: string): string {
  const links = html.match(/<link\b[^>]*>/gi);
  if (!links) return "";
  let best = "";
  let bestSize = -1;
  for (const link of links) {
    if (!/rel=["'][^"']*apple-touch-icon/i.test(link)) continue;
    const href = attr(link, "href");
    if (!href) continue;
    const sizes = attr(link, "sizes");
    const size = sizes ? parseInt(sizes, 10) || 0 : 0;
    if (size > bestSize) {
      bestSize = size;
      best = href;
    }
  }
  return best;
}

/**
 * Return the href of a <link rel="icon"> ONLY when it is a real, scalable
 * png/svg icon. Bare `.ico` favicons are skipped: they are low-quality and
 * frequently a website-builder's generic default, which the trust rule forbids.
 */
function findIconLink(html: string): string {
  const links = html.match(/<link\b[^>]*>/gi);
  if (!links) return "";
  for (const link of links) {
    if (!/rel=["'][^"']*(?:shortcut\s+)?icon["']/i.test(link)) continue;
    const href = attr(link, "href");
    if (!href) continue;
    if (/\.(svg|png)(?:$|[?#])/i.test(href)) return href;
  }
  return "";
}

/** Return an og:image / twitter:image content URL, if any. */
function findMetaImage(html: string): string {
  const metas = html.match(/<meta\b[^>]*>/gi);
  if (!metas) return "";
  for (const key of ["og:image:secure_url", "og:image", "twitter:image"]) {
    for (const meta of metas) {
      const prop = (attr(meta, "property") || attr(meta, "name") || "").toLowerCase();
      if (prop === key) {
        const content = attr(meta, "content");
        if (content) return content;
      }
    }
  }
  return "";
}

/** Read a single HTML attribute value from a tag string. */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return m ? m[1]!.trim() : "";
}

/** Fetch the homepage HTML (bounded time + size); "" on any failure. */
async function fetchHtml(url: string, log?: Logger): Promise<{ html: string; finalUrl: string }> {
  // Follow redirects manually so every hop's host can be SSRF-checked — a
  // public URL must never be able to redirect us into a private network. Each
  // hop gets its own timeout budget (many sites do http->https->www, and one
  // shared budget across all hops made real sites time out and fall to
  // initials).
  let current = url;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    let host: string;
    try {
      host = new URL(current).hostname;
    } catch {
      return { html: "", finalUrl: current };
    }
    if (!isPublicHost(host)) {
      log?.debug({ url: current }, "logo: blocked non-public host");
      return { html: "", finalUrl: current };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; FindBusinessReviewsBot/1.0; +https://findbusinessreviews.com)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { html: "", finalUrl: current };
        try {
          current = new URL(loc, current).toString();
        } catch {
          return { html: "", finalUrl: current };
        }
        continue;
      }
      if (!res.ok) return { html: "", finalUrl: current };
      const type = res.headers.get("content-type") || "";
      if (!type.includes("html")) return { html: "", finalUrl: current };
      const buf = await res.arrayBuffer();
      const bytes =
        buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return { html, finalUrl: current };
    } catch (err) {
      log?.debug({ err, url: current }, "logo: homepage fetch failed");
      return { html: "", finalUrl: current };
    } finally {
      clearTimeout(timer);
    }
  }
  return { html: "", finalUrl: current };
}

/**
 * Resolve a trustworthy brand logo for a business from its official website.
 * Always returns a structured result; `url: null` (confidence "none") means the
 * UI should show initials. The `reason` explains the decision for logging.
 */
export async function resolveWebsiteLogo(
  website: string,
  log?: Logger,
): Promise<ResolvedLogo> {
  const site = normalizeSite(website);
  if (!site) return fallbackLogo("no usable website on record");

  const cacheKey = (() => {
    try {
      return new URL(site).host.toLowerCase();
    } catch {
      return site.toLowerCase();
    }
  })();

  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > now) return hit.value;

  const result = await resolveUncached(site, log);
  cache.set(cacheKey, { value: result, expires: now + CACHE_TTL_MS });
  return result;
}

async function resolveUncached(
  site: string,
  log?: Logger,
): Promise<ResolvedLogo> {
  const { html, finalUrl } = await fetchHtml(site, log);
  if (!html) return fallbackLogo("homepage unreachable or not HTML");

  // Allow-list model: candidates are only sourced from the business's OWN
  // homepage, in priority order. JSON-LD logo (high) -> apple-touch-icon
  // (high) -> icon link png/svg (medium) -> og:image / twitter:image (medium).
  // og/twitter images may be served extensionless from CDNs; all other
  // sources must carry an image file extension.
  const candidates: Array<{
    raw: string;
    source: LogoSource;
    confidence: LogoConfidence;
    requireImageExt: boolean;
  }> = [
    { raw: findJsonLdLogo(html), source: "website_schema", confidence: "high", requireImageExt: true },
    { raw: findAppleTouchIcon(html), source: "website_icon", confidence: "high", requireImageExt: true },
    { raw: findIconLink(html), source: "favicon", confidence: "medium", requireImageExt: true },
    { raw: findMetaImage(html), source: "website_og", confidence: "medium", requireImageExt: false },
  ];

  for (const cand of candidates) {
    if (!cand.raw) continue;
    const abs = absolutize(cand.raw, finalUrl);
    if (!abs || !isAllowed(abs, cand.requireImageExt)) continue;
    // A high-confidence mark that lives off the business's own domain is less
    // certain — keep it, but downgrade to medium.
    const offDomain = !sameSite(abs, finalUrl);
    const confidence: LogoConfidence =
      cand.confidence === "high" && offDomain ? "medium" : cand.confidence;
    const reason = offDomain
      ? `${cand.source} found off the business's own domain (downgraded)`
      : `${cand.source} on the business's own domain`;
    return { url: abs, source: cand.source, confidence, reason };
  }
  return fallbackLogo("no trustworthy logo on homepage");
}
