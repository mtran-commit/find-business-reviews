import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { businessClaimRequestsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Checks the x-admin-token header against REPORT_ADMIN_TOKEN. Returns true
 * when authorised; otherwise writes the error response and returns false.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const adminToken = process.env["REPORT_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({
      error: "Admin access is not configured. Set REPORT_ADMIN_TOKEN to enable this endpoint.",
    });
    return false;
  }
  if (req.get("x-admin-token") !== adminToken) {
    res.status(401).json({ error: "Access denied." });
    return false;
  }
  return true;
}

const InsertClaimSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().default(""),
  city: z.string().trim().max(200).optional().default(""),
  postcode: z.string().trim().max(20).optional().default(""),
  country: z.string().trim().max(100).optional().default(""),
  website: z.string().trim().max(500).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  googleProfileUrl: z.string().trim().max(500).optional().default(""),
  contactName: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().email().max(300),
});

/** Public: submit a missing business claim request. */
router.post("/business-claim-requests", async (req, res): Promise<void> => {
  const parsed = InsertClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submission. Please check all required fields." });
    return;
  }
  try {
    const [row] = await db
      .insert(businessClaimRequestsTable)
      .values({
        businessName: parsed.data.businessName,
        address: parsed.data.address,
        city: parsed.data.city,
        postcode: parsed.data.postcode,
        country: parsed.data.country,
        website: parsed.data.website,
        phone: parsed.data.phone,
        googleProfileUrl: parsed.data.googleProfileUrl,
        contactName: parsed.data.contactName,
        email: parsed.data.email,
        status: "pending",
      })
      .returning({ id: businessClaimRequestsTable.id });
    res.status(201).json({ ok: true, id: row?.id });
  } catch (err) {
    req.log.error({ err }, "business claim insert failed");
    res.status(500).json({ error: "Could not save your submission. Please try again." });
  }
});

/** Admin: list all claims (newest first). */
router.get("/admin/business-claim-requests", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await db
      .select()
      .from(businessClaimRequestsTable)
      .orderBy(businessClaimRequestsTable.createdAt);
    res.json(rows.reverse());
  } catch (err) {
    req.log.error({ err }, "business claim list failed");
    res.status(500).json({ error: "Could not load submissions." });
  }
});

const UpdateClaimSchema = z.object({
  status: z.enum(["pending", "reviewed", "added", "rejected"]),
});

/** Admin: update claim status. */
router.patch("/admin/business-claim-requests/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  const parsed = UpdateClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status value." });
    return;
  }
  try {
    await db
      .update(businessClaimRequestsTable)
      .set({ status: parsed.data.status })
      .where(eq(businessClaimRequestsTable.id, id as string));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "business claim update failed");
    res.status(500).json({ error: "Could not update status." });
  }
});

export default router;
