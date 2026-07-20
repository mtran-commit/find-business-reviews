import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  fetchBusinessReviews,
  fetchBusinessCore,
  resolvePlatformRating,
  SLOW_PLATFORM_KEYS,
  buildDemoOffer,
  detectBusinessCategory,
  fetchSimilarBusinesses,
} from "../lib/serpapi";
import { fetchBusinessBranding } from "../lib/branding";
import { getDataforseoCreds } from "../lib/dataforseo";
import { fetchWowletteOffers } from "../lib/wowlette";

const router: IRouter = Router();

const SearchQuery = z.object({
  query: z.string().trim().min(1).max(200),
  // Optional raw location string (address / postcode / city) kept separate from
  // the combined keyword so the backend can detect the country and score candidates.
  location: z.string().trim().max(300).optional().default(""),
  // `phase=core` returns the fast Google-only profile (a few seconds); the
  // client then resolves the slow platforms one-by-one. Omitted = full lookup
  // (kept for backwards compatibility and report generation).
  phase: z.enum(["core", "full"]).optional().default("full"),
});

/**
 * Primary lookup. Returns the full business profile, per-platform ratings,
 * an offer (demo for now) and nearby comparison businesses. API keys stay on
 * the server — `SERPAPI_API_KEY` never reaches the browser.
 */
router.get("/search-business", async (req, res): Promise<void> => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A business name (query) is required." });
    return;
  }

  const creds = getDataforseoCreds();
  if (!creds) {
    req.log.error("DataForSEO credentials are not configured");
    res
      .status(503)
      .json({ error: "Reviews service is not configured on the server." });
    return;
  }
  const serpApiKey = process.env["SERPAPI_API_KEY"] ?? null;

  const location = parsed.data.location || undefined;

  try {
    const data =
      parsed.data.phase === "core"
        ? await fetchBusinessCore(parsed.data.query, creds, req.log, location)
        : await fetchBusinessReviews(
            parsed.data.query,
            creds,
            serpApiKey,
            req.log,
            location,
          );
    if (!data) {
      res.status(404).json({
        error: "No exact business found for that name and location. Check the spelling or try adding the suburb and country.",
        noMatch: true,
      });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "DataForSEO business lookup failed");
    res
      .status(502)
      .json({ error: "Could not fetch reviews right now. Please try again." });
  }
});

const PlatformQuery = z.object({
  query: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(300).optional().default(""),
  platform: z.enum(SLOW_PLATFORM_KEYS),
});

// Server-side cap so a single platform lookup can never exceed a mobile
// WebView's ~60s hard request timeout; a timed-out platform degrades honestly.
const PLATFORM_LOOKUP_TIMEOUT_MS = 50_000;

/**
 * Phase-2 lookup: resolve ONE slow platform's rating for a business already
 * identified by the core lookup. The client fires these in parallel and fills
 * results in as each lands, so no request approaches the iOS 60s limit.
 */
router.get("/search-business-platform", async (req, res): Promise<void> => {
  const parsed = PlatformQuery.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "query, name and platform are required." });
    return;
  }

  const creds = getDataforseoCreds();
  if (!creds) {
    req.log.error("DataForSEO credentials are not configured");
    res
      .status(503)
      .json({ error: "Reviews service is not configured on the server." });
    return;
  }
  const serpApiKey = process.env["SERPAPI_API_KEY"] ?? null;
  const { platform, name, address, query } = parsed.data;

  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ rating: null; note: string }>((resolve) => {
      timer = setTimeout(
        () => resolve({ rating: null, note: "Lookup timed out" }),
        PLATFORM_LOOKUP_TIMEOUT_MS,
      );
    });
    const result = await Promise.race([
      resolvePlatformRating(
        platform,
        name,
        address,
        query,
        creds,
        serpApiKey,
        req.log,
      ),
      timeout,
    ]).finally(() => clearTimeout(timer));
    res.json({
      platform,
      rating: result.rating ?? null,
      note: result.note ?? null,
    });
  } catch (err) {
    req.log.error({ err, platform }, "Platform lookup failed");
    res.status(502).json({ error: "Could not fetch this platform right now." });
  }
});

