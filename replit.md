# Compare Reviews

A single-page web app where someone enters a business name and compares its public review ratings across Google, TripAdvisor and Yelp, with a computed Trust Score, rating-gap alerts, red flags and a review summary.

## Where things live

- Frontend: self-contained single file `artifacts/compare-reviews/index.html` (inline CSS + JS, no React/build deps). Spec-matched comparison UI: a persistent centered search pill (aqua circle + black "Check", no hero), a results heading ("Results for: X" + "AI checked N review platforms in X.X seconds · <locality> results" + green-dot "Live data checked just now"), and a featured "AI Recommendation" card built with CSS `grid-template-areas` (image 330×175 | info | ratings-by-platform panel | white trust-score panel; 1.5px aqua border; black overlapping badge). The image area (`.featured-image-wrap`) layers a branded-initials base, the business photo (`imageUrl`, `object-fit:cover`), and a small brand-logo overlay bottom-left (`.logo-overlay`, `logoUrl`, white rounded card); broken images degrade gracefully via `__photoFail`/`__logoFail` (logo→initials, photo→navy fallback). `renderLogo(logoUrl, name, cls)` shows a real logo or an initials fallback and is reused for the similar-business row logos. Info column: name, address, computed pill tags, black partial-fill stars + "X.X average across N reviews", outline action buttons (Visit website/Call/Directions) and a subtle offer chip. Below: compact horizontal similar-business rows (`.result-row`, demo) and a centered footer note. Per spec the main page has NO analytics cards — the full AI insights live ONLY in report MODALS. The Trust Score panel holds a `.report-action-stack` of THREE full-width buttons (mobile-visible, in order): VIEW REPORT + "View AI Review Sentiment" (Free) both open the same free customer report via `openReport` (titled "AI Review Sentiment", review summary/best-for/red-flags/reputation-trend/score stats). The third button, "Business Report" ($10), opens `openBusinessReport` — a business-OWNER paid preview that REUSES the same modal (els.reportTitle/Sub/Body): stat grid (Trust Score/avg/platforms), an "AI sentiment overview" block (from the same AI call), data-derived `businessStrengths` (max 2, honest, from real metrics) + `businessRisk` line, a locked-sections list, and an "Unlock full report — $10" button (`data-act="unlock"`) calling `startBusinessReportPayment()` which alerts "Stripe payment connection coming soon." (Stripe not yet wired). Report loading UX: both `openReport` and `openBusinessReport` are async — they immediately render a full `.report-loading` state (reuses `.spinner`/`--navy`; `reportLoadingHtml(type)` = spinner + "Report Generating" + platform message + "Please don't close this window"), open the modal, then `await ensureAIAnalysis(data)` and auto-render the finished report (NO double-click). On AI failure BOTH show `reportErrorHtml()` ("Report could not be generated right now. Please try again."). `ensureAIAnalysis(data)` caches the in-flight fetch promise on `data.__aiPromise` so the two buttons share ONE POST to `/api/analyze-reviews`, rejects on failure (clearing the cache so a re-open retries) and resolves `null` when no public platforms exist (→ `renderCustomerReport` uses per-field rule-based fallbacks `fbReviewSummary`/`fbBestFor`/`fbRedFlags`/`fbTrend`). A module-level `reportToken` is bumped on every open AND in `closeReport`; each async open captures its token and only renders if it still matches, so a slow/late AI response can never paint into a closed or replaced modal. All AI-derived text is `escapeHtml`-escaped before insertion. All three buttons use `data-act` event delegation (report/sentiment/business-report) like the rest of the card. External URLs are opened via `safeOpen` (http(s)-only, `noopener,noreferrer`). Clicking a similar-business row or its "View report" runs a fresh real search. A `?q=<name>` URL param deep-links into an auto-run search.
- Backend: `artifacts/api-server/src/routes/business.ts` (`/search-business`, `/find-offers` + zod/v4) and `artifacts/api-server/src/lib/serpapi.ts` (SerpApi client + demo builders, returns the `BusinessReviews` shape). `artifacts/api-server/src/routes/analyze.ts` is the OpenAI-backed structured-analysis endpoint (`POST /api/analyze-reviews`).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Architecture decisions

