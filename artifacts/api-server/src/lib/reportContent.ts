import { z } from "zod/v4";
import type { BusinessReviews, PlatformRating } from "./serpapi";

/** Fixed legal disclaimer required on every report. */
export const REPORT_DISCLAIMER =
  "This report is generated using available public review data and AI analysis. " +
  "It is intended for business insight purposes only and should not be treated " +
  "as legal, financial or professional advice.";

/** One platform row in the computed rating overview. */
export interface PlatformRow {
  platform: string;
  rating: string;
  reviews: string;
  note: string;
}

/** Numeric metrics computed deterministically on the server (not by the AI). */
export interface ReportMetrics {
  trustScore: number | null;
  averageRating: number | null;
  totalReviews: number;
  platformCount: number;
  platforms: PlatformRow[];
}

/** Qualitative sections returned by the AI model. */
const AiSectionsSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  trustScoreOverview: z.string().trim().default(""),
  sentimentAnalysis: z.string().trim().default(""),
  topStrengths: z.array(z.string().trim().min(1)).max(8).default([]),
  mainComplaints: z.array(z.string().trim().min(1)).max(8).default([]),
  riskLevel: z.string().trim().default(""),
  costingYouCustomers: z.string().trim().default(""),
  customerLanguageInsights: z.string().trim().default(""),
  competitorSnapshot: z.string().trim().default(""),
  recommendedOffer: z.string().trim().default(""),
  reviewImprovementOpportunity: z.string().trim().default(""),
  sevenDayActionPlan: z.array(z.string().trim().min(1)).max(12).default([]),
  thirtyDayPlan: z.array(z.string().trim().min(1)).max(12).default([]),
  reviewResponseTemplates: z
    .array(
      z.object({
        scenario: z.string().trim().min(1),
        template: z.string().trim().min(1),
      }),
    )
    .max(6)
    .default([]),
  finalRecommendation: z.string().trim().default(""),
});

export type AiSections = z.infer<typeof AiSectionsSchema>;

/** Full structured report persisted to report_json and rendered into the PDF. */
export interface BusinessReport {
  businessName: string;
  businessAddress: string;
  generatedAt: string;
  metrics: ReportMetrics;
  sections: AiSections;
  disclaimer: string;
}

function platformRow(
  label: string,
  rating: PlatformRating | null,
  note: string,
): PlatformRow | null {
  if (!rating) {
    return { platform: label, rating: "—", reviews: "—", note: note || "No public listing found." };
  }
  return {
    platform: label,
    rating: rating.rating.toFixed(1) + " / 5",
    reviews: rating.reviews.toLocaleString("en-AU"),
    note,
  };
}

/**
 * Compute the numeric overview from the real, non-demo platform ratings only.
 * Mirrors the client-side Trust Score formula: round(avg / 5 * 100).
 */
export function computeMetrics(data: BusinessReviews): ReportMetrics {
  const demo = new Set(data.demo || []);
  const entries: Array<{ key: string; label: string; rating: PlatformRating | null }> = [
    { key: "google", label: "Google", rating: data.google },
    { key: "yelp", label: "Yelp", rating: data.yelp },
    { key: "tripadvisor", label: "TripAdvisor", rating: data.tripadvisor },
  ];

  const available = entries.filter(
    (e) => e.rating && !demo.has(e.key),
  ) as Array<{ key: string; label: string; rating: PlatformRating }>;

  const totalReviews = available.reduce((sum, e) => sum + e.rating.reviews, 0);
  const averageRating =
    available.length > 0
      ? available.reduce((sum, e) => sum + e.rating.rating, 0) / available.length
      : null;
  const trustScore =
    averageRating !== null ? Math.round((averageRating / 5) * 100) : null;

  const platforms = entries
    .map((e) =>
      platformRow(
        e.label,
        demo.has(e.key) ? null : e.rating,
        (data.notes && data.notes[e.key]) || "",
      ),
    )
    .filter((r): r is PlatformRow => r !== null);

  return {
    trustScore,
    averageRating: averageRating !== null ? Math.round(averageRating * 10) / 10 : null,
    totalReviews,
    platformCount: available.length,
    platforms,
  };
}

const SYSTEM_PROMPT =
  "You are an expert small-business reputation consultant writing a paid, " +
  "premium 'AI Business Reputation Report' for a business owner. Base every " +
  "statement ONLY on the real platform ratings and metrics provided. Do NOT " +
  "invent specific review quotes, ratings, platforms, competitor names, or " +
  "numbers that were not given. Where a platform has no listing, treat it as " +
  "'not applicable' rather than a negative. Be honest, specific and practical; " +
  "avoid generic filler. Australian business context and spelling. Return JSON " +
  "ONLY with exactly these keys: executiveSummary (2-4 sentence paragraph), " +
  "trustScoreOverview (2-3 sentences interpreting the trust score and ratings), " +
  "sentimentAnalysis (short paragraph), topStrengths (array of 3-5 short " +
  "phrases), mainComplaints (array of 0-4 short phrases; empty if the ratings " +
  "give no basis), riskLevel (one of: Low, Moderate, Elevated, High — with a " +
  "half-sentence why), costingYouCustomers (short paragraph on likely lost " +
  "business), customerLanguageInsights (short paragraph on the words customers " +
  "likely use), competitorSnapshot (short paragraph; general, no invented " +
  "names), recommendedOffer (one concrete offer idea to win more bookings), " +
  "reviewImprovementOpportunity (short paragraph), sevenDayActionPlan (array of " +
  "4-7 concrete steps), thirtyDayPlan (array of 4-7 concrete steps), " +
  "reviewResponseTemplates (array of 2-3 objects {scenario, template} — e.g. " +
  "responding to a happy review and to a critical review), finalRecommendation " +
  "(2-3 sentences).";

/**
 * Generate the qualitative report sections via OpenAI. The OpenAI client is
 * imported lazily so a missing integration surfaces as a thrown error the caller
 * turns into a clean failure state, rather than crashing server boot.
 */
export async function generateAiSections(
  businessName: string,
  metrics: ReportMetrics,
  category: string,
  suburb: string,
): Promise<AiSections> {
  if (
    !process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ||
    !process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]
  ) {
    throw new Error("OpenAI integration is not configured.");
  }

  const ratingLines =
    metrics.platforms
      .map((p) => `- ${p.platform}: ${p.rating} from ${p.reviews} reviews`)
      .join("\n") || "- No public platform ratings were available.";

  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Business: ${businessName}\n` +
          (category ? `Industry/category: ${category}\n` : "") +
          (suburb ? `Suburb: ${suburb}\n` : "") +
          `Trust Score: ${metrics.trustScore ?? "n/a"} / 100\n` +
          `Average rating across platforms: ${metrics.averageRating ?? "n/a"} / 5\n` +
          `Total reviews counted: ${metrics.totalReviews}\n` +
          `Platform ratings:\n${ratingLines}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("Empty AI response.");

  const parsed = AiSectionsSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("AI report failed validation.");
  }
  return parsed.data;
}
