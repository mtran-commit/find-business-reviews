import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Loads the REAL single-file app (index.html, inline JS included) in jsdom
 * with a scripted fetch stub, so we can drive two rapid back-to-back searches
 * and control exactly when each Wowlette offers response lands.
 *
 * Protects the search-token guard in loadWowletteOffers: offers from an OLD
 * search must never paint into a NEW search's results.
 */

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8",
);

interface Deferred {
  resolve: (body: unknown) => void;
  reject: (err: unknown) => void;
  promise: Promise<unknown>;
}

function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

/** Minimal phase=core business payload the renderer accepts. */
function coreBusiness(name: string) {
  return {
    name,
    address: "1 Test St, Testville NSW",
    website: "https://example.com",
    phone: "",
    imageUrl: null,
    google: { rating: 4.5, reviews: 120 },
    yelp: null,
    tripadvisor: null,
    trustpilot: null,
    productReview: null,
    facebook: null,
    pending: [], // no phase-2 platform fetches in this test
    unavailable: [],
    demo: [],
    notes: {},
    nearby: [],
  };
}

interface TestApp {
  window: JSDOM["window"];
  /** Wowlette fetch deferreds, keyed by business name, in call order. */
  wowletteCalls: { name: string; d: Deferred }[];
  runSearch: (q: string) => Promise<void>;
  slotHtml: () => string;
  flush: () => Promise<void>;
}

function bootApp(): TestApp {
  const wowletteCalls: { name: string; d: Deferred }[] = [];

  const virtualConsole = new VirtualConsole(); // swallow app console noise
  const dom = new JSDOM(HTML, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.alert = () => {};
      const fetchStub = (input: unknown): Promise<unknown> => {
        const url = String(input);
        if (url.includes("/search-business?")) {
          const q = new URL(url, "http://localhost").searchParams.get("query");
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => coreBusiness(`Biz ${q}`),
          });
        }
        if (url.includes("/wowlette-offers")) {
          const name =
            new URL(url, "http://localhost").searchParams.get("name") || "";
          const d = deferred();
          wowletteCalls.push({ name, d });
          return d.promise as Promise<unknown>;
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).fetch = fetchStub;
    },
  });

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const win = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runSearchFn = (win as any).runSearch as (q: string) => Promise<void>;
  expect(typeof runSearchFn).toBe("function");

  return {
    window: win,
    wowletteCalls,
    runSearch: (q: string) => runSearchFn(q),
    slotHtml: () => {
      const slot = win.document.querySelector(".wowlette-slot");
      return slot ? slot.innerHTML : "";
    },
    flush,
  };
}

function wowletteBody(bizName: string, offerTitle: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      available: true,
      businesses: [
        {
          id: 1,
          name: bizName,
          offers: [
            {
              id: 1,
              title: offerTitle,
              offerType: "Discount",
              description: "",
              terms: "",
              expiryDate: "",
              addToWalletUrl: "https://wowlette.example.com/offer/1",
            },
          ],
        },
      ],
    }),
  };
}

describe("Wowlette offers can never leak from an old search into a new one", () => {
  let app: TestApp;

  beforeEach(() => {
    app = bootApp();
  });

  it("drops a LATE offers response from search #1 after search #2 starts, then shows search #2's offers", async () => {
    // --- Search 1 renders and fires its offers lookup (held open) ---
    await app.runSearch("alpha");
    await app.flush();
    expect(app.wowletteCalls).toHaveLength(1);
    expect(app.wowletteCalls[0]?.name).toBe("Biz alpha");

    // --- Search 2 starts immediately (rapid back-to-back) ---
    await app.runSearch("beta");
    await app.flush();
    expect(app.wowletteCalls).toHaveLength(2);
    expect(app.wowletteCalls[1]?.name).toBe("Biz beta");

    // --- Search 1's offers arrive LATE, after search 2 rendered ---
    app.wowletteCalls[0]?.d.resolve(
      wowletteBody("Biz alpha", "STALE OFFER FROM OLD SEARCH"),
    );
    await app.flush();

    // The stale response must be dropped entirely.
    expect(app.slotHtml()).toBe("");
    expect(app.window.document.body.innerHTML).not.toContain(
      "STALE OFFER FROM OLD SEARCH",
    );

    // --- Search 2's offers arrive and render normally ---
    app.wowletteCalls[1]?.d.resolve(
      wowletteBody("Biz beta", "Fresh beta offer"),
    );
    await app.flush();

    expect(app.slotHtml()).toContain("Fresh beta offer");
    expect(app.slotHtml()).toContain("Biz beta");
    expect(app.slotHtml()).not.toContain("STALE OFFER FROM OLD SEARCH");
  });

  it("also drops the old response when it resolves BEFORE the new search's response", async () => {
    await app.runSearch("alpha");
    await app.flush();
    await app.runSearch("beta");
    await app.flush();

    // Old search resolves first this time — still must be dropped.
    app.wowletteCalls[0]?.d.resolve(wowletteBody("Biz alpha", "Old alpha offer"));
    await app.flush();
    expect(app.slotHtml()).toBe("");

    app.wowletteCalls[1]?.d.resolve(wowletteBody("Biz beta", "Beta offer"));
    await app.flush();
    expect(app.slotHtml()).toContain("Beta offer");
    expect(app.window.document.body.innerHTML).not.toContain("Old alpha offer");
  });

  it("keeps the offers card hidden when the endpoint degrades to {available:false, businesses:[]}", async () => {
    await app.runSearch("gamma");
    await app.flush();

    app.wowletteCalls[0]?.d.resolve({
      ok: true,
      status: 200,
      json: async () => ({ available: false, businesses: [] }),
    });
    await app.flush();

    expect(app.slotHtml()).toBe("");
    expect(app.window.document.querySelector(".wowlette-card")).toBeNull();
  });

  it("keeps the offers card hidden when the endpoint request fails outright", async () => {
    await app.runSearch("delta");
    await app.flush();

    app.wowletteCalls[0]?.d.reject(new Error("network down"));
    await app.flush();

    expect(app.slotHtml()).toBe("");
    // The rest of the results must be unaffected by the offers failure.
    expect(app.window.document.body.textContent).toContain("Biz delta");
  });

  it("keeps the offers card hidden on a non-JSON / non-OK response", async () => {
    await app.runSearch("epsilon");
    await app.flush();

    app.wowletteCalls[0]?.d.resolve({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    await app.flush();

    expect(app.slotHtml()).toBe("");
  });
});
