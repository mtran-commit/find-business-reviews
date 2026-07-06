---
name: Gmail connector email sending
description: How transactional email with attachments is sent via the Replit Gmail connector in a pnpm monorepo, and the quirks hit while wiring it.
---

# Gmail connector email sending

- Sending mail = build a full RFC 2822 MIME string (multipart/mixed → multipart/alternative + attachment parts), base64url-encode it, and POST `{raw}` to `/gmail/v1/users/me/messages/send` via `connectors.proxy("google-mail", ...)` from `@replit/connectors-sdk`. There is no higher-level "send" helper.
- **Why:** the connector only proxies the raw Gmail REST API; nodemailer-style SMTP is not available through it.
- **How to apply:** wrap base64 bodies at 76 chars, strip CR/LF from all header values (injection), never cache the `ReplitConnectors` client (tokens expire). Verify the authorized mailbox after OAuth via `GET /gmail/v1/users/me/profile` — the app sends from whichever account the user signed in with, not necessarily the intended one.
- pnpm monorepo quirk: the SDK installs into one workspace package (e.g. the api-server); ad-hoc verification scripts must live INSIDE that package dir to resolve the import — a script in `/tmp` or the repo root fails with ERR_MODULE_NOT_FOUND. The code_execution sandbox also resolves from the root and can't import it.
