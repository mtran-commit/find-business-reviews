import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  reportRequestsTable,
  createReportRequestSchema,
  updateReportRequestSchema,
  type ReportRequest,
} from "@workspace/db";
import { normalizeReport } from "../lib/reportContent";
import { buildReportPdf } from "../lib/reportPdf";
import { buildReportHtml } from "../lib/reportHtml";
import {
  ReportBusyError,
  ReportSendInProgressError,
  runReportGeneration,
  deliverGeneratedReport,
  autoDeliverReport,
  isSendClaimActive,
} from "../lib/reportDelivery";

const router: IRouter = Router();

const idSchema = z.string().uuid();

/** Load one request by validated id, or write the error response and return null. */
async function loadRequest(
  req: Request,
  res: Response,
): Promise<ReportRequest | null> {
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid report request id." });
    return null;
  }
  const [row] = await db
    .select()
    .from(reportRequestsTable)
    .where(eq(reportRequestsTable.id, idParsed.data));
  if (!row) {
    res.status(404).json({ error: "Report request not found." });
    return null;
  }
  return row;
}

/**
 * Shared admin gate for endpoints that expose customer PII. Returns true when
 * the request is authorised; otherwise it writes the appropriate error response
 * and returns false. When REPORT_ADMIN_TOKEN is unset the endpoint refuses to
 * serve (safe default), so PII is never exposed publicly.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const adminToken = process.env["REPORT_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({
      error:
        "Admin access is not configured. Set REPORT_ADMIN_TOKEN to enable this endpoint.",
    });
    return false;
  }
  if (req.get("x-admin-token") !== adminToken) {
    res.status(401).json({ error: "Access denied." });
    return false;
  }
  return true;
}

/**
 * Save a paid AI Customer Review Sentiment Report request before sending the customer to
 * Stripe. Stored as `pending_payment`. No card data is ever collected here —
 * payment is handled entirely by the hosted Stripe Payment Link.
 */
router.post("/report-requests", async (req, res): Promise<void> => {
  const parsed = createReportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid report request details." });
    return;
  }

  const d = parsed.data;
  try {
    const [row] = await db
      .insert(reportRequestsTable)
      .values({
        fullName: d.fullName,
        email: d.email,
        phone: d.phone,
        businessName: d.businessName,
        businessAddress: d.businessAddress,
        businessLink: d.businessLink || null,
        authorised: d.authorised,
        searchedBusiness: d.searchedBusiness ?? null,
        status: "pending_payment",
      })
      .returning({ id: reportRequestsTable.id });

    res.json({ success: true, requestId: row?.id });
  } catch (err) {
    req.log.error({ err }, "Failed to save report request");
    res.status(500).json({ error: "Could not create report request." });
  }
});

/**
 * Create a customer-specific Stripe Checkout Session for a saved report
 * request. Public (the customer just saved their own request), but only works
 * for requests still awaiting payment. The session carries the request id in
 * metadata so the Stripe webhook can automatically mark it paid. If Stripe is
 * unavailable this returns 503 and the frontend falls back to the shared
 * Payment Link (matched manually by the admin).
 */
router.post(
  "/report-requests/:id/checkout",
  async (req, res): Promise<void> => {
    const row = await loadRequest(req, res);
    if (!row) return;
    if (row.status !== "pending_payment") {
      res.status(400).json({ error: "This request is not awaiting payment." });
      return;
    }

    try {
      const { createReportCheckoutSession } = await import(
        "../lib/stripeCheckout"
      );
      const { sessionId, url } = await createReportCheckoutSession({
        requestId: row.id,
        email: row.email,
      });

      await db
        .update(reportRequestsTable)
        .set({ stripeCheckoutSessionId: sessionId })
        .where(eq(reportRequestsTable.id, row.id));

      res.json({ url });
    } catch (err) {
      req.log.error({ err }, "Failed to create Stripe checkout session");
      res
        .status(503)
        .json({ error: "Could not start the secure payment right now." });
    }
  },
);

