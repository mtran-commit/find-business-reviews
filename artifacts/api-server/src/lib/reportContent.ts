import { z } from "zod/v4";
import type { BusinessReviews, PlatformRating, NearbyBusiness } from "./serpapi";

/** Fixed legal disclaimer required on every report. */
export const REPORT_DISCLAIMER =
  "This report is generated using available public review data, third-party " +
  "platform signals and AI analysis. AI-generated content may contain errors, " +
  "omissions, incorrect assumptions or incomplete interpretations. Public " +
  "review data may be incomplete, outdated or unavailable and may change after " +
  "the report is generated. This report is provided for general business " +
  "insight purposes only and should not be treated as legal, financial, " +
  "accounting, marketing or professional advice. Find Business Reviews accepts " +
  "no liability for decisions made based on this report; important information " +
  "should be verified independently before acting on it. This report does not " +
  "guarantee improved ratings, sales, bookings, rankings or revenue.";

/** Fixed 'Important Notice' card shown under the KPI cards on page 1. */
export const REPORT_IMPORTANT_NOTICE =
  "This report is generated using available public review data and AI " +
  "analysis. AI may make mistakes, and public data may be incomplete, " +
  "outdated or unavailable. This report is provided for general business " +
  "insight only and does not guarantee improved ratings, sales, bookings, " +
  "rankings or revenue.";

/** Fixed 'Data Cut-Off' notice shown on page 1 and near the final disclaimer. */
export const REPORT_DATA_CUTOFF =
  "This report reflects available public review data at or around the " +
  "generated date. Ratings, review counts, review text, business information " +
  "and competitor data may change after this report is produced.";

/** Fixed 'How to Use This Report' copy shown near the start of the report. */
export const HOW_TO_USE_REPORT =
  "Use this report to understand what customers appear to value, what may be " +
  "creating hesitation, and which reputation actions should be prioritised. " +
  "This report should be reviewed together with your own business records, " +
  "staff feedback and customer service data.";

/** Fixed note shown above the competitor table (indicative comparison only). */
export const COMPETITOR_NOTE =
  "Competitor information is provided as an indicative comparison only where " +
  "verified competitor data is limited. Use this section as a guide, not as a " +
  "definitive ranking.";

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

/** A Google review topic chip: a customer theme + how many reviews mention it. */
export interface ReviewTag {
  tag: string;
  count: number;
}

