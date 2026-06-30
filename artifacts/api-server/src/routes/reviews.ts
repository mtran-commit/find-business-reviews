import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { fetchBusinessReviews } from "../lib/serpapi";

const router: IRouter = Router();

const ReviewsQuery = z.object({
  q: z.string().trim().min(1).max(200),
});

router.get("/reviews", async (req, res): Promise<void> => {
  const parsed = ReviewsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A business name (q) is required." });
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
    const data = await fetchBusinessReviews(parsed.data.q, apiKey, req.log);
    if (!data) {
      res
        .status(404)
        .json({ error: "No matching business found. Try a more specific name." });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "SerpApi reviews lookup failed");
    res
      .status(502)
      .json({ error: "Could not fetch reviews right now. Please try again." });
  }
});

export default router;