/**
 * Admin listing of report requests. This returns customer PII (names, emails,
 * phone numbers), so it is gated behind REPORT_ADMIN_TOKEN. When the token is
 * not configured the endpoint refuses to serve data (safe default), so PII is
 * never exposed publicly. Provide the token via the `x-admin-token` header.
 */
router.get("/report-requests", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  try {
    const rows = await db
      .select()
      .from(reportRequestsTable)
      .orderBy(desc(reportRequestsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list report requests");
    res.status(500).json({ error: "Could not fetch report requests." });
  }
});

/**
 * Admin update of a report request's payment/report status (e.g. "Mark as paid"
 * or "Mark report as sent"). Gated behind the same admin token as the listing.
 */
router.patch("/report-requests/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const idParsed = z.string().uuid().safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid report request id." });
    return;
  }

  const parsed = updateReportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid update fields." });
    return;
  }

  try {
    const [row] = await db
      .update(reportRequestsTable)
      .set({
        ...parsed.data,
        // Preserve original event timestamps on repeated updates.
        ...(parsed.data.status === "paid"
          ? { paidAt: sql`COALESCE(${reportRequestsTable.paidAt}, now())` }
          : {}),
        ...(parsed.data.reportStatus === "sent"
          ? {
              reportSentAt: sql`COALESCE(${reportRequestsTable.reportSentAt}, now())`,
            }
          : {}),
      })
      .where(eq(reportRequestsTable.id, idParsed.data))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Report request not found." });
      return;
    }

    // Legacy "Mark as paid" path: trigger the same automatic delivery as the
    // dedicated mark-paid route and the Stripe webhook.
    if (parsed.data.status === "paid") {
      void autoDeliverReport(row.id);
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update report request");
    res.status(500).json({ error: "Could not update report request." });
  }
});

/**
 * Admin: delete a report request (e.g. duplicates). Permanent — gated behind
 * the same admin token as the listing.
 */
router.delete("/report-requests/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const row = await loadRequest(req, res);
  if (!row) return;
  try {
    await db
      .delete(reportRequestsTable)
      .where(eq(reportRequestsTable.id, row.id));
    res.json({ success: true, id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to delete report request");
    res.status(500).json({ error: "Could not delete report request." });
  }
});

/**
 * Admin: mark a request as paid. Manual reconciliation step — the admin checks
 * Stripe, then flips payment status so a report can be generated.
 */
router.post(
  "/admin/report-requests/:id/mark-paid",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;
    try {
      const [updated] = await db
        .update(reportRequestsTable)
        .set({ status: "paid", paidAt: row.paidAt ?? new Date() })
        .where(eq(reportRequestsTable.id, row.id))
        .returning();
      // Kick off automatic generation + email delivery in the background.
      // The admin sees the row flip to "generating" on the next refresh;
      // manual buttons remain as fallback if this fails.
      void autoDeliverReport(row.id);
      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "Failed to mark request as paid");
      res.status(500).json({ error: "Could not mark as paid." });
    }
  },
);

/**
 * Admin: mark the report as sent (after emailing the PDF to the customer).
 */
router.post(
  "/admin/report-requests/:id/mark-sent",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;
    if (row.reportStatus !== "generated" && row.reportStatus !== "sent") {
      res
        .status(400)
        .json({ error: "Generate the report before marking it as sent." });
      return;
    }
    try {
      const [updated] = await db
        .update(reportRequestsTable)
        .set({ reportStatus: "sent", reportSentAt: row.reportSentAt ?? new Date() })
        .where(eq(reportRequestsTable.id, row.id))
        .returning();
      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "Failed to mark report as sent");
      res.status(500).json({ error: "Could not mark report as sent." });
    }
  },
);

/**
 * Admin only: generate the full paid AI Customer Review Sentiment Report. Requires the
 * request to be paid first. Re-fetches current review data, calls OpenAI for the
 * qualitative sections, persists the structured report JSON, and flips the report
 * status to `generated`. On any failure the status is set to `failed` so the
 * admin can retry. Public users can never reach this (admin-token gated).
 */
