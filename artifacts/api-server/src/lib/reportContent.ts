import { z } from "zod/v4";
import type { BusinessReviews, PlatformRating, NearbyBusiness } from "./serpapi";

/** Fixed legal disclaimer required on every report. */
export const REPORT_DISCLAIMER =
  "This report is generated using available public review data and AI analysis. " +
  "It is intended for business insight purposes only and should not be treated " +
  "as legal, financial or professional advice. Public review data may be " +
  "incomplete or change over time.";

/** Fixed intro shown above the Platform Checklist table. */
export const PLATFORM_CHECKLIST_INTRO =
  "Not every review platform matters equally. This checklist shows which " +
  "platforms are most relevant for your industry and where your reputation " +
  "should be monitored next.";

/** Fixed Trust Score explanation shown with the Platform Checklist. */
export const TRUST_SCORE_EXPLANATION =
  "The Trust Score is calculated from available relevant review platforms. " +
  "Platforms that are not relevant to this business category are not heavily " +
  "weighted.";

/** Data confidence based on how much public review text we could analyse. */
export type DataQuality = "High" | "Medium" | "Low";

/** One platform row in the computed rating overview. */
export interface PlatformRow {
  key: string;
  platform: string;
  rating: string;
  reviews: string;
  note: string;
}

/** A nearby competitor row, computed deterministically from public data. */
export interface CompetitorRow {
  name: string;
  trustScore: number | null;
  averageRating: string;
  reviews: string;
  comparison: string;
  demo: boolean;
}

/** Numeric metrics computed deterministically on the server (not by the AI). */
export interface ReportMetrics {
  trustScore: number | null;
  averageRating: number | null;
  totalReviews: number;
  platformCount: number;
  platforms: PlatformRow[];
  competitors: CompetitorRow[];
  dataQuality: DataQuality;
  snippetCount: number;
}

/** Short, paraphrase-friendly review snippets collected per platform. */
export interface ReviewSnippets {
  google: string[];
  yelp: string[];
  tripadvisor: string[];
}

const RiskEnum = z.enum(["Low", "Medium", "High"]);
const PriorityEnum = z.enum(["Low", "Medium", "High"]);

/** Qualitative sections returned by the AI model (structured for the dashboard). */
const AiSectionsSchema = z.object({
  executiveSummary: z.string().trim().min(1),
  customerSentimentLabel: z.string().trim().default("Mostly Positive"),
  platformMeanings: z
    .object({
      google: z.string().trim().default(""),
      yelp: z.string().trim().default(""),
      tripadvisor: z.string().trim().default(""),
    })
    .default({ google: "", yelp: "", tripadvisor: "" }),
  platformChecklist: z
    .array(
      z.object({
        platform: z.string().trim().min(1),
        relevant: z.string().trim().default(""),
        currentStatus: z.string().trim().default(""),
        recommendedAction: z.string().trim().default(""),
        priority: z.string().trim().default(""),
      }),
    )
    .max(10)
    .default([]),
  sentiment: z
    .object({
      positive: z.number().min(0).max(100).default(0),
      neutral: z.number().min(0).max(100).default(0),
      negative: z.number().min(0).max(100).default(0),
      positiveThemes: z.array(z.string().trim().min(1)).max(8).default([]),
      negativeThemes: z.array(z.string().trim().min(1)).max(8).default([]),
      insight: z.string().trim().default(""),
      estimated: z.boolean().default(true),
    })
    .default({
      positive: 0,
      neutral: 0,
      negative: 0,
      positiveThemes: [],
      negativeThemes: [],
      insight: "",
      estimated: true,
    }),
  topStrengths: z
    .array(
      z.object({
        theme: z.string().trim().min(1),
        explanation: z.string().trim().default(""),
        evidence: z.string().trim().default(""),
      }),
    )
    .max(6)
    .default([]),
  mainComplaints: z
    .array(
      z.object({
        theme: z.string().trim().min(1),
        riskLevel: RiskEnum.default("Low"),
        explanation: z.string().trim().default(""),
        fix: z.string().trim().default(""),
      }),
    )
    .max(6)
    .default([]),
  costingYouCustomers: z.array(z.string().trim().min(1)).max(8).default([]),
  customerLanguage: z
    .object({
      words: z.array(z.string().trim().min(1)).max(12).default([]),
      marketingPhrases: z.array(z.string().trim().min(1)).max(8).default([]),
      avoidPhrases: z.array(z.string().trim().min(1)).max(8).default([]),
    })
    .default({ words: [], marketingPhrases: [], avoidPhrases: [] }),
  competitorConclusion: z.string().trim().default(""),
  recommendedOffer: z
    .object({
      offer: z.string().trim().default(""),
      why: z.string().trim().default(""),
      exampleCopy: z.string().trim().default(""),
    })
    .default({ offer: "", why: "", exampleCopy: "" }),
  reviewImprovement: z
    .object({
      priority: PriorityEnum.default("Medium"),
      why: z.string().trim().default(""),
      action: z.string().trim().default(""),
    })
    .default({ priority: "Medium", why: "", action: "" }),
  sevenDayActionPlan: z
    .array(
      z.object({
        day: z.string().trim().min(1),
        action: z.string().trim().min(1),
      }),
    )
    .max(10)
    .default([]),
  thirtyDayPlan: z
    .array(
      z.object({
        week: z.string().trim().min(1),
        focus: z.string().trim().min(1),
      }),
    )
    .max(8)
    .default([]),
  responseTemplates: z
    .object({
      positive: z.string().trim().default(""),
      negative: z.string().trim().default(""),
    })
    .default({ positive: "", negative: "" }),
  finalRecommendation: z
    .object({
      first: z.string().trim().default(""),
      fastest: z.string().trim().default(""),
      monitor: z.string().trim().default(""),
    })
    .default({ first: "", fastest: "", monitor: "" }),
});

