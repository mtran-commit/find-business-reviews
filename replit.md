# Find Business Reviews

A single-page web app (live at findbusinessreviews.com) where someone enters a business name and compares its public review ratings across **Google, Yelp, TripAdvisor, Trustpilot, Product Review (productreview.com.au) and Facebook**, with a computed 0–100 Trust Score, rating-gap alerts, red flags and an AI review summary. Business owners can also buy a paid, personalised AI reputation report.

## Brand & palette

- Brand: "Find Business Reviews", tagline "Trust before you buy". Logo at `artifacts/compare-reviews/public/logo.png`.
- Palette is ONLY: navy `#071A3D`, black `#050505`, white, purple `#7B3CFF`/`#8B4DFF`, soft purple `#F1E8FF`, light bg `#F7F7F4`/`#FFF`. **No turquoise/aqua/light-blue anywhere.** The legacy `--aqua` CSS token is now an alias for purple, so any leftover `var(--aqua)` still renders purple. Body/subtitles are black or navy.
- Exception: platform icons (`public/icons/*.svg`) keep their real brand colours; generated PDF/HTML reports are fully monochrome except real business photos/logos.

## Architecture

### Frontend — `artifacts/compare-reviews/index.html`
Self-contained single file (inline CSS + JS, no React/build step). Landing (marketing hero + platform strip + two-input search: business + location) → results. `handleLandingSearch()` combines the two inputs; an empty location triggers best-effort browser geolocation + reverse-geocode, and any failure silently searches business-only. `?q=<name>` deep-links an auto-run search.

- The main results page shows a featured "AI Recommendation" card (photo, ratings-by-platform panel, Trust Score panel). **Full AI insights live ONLY in report modals**, never inline.
- Three report buttons: two **free** ("AI Review Sentiment") open `openReport`; one **paid** "Business Report" ($23 + GST) opens `openBusinessReport` (an owner-facing preview). Both are async — they render a loading modal, share ONE `/api/analyze-reviews` call (cached on the data object), then auto-render. A `reportToken` bumped on every open/close prevents a late AI response painting into a closed/replaced modal.
- Paid flow is strictly: preview → request form → save (`POST /api/report-requests`) → per-customer Stripe Checkout (`POST /api/report-requests/:id/checkout`, opened in a new tab). **Stripe can never open before the form is filled and saved** — the legacy `startBusinessReportPayment()` alias now just opens the form. Falls back to the shared Payment Link if checkout creation fails.
- Security: all AI/business text is `escapeHtml`-escaped before insertion; external links go through `safeOpen` (http(s)-only, `noopener`). The app NEVER collects card details.

### Data provider — split between two providers (both server-side, never in the browser)
`artifacts/api-server/src/lib/dataforseo.ts` + `serpapi.ts`.

- **DataForSEO** (`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`) supplies: Google business info + nearby competitors via the **Maps SERP** search `serp/google/maps/live/advanced` (top-ranked item — NOT `my_business_info/live`, which only resolves one exact business and 40102s on multi-location queries); Google review snippets; and TripAdvisor + Trustpilot aggregate ratings + snippets via **async** `.../search` + `.../reviews` task_post→task_get on `priority:2` (neither has a live endpoint). Product Review + Facebook ratings are best-effort Google organic rich-snippet ratings scraped from `serp/google/organic/live/advanced`, scoped by **exact host / subdomain** (not substring) and normalised to /5.
- **SerpApi** (`SERPAPI_API_KEY`, optional) is kept ONLY for Yelp and Facebook/Instagram branding profiles; absent key → those degrade cleanly.
- All 5 non-Google lookups run in parallel; each degrades **honestly** (`note: "No match found"`/`"Lookup unavailable"`, joins `unavailable[]`) and is NEVER faked. All 6 platform keys flow through `BusinessReviews` → `computeMetrics` → the frontend `PLATFORMS` array → hero strip.
- Yelp has no aggregate-rating engine: resolve the listing, then derive the rating by averaging the first page of `yelp_reviews` (up to 49) and use `total_results` as the count (`yelp_reviews` only called after a confident name match, to save quota).
- Similar/nearby businesses must match BOTH the searched business's category and suburb; falls back to clearly-labelled category-specific demo rows, never the wrong category. Offers are deterministic **demo** data, always labelled "Demo".

### Backend — `artifacts/api-server`
Express 5 + Postgres/Drizzle. Routes: `business.ts` (`/search-business`, `/find-offers`, `/similar-businesses`), `analyze.ts` (`POST /api/analyze-reviews`), `reportRequests.ts` (report request CRUD + admin fulfilment). All input validated with `zod/v4`; `businessLink` is http(s)-validated so no `javascript:`/`data:` URL can be stored. Card data is never stored.

