import { sql } from "drizzle-orm";
import { db, reportRequestsTable } from "@workspace/db";
import { getStripeSync } from "./stripeClient";
import { logger } from "./logger";

/**
 * Stripe webhook processing. stripe-replit-sync verifies the signature and
 * syncs the event into the `stripe` schema; on success we additionally react
 * to checkout completion by marking the matching report request as paid.
 * Manual "Mark as paid" in the admin page remains as the fallback whenever a
 * webhook is missed.
 */
export async function processStripeWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "This usually means express.json() parsed the body before reaching this handler. " +
        "FIX: Ensure the webhook route is registered BEFORE app.use(express.json()).",
    );
  }

  const sync = await getStripeSync();
  // Verifies the signature; throws on an invalid/forged payload.
  await sync.processWebhook(payload, signature);

  // Signature verified above — safe to parse and react to the event.
  let event: {
    type?: string;
    data?: {
      object?: {
        id?: string;
        payment_intent?: string | { id?: string } | null;
        payment_status?: string;
        metadata?: Record<string, string> | null;
        client_reference_id?: string | null;
      };
    };
  };
  try {
    event = JSON.parse(payload.toString("utf8"));
  } catch {
    return; // Synced fine; nothing more we can do without a parseable body.
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return;
  }

  const session = event.data?.object;
  const requestId =
    session?.metadata?.["reportRequestId"] ??
    session?.client_reference_id ??
    null;
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    logger.warn(
      { eventType: event.type, sessionId: session?.id },
      "Stripe checkout completed without a report request id",
    );
    return;
  }

  // For async payment methods the initial "completed" event can still be
  // unpaid; only mark paid when Stripe says the payment is settled.
  if (
    event.type === "checkout.session.completed" &&
    session?.payment_status &&
    session.payment_status !== "paid"
  ) {
    logger.info(
      { requestId, paymentStatus: session.payment_status },
      "Checkout completed but not yet paid; waiting for async success event",
    );
    return;
  }

  const paymentIntent =
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : (session?.payment_intent?.id ?? null);

  // Correlation guard: when we stored a checkout session id for this request,
  // only that exact session may mark it paid. (A NULL stored id still matches
  // — covers requests created before session ids were persisted.)
  const sessionId = session?.id ?? null;
  const updated = await db
    .update(reportRequestsTable)
    .set({
      status: "paid",
      paidAt: sql`COALESCE(${reportRequestsTable.paidAt}, NOW())`,
      stripePaymentReference: paymentIntent ?? session?.id ?? null,
    })
    .where(
      sql`${reportRequestsTable.id} = ${requestId} AND ${reportRequestsTable.status} = 'pending_payment' AND (${reportRequestsTable.stripeCheckoutSessionId} IS NULL OR ${reportRequestsTable.stripeCheckoutSessionId} = ${sessionId})`,
    )
    .returning({ id: reportRequestsTable.id });

  if (updated.length > 0) {
    logger.info({ requestId, paymentIntent }, "Report request marked paid via Stripe webhook");
  } else {
    logger.info(
      { requestId },
      "Stripe webhook received but request was not pending payment (already paid or missing)",
    );
  }
}
