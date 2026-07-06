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
  /** Payment state: pending_payment | paid | refunded | cancelled. */
  status: text("status").notNull().default("pending_payment"),
  /** Report state: pending | generating | generated | sent | failed. */
  reportStatus: text("report_status").notNull().default("pending"),
  /** Stable download path for the generated PDF (set once generated). */
  reportPdfUrl: text("report_pdf_url"),
  /** Structured AI report content, regenerated into the PDF on download. */
  reportJson: jsonb("report_json"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  /** When the current email-send claim was taken (lease for `sending`). */
  reportSendStartedAt: timestamp("report_send_started_at", { withTimezone: true }),
  reportGeneratedAt: timestamp("report_generated_at", { withTimezone: true }),
  reportSentAt: timestamp("report_sent_at", { withTimezone: true }),
  /** Optional Stripe payment reference for manual reconciliation. */
  stripePaymentReference: text("stripe_payment_reference"),
  /** Stripe Checkout Session id created for this request (customer-specific payment). */
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Payment states. */
export const PAYMENT_STATUSES = [
  "pending_payment",
  "paid",
  "refunded",
  "cancelled",
] as const;

/** Report lifecycle states. */
export const REPORT_STATUSES = [
  "pending",
  "generating",
  "generated",
  "sent",
  "failed",
] as const;

/** Validated shape for the public POST /api/report-requests body. */
export const createReportRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(50),
  businessName: z.string().trim().min(1).max(200),
  businessAddress: z.string().trim().min(1).max(400),
  businessLink: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "Business link must be an http(s) URL.",
    )
    .optional()
    .default(""),
  authorised: z.literal(true),
  searchedBusiness: z.unknown().optional(),
});

/** Validated shape for the admin PATCH /api/report-requests/:id body. */
export const updateReportRequestSchema = z
  .object({
    status: z.enum(PAYMENT_STATUSES).optional(),
    reportStatus: z.enum(REPORT_STATUSES).optional(),
  })
  .refine((v) => v.status !== undefined || v.reportStatus !== undefined, {
    message: "Provide at least one field to update.",
  });

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
export type UpdateReportRequest = z.infer<typeof updateReportRequestSchema>;
export type ReportRequest = typeof reportRequestsTable.$inferSelect;
export type InsertReportRequest = typeof reportRequestsTable.$inferInsert;
