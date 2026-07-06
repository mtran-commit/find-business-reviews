import { and, eq, ne } from "drizzle-orm";
import { db, reportRequestsTable, type ReportRequest } from "@workspace/db";
import {
  fetchBusinessReviews,
  fetchReviewSnippets,
  type BusinessReviews,
  type ReviewSnippets,
} from "./serpapi";
import {
  computeMetrics,
  generateAiSections,
  normalizeReport,
  REPORT_DISCLAIMER,
  type BusinessReport,
} from "./reportContent";
import {
  emptyBranding,
  fetchBusinessBranding,
  type BusinessBranding,
} from "./branding";
import { buildReportPdf } from "./reportPdf";
import { sendReportEmail } from "./reportEmail";
import type { Logger } from "pino";
import { logger } from "./logger";

/** Thrown when another request is already generating this report. */
export class ReportBusyError extends Error {
  constructor() {
    super("Report is already generating.");
    this.name = "ReportBusyError";
  }
}

/**
 * Core generation pipeline shared by the admin "Generate report" /
 * "Generate & send report" actions and the automatic post-payment delivery.
 * Sets `generating`, builds the full report, persists it and returns the
 * updated row. On ANY failure it flips the status to `failed` (so the admin
 * can retry) and rethrows.
 */
export async function runReportGeneration(
  row: ReportRequest,
  log: Logger,
): Promise<ReportRequest> {
  // Atomically claim the row: only one concurrent request may flip it to
  // `generating`. Losing racers get ReportBusyError (→ 409, never `failed`).
  const claimed = await db
    .update(reportRequestsTable)
    .set({ reportStatus: "generating" })
    .where(
      and(
        eq(reportRequestsTable.id, row.id),
        ne(reportRequestsTable.reportStatus, "generating"),
      ),
    )
    .returning({ id: reportRequestsTable.id });
  if (claimed.length === 0) {
    throw new ReportBusyError();
  }

  try {
    // Re-fetch current review data. Prefer a live SerpApi lookup; fall back to
    // the snapshot captured when the customer submitted the request.
    let data: BusinessReviews | null = null;
    const apiKey = process.env["SERPAPI_API_KEY"];
    const query = [row.businessName, row.businessAddress]
      .filter(Boolean)
      .join(" ");
    if (apiKey) {
      try {
        data = await fetchBusinessReviews(query, apiKey, log);
      } catch (err) {
        log.warn({ err }, "Live review fetch failed; using saved snapshot");
      }
    }
    if (!data && row.searchedBusiness) {
      data = row.searchedBusiness as BusinessReviews;
    }
    if (!data) {
      throw new Error("No review data available for this business.");
    }

    // Best-effort review snippets for richer AI theme analysis. A failure here
    // just yields fewer snippets (and a lower data-quality score), never aborts.
    let snippets: ReviewSnippets = {
      google: [],
      yelp: [],
      tripadvisor: [],
      googleTopics: [],
    };
    if (apiKey) {
      try {
        snippets = await fetchReviewSnippets(data, apiKey, log);
      } catch (err) {
        log.warn({ err }, "Review snippet fetch failed; continuing");
      }
    }
    const snippetCount =
      snippets.google.length + snippets.yelp.length + snippets.tripadvisor.length;

    const metrics = computeMetrics(data, snippetCount);
    const category = data.category?.label ?? "";
    const suburb = data.locality?.suburb ?? "";

    // Best-effort public branding + social proof (Facebook / Instagram via
    // SerpApi, confidence-matched). A failure just means no social section.
    let branding: BusinessBranding = emptyBranding();
    if (apiKey) {
      try {
        branding = await fetchBusinessBranding(
          {
            businessName: row.businessName,
            businessAddress: row.businessAddress,
            suburb,
            website: data.website ?? row.businessLink ?? "",
            phone: data.phone ?? "",
            googleThumbnail: data.imageUrl ?? "",
          },
          apiKey,
          log,
        );
      } catch (err) {
        log.warn({ err }, "Branding fetch failed; continuing without it");
      }
    }

    const sections = await generateAiSections(
      row.businessName,
      metrics,
      category,
      suburb,
      snippets,
    );

    const report: BusinessReport = {
      businessName: row.businessName,
      businessAddress: row.businessAddress,
      category,
      suburb,
      website: data.website ?? "",
      phone: data.phone ?? "",
      // Zero-tolerance logo rule: only a confidently matched brand mark may
      // appear in the report. Priority: confidently matched social profile
      // image (Facebook > Instagram), then a high-confidence Google logo;
      // otherwise "" and renderers show a neat initials tile.
      businessLogo:
        branding.businessLogo ||
        (data.logoConfidence === "high" && data.logoUrl ? data.logoUrl : ""),
      businessLogoSource:
        branding.businessLogo && branding.businessLogoSource
          ? branding.businessLogoSource
          : data.logoConfidence === "high" && data.logoUrl
            ? "google_maps"
            : "",
      businessImage: data.imageUrl || branding.businessImage || "",
      socialPresence: {
        facebook: branding.facebook
          ? {
              profileUrl: branding.facebook.profileUrl,
              followers: branding.facebook.followers,
              likes: branding.facebook.likes,
              rating: branding.facebook.rating,
              reviews: branding.facebook.reviews,
              verified: branding.facebook.verified,
            }
          : null,
        instagram: branding.instagram
          ? {
              profileUrl: branding.instagram.profileUrl,
              followers: branding.instagram.followers,
              posts: branding.instagram.posts,
              verified: branding.instagram.verified,
            }
          : null,
        brandingSource: branding.brandingSource,
        confidenceScore: branding.confidenceScore,
      },
      generatedAt: new Date().toISOString(),
      metrics,
      sections,
      disclaimer: REPORT_DISCLAIMER,
    };

    const pdfPath = `/api/admin/report-requests/${row.id}/download`;
    const [updated] = await db
      .update(reportRequestsTable)
      .set({
        reportStatus: "generated",
        reportJson: report,
        reportPdfUrl: pdfPath,
        reportGeneratedAt: new Date(),
      })
      .where(eq(reportRequestsTable.id, row.id))
      .returning();

    if (!updated) {
      throw new Error("Report request disappeared during generation.");
    }
    return updated;
  } catch (err) {
    log.error({ err }, "Report generation failed");
    try {
      await db
        .update(reportRequestsTable)
        .set({ reportStatus: "failed" })
        .where(eq(reportRequestsTable.id, row.id));
    } catch (setErr) {
      log.error({ err: setErr }, "Failed to set report status to failed");
    }
    throw err;
  }
}