export type AiSections = z.infer<typeof AiSectionsSchema>;

/** Full structured report persisted to report_json and rendered to HTML/PDF. */
export interface BusinessReport {
  businessName: string;
  businessAddress: string;
  category: string;
  suburb: string;
  website: string;
  phone: string;
  generatedAt: string;
  metrics: ReportMetrics;
  sections: AiSections;
  disclaimer: string;
}

const FALLBACK_SUMMARY =
  "This report was generated from available public review data. Some sections " +
  "could not be rendered from the stored data and may be incomplete.";

/** Coerce arbitrary persisted JSON into a valid ReportMetrics (never throws). */
function coerceMetrics(raw: unknown): ReportMetrics {
  const m =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const int = (v: unknown): number => (typeof v === "number" ? v : 0);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const dq = m["dataQuality"];
  return {
    trustScore: num(m["trustScore"]),
    averageRating: num(m["averageRating"]),
    totalReviews: int(m["totalReviews"]),
    platformCount: int(m["platformCount"]),
    platforms: arr<PlatformRow>(m["platforms"]),
    competitors: arr<CompetitorRow>(m["competitors"]),
    dataQuality:
      dq === "High" || dq === "Medium" || dq === "Low" ? dq : "Low",
    snippetCount: int(m["snippetCount"]),
  };
}

/**
 * Normalise arbitrary persisted `reportJson` (including older shapes or partial
 * JSON) into a valid BusinessReport so the HTML/PDF renderers never crash. New-
 * shape reports parse fully; anything the strict AI schema rejects falls back to
 * default sections while preserving the executive summary when it is present.
 */
export function normalizeReport(raw: unknown): BusinessReport {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

  let sections: AiSections;
  const parsed = AiSectionsSchema.safeParse(r["sections"]);
  if (parsed.success) {
    sections = parsed.data;
  } else {
    const rawSec =
      r["sections"] && typeof r["sections"] === "object"
        ? (r["sections"] as Record<string, unknown>)
        : {};
    const summary = str(rawSec["executiveSummary"]).trim() || FALLBACK_SUMMARY;
    sections = AiSectionsSchema.parse({ executiveSummary: summary });
  }

  return {
    businessName: str(r["businessName"], "Business"),
    businessAddress: str(r["businessAddress"]),
    category: str(r["category"]),
    suburb: str(r["suburb"]),
    website: str(r["website"]),
    phone: str(r["phone"]),
    generatedAt: str(r["generatedAt"], new Date().toISOString()),
    metrics: coerceMetrics(r["metrics"]),
    sections,
    disclaimer: str(r["disclaimer"]) || REPORT_DISCLAIMER,
  };
}

function platformRow(
  key: string,
  label: string,
  rating: PlatformRating | null,
  note: string,
): PlatformRow {
  if (!rating) {
    return {
      key,
      platform: label,
      rating: "—",
      reviews: "—",
      note: note || "No public listing found.",
    };
  }
  return {
    key,
    platform: label,
    rating: rating.rating.toFixed(1) + " / 5",
    reviews: rating.reviews.toLocaleString("en-AU"),
    note,
  };
}