router.post(
  "/admin/report-requests/:id/generate-report",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;

    if (row.status !== "paid") {
      res.status(400).json({
        error: "Payment must be marked as paid before generating report.",
      });
      return;
    }
    if (isSendClaimActive(row)) {
      res.status(409).json({
        error: "The report email is being sent right now. Please wait a moment.",
      });
      return;
    }

    try {
      const updated = await runReportGeneration(row, req.log);
      res.json(updated);
    } catch (err) {
      if (err instanceof ReportBusyError) {
        res.status(409).json({
          error: "Report is already generating. Please try again shortly.",
        });
        return;
      }
      res.status(502).json({
        error: "Report could not be generated right now. Please try again.",
      });
    }
  },
);

/**
 * Admin: generate (if needed) AND email the report to the customer with the
 * PDF attached, then mark the request as sent. Uses the Gmail connection
 * (hello@findbusinessreviews.com). If the email fails after a successful
 * generation the report stays `generated` so the admin can retry or fall back
 * to manual download + email.
 */
router.post(
  "/admin/report-requests/:id/send-report",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;

    if (row.status !== "paid") {
      res.status(400).json({
        error: "Payment must be marked as paid before sending the report.",
      });
      return;
    }
    if (row.reportStatus === "generating") {
      res.status(409).json({
        error: "Report is already generating. Please try again shortly.",
      });
      return;
    }
    if (isSendClaimActive(row)) {
      res.status(409).json({
        error: "The report email is being sent right now. Please wait a moment.",
      });
      return;
    }

    // Generate first unless a finished report already exists. A stale
    // `sending` row (crashed mid-email) still holds a finished report.
    let current = row;
    if (
      !current.reportJson ||
      (current.reportStatus !== "generated" &&
        current.reportStatus !== "sent" &&
        current.reportStatus !== "sending")
    ) {
      try {
        current = await runReportGeneration(current, req.log);
      } catch (err) {
        if (err instanceof ReportBusyError) {
          res.status(409).json({
            error: "Report is already generating. Please try again shortly.",
          });
          return;
        }
        res.status(502).json({
          error: "Report could not be generated right now. Please try again.",
        });
        return;
      }
    }
    if (!current.reportJson) {
      res.status(502).json({
        error: "Report could not be generated right now. Please try again.",
      });
      return;
    }

    // Build the PDF and email it under the shared atomic send claim (so this
    // can never double-send against the automatic post-payment delivery). An
    // email failure leaves the report as `generated` (never `sent`).
    try {
      const updated = await deliverGeneratedReport(current, req.log);
      res.json(updated);
    } catch (err) {
      if (err instanceof ReportSendInProgressError) {
        res.status(409).json({
          error:
            "The report email is being sent right now. Please wait a moment.",
        });
        return;
      }
      req.log.error({ err }, "Failed to email report to customer");
      res.status(502).json({
        error:
          "Report was generated but the email could not be sent. You can retry, or download the PDF and email it manually.",
      });
    }
  },
);

/**
 * Admin: download the generated report as a PDF. The PDF is rebuilt on demand
 * from the persisted report JSON so no binary blob needs storing.
 */
router.get(
  "/admin/report-requests/:id/download",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;

    if (!row.reportJson) {
      res.status(404).json({ error: "No generated report to download yet." });
      return;
    }

    try {
      const pdf = await buildReportPdf(normalizeReport(row.reportJson));
      const safeName = (row.businessName || "business")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 60);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="reputation-report-${safeName || "business"}.pdf"`,
      );
      res.send(Buffer.from(pdf));
    } catch (err) {
      req.log.error({ err }, "Failed to build report PDF");
      res.status(500).json({ error: "Could not build the report PDF." });
    }
  },
);

/**
 * Admin: view the generated report as a styled HTML dashboard page. Rebuilt on
 * demand from the persisted report JSON. Admin-token gated (never public).
 */
router.get(
  "/admin/report-requests/:id/report",
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const row = await loadRequest(req, res);
    if (!row) return;

    if (!row.reportJson) {
      res.status(404).json({ error: "No generated report to view yet." });
      return;
    }

    try {
      const html = buildReportHtml(normalizeReport(row.reportJson));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      req.log.error({ err }, "Failed to build report HTML");
      res.status(500).json({ error: "Could not build the report page." });
    }
  },
);

export default router;