- Reviews come from SerpApi (server-side; `SERPAPI_API_KEY` never reaches the browser). Google rating/review-count is read directly from the `google_maps` engine.
- Yelp has no aggregate-rating engine in SerpApi. We resolve the Yelp listing via the `yelp` search engine (best distinctive-token name match), then derive the rating by averaging the first page (up to 49) of `yelp_reviews` and use `search_information.total_results` as the review count. This is exact for low-review businesses and a close estimate for high-volume ones.
- To protect quota, `yelp_reviews` is only called after a confident name match; non-matches short-circuit with no extra call.
- TripAdvisor uses the `tripadvisor` search engine, which returns the aggregate `rating` + `reviews` count directly on each place — one call, matched by distinctive-token name (ties broken by review count). No `tripadvisor_reviews` call needed. Non-matches return `null` with note "No match found".
- Offers (`offer` on `BusinessReviews`, also `GET /api/find-offers?businessName=&website=`) are deterministic demo data (`buildDemoOffer`, ~50% "available" by hash) flagged `demo: true` / `source: "Demo data"`. The UI labels them "Demo" and never presents them as verified real offers. Replace with a real public-results lookup later.
- Similar/nearby businesses (`nearby` on `BusinessReviews`) must match BOTH the searched business's CATEGORY and its SUBURB. `detectBusinessCategory(name, query, placeTypes)` classifies into ordered groups (real_estate, cafe, restaurant, hotel, individual trades like plumber/electrician, beauty, dentist, medical, retail; default "businesses") using the Google Maps `type` field (which can be a string OR array, e.g. `["Italian restaurant","Bar"]`), the name and the query — single-word keywords match on word tokens (so "bar" never matches "barber"), multi-word match as substrings. `extractLocality(address, query)` parses the AU suburb as the text before the state abbrev (VIC/NSW/QLD/SA/WA/TAS/NT/ACT), e.g. "Chelsea VIC 3196" → Chelsea. `fetchSimilarBusinesses(category, locality, excludeName, ...)` runs ONE `google_maps` search for `${searchTerm} near ${suburb} ${state} Australia`, excludes the searched business (distinctive-token overlap) and de-dupes, returning up to 3 real peers with their real Google rating (Yelp/TripAdvisor left null to protect quota; shown as "—" with no penalty). When fewer than 3 real peers are found it falls back to `buildCategoryDemoNearby` (category-specific, suburb-aware names via `DEMO_TEMPLATES`, flagged `demo: true`) — never the wrong category. `GET /api/similar-businesses?category=&suburb=&state=&businessName=` exposes it standalone. The UI title is dynamic: `Similar ${category.label} near ${suburb}`, with a "Demo data" badge only when rows are demo. Clicking a nearby row runs a real search for that name.
- AI analysis: `POST /api/analyze-reviews` uses OpenAI (`gpt-5-mini` via the Replit AI Integrations proxy — `@workspace/integrations-openai-ai-server`, key never reaches the browser) with `response_format: json_object` to return structured `{ reviewSummary, bestFor[], redFlags[], reputationTrend, offerSummary }` from ONLY the real non-demo platform ratings sent by the client. Validated server-side with zod. The OpenAI client is imported lazily inside the handler so a missing integration returns a clean 503 instead of crashing server boot. The frontend gates both reports on this call behind a "Report Generating" loading modal (see the report-modal description above): on success it renders AI fields (falling back per-field to rule-based helpers only when a field is absent or no platforms exist); on outright failure it shows the "Report could not be generated right now" error instead of silently substituting a fallback report.
- Logos & photos: `imageUrl` is the Google Maps `thumbnail` (a colour business photo); `logoUrl` is the brand logo derived server-side from the website via Google's public favicon service (`faviconLogo(website)` → `https://www.google.com/s2/favicons?domain=<host>&sz=128`, no API key). `NearbyBusiness` carries both (real peers from their own website/thumbnail; demo rows leave them `""`). The frontend always has an initials fallback, so missing/broken assets never break layout.
- Trust Score uses the spec formula `round(avg/5 * 100)` over available (non-null, non-demo) platforms; avg, total reviews and gap are also computed client-side over those platforms only, so missing platforms don't penalize the score.

## Product

Enter a business name (or deep-link with `?q=<name>`) to see a premium comparison dashboard: a featured AI-recommendation card with real Google, Yelp and TripAdvisor ratings (counts + horizontal text stars), computed tags, a 0–100 Trust Score panel, and an available-offer section (demo); an AI analysis card (summary, best-for, red flags, reputation trend); nearby comparison rows (demo); and clearly-labelled "Not available yet" states (unmatched Yelp/TripAdvisor).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