function nearbyAverage(n: NearbyBusiness): { avg: number | null; reviews: number } {
  const ratings = [n.google, n.yelp, n.tripadvisor].filter(
    (r): r is PlatformRating => !!r,
  );
  if (ratings.length === 0) return { avg: null, reviews: 0 };
  const avg = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const reviews = ratings.reduce((s, r) => s + r.reviews, 0);
  return { avg, reviews };
}

/** Build competitor comparison rows from the nearby businesses (deterministic). */
export function computeCompetitors(
  data: BusinessReviews,
  businessTrustScore: number | null,
): CompetitorRow[] {
  const nearby = Array.isArray(data.nearby) ? data.nearby : [];
  return nearby.slice(0, 3).map((n) => {
    const { avg, reviews } = nearbyAverage(n);
    const trustScore = avg !== null ? Math.round((avg / 5) * 100) : null;
    let comparison = "Not enough data to compare";
    if (trustScore !== null && businessTrustScore !== null) {
      const diff = businessTrustScore - trustScore;
      if (diff >= 4) comparison = "You are ahead";
      else if (diff <= -4) comparison = "Ahead of you";
      else comparison = "Closely matched";
    }
    return {
      name: n.name,
      trustScore,
      averageRating: avg !== null ? avg.toFixed(1) + " / 5" : "—",
      reviews: reviews > 0 ? reviews.toLocaleString("en-AU") : "—",
      comparison,
      demo: !!n.demo,
    };
  });
}

/** Data quality from the number of public review snippets we could analyse. */
export function computeDataQuality(snippetCount: number): DataQuality {
  if (snippetCount >= 30) return "High";
  if (snippetCount >= 8) return "Medium";
  return "Low";
}

/**
 * Compute the numeric overview from the real, non-demo platform ratings only.
 * Mirrors the client-side Trust Score formula: round(avg / 5 * 100).
 */
export function computeMetrics(
  data: BusinessReviews,
  snippetCount = 0,
): ReportMetrics {
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

  const platforms = entries.map((e) =>
    platformRow(
      e.key,
      e.label,
      demo.has(e.key) ? null : e.rating,
      (data.notes && data.notes[e.key]) || "",
    ),
  );

  return {
    trustScore,
    averageRating: averageRating !== null ? Math.round(averageRating * 10) / 10 : null,
    totalReviews,
    platformCount: available.length,
    platforms,
    competitors: computeCompetitors(data, trustScore),
    dataQuality: computeDataQuality(snippetCount),
    snippetCount,
  };
}

