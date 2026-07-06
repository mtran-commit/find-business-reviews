/**
 * Sends the paid AI Customer Review Sentiment Report to the customer by email
 * with the PDF attached, via the Replit Gmail connector (google-mail). The
 * connected mailbox is the sender (hello@findbusinessreviews.com); the SDK
 * handles OAuth token refresh automatically, so no credentials live here.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";

const FROM_NAME = "Find Business Reviews";

/** RFC 2047 encode a header value so names with non-ASCII chars are safe. */
function encodeHeaderWord(value: string): string {
  // Strip CR/LF to prevent header injection, then encode if non-ASCII.
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) {
    // Quote if it contains specials.
    return /[",<>@;:\\]/.test(clean) ? `"${clean.replace(/(["\\])/g, "\\$1")}"` : clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** Base64-encode and wrap at 76 chars per RFC 2045 for maximum compatibility. */
function b64lines(data: Uint8Array | string): string {
  const b64 =
    typeof data === "string"
      ? Buffer.from(data, "utf8").toString("base64")
      : Buffer.from(data).toString("base64");
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Simple, professional branded HTML body (inline styles for email clients). */
function buildEmailHtml(customerName: string, businessName: string): string {
  const first = escapeHtml((customerName || "").trim().split(/\s+/)[0] || "there");
  const biz = escapeHtml(businessName || "your business");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f7f4;font-family:Arial,Helvetica,sans-serif;color:#050505;">
    <div style="max-width:600px;margin:0 auto;padding:28px 20px;">
      <div style="background:#071a3d;border-radius:14px 14px 0 0;padding:22px 26px;">
        <div style="color:#ffffff;font-size:20px;font-weight:bold;">Find Business Reviews</div>
        <div style="color:#c9b8f5;font-size:13px;margin-top:4px;">Trust before you buy</div>
      </div>
      <div style="background:#ffffff;border:1px solid #e6e2f2;border-top:0;border-radius:0 0 14px 14px;padding:26px;">
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hi ${first},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
          Thank you for your purchase. Your <strong>AI Customer Review Sentiment Report</strong>
          for <strong>${biz}</strong> is ready and attached to this email as a PDF.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
          Inside you'll find your Trust Score, platform-by-platform comparison, AI customer
          sentiment analysis, and a practical action plan to strengthen your online reputation.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
          If you have any questions about your report, just reply to this email.
        </p>
        <p style="font-size:15px;line-height:1.6;margin:22px 0 0;">
          Kind regards,<br/>
          <strong>The Find Business Reviews team</strong>
        </p>
      </div>
      <p style="font-size:11px;color:#6b6b76;text-align:center;margin:16px 0 0;line-height:1.5;">
        Independent. Unbiased. Built for smarter decisions.<br/>
        This report was prepared from publicly available review data.
      </p>
    </div>
  </body>
</html>`;
}

function buildEmailText(customerName: string, businessName: string): string {
  const first = (customerName || "").trim().split(/\s+/)[0] || "there";
  return (
    `Hi ${first},\n\n` +
    `Thank you for your purchase. Your AI Customer Review Sentiment Report for ` +
    `${businessName || "your business"} is ready and attached to this email as a PDF.\n\n` +
    `Inside you'll find your Trust Score, platform-by-platform comparison, AI customer ` +
    `sentiment analysis, and a practical action plan to strengthen your online reputation.\n\n` +
    `If you have any questions about your report, just reply to this email.\n\n` +
    `Kind regards,\nThe Find Business Reviews team\n\n` +
    `Independent. Unbiased. Built for smarter decisions.`
  );
}

export interface SendReportEmailParams {
  to: string;
  customerName: string;
  businessName: string;
  pdf: Uint8Array;
  pdfFilename: string;
}

/**
 * Build the MIME message and send it through the Gmail API. Throws on any
 * failure (caller decides how to react — the report stays "generated" so the
 * admin can retry or download + email manually).
 */
export async function sendReportEmail(params: SendReportEmailParams): Promise<void> {
  const { to, customerName, businessName, pdf, pdfFilename } = params;

  const cleanTo = to.replace(/[\r\n]+/g, "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
    throw new Error("Invalid recipient email address.");
  }

  const boundaryMixed = "mixed_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const boundaryAlt = "alt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const subject = `Your AI Customer Review Sentiment Report — ${businessName || "Your Business"}`;
  const safeFilename = (pdfFilename || "report.pdf").replace(/[^\w.-]+/g, "-");

  const mime = [
    `From: ${encodeHeaderWord(FROM_NAME)} <hello@findbusinessreviews.com>`,
    `To: ${encodeHeaderWord(customerName)} <${cleanTo}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
    "",
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(buildEmailText(customerName, businessName)),
    "",
    `--${boundaryAlt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(buildEmailHtml(customerName, businessName)),
    "",
    `--${boundaryAlt}--`,
    "",
    `--${boundaryMixed}`,
    `Content-Type: application/pdf; name="${safeFilename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    "",
    b64lines(pdf),
    "",
    `--${boundaryMixed}--`,
    "",
  ].join("\r\n");

  const raw = Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Never cache the connectors client — tokens expire (per Replit integration docs).
  const connectors = new ReplitConnectors();
  const resp = await connectors.proxy(
    "google-mail",
    "/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Gmail send failed (${resp.status}): ${text.slice(0, 300) || "no response body"}`,
    );
  }
}
