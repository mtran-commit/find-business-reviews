import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

/**
 * Validates that the homepage JSON-LD structured-data block and key
 * social/canonical meta tags are well-formed and contain the required values.
 *
 * These checks mirror what Google's Rich Results Test inspects so regressions
 * are caught before they reach production.
 */

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8",
);

// Parse once for all tests
const dom = new JSDOM(HTML, { url: "https://findbusinessreviews.com/" });
const doc = dom.window.document;

// ─── JSON-LD helpers ────────────────────────────────────────────────────────

/**
 * Returns every parsed JSON-LD object (or @graph item) from all
 * <script type="application/ld+json"> blocks in the document.
 */
function extractLdItems(): Record<string, unknown>[] {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const items: Record<string, unknown>[] = [];
  for (const script of scripts) {
    const parsed = JSON.parse(script.textContent ?? "");
    if (
      parsed &&
      typeof parsed === "object" &&
      "@graph" in parsed &&
      Array.isArray((parsed as { "@graph": unknown[] })["@graph"])
    ) {
      items.push(...(parsed as { "@graph": Record<string, unknown>[] })["@graph"]);
    } else {
      items.push(parsed as Record<string, unknown>);
    }
  }
  return items;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Structured data — JSON-LD", () => {
  it("has at least one <script type='application/ld+json'> block", () => {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it("every JSON-LD block parses as valid JSON", () => {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    for (const script of scripts) {
      expect(() => JSON.parse(script.textContent ?? "")).not.toThrow();
    }
  });

  it("contains a WebApplication schema", () => {
    const items = extractLdItems();
    const found = items.some((item) => item["@type"] === "WebApplication");
    expect(found, "Expected a @type:WebApplication schema item").toBe(true);
  });

  it("contains a WebSite schema", () => {
    const items = extractLdItems();
    const found = items.some((item) => item["@type"] === "WebSite");
    expect(found, "Expected a @type:WebSite schema item").toBe(true);
  });

  it("contains an Organization schema", () => {
    const items = extractLdItems();
    const found = items.some((item) => item["@type"] === "Organization");
    expect(found, "Expected a @type:Organization schema item").toBe(true);
  });

  it("WebSite schema has a SearchAction with a urlTemplate", () => {
    const items = extractLdItems();
    const website = items.find((item) => item["@type"] === "WebSite") as
      | Record<string, unknown>
      | undefined;
    expect(website, "WebSite schema must exist").toBeDefined();
    const action = website?.["potentialAction"] as Record<string, unknown> | undefined;
    expect(action?.["@type"]).toBe("SearchAction");
    const target = action?.["target"] as Record<string, unknown> | string | undefined;
    const urlTemplate =
      typeof target === "string"
        ? target
        : (target as Record<string, unknown> | undefined)?.["urlTemplate"];
    expect(typeof urlTemplate).toBe("string");
    expect(urlTemplate as string).toContain("{search_term_string}");
  });

  it("Organization schema has a name and url", () => {
    const items = extractLdItems();
    const org = items.find((item) => item["@type"] === "Organization") as
      | Record<string, unknown>
      | undefined;
    expect(org, "Organization schema must exist").toBeDefined();
    expect(typeof org?.["name"]).toBe("string");
    expect((org?.["name"] as string).length).toBeGreaterThan(0);
    expect(typeof org?.["url"]).toBe("string");
    expect((org?.["url"] as string).length).toBeGreaterThan(0);
  });

  it("WebApplication schema has an offers block with a price and priceCurrency", () => {
    const items = extractLdItems();
    const app = items.find((item) => item["@type"] === "WebApplication") as
      | Record<string, unknown>
      | undefined;
    expect(app, "WebApplication schema must exist").toBeDefined();
    const offers = app?.["offers"] as Record<string, unknown> | undefined;
    expect(offers?.["@type"]).toBe("Offer");
    expect(typeof offers?.["price"]).not.toBe("undefined");
    expect(typeof offers?.["priceCurrency"]).toBe("string");
  });
});

describe("Meta tags — social and canonical", () => {
  function metaContent(selector: string): string {
    return doc.querySelector(selector)?.getAttribute("content") ?? "";
  }

  it("og:image is present and non-empty", () => {
    const content = metaContent('meta[property="og:image"]');
    expect(content.length, "og:image must be non-empty").toBeGreaterThan(0);
  });

  it("og:image is an absolute URL", () => {
    const content = metaContent('meta[property="og:image"]');
    expect(content).toMatch(/^https?:\/\//);
  });

  it("twitter:image is present and non-empty", () => {
    const content = metaContent('meta[name="twitter:image"]');
    expect(content.length, "twitter:image must be non-empty").toBeGreaterThan(0);
  });

  it("twitter:image is an absolute URL", () => {
    const content = metaContent('meta[name="twitter:image"]');
    expect(content).toMatch(/^https?:\/\//);
  });

  it("canonical link is present and non-empty", () => {
    const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
    expect(href.length, "canonical href must be non-empty").toBeGreaterThan(0);
  });

  it("canonical link is an absolute URL", () => {
    const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
    expect(href).toMatch(/^https?:\/\//);
  });

  it("og:title is present and non-empty", () => {
    const content = metaContent('meta[property="og:title"]');
    expect(content.length, "og:title must be non-empty").toBeGreaterThan(0);
  });

  it("twitter:card is present and non-empty", () => {
    const content = metaContent('meta[name="twitter:card"]');
    expect(content.length, "twitter:card must be non-empty").toBeGreaterThan(0);
  });
});