/** Short, paraphrase-friendly review snippets collected per platform. */
export interface ReviewSnippets {
  google: string[];
  yelp: string[];
  tripadvisor: string[];
  trustpilot: string[];
  /** Google review topic chips (e.g. "auction — 34 mentions"); [] when none. */
  googleTopics: ReviewTag[];
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
      trustpilot: z.string().trim().default(""),
      productReview: z.string().trim().default(""),
      facebook: z.string().trim().default(""),
    })
    .default({
      google: "",
      yelp: "",
      tripadvisor: "",
      trustpilot: "",
      productReview: "",
      facebook: "",
    }),
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
        businessImpact: z.string().trim().default(""),
      }),
    )
    .max(6)
    .default([]),
  costingYouCustomers: z.array(z.string().trim().min(1)).max(8).default([]),
  commercialImpact: z.array(z.string().trim().min(1)).max(6).default([]),
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
      biggestRisk: z.string().trim().default(""),
      marketingOpportunity: z.string().trim().default(""),
    })
    .default({
      first: "",
      fastest: "",
      monitor: "",
      biggestRisk: "",
      marketingOpportunity: "",
    }),
  executiveSnapshot: z
    .object({
      customersLove: z.array(z.string().trim().min(1)).max(3).default([]),
      mainRisks: z.array(z.string().trim().min(1)).max(3).default([]),
      doFirst: z.string().trim().default(""),
      monitorNext: z.string().trim().default(""),
    })
    .default({ customersLove: [], mainRisks: [], doFirst: "", monitorNext: "" }),
  customerVoiceSummary: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        text: z.string().trim().default(""),
      }),
    )
    .max(5)
    .default([]),
  topActionsThisWeek: z.array(z.string().trim().min(1)).max(3).default([]),
  analytics: z
    .object({
      trustScoreTrend: z
        .object({
          direction: z.string().trim().default("Unknown"),
          explanation: z.string().trim().default(""),
        })
        .default({ direction: "Unknown", explanation: "" }),
      reviewVolumeInsight: z.string().trim().default(""),
      ratingGapInsight: z.string().trim().default(""),
      complaintFrequency: z
        .array(
          z.object({
            issue: z.string().trim().min(1),
            frequency: z.string().trim().default(""),
            note: z.string().trim().default(""),
          }),
        )
        .max(6)
        .default([]),
      lostCustomerRisk: z
        .object({
          level: z.string().trim().default(""),
          factors: z.array(z.string().trim().min(1)).max(5).default([]),
        })
        .default({ level: "", factors: [] }),
      growthOpportunity: z
        .object({
          level: z.string().trim().default(""),
          score: z.number().min(0).max(100).nullable().default(null),
          focusAreas: z.array(z.string().trim().min(1)).max(4).default([]),
          rationale: z.string().trim().default(""),
        })
        .default({ level: "", score: null, focusAreas: [], rationale: "" }),
    })
    .default({
      trustScoreTrend: { direction: "Unknown", explanation: "" },
      reviewVolumeInsight: "",
      ratingGapInsight: "",
      complaintFrequency: [],
      lostCustomerRisk: { level: "", factors: [] },
      growthOpportunity: { level: "", score: null, focusAreas: [], rationale: "" },
    }),
  customerVoiceAnalysis: z
    .object({
      reviewTags: z
        .array(
          z.object({
            tag: z.string().trim().min(1),
            count: z.number().min(0).default(0),
            customerMeaning: z.string().trim().default(""),
            businessAction: z.string().trim().default(""),
          }),
        )
        .max(15)
        .default([]),
      whatCustomersLove: z
        .array(
          z.object({
            theme: z.string().trim().min(1),
            explanation: z.string().trim().default(""),
            evidence: z.string().trim().default(""),
            opportunity: z.string().trim().default(""),
            confidence: z.string().trim().default(""),
            confidenceBasis: z.string().trim().default(""),
          }),
        )
        .max(6)
        .default([]),
      customerConcerns: z
        .array(
          z.object({
            theme: z.string().trim().min(1),
            riskLevel: z.string().trim().default(""),
            explanation: z.string().trim().default(""),
            recommendedFix: z.string().trim().default(""),
            businessImpact: z.string().trim().default(""),
            confidence: z.string().trim().default(""),
            confidenceBasis: z.string().trim().default(""),
          }),
        )
        .max(6)
        .default([]),
      concernsNote: z.string().trim().default(""),
      clientExpectationMap: z.array(z.string().trim().min(1)).max(8).default([]),
      improvementPriorities: z
        .array(
          z.object({
            priority: z.string().trim().min(1),
            level: z.string().trim().default(""),
            whyItMatters: z.string().trim().default(""),
            action: z.string().trim().default(""),
            expectedImpact: z.string().trim().default(""),
          }),
        )
        .max(6)
        .default([]),
      actionRecommendations: z
        .object({
          websiteChanges: z.array(z.string().trim().min(1)).max(5).default([]),
          reviewProcess: z.array(z.string().trim().min(1)).max(5).default([]),
          staffCommunication: z.array(z.string().trim().min(1)).max(5).default([]),
          marketingActions: z.array(z.string().trim().min(1)).max(5).default([]),
          competitorMonitoring: z.array(z.string().trim().min(1)).max(5).default([]),
        })
        .default({
          websiteChanges: [],
          reviewProcess: [],
          staffCommunication: [],
          marketingActions: [],
          competitorMonitoring: [],
        }),
      customerLanguageInsights: z
        .object({
          wordsCustomersUse: z.array(z.string().trim().min(1)).max(12).default([]),
          phrasesToUseInMarketing: z
            .array(z.string().trim().min(1))
            .max(8)
            .default([]),
          phrasesToAvoid: z.array(z.string().trim().min(1)).max(8).default([]),
        })
        .default({
          wordsCustomersUse: [],
          phrasesToUseInMarketing: [],
          phrasesToAvoid: [],
        }),
    })
    .default({
      reviewTags: [],
      whatCustomersLove: [],
      customerConcerns: [],
      concernsNote: "",
      clientExpectationMap: [],
      improvementPriorities: [],
      actionRecommendations: {
        websiteChanges: [],
        reviewProcess: [],
        staffCommunication: [],
        marketingActions: [],
        competitorMonitoring: [],
      },
      customerLanguageInsights: {
        wordsCustomersUse: [],
        phrasesToUseInMarketing: [],
        phrasesToAvoid: [],
      },
    }),
});

