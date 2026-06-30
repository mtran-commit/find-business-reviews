import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  fetchBusinessReviews,
  buildDemoOffer,
  demoReviewPay,
} from "../lib/serpapi";

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

const ReviewPayQuery = z.object({
  businessName: z.string().trim().min(1).max(200),
});

/**
 * Review Pay status. Internal platform — demo/placeholder data for now until
 * the real Review Pay database is connected.
 */
router.get("/reviewpay-reviews", (req, res): void => {
  const parsed = ReviewPayQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A businessName is required." });
    return;
  }
  const rating = demoReviewPay(parsed.data.businessName);
  res.json({ available: true, reviewpay: rating, demo: true });
});

export default router;
