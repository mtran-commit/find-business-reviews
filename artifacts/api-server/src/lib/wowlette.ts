import { z } from "zod/v4";
import type { Logger } from "pino";

/**
 * Wowlette partner integration: checks the user's other Replit app (Wowlette)
 * for live offers matching a business name, via its public no-auth endpoint
 * `GET <WOWLETTE_BASE_URL>/api/public/offers/search?name=<business name>`.
 *
 * Design rules:
 * - NEVER fails or slows the review search: any error/timeout/missing config
 *   degrades to an empty result.
 * - Response is zod-validated; `addToWalletUrl` must be http(s) so no unsafe
 *   URL is ever forwarded to the browser.
 * - Small in-memory cache (10 min) to avoid hammering Wowlette on repeats.
 */

const OfferSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().trim().min(1).max(300),
  offerType: z.string().trim().max(100).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  terms: z.string().trim().max(2000).optional().default(""),
  expiryDate: z.string().trim().max(40).optional().default(""),
  addToWalletUrl: z
    .string()
    .trim()
    .refine((u) => /^https?:\/\//i.test(u), "addToWalletUrl must be http(s)"),
});

const BusinessSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().trim().min(1).max(300),
  address: z.string().trim().max(500).optional().default(""),
  website: z.string().trim().max(500).optional().default(""),
  offers: z.array(OfferSchema).default([]),
});

const SearchResponseSchema = z.object({
  businesses: z.array(BusinessSchema).default([]),
});

export type WowletteBusiness = z.infer<typeof BusinessSchema>;

export interface WowletteOffersResult {
  available: boolean;
  businesses: WowletteBusiness[];
}

const EMPTY: WowletteOffersResult = { available: false, businesses: [] };

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const cache = new Map<string, { at: number; result: WowletteOffersResult }>();

function getBaseUrl(): string | null {
  const raw = (process.env["WOWLETTE_BASE_URL"] ?? "").trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export async function fetchWowletteOffers(
  name: string,
  log: Logger,
): Promise<WowletteOffersResult> {
  const base = getBaseUrl();
  if (!base) return EMPTY;

  const key = name.trim().toLowerCase();
  if (!key) return EMPTY;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let result = EMPTY;
  try {
    const url = `${base}/api/public/offers/search?name=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const parsed = SearchResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        const businesses = parsed.data.businesses.filter(
          (b) => b.offers.length > 0,
        );
        result = { available: businesses.length > 0, businesses };
      } else {
        log.warn(
          { err: parsed.error.message },
          "Wowlette offers response failed validation",
        );
      }
    } else {
      log.warn({ status: res.status }, "Wowlette offers lookup failed");
    }
  } catch (err) {
    log.warn({ err }, "Wowlette offers lookup errored");
  }

  cache.set(key, { at: Date.now(), result });
  return result;
}
