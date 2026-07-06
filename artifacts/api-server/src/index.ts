import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Initialise Stripe on startup: create the `stripe` schema, register the
 * managed webhook (pointing at /api/stripe/webhook on the public domain) and
 * backfill existing Stripe data. Non-fatal — if the Stripe integration is
 * unavailable the rest of the API still serves, and payments fall back to
 * manual "Mark as paid" in the admin page.
 */
async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set; skipping Stripe initialisation");
    return;
  }

  try {
    const { runMigrations } = await import("stripe-replit-sync");
    await runMigrations({ databaseUrl });

    const { getStripeSync } = await import("./lib/stripeClient");
    const stripeSync = await getStripeSync();

    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
    if (domain) {
      const webhook = await stripeSync.findOrCreateManagedWebhook(
        `https://${domain}/api/stripe/webhook`,
      );
      logger.info(
        { webhookUrl: webhook?.url ?? "configured" },
        "Stripe managed webhook ready",
      );
    } else {
      logger.warn("REPLIT_DOMAINS not set; skipped Stripe webhook setup");
    }

    stripeSync
      .syncBackfill()
      .then(() => logger.info("Stripe data synced"))
      .catch((err) => logger.error({ err }, "Stripe backfill failed"));
  } catch (err) {
    logger.error(
      { err },
      "Stripe initialisation failed; automatic payment marking is unavailable (manual Mark as paid still works)",
    );
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void initStripe();
});
