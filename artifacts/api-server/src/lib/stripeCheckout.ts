import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";

/**
 * Customer-specific Stripe Checkout for the paid AI Customer Review Sentiment
 * Report ($23 + GST AUD). Each saved report request gets its own Checkout
 * Session carrying the request id in metadata, so the webhook can mark the
 * exact request as paid automatically.
 */

/** The existing hosted Payment Link the shared button used to open. Used to
 * reuse the exact same product + price for per-customer checkouts. */
const LEGACY_PAYMENT_LINK_URL = "https://buy.stripe.com/5kQ14oa2yfUh9JR1Tt2cg00";

/** Stable lookup key for the report price when we have to create one. */
const REPORT_PRICE_LOOKUP_KEY = "business_report_23_plus_gst";

/** $23 + 10% GST = $25.30 AUD, in cents. Used only when we must create a price. */
const REPORT_PRICE_AMOUNT_CENTS = 2530;

let cachedPriceId: string | null = null;

/** Find the price behind the legacy Payment Link, but ONLY if it charges
 * exactly the expected report amount (AUD $25.30 incl. GST). The live
 * account's legacy link was configured at a different amount ($10), so
 * trusting the link's price blindly made live checkouts charge the wrong
 * amount. Returns null when not found or when the amount doesn't match. */
async function priceFromLegacyPaymentLink(
  stripe: Stripe,
): Promise<string | null> {
  try {
    const links = await stripe.paymentLinks.list({ limit: 100 });
    const match = links.data.find((l) => l.url === LEGACY_PAYMENT_LINK_URL);
    if (!match) return null;
    const items = await stripe.paymentLinks.listLineItems(match.id, {
      limit: 1,
    });
    const price = items.data[0]?.price;
    if (
      price &&
      price.unit_amount === REPORT_PRICE_AMOUNT_CENTS &&
      price.currency === "aud"
    ) {
      return price.id;
    }
    if (price) {
      logger.warn(
        {
          priceId: price.id,
          unitAmount: price.unit_amount,
          currency: price.currency,
        },
        "Legacy payment link price does not match the expected report amount; ignoring it",
      );
    }
    return null;
  } catch (err) {
    logger.warn({ err }, "Could not read legacy payment link price");
    return null;
  }
}

/** Resolve (and cache) the Stripe price id for the report. Order:
 * 1. a previously created price by lookup key (verified amount),
 * 2. the price behind the legacy Payment Link (only if it matches $25.30 AUD),
 * 3. create the product + price (AUD $25.30 incl. GST). */
async function resolveReportPriceId(stripe: Stripe): Promise<string> {
  if (cachedPriceId) return cachedPriceId;

  const byKey = await stripe.prices.list({
    lookup_keys: [REPORT_PRICE_LOOKUP_KEY],
    limit: 1,
  });
  const existing = byKey.data[0];
  if (
    existing &&
    existing.unit_amount === REPORT_PRICE_AMOUNT_CENTS &&
    existing.currency === "aud"
  ) {
    cachedPriceId = existing.id;
    return existing.id;
  }

  const linkPrice = await priceFromLegacyPaymentLink(stripe);
  if (linkPrice) {
    cachedPriceId = linkPrice;
    return linkPrice;
  }

  const product = await stripe.products.create({
    name: "AI Customer Review Sentiment Report",
    description:
      "Personalised AI reputation report for your business — $23 + GST.",
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: REPORT_PRICE_AMOUNT_CENTS,
    currency: "aud",
    lookup_key: REPORT_PRICE_LOOKUP_KEY,
  });
  logger.info(
    { productId: product.id, priceId: price.id },
    "Created Stripe product/price for the business report",
  );
  cachedPriceId = price.id;
  return price.id;
}

/** Base URL customers return to after checkout. */
function publicBaseUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (!domain) throw new Error("REPLIT_DOMAINS is not set");
  return `https://${domain}`;
}

/** Create a checkout session tied to one report request. */
export async function createReportCheckoutSession(params: {
  requestId: string;
  email: string;
}): Promise<{ sessionId: string; url: string }> {
  const stripe = await getUncachableStripeClient();
  const priceId = await resolveReportPriceId(stripe);
  const base = publicBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: params.email,
    client_reference_id: params.requestId,
    metadata: { reportRequestId: params.requestId },
    payment_intent_data: {
      metadata: { reportRequestId: params.requestId },
      // Stripe sends its own payment receipt to this address on success,
      // regardless of the dashboard's global email setting. (Stripe suppresses
      // receipt emails in test mode — they only go out with live keys.)
      receipt_email: params.email,
    },
    success_url: `${base}/?payment=success`,
    cancel_url: `${base}/?payment=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { sessionId: session.id, url: session.url };
}
