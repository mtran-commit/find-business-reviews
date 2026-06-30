import { Router, type IRouter } from "express";
import { z } from "zod/v4";

const router: IRouter = Router();

const PlatformInput = z.object({
  label: z.string().trim().min(1).max(60),
  rating: z.number().min(0).max(5),
  reviews: z.number().int().min(0),
});

const AnalyzeBody = z.object({
  name: z.string().trim().min(1).max(200),
  platforms: z.array(PlatformInput).min(1).max(10),
  offerAvailable: z.boolean().optional().default(false),
});

/** Shape the model is asked to return; missing fields fall back on the client. */
const AnalysisSchema = z.object({
  reviewSummary: z.string().trim().min(1),
  bestFor: z.array(z.string().trim().min(1)).max(6).default([]),
  redFlags: z.array(z.string().trim().min(1)).max(6).default([]),
  reputationTrend: z.string().trim().default(""),
  offerSummary: z.string().trim().default(""),
});

/**
 * AI review analysis. Uses OpenAI to produce ONLY qualitative, plain-language
 * analysis of the real platform ratings sent by the client. Numeric values
 * (trust score, averages) are computed deterministically on the client and are
 * intentionally not delegated to the model. Returns a structured JSON object.
 */
router.post("/analyze-reviews", async (req, res): Promise<void> => {
  const parsed = AnalyzeBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "A business name and at least one platform rating are required." });
    return;
  }

  if (
    !process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ||
    !process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]
  ) {
    req.log.error("OpenAI integration is not configured");
    res
      .status(503)
      .json({ error: "AI analysis service is not configured on the server." });
    return;
  }

  const { name, platforms, offerAvailable } = parsed.data;
  const lines = platforms
    .map((p) => `- ${p.label}: ${p.rating.toFixed(1)}/5 from ${p.reviews} reviews`)
    .join("\n");

  try {
    // Imported lazily so a missing OpenAI integration returns a clean 503
    // above instead of throwing at module load and crashing server startup.
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise, consumer-friendly review analyst. Analyse ONLY " +
            "the real platform ratings provided. Do not invent ratings, review " +
            "text, platforms, or offers. Use simple language. Return JSON only " +
            "with exactly these keys: reviewSummary (a 2-3 sentence plain-language " +
            "paragraph noting agreement or gaps between platforms), bestFor (array " +
            "of 2-4 short tag phrases), redFlags (array of 0-3 short concerns; " +
            "empty array if none), reputationTrend (one short sentence), " +
            "offerSummary (one short sentence; if no public offer is available, " +
            "say that no public offer was found today).",
        },
        {
          role: "user",
          content:
            `Business: ${name}\nReal platform ratings:\n${lines}\n` +
            `Public offer available: ${offerAvailable ? "yes" : "no"}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      res.status(502).json({ error: "Could not generate analysis right now." });
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      req.log.warn("OpenAI analysis was not valid JSON");
      res.status(502).json({ error: "Could not generate analysis right now." });
      return;
    }

    const analysis = AnalysisSchema.safeParse(json);
    if (!analysis.success) {
      req.log.warn({ issues: analysis.error.issues }, "OpenAI analysis failed validation");
      res.status(502).json({ error: "Could not generate analysis right now." });
      return;
    }

    res.json(analysis.data);
  } catch (err) {
    req.log.error({ err }, "OpenAI analysis generation failed");
    res
      .status(502)
      .json({ error: "Could not generate analysis right now. Please try again." });
  }
});

export default router;