export type AiSections = z.infer<typeof AiSectionsSchema>;

/** Confidently-matched public social profiles (persisted for the report). */
export interface SocialPresence {
  facebook: {
    profileUrl: string;
    followers: string;
    likes: string;
    rating: number | null;
    reviews: number | null;
    verified: boolean;
  } | null;
  instagram: {
    profileUrl: string;
    followers: number | null;
    posts: number | null;
    verified: boolean;
  } | null;
  /** Where the client logo came from: facebook | instagram | google | none. */
  brandingSource: string;
  /** Match confidence (0..1) of the best accepted social profile. */
  confidenceScore: number;
}

export function emptySocialPresence(): SocialPresence {
  return { facebook: null, instagram: null, brandingSource: "none", confidenceScore: 0 };
}

/** Full structured report persisted to report_json and rendered to HTML/PDF. */
export interface BusinessReport {
  businessName: string;
  businessAddress: string;
  category: string;
  suburb: string;
  website: string;
  phone: string;
  /** Client business logo URL ("" when no trusted logo is available). */
  businessLogo: string;
  /** Audit trail: source URL/profile the logo came from ("" when none). */
  businessLogoSource: string;
  /** Business photo URL (e.g. Google Maps thumbnail; "" when unavailable). */
  businessImage: string;
  /** Confidently-matched public social profiles (empty shape when none). */
  socialPresence: SocialPresence;
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

/** Coerce arbitrary persisted JSON into a valid SocialPresence (never throws). */
function coerceSocialPresence(raw: unknown): SocialPresence {
  const out = emptySocialPresence();
  if (!raw || typeof raw !== "object") return out;
  const sp = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const fb = sp["facebook"];
  if (fb && typeof fb === "object") {
    const f = fb as Record<string, unknown>;
    const profileUrl = str(f["profileUrl"]);
    if (profileUrl) {
      out.facebook = {
        profileUrl,
        followers: str(f["followers"]),
        likes: str(f["likes"]),
        rating: num(f["rating"]),
        reviews: num(f["reviews"]),
        verified: f["verified"] === true,
      };
    }
  }
  const ig = sp["instagram"];
  if (ig && typeof ig === "object") {
    const i = ig as Record<string, unknown>;
    const profileUrl = str(i["profileUrl"]);
    if (profileUrl) {
      out.instagram = {
        profileUrl,
        followers: num(i["followers"]),
        posts: num(i["posts"]),
        verified: i["verified"] === true,
      };
    }
  }
  out.brandingSource = str(sp["brandingSource"]) || "none";
  const conf = num(sp["confidenceScore"]);
  out.confidenceScore = conf === null ? 0 : Math.min(1, Math.max(0, conf));
  return out;
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
    businessLogo: str(r["businessLogo"]),
    businessLogoSource: str(r["businessLogoSource"]),
    businessImage: str(r["businessImage"]),
    socialPresence: coerceSocialPresence(r["socialPresence"]),
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
      if (diff >= 4) comparison = "You currently lead this comparison";
      else if (diff <= -4) comparison = "Stronger review visibility";
      else comparison = "Similar position";
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
    { key: "trustpilot", label: "Trustpilot", rating: data.trustpilot },
    { key: "productReview", label: "Product Review", rating: data.productReview },
    { key: "facebook", label: "Facebook", rating: data.facebook },
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

/** Deterministic analytics computed from real metrics (never from the AI). */
export interface ReportAnalytics {
  ratingGap: {
    gap: number | null;
    highest: { platform: string; rating: number } | null;
    lowest: { platform: string; rating: number } | null;
    values: Array<{ platform: string; rating: number | null }>;
  };
  reviewVolume: {
    own: number;
    competitorAverage: number | null;
    comparison: "Above" | "Similar" | "Below" | "Unknown";
    topCompetitor: { name: string; reviews: number } | null;
    /** Extra reviews needed to match the top nearby competitor (0 when ahead). */
    reviewGap: number | null;
  };
  competitorGap: {
    ownTrustScore: number | null;
    topCompetitor: { name: string; trustScore: number } | null;
    /** topCompetitor.trustScore - ownTrustScore (negative when ahead). */
    gap: number | null;
  };
  /** Deterministic confidence label derived from data quality. */
  sentimentConfidence: "High" | "Medium" | "Low";
}

function parseRating(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)/.exec(s.trim());
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

function parseCount(s: string): number | null {
  const n = Number(s.replace(/[^0-9]/g, ""));
  return s.trim() && s.trim() !== "—" && s.trim() !== "-" && Number.isFinite(n)
    ? n
    : null;
}

/** Compute the rating-gap and review-volume analytics from stored metrics. */
export function computeAnalytics(m: ReportMetrics): ReportAnalytics {
  const values = m.platforms.map((p) => ({
    platform: p.platform,
    rating: parseRating(p.rating),
  }));
  const rated = values.filter(
    (v): v is { platform: string; rating: number } => v.rating !== null,
  );
  let gap: ReportAnalytics["ratingGap"] = {
    gap: null,
    highest: null,
    lowest: null,
    values,
  };
  if (rated.length >= 2) {
    const sorted = [...rated].sort((a, b) => b.rating - a.rating);
    const highest = sorted[0]!;
    const lowest = sorted[sorted.length - 1]!;
    gap = {
      gap: Math.round((highest.rating - lowest.rating) * 10) / 10,
      highest,
      lowest,
      values,
    };
  }

  const realCompetitors = m.competitors
    .filter((c) => !c.demo)
    .map((c) => ({
      name: c.name,
      reviews: parseCount(c.reviews),
      trustScore: c.trustScore,
    }));
  const realCompetitorCounts = realCompetitors
    .map((c) => c.reviews)
    .filter((n): n is number => n !== null && n > 0);
  const competitorAverage =
    realCompetitorCounts.length > 0
      ? Math.round(
          realCompetitorCounts.reduce((s, n) => s + n, 0) /
            realCompetitorCounts.length,
        )
      : null;
  let comparison: ReportAnalytics["reviewVolume"]["comparison"] = "Unknown";
  if (competitorAverage !== null && m.totalReviews > 0) {
    if (m.totalReviews >= competitorAverage * 1.25) comparison = "Above";
    else if (m.totalReviews <= competitorAverage * 0.75) comparison = "Below";
    else comparison = "Similar";
  }

  // Top nearby competitor by review count (real competitors only).
  let topCompetitor: ReportAnalytics["reviewVolume"]["topCompetitor"] = null;
  for (const c of realCompetitors) {
    if (
      c.reviews !== null &&
      c.reviews > 0 &&
      (!topCompetitor || c.reviews > topCompetitor.reviews)
    ) {
      topCompetitor = { name: c.name, reviews: c.reviews };
    }
  }
  const reviewGap =
    topCompetitor !== null
      ? Math.max(0, topCompetitor.reviews - m.totalReviews)
      : null;

  // Trust Score gap vs the highest-scoring real competitor.
  let topByScore: ReportAnalytics["competitorGap"]["topCompetitor"] = null;
  for (const c of realCompetitors) {
    if (
      c.trustScore !== null &&
      (!topByScore || c.trustScore > topByScore.trustScore)
    ) {
      topByScore = { name: c.name, trustScore: c.trustScore };
    }
  }
  const competitorGap: ReportAnalytics["competitorGap"] = {
    ownTrustScore: m.trustScore,
    topCompetitor: topByScore,
    gap:
      m.trustScore !== null && topByScore !== null
        ? topByScore.trustScore - m.trustScore
        : null,
  };

  const sentimentConfidence: ReportAnalytics["sentimentConfidence"] =
    m.dataQuality === "High"
      ? "High"
      : m.dataQuality === "Medium"
        ? "Medium"
        : "Low";

  return {
    ratingGap: gap,
    reviewVolume: {
      own: m.totalReviews,
      competitorAverage,
      comparison,
      topCompetitor,
      reviewGap,
    },
    competitorGap,
    sentimentConfidence,
  };
}

const SYSTEM_PROMPT =
  "You are generating a paid AI Customer Review Sentiment Report for a business owner. " +
  "You are analysing customer reviews for that owner: your job is to explain " +
  "what clients actually think, using the review text, Google review tags/topic " +
  "chips (with mention counts), repeated customer words and phrases, ratings, " +
  "review dates, review volume and competitor signals provided. Focus on " +
  "practical business insight: what customers love, what may concern them, what " +
  "needs improvement, and what actions the business should take. Do not invent " +
  "complaints. If data is limited, clearly say so. " +
  "Analyse the available platform ratings (which may include Google, Yelp, " +
  "TripAdvisor, Trustpilot, Product Review and Facebook), review counts, " +
  "review snippets, customer sentiment themes and competitor signals provided. " +
  "Only discuss platforms whose data is actually supplied; never invent a " +
  "listing for a platform that has no data. " +
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
  "executiveSummary (string: 4-6 sentences that answer, in plain language: what " +
  "clients think about this business, what they like most, what concerns or " +
  "risks appear, what the business needs to improve, what the owner should do " +
  "this week, and what to monitor over the next 30 days); " +
  "customerSentimentLabel (string: e.g. 'Mostly Positive', 'Positive', 'Mixed'); " +
  "platformMeanings (object {google, yelp, tripadvisor, trustpilot, " +
  "productReview, facebook}: each a one-sentence business meaning, '' if no " +
  "listing or no data for that platform); " +
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
  "'High'), explanation, fix, businessImpact — businessImpact is one plain-" +
  "English sentence on why the issue matters commercially, e.g. 'Repeated " +
  "stock gaps may reduce repeat visits and push regular customers to nearby " +
  "competitors.', worded carefully with 'may'); " +
  "costingYouCustomers (array of 3-6 short risk statements); " +
  "commercialImpact (array of 2-5 plain-English sentences explaining how the " +
  "review themes may affect sales, bookings, foot traffic, enquiries or " +
  "customer confidence — e.g. strong positive themes can be used in marketing " +
  "to increase conversion; repeated complaints may cause hesitation before " +
  "purchase; low review freshness may reduce trust compared with competitors; " +
  "grounded ONLY in the data given, cautious wording); " +
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
  "finalRecommendation (object {first, fastest, monitor, biggestRisk, " +
  "marketingOpportunity} — first: the most urgent action; fastest: the " +
  "quickest action that may improve trust; monitor: what to track over the " +
  "next 30 days; biggestRisk: the most important customer risk from the " +
  "review analysis; marketingOpportunity: the positive customer theme the " +
  "business should promote); " +
  "executiveSnapshot (object {customersLove, mainRisks, doFirst, monitorNext} " +
  "— an executive summary card: customersLove is 2-3 short positive themes " +
  "drawn from the tags/review text, mainRisks is 1-3 short concerns (cautious " +
  "wording, fewer if data is limited), doFirst is ONE urgent action sentence, " +
  "monitorNext is ONE 30-day monitoring item); " +
  "customerVoiceSummary (array of 3-5 objects {label, text} summarising in " +
  "plain business language what customers appear to think, using EXACTLY " +
  "these labels in this order where data allows: 'Customers most often " +
  "praise', 'Customers repeatedly mention', 'Main improvement signals', " +
  "'Fastest trust opportunity', 'What to monitor next' — text is one short " +
  "sentence per label grounded in the tags/snippets; if tags like 'bakery' " +
  "or 'fresh vegetables' exist, explain what they mean in plain business " +
  "language; omit labels you cannot ground in data); " +
  "topActionsThisWeek (array of EXACTLY 3 short, very practical actions for " +
  "this week, generated from the actual review analysis — e.g. audit stock " +
  "gaps for high-demand items, respond publicly to recent service feedback, " +
  "add QR review prompts at checkout — never generic filler); " +
  "analytics (object with EXACTLY these keys — all estimates must come ONLY " +
  "from the data provided, never invented: " +
  "trustScoreTrend (object {direction, explanation}: direction is 'Improving', " +
  "'Stable', 'Declining' or 'Not enough historical data' — judge cautiously " +
  "from the balance of recent positive vs negative review snippet themes; " +
  "NEVER invent a trend: if there is no clear historical signal use 'Not " +
  "enough historical data' with explanation exactly 'Trend tracking will " +
  "begin from this report.'; otherwise explain in 1-2 sentences); " +
  "reviewVolumeInsight (string, 1-2 sentences: whether the business appears to " +
  "be getting enough new reviews compared with the competitor review counts " +
  "given — if no competitor data, say the comparison is not available); " +
  "ratingGapInsight (string, 1-2 sentences interpreting differences between " +
  "the Google, Yelp and TripAdvisor ratings given — mention missing listings " +
  "honestly; '' if fewer than 2 platforms have ratings); " +
  "complaintFrequency (array of 0-5 objects {issue, frequency, note}: the most " +
  "repeated issues mentioned in the review snippets, frequency 'High', " +
  "'Medium' or 'Low' judged only from how often the theme appears in the " +
  "snippets given, note is one short sentence; empty array if snippets are " +
  "too limited); " +
  "lostCustomerRisk (object {level, factors}: level 'Low', 'Medium' or 'High'; " +
  "factors is 1-4 short statements on what may be stopping customers from " +
  "choosing the business, worded carefully like 'may be costing'; use level " +
  "'Low' with a cautious factor when data is limited); " +
  "growthOpportunity (object {level, score, focusAreas, rationale}: level is " +
  "'High', 'Medium' or 'Low' — how much room there is to improve fastest " +
  "(e.g. 'High' when ratings are strong but review volume is lower than " +
  "competitors, platforms are missing, or complaints are easily fixable), " +
  "score is a matching integer 0-100 (higher = more untapped opportunity), " +
  "focusAreas is 1-4 short phrases naming the fastest improvement areas, " +
  "rationale is 1-2 sentences explaining the level; level '' and score null " +
  "if there is no meaningful data)); " +
  "customerVoiceAnalysis (object explaining what customers are actually " +
  "saying, with EXACTLY these keys: " +
  "reviewTags (array of objects {tag, count, customerMeaning, businessAction} " +
  "— one entry per Google review tag/topic chip PROVIDED in the input, keeping " +
  "the exact tag text and mention count given (count 0 if no count was given); " +
  "customerMeaning explains in 1-2 sentences what the tag says about customer " +
  "priorities, businessAction is one practical action; EMPTY ARRAY if no tags " +
  "were provided — NEVER invent tags or counts); " +
  "whatCustomersLove (array of 3-5 objects {theme, explanation, evidence, " +
  "opportunity, confidence, confidenceBasis}: positive themes drawn from the " +
  "review text and tags; evidence cites paraphrased review/tag signals like " +
  "'mentioned in the auction tag (34 mentions)' — never invented quotes; " +
  "opportunity is how the business can use the theme; confidence is 'High', " +
  "'Medium' or 'Low' — High ONLY when supported by high review volume, " +
  "repeated tags with large mention counts or many snippets; Medium when " +
  "supported by some review text or one platform only; Low when inferred from " +
  "limited data — NEVER pretend confidence is high when data is limited; " +
  "confidenceBasis is one short line citing the real basis, e.g. 'Based on 94 " +
  "customer topic mentions.' or 'Based on limited available review text.'; " +
  "fewer or empty if data is limited); " +
  "customerConcerns (array of 0-4 objects {theme, riskLevel, explanation, " +
  "recommendedFix, businessImpact, confidence, confidenceBasis}: concerns " +
  "from low-rated reviews, negative snippets and platform rating gaps; " +
  "riskLevel 'Low', 'Medium' or 'High'; businessImpact is one careful " +
  "sentence on why the concern matters commercially ('may reduce', 'may " +
  "cause'); confidence/confidenceBasis follow the same honest rules as " +
  "whatCustomersLove; do NOT invent complaints — empty array if no negative " +
  "signals exist); " +
  "concernsNote (string: '' normally, but when there is not enough negative " +
  "review text set it exactly to 'Limited negative review text was available. " +
  "Risks are inferred from rating gaps and available public review signals.'); " +
  "clientExpectationMap (array of 4-6 short phrases describing what customers " +
  "appear to expect from THIS business given its industry and the review " +
  "themes, e.g. for real estate: fast communication, honest market advice, " +
  "clear explanation of the selling process, emotional support, strong auction " +
  "strategy, regular updates; for restaurants: consistent food quality, " +
  "friendly service, good value; for trades: arrive on time, clear pricing, " +
  "good workmanship); " +
  "improvementPriorities (array of 2-4 objects {priority, level, whyItMatters, " +
  "action, expectedImpact}: a RANKED list of what to improve first; priority " +
  "is a short title like 'Increase recent review volume', level is 'High', " +
  "'Medium' or 'Low', whyItMatters/action/expectedImpact are one sentence " +
  "each, grounded only in the data given); " +
  "actionRecommendations (object {websiteChanges, reviewProcess, " +
  "staffCommunication, marketingActions, competitorMonitoring} — each an array " +
  "of 1-3 short practical actions; marketing should reuse the customers' own " +
  "words/tags; reviewProcess should say when to ask for reviews for this " +
  "industry); " +
  "customerLanguageInsights (object {wordsCustomersUse, " +
  "phrasesToUseInMarketing, phrasesToAvoid}: wordsCustomersUse is 4-10 single " +
  "words/short phrases that ACTUALLY appear in the review snippets/tags given; " +
  "phrasesToUseInMarketing is 2-4 marketing phrases built from those words; " +
  "phrasesToAvoid is 2-4 phrases to avoid such as generic claims with no " +
  "proof, guaranteed-outcome language, overpromising, or saying 'best' " +
  "without evidence)).";

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
    snippetBlock("TripAdvisor", snippets.tripadvisor) +
    snippetBlock("Trustpilot", snippets.trustpilot);

  const tagLines = (snippets.googleTopics ?? [])
    .map((t) => `- ${t.tag} — ${t.count > 0 ? `${t.count} mentions` : "mention count not available"}`)
    .join("\n");
  const tagText = tagLines
    ? `Google review tags / topic chips (customer themes — use these in ` +
      `customerVoiceAnalysis.reviewTags with the exact tags and counts):\n${tagLines}\n`
    : "No Google review tags/topic chips were available — customerVoiceAnalysis.reviewTags must be an empty array.\n";

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
          tagText +
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
  return groundCustomerVoice(parsed.data, snippets.googleTopics ?? [], metrics.snippetCount);
}

const LIMITED_CONCERNS_NOTE =
  "Limited negative review text was available. Risks are inferred from rating gaps and available public review signals.";

const CONF_RANK: Record<string, number> = { Low: 0, Medium: 1, High: 2 };

/**
 * Deterministic confidence ceiling: the AI may never claim more confidence
 * than the underlying data supports. High needs high data quality (>=30
 * snippets) or >=30 total tag mentions; Medium needs medium data quality or
 * >=10 tag mentions; otherwise everything is capped at Low.
 */
function maxConfidence(snippetCount: number, tagMentions: number): DataQuality {
  const quality = computeDataQuality(snippetCount);
  if (quality === "High" || tagMentions >= 30) return "High";
  if (quality === "Medium" || tagMentions >= 10) return "Medium";
  return "Low";
}

function clampConfidence(value: string, ceiling: DataQuality): string {
  const v = value.trim();
  if (!(v in CONF_RANK)) return "";
  return CONF_RANK[v]! > CONF_RANK[ceiling]! ? ceiling : v;
}

/**
 * Deterministic anti-invention guardrails for customerVoiceAnalysis.
 * - reviewTags may ONLY contain tags that actually came from Google review topics,
 *   with the real mention counts (AI keeps only its interpretation columns).
 * - When no review snippet text exists, concerns cannot be grounded in customer
 *   words, so they are cleared and replaced with the fixed limited-data note.
 * - Per-insight confidence labels are clamped to what the data volume supports.
 */
function groundCustomerVoice(
  sections: AiSections,
  realTags: ReviewTag[],
  snippetCount: number,
): AiSections {
  const cv = sections.customerVoiceAnalysis;
  const tagMentions = realTags.reduce((s, t) => s + (t.count > 0 ? t.count : 0), 0);
  const ceiling = maxConfidence(snippetCount, tagMentions);
  for (const item of cv.whatCustomersLove) {
    item.confidence = clampConfidence(item.confidence, ceiling);
  }
  for (const item of cv.customerConcerns) {
    item.confidence = clampConfidence(item.confidence, ceiling);
  }

  if (realTags.length === 0) {
    cv.reviewTags = [];
  } else {
    const byTag = new Map(
      cv.reviewTags.map((t) => [t.tag.trim().toLowerCase(), t] as const),
    );
    cv.reviewTags = realTags.map((rt) => {
      const ai = byTag.get(rt.tag.trim().toLowerCase());
      return {
        tag: rt.tag,
        count: rt.count,
        customerMeaning: ai?.customerMeaning ?? "",
        businessAction: ai?.businessAction ?? "",
      };
    });
  }

  if (snippetCount === 0) {
    cv.customerConcerns = [];
    cv.concernsNote = LIMITED_CONCERNS_NOTE;
  } else if (cv.customerConcerns.length === 0 && !cv.concernsNote) {
    cv.concernsNote = LIMITED_CONCERNS_NOTE;
  }

  return sections;
}
