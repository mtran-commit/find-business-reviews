import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  reportRequestsTable,
  createReportRequestSchema,
  updateReportRequestSchema,
} from "@workspace/db";

const router: IRouter = Router();

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
 * Save a Business Reputation Report request before sending the customer to
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
      .set(parsed.data)
      .where(eq(reportRequestsTable.id, idParsed.data))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Report request not found." });
      return;
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update report request");
    res.status(500).json({ error: "Could not update report request." });
  }
});

export default router;
