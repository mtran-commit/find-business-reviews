import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { fetchWowletteOffers } from "./wowlette";

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

// Each test uses a unique business name so the module-level 10-min cache
// can never leak a result from one test into another.
let n = 0;
const uniqueName = () => `test business ${Date.now()}-${++n}`;

const EMPTY = { available: false, businesses: [] };

describe("fetchWowletteOffers degrades to {available:false, businesses:[]}", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["WOWLETTE_BASE_URL"] = "https://wowlette.example.com";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env["WOWLETTE_BASE_URL"];
    vi.clearAllMocks();
  });

  it("returns empty when the upstream request times out / aborts", async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
  });

  it("returns empty when the upstream payload fails schema validation", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            businesses: [
              {
                // invalid: no id/name, offer missing required fields
                offers: [{ title: "" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
  });

  it("returns empty when the upstream payload is not JSON at all", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("<html>oops</html>", { status: 200 }),
    ) as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
  });

  it("returns empty when the upstream responds non-2xx", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
  });

  it("rejects offers whose addToWalletUrl is not http(s)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            businesses: [
              {
                id: 1,
                name: "Evil Biz",
                offers: [
                  {
                    id: 1,
                    title: "Free hack",
                    addToWalletUrl: "javascript:alert(1)",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
  });

  it("returns empty without fetching when WOWLETTE_BASE_URL is unset", async () => {
    delete process.env["WOWLETTE_BASE_URL"];
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(fetchWowletteOffers(uniqueName(), log)).resolves.toEqual(
      EMPTY,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("sanity: a valid payload with offers is returned as available", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            businesses: [
              {
                id: 7,
                name: "Good Biz",
                offers: [
                  {
                    id: 1,
                    title: "10% off",
                    addToWalletUrl: "https://wowlette.example.com/offer/1",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const result = await fetchWowletteOffers(uniqueName(), log);
    expect(result.available).toBe(true);
    expect(result.businesses).toHaveLength(1);
    expect(result.businesses[0]?.name).toBe("Good Biz");
  });
});
