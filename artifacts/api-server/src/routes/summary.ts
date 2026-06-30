import { Router, type IRouter } from "express";
import { z } from "zod/v4";

const router: IRouter = Router();

const PlatformInput = z.object({
  label: z.string().trim().min(1).max(60),
  rating: z.number().min(0).max(5),
  reviews: z.number().int().min(0),
});

const SummaryBody = z.object({
  name: z.string().trim().min(1).max(200),
  platforms: z.array(PlatformInput).min(1).max(10),
});

router.post("/summary", async (req, res): Promise<void> => {
  const parsed = SummaryBody.safeParse(req.body);
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
      .json({ error: "AI summary service is not configured on the server." });
    return;
  }

  const { name, platforms } = parsed.data;
  const lines = platforms
    .map((p) => `- ${p.label}: ${p.rating.toFixed(1)}/5 from ${p.reviews} reviews`)
    .join("\n");

  try {
    // Imported lazily so a missing OpenAI integration returns a clean 503
    // above instead of throwing at module load and crashing server startup.
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a concise review analyst. Write a 2-3 sentence plain-language " +
            "summary of a business's reputation based ONLY on the real platform " +
            "ratings provided. Note any meaningful agreement or gap between platforms. " +
            "Do not invent ratings, review text, or platforms that were not given. " +
            "Avoid bullet points; return a single short paragraph.",
        },
        {
          role: "user",
          content: `Business: ${name}\nReal platform ratings:\n${lines}`,
        },
      ],
    });

    const summary = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!summary) {
      res.status(502).json({ error: "Could not generate a summary right now." });
      return;
    }
    res.json({ summary });
  } catch (err) {
    req.log.error({ err }, "OpenAI summary generation failed");
    res
      .status(502)
      .json({ error: "Could not generate a summary right now. Please try again." });
  }
});

export default router;
