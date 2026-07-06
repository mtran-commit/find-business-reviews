import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Stripe webhook must receive the RAW body for signature verification, so it
// is registered BEFORE express.json(). Any custom reaction (marking a report
// request paid) happens inside processStripeWebhook after verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0]! : signature;
    try {
      const { processStripeWebhook } = await import("./lib/stripeWebhook");
      await processStripeWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      req.log.error({ err }, "Stripe webhook processing failed");
      // 400 only for signature/format problems (Stripe should NOT retry a
      // forged/garbled payload); 500 for transient internal failures (DB or
      // Stripe connector down) so Stripe retries the event later.
      const msg = err instanceof Error ? err.message : "";
      const isSignatureError =
        /signature|webhook secret|No signatures found|Unexpected token|Payload must be a Buffer/i.test(
          msg,
        );
      res
        .status(isSignatureError ? 400 : 500)
        .json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