const OffersQuery = z.object({
  businessName: z.string().trim().min(1).max(200),
  website: z.string().trim().max(500).optional().default(""),
});

/**
 * Offer lookup. Demo/placeholder data for now (flagged `demo: true`). Later
 * this should search public results ("<name> discount/coupon/promo/offer") and
 * only return `available: true` for a credible result.
 */
router.get("/find-offers", (req, res): void => {
  const parsed = OffersQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A businessName is required." });
    return;
  }
  res.json(buildDemoOffer(parsed.data.businessName, parsed.data.website));
});

const WowletteQuery = z.object({
  name: z.string().trim().min(1).max(200),
});

/**
 * Live offers for a business on Wowlette (the user's partner app). Proxied
 * server-side so the Wowlette domain stays configurable via WOWLETTE_BASE_URL.
 * Always 200 with `{ available, businesses }` — never an error, never slows
 * the review search (the frontend calls this in parallel, fire-and-forget).
 */
router.get("/wowlette-offers", async (req, res): Promise<void> => {
  const parsed = WowletteQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A business name is required." });
    return;
  }
  const result = await fetchWowletteOffers(parsed.data.name, req.log);
  res.json(result);
});

const SimilarQuery = z.object({
  category: z.string().trim().min(1).max(80),
  suburb: z.string().trim().min(1).max(80),
  state: z.string().trim().max(10).optional().default(""),
  businessName: z.string().trim().max(200).optional().default(""),
});

/**
 * Similar businesses matched by BOTH category and suburb. Searches SerpApi for
 * "<category> near <suburb> <state> Australia", excludes the searched business,
 * and falls back to category+suburb demo data when no real peers are found.
 */
router.get("/similar-businesses", async (req, res): Promise<void> => {
  const parsed = SimilarQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "category and suburb are required." });
    return;
  }

  const creds = getDataforseoCreds();
  if (!creds) {
    req.log.error("DataForSEO credentials are not configured");
    res
      .status(503)
      .json({ error: "Reviews service is not configured on the server." });
    return;
  }

  const { category: catTerm, suburb, state, businessName } = parsed.data;
  // Normalise the requested category through the same detector so labels and
  // search terms stay consistent with the main lookup.
  const category = detectBusinessCategory(catTerm, catTerm, [catTerm]);

  try {
    const results = await fetchSimilarBusinesses(
      category,
      { suburb, state },
      businessName,
      creds,
      req.log,
    );
    res.json({
      category,
      locality: { suburb, state },
      results,
      demo: results.some((r) => r.demo),
    });
  } catch (err) {
    req.log.error({ err }, "Similar-business lookup failed");
    res
      .status(502)
      .json({ error: "Could not fetch similar businesses right now." });
  }
});

const BrandingQuery = z.object({
  businessName: z.string().trim().min(1).max(200),
  suburb: z.string().trim().max(80).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  website: z.string().trim().max(500).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
});

/**
 * Public branding + social proof lookup (Facebook / Instagram via SerpApi,
 * confidence-matched, cached 24h server-side). Used by the paid-report preview
 * card. Only confidently matched public business profiles are ever returned.
 */
router.get("/business-branding", async (req, res): Promise<void> => {
  const parsed = BrandingQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A businessName is required." });
    return;
  }

  const creds = getDataforseoCreds();
  if (!creds) {
    req.log.error("DataForSEO credentials are not configured");
    res
      .status(503)
      .json({ error: "Branding service is not configured on the server." });
    return;
  }
  const serpApiKey = process.env["SERPAPI_API_KEY"] ?? null;

  const q = parsed.data;
  try {
    const branding = await fetchBusinessBranding(
      {
        businessName: q.businessName,
        businessAddress: q.address,
        suburb: q.suburb,
        website: q.website,
        phone: q.phone,
      },
      serpApiKey,
      creds,
      req.log,
    );
    res.json(branding);
  } catch (err) {
    req.log.error({ err }, "Branding lookup failed");
    res
      .status(502)
      .json({ error: "Could not fetch branding right now." });
  }
});

export default router;