- **AI analysis**: `POST /api/analyze-reviews` uses OpenAI `gpt-5-mini` via the Replit AI Integrations proxy (`@workspace/integrations-openai-ai-server`, key never in browser), `response_format: json_object`, zod-validated. The client is **lazily imported inside the handler** so a missing integration returns a clean 503 instead of crashing boot. AI facts are grounded deterministically post-parse (e.g. review tags overwritten from real data), never prompt-only.
- **`report_requests` table** (`lib/db/src/schema/reportRequests.ts`): `status` = payment state (`pending_payment`→`paid`/`refunded`/`cancelled`), `reportStatus` = delivery state (`pending`→`generating`→`generated`→`sending`→`sent`/`failed`), plus `reportJson`, `reportPdfUrl`, timestamps, `stripe_checkout_session_id`, `report_send_started_at`. Additive migrations only.
- **Admin gate**: every admin route uses `requireAdmin`, keyed on `REPORT_ADMIN_TOKEN` — **503 when the token is unset** (safe default, no public PII leak), else requires a matching `x-admin-token` header (401 on mismatch).

### Stripe payments
Per-customer Stripe Checkout via the Replit Stripe connector; credentials fetched fresh from the connection API in `stripeClient.ts` (accepts `settings.secret_key` OR `settings.secret`; never cached, never in browser).

- **Environment selection is critical**: the connection API can return BOTH a `development` (sk_test) and a `production` (sk_live) connection. `getStripeCredentials` selects by `item.environment` — deployments (`REPLIT_DEPLOYMENT` set) take production, workspace takes development. **Never take `items[0]` blindly** — that once made the live app create sandbox checkouts.
- **Price guard**: resolve the AUD $25.30 price by lookup_key `business_report_23_plus_gst` first, else the legacy Payment Link's price — but BOTH are only accepted at **exactly 2530 AUD cents**. The live legacy link was once $10 and charged customers $10; never trust a link amount blindly. Frontend fallback `BUSINESS_REPORT_PAYMENT_LINK` is a live $25.30 link.
- **Webhook**: raw-body `POST /api/stripe/webhook` registered BEFORE `express.json()`; verified via `stripe-replit-sync`. On paid, marks the request `paid` with idempotent WHERE guards (safe against manual "Mark as paid" races). Returns 400 only for signature errors, 500 for transient failures (so Stripe retries).
- **Boot**: `initStripe()` (migrations + managed webhook + backfill) is entirely NON-FATAL — Stripe down ⇒ API still serves and admin manual "Mark as paid" is the fallback.
- **Bundling**: `stripe-replit-sync` MUST be esbuild-external in `build.mjs` (its migrations read SQL relative to `__dirname`, which breaks when bundled).

### Admin fulfilment & report delivery
Private unlinked route `/admin-report-requests` (served by the SPA rewrite, branches on pathname). Token-prompt stored in `localStorage`, sent as `x-admin-token`. Lists all requests newest-first with filters, search, duplicate detection, and per-row state-dependent actions. The public site never links here.

- Reports are **rebuilt on demand from `reportJson`** (never stored to disk): `GET .../download` → pdf-lib PDF (`reportPdf.ts`), `GET .../report` → inline-CSS HTML dashboard (`reportHtml.ts`). **No Chromium/Puppeteer on Replit** — the pdf-lib path is the PDF path. Both routes normalise old persisted JSON through `normalizeReport` so renderers never 500 on old-shape reports.
- Generation (`generate-report`) requires `status==="paid"`, re-fetches live data (falling back to the saved snapshot), collects snippets, computes deterministic metrics/analytics, and calls OpenAI for the structured multi-section report. All new AI schema fields are `.default()`ed for back-compat.
- **Delivery is automatic**: `autoDeliverReport` (fire-and-forget, `reportDelivery.ts`) runs whenever a request flips to `paid` (webhook / mark-paid / legacy PATCH) — generates if needed, then emails the PDF. Concurrency is protected by **atomic DB claims/leases**: a `generating` claim and a `sending` lease (10-min TTL, reclaimable if stale) ensure the auto job and admin buttons can never double-generate or double-email. Manual "Generate & send" / download / "Mark as sent" remain as fallbacks.
- **Email**: `reportEmail.ts` sends a MIME multipart (text+HTML + PDF attachment) via the Replit **Gmail** connector (`connectors.proxy("google-mail", ...)`, mailbox hello@findbusinessreviews.com). Headers are CRLF-stripped against injection.