/**
 * Build the PDF from the persisted report JSON and email it to the customer.
 * Throws on failure (the caller decides how to surface it); on success the
 * report status is NOT touched — call markReportSent afterwards.
 */
export async function emailReportToCustomer(
  row: ReportRequest,
  log: Logger,
): Promise<void> {
  if (!row.reportJson) {
    throw new Error("No generated report to email.");
  }
  const pdf = await buildReportPdf(normalizeReport(row.reportJson));
  const safeName = (row.businessName || "business")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  await sendReportEmail({
    to: row.email,
    customerName: row.fullName || "",
    businessName: row.businessName || "",
    pdf,
    pdfFilename: `reputation-report-${safeName || "business"}.pdf`,
  });
  log.info({ requestId: row.id }, "Report emailed to customer");
}

/** Mark the report as sent, preserving any existing sent timestamp. */
export async function markReportSent(
  row: ReportRequest,
): Promise<ReportRequest> {
  const [updated] = await db
    .update(reportRequestsTable)
    .set({
      reportStatus: "sent",
      reportSentAt: row.reportSentAt ?? new Date(),
    })
    .where(eq(reportRequestsTable.id, row.id))
    .returning();
  return updated ?? { ...row, reportStatus: "sent" };
}

/**
 * Automatic post-payment delivery: generate the report (if there isn't a
 * finished one already) and email it to the customer, then mark it sent.
 * Fire-and-forget — NEVER throws. Runs after a request flips to `paid`
 * (Stripe webhook or admin "Mark as paid"). Any failure is logged and leaves
 * the row in an honest state (`failed` or `generated`) so the admin buttons
 * remain a working fallback.
 */
export async function autoDeliverReport(requestId: string): Promise<void> {
  const log = logger.child({ requestId, job: "auto-deliver-report" });
  try {
    const [row] = await db
      .select()
      .from(reportRequestsTable)
      .where(eq(reportRequestsTable.id, requestId));
    if (!row) {
      log.warn("Auto-delivery skipped: request not found");
      return;
    }
    if (row.status !== "paid") {
      log.info({ status: row.status }, "Auto-delivery skipped: not paid");
      return;
    }
    if (row.reportStatus === "sent") {
      log.info("Auto-delivery skipped: report already sent");
      return;
    }

    let current = row;
    if (
      !current.reportJson ||
      (current.reportStatus !== "generated" && current.reportStatus !== "sent")
    ) {
      current = await runReportGeneration(current, log);
    }

    await emailReportToCustomer(current, log);
    await markReportSent(current);
    log.info("Report auto-delivered after payment");
  } catch (err) {
    if (err instanceof ReportBusyError) {
      log.info("Auto-delivery skipped: report already generating");
      return;
    }
    log.error(
      { err },
      "Automatic report delivery failed; admin can retry from the admin page",
    );
  }
}
