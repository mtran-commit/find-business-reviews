import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, reportRequestsTable, createReportRequestSchema } from "@workspace/db";

const router: IRouter = Router();

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
  const adminToken = process.env["REPORT_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({
      error:
        "Admin access is not configured. Set REPORT_ADMIN_TOKEN to enable this endpoint.",
    });
    return;
  }
  if (req.get("x-admin-token") !== adminToken) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

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

export default router;