### Logos (zero-tolerance trust rule)
NEVER show a wrong or generic logo (WordPress/Wix/Squarespace/Shopify/favicon/platform icons). The **only** confident logo source is the business's OWN official website, scraped server-side by `lib/logo.ts` (`resolveWebsiteLogo`): it reads the homepage HTML for schema.org/JSON-LD `logo` (→ `high`) and `apple-touch-icon` (→ `high`), then a scalable `<link rel=icon>` png/svg (→ `medium`), then og:image/twitter:image (→ `medium`). Bare `.ico` favicons are skipped (low-quality/builder-default). Every candidate is host/path-checked against a banned list (builders, review/social CDNs, `parastorage`/`wixstatic`/`pfavico` = Wix, favicon services, placeholders) and must be an absolute http(s) image; a `high` mark hosted off the business's own domain is downgraded to `medium`. SSRF-safe: `fetchHtml` follows redirects **manually**, re-checking `isPublicHost` on every hop (blocks localhost/`.local`/private/loopback/link-local/metadata IPs), each hop with its own timeout budget. Results (incl. misses) are cached in-memory 24h. `resolveWebsiteLogo` ALWAYS returns a structured `ResolvedLogo` (never null): `{ url: string|null, source, confidence, reason }` where `confidence: "high"|"medium"|"low"|"none"` and `source: "website_schema"|"website_icon"|"website_og"|"favicon"|"google"|"facebook"|"fallback"` (only the website_*/favicon sources are actually produced; google/facebook stay banned and are never auto-trusted). `BusinessReviews`/`NearbyBusiness` carry a nested `logo` object; `logLogoDecision` logs each decision (business, url, source, confidence, reason, initialsFallback). The frontend `logoInfo()`/`safeLogoUrl()` read the nested `logo` (back-compat with the old flat shape), show a logo (overlay badge bottom-left of the photo for the featured card, `result-logo` for peers) only when confidence is high/medium AND it passes a local defence-in-depth banned-list check, `console.debug`-log each decision, and fall back to navy initials otherwise (broken images degrade to initials via `onerror`). Business photos (`imageUrl`, the Google Maps thumbnail) are always shown regardless. Paid reports (`reportDelivery.ts`) also use this logo (social-branding match first, then the website logo).

### Trust Score
`round(avg/5 * 100)` over available (non-null, non-demo) platforms only, so missing platforms don't penalize the score. Avg, total reviews and rating gap are computed the same way.

### Social branding — `branding.ts`
Best-effort Facebook/Instagram profile discovery via SerpApi, gated by a `scoreMatch` confidence threshold (≥0.6) so a wrong profile is never attached. 24h in-memory cache; every fetch is try/caught — branding NEVER fails a report generation.

### iOS mobile app (Capacitor + Codemagic)
The web app ships to iOS as a Capacitor shell built on Codemagic cloud Macs (no local Mac). Setup lives in: `codemagic.yaml` (repo root, monorepo-aware build), `artifacts/compare-reviews/capacitor.config.json` (appId `com.findbusinessreviews.app`, webDir `dist/public`), `resources/icon.png`+`splash.png`, and native detection in `index.html` (`API_BASE` switches to `https://findbusinessreviews.com/api` when protocol is `capacitor:`). Native build needs `PORT=8080 BASE_PATH=./`. CORS is already open. Full walkthrough: `codemagic-ios-guide.md`. Keep the site published — the native app is a client of the live API.

## Run & operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`. Secrets in use: `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`, `SERPAPI_API_KEY` (optional), `REPORT_ADMIN_TOKEN`, `SESSION_SECRET`. Integrations: Stripe, Gmail, OpenAI (via Replit AI Integrations).

## Stack

pnpm workspaces · Node.js 24 · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle ORM · Zod (`zod/v4`) + `drizzle-zod` · Orval codegen from OpenAPI · esbuild (CJS bundle). See the `pnpm-workspace` skill for workspace structure and conventions.

## Gotchas (non-obvious traps)

- DataForSEO `task_post` returns per-task status **`20100` "Task Created."**, NOT 20000 — the post response handler must accept 20100.
- TripAdvisor and Trustpilot are **async-only** (no `/live` endpoint) — use task_post→task_get on `priority:2`.
- Google Maps `type` can be a string OR an array — handle both when classifying category.
- Stripe: select the connection by `environment`, never `items[0]`; only accept a price of exactly 2530 AUD cents.
- The Stripe webhook route must be registered BEFORE `express.json()` (needs the raw body).
- `stripe-replit-sync` must be esbuild-external, or its migrations silently no-op.
- No Chromium on Replit — render PDFs with pdf-lib, not Puppeteer.
- Import the OpenAI integration client lazily inside handlers, or a missing integration crashes server boot.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- `pnpm-workspace` skill — workspace structure, TypeScript setup, package details.
- `.agents/memory/` — durable cross-session lessons (provider quirks, Stripe/bundling notes, PDF rendering, AI grounding).