const SYSTEM_PROMPT =
  "You are generating a paid AI Business Reputation Report for a business owner. " +
  "Analyse the available Google, Yelp and TripAdvisor ratings, review counts, " +
  "review snippets, customer sentiment themes and competitor signals provided. " +
  "Provide practical, specific, business-friendly recommendations for an " +
  "Australian business (Australian spelling). Do NOT invent facts, specific " +
  "review quotes, customer names, platforms, competitor names or numbers that " +
  "were not given. Use short paraphrased themes only — never quote long reviews " +
  "or expose private customer information. If review text is limited, say so and " +
  "use careful wording such as 'appears', 'suggests', 'may indicate', 'based on " +
  "available review data'. Never make allegations: write 'this may be costing " +
  "the business potential customers' rather than 'this business is losing " +
  "customers'; write 'some available review samples suggest' rather than " +
  "'customers hate'. Return structured JSON ONLY with EXACTLY these keys:\n" +
  "executiveSummary (string: 3-5 sentences on overall reputation, main " +
  "strengths, main weaknesses, focus areas, and local competitiveness); " +
  "customerSentimentLabel (string: e.g. 'Mostly Positive', 'Positive', 'Mixed'); " +
  "platformMeanings (object {google, yelp, tripadvisor}: each a one-sentence " +
  "business meaning, '' if no listing); " +
  "platformChecklist (array of 4-7 objects {platform, relevant, currentStatus, " +
  "recommendedAction, priority} — a platform monitoring checklist chosen for " +
  "the detected business category. 'platform' is the platform name (e.g. " +
  "'Google', 'Facebook', 'Yelp', 'TripAdvisor', plus industry platforms); " +
  "'relevant' is a short judgement like 'Yes - primary local trust platform' " +
  "or 'Low for this industry'; 'currentStatus' reflects ONLY the data given " +
  "(e.g. 'Active, strong rating', 'No public listing found') — for any " +
  "platform not covered by the data write 'Not checked yet', NEVER invent a " +
  "status; 'recommendedAction' is one practical sentence; 'priority' is " +
  "'High', 'Medium', 'Low' or 'Not relevant'. Always include Google, Yelp and " +
  "TripAdvisor rows plus Facebook and relevant industry platforms. Industry " +
  "guidance: real estate -> Google High, Facebook Medium, " +
  "Realestate.com.au/Domain/RateMyAgent High, Yelp Low, TripAdvisor Low (never " +
  "highly relevant for real estate); restaurants/cafes -> Google High, " +
  "TripAdvisor High, Yelp Medium, Facebook/Instagram Medium, Zomato or local " +
  "food platforms Medium; trades -> Google High, Facebook Medium, " +
  "Hipages/Oneflare/ServiceSeeking High, Yelp Low-Medium, TripAdvisor Not " +
  "relevant; beauty/wellness -> Google High, Facebook Medium, Instagram " +
  "Medium, Fresha/Bookwell/Treatwell High, Yelp Medium. Do NOT punish the " +
  "business when a platform is irrelevant to its industry; use careful " +
  "wording like 'recommended', 'priority', 'secondary signal'); " +
  "sentiment (object {positive, neutral, negative (integers summing to ~100), " +
  "positiveThemes (2-5 short phrases), negativeThemes (0-4 short phrases), " +
  "insight (1-2 sentence AI insight), estimated (boolean, true unless you have " +
  "abundant review text)}); " +
  "topStrengths (array of exactly 3 objects {theme, explanation, evidence} — " +
  "evidence is a short paraphrased theme, not a quote); " +
  "mainComplaints (array of 0-3 objects {theme, riskLevel ('Low'|'Medium'|" +
  "'High'), explanation, fix}); " +
  "costingYouCustomers (array of 3-6 short risk statements); " +
  "customerLanguage (object {words (array), marketingPhrases (array), " +
  "avoidPhrases (array)}); " +
  "competitorConclusion (string: one honest sentence on local standing); " +
  "recommendedOffer (object {offer, why, exampleCopy} — one practical offer " +
  "suited to the industry); " +
  "reviewImprovement (object {priority ('Low'|'Medium'|'High'), why, action}); " +
  "sevenDayActionPlan (array of exactly 7 objects {day, action} with day 'Day 1'" +
  "..'Day 7'); " +
  "thirtyDayPlan (array of exactly 4 objects {week, focus} with week 'Week 1'.." +
  "'Week 4'); " +
  "responseTemplates (object {positive, negative} — professional, business-" +
  "friendly review reply templates); " +
  "finalRecommendation (object {first, fastest, monitor} — what to do first, " +
  "what improves trust fastest, what to monitor next).";

function snippetBlock(label: string, items: string[]): string {
  const clean = items
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((s) => (s.length > 220 ? s.slice(0, 217) + "..." : s));
  if (clean.length === 0) return "";
  return `${label} review snippets (paraphrase only, do not quote):\n` +
    clean.map((s) => `  - ${s}`).join("\n") + "\n";
}

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
  snippets: ReviewSnippets,
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

  const competitorLines =
    metrics.competitors
      .map(
        (c) =>
          `- ${c.name}: trust ${c.trustScore ?? "n/a"}/100, ${c.averageRating}, ${c.reviews} reviews${c.demo ? " (illustrative)" : ""}`,
      )
      .join("\n") || "- No competitor data available.";

  const snippetText =
    snippetBlock("Google", snippets.google) +
    snippetBlock("Yelp", snippets.yelp) +
    snippetBlock("TripAdvisor", snippets.tripadvisor);

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
          (suburb ? `Suburb/location: ${suburb}\n` : "") +
          `Trust Score: ${metrics.trustScore ?? "n/a"} / 100\n` +
          `Average rating across platforms: ${metrics.averageRating ?? "n/a"} / 5\n` +
          `Total reviews counted: ${metrics.totalReviews}\n` +
          `Data quality: ${metrics.dataQuality} (${metrics.snippetCount} review snippets available)\n` +
          `Platform ratings:\n${ratingLines}\n` +
          `Nearby competitors:\n${competitorLines}\n` +
          (snippetText
            ? `\nReview snippets to base themes on:\n${snippetText}`
            : "\nNo review snippet text was available; base themes cautiously on the ratings only and set sentiment.estimated to true."),
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
