import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * Business Reputation Report requests captured before the customer is sent to
 * Stripe. Stored as `pending_payment`; a later Stripe webhook
 * (checkout.session.completed) will flip matching rows to `paid` and trigger
 * report generation + delivery. No card data is ever stored here.
 */
export const reportRequestsTable = pgTable("report_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  businessName: text("business_name").notNull(),
  businessAddress: text("business_address").notNull(),
  businessLink: text("business_link"),
  authorised: boolean("authorised").notNull(),
  searchedBusiness: jsonb("searched_business"),
  /** Payment state: "pending_payment" until confirmed, then "paid". */
  status: text("status").notNull().default("pending_payment"),
  /** Report delivery state: "pending" until the report is sent, then "sent". */
  reportStatus: text("report_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Validated shape for the public POST /api/report-requests body. */
export const createReportRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(50),
  businessName: z.string().trim().min(1).max(200),
  businessAddress: z.string().trim().min(1).max(400),
  businessLink: z.string().trim().max(500).optional().default(""),
  authorised: z.literal(true),
  searchedBusiness: z.unknown().optional(),
});

/** Validated shape for the admin PATCH /api/report-requests/:id body. */
export const updateReportRequestSchema = z
  .object({
    status: z.enum(["pending_payment", "paid"]).optional(),
    reportStatus: z.enum(["pending", "sent"]).optional(),
  })
  .refine((v) => v.status !== undefined || v.reportStatus !== undefined, {
    message: "Provide at least one field to update.",
  });

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
export type UpdateReportRequest = z.infer<typeof updateReportRequestSchema>;
export type ReportRequest = typeof reportRequestsTable.$inferSelect;
export type InsertReportRequest = typeof reportRequestsTable.$inferInsert;
