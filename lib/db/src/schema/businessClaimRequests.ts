import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Submitted "missing business" requests from users who couldn't find their
 * business in a search. Admin reviews these to manually add the listing.
 */
export const businessClaimRequestsTable = pgTable("business_claim_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: text("business_name").notNull(),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  postcode: text("postcode").notNull().default(""),
  country: text("country").notNull().default(""),
  website: text("website").notNull().default(""),
  phone: text("phone").notNull().default(""),
  googleProfileUrl: text("google_profile_url").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull(),
  /** pending | reviewed | added | rejected */
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessClaimRequest = typeof businessClaimRequestsTable.$inferSelect;
export type InsertBusinessClaimRequest = typeof businessClaimRequestsTable.$inferInsert;
