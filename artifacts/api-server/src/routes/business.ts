import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  fetchBusinessReviews,
  buildDemoOffer,
  detectBusinessCategory,
  fetchSimilarBusinesses,
} from "../lib/serpapi";
import { fetchBusinessBranding } from "../lib/branding";

const router: IRouter = Router();

const SearchQuery = z.object({
  query: z.string().trim().min(1).max(200),
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

  const apiKey = process.env["SERPAPI_API_KEY"];
  if (!apiKey) {
    req.log.error("SERPAPI_API_KEY is not configured");
    res
      .status(503)
      .json({ error: "Reviews service is not configured on the server." });
    return;
  }

  try {
    const data = await fetchBusinessReviews(parsed.data.query, apiKey, req.log);
    if (!data) {
      res
        .status(404)
        .json({ error: "No matching business found. Try a more specific name." });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "SerpApi business lookup failed");
    res
      .status(502)
      .json({ error: "Could not fetch reviews right now. Please try again." });
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

  const apiKey = process.env["SERPAPI_API_KEY"];
  if (!apiKey) {
    req.log.error("SERPAPI_API_KEY is not configured");
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
      apiKey,
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

  const apiKey = process.env["SERPAPI_API_KEY"];
  if (!apiKey) {
    req.log.error("SERPAPI_API_KEY is not configured");
    res
      .status(503)
      .json({ error: "Branding service is not configured on the server." });
    return;
  }

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
      apiKey,
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
