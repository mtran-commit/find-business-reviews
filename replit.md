# Compare Reviews

A single-page web app where someone enters a business name and compares its public review ratings across Google, TripAdvisor, Yelp and Facebook, with a computed Trust Score, rating-gap alerts, red flags and a review summary.

## Where things live

- Frontend: self-contained single file `artifacts/compare-reviews/index.html` (inline CSS + JS, no React/build deps). Spec-matched comparison UI: a persistent centered search pill (aqua circle + black "Check", no hero), a results heading ("Results for: X" + "AI checked N review platforms in X.X seconds · <locality> results" + green-dot "Live data checked just now"), and a featured "AI Recommendation" card built with CSS `grid-template-areas` (image 330×175 | info | ratings-by-platform panel | white trust-score panel; 1.5px aqua border; black overlapping badge). Info column: name, address, computed pill tags, black partial-fill stars + "X.X average across N reviews", a blue "Review Pay reviews available (Demo)" line, outline action buttons (Visit website/Call/Directions) and a subtle offer chip. Below: compact horizontal similar-business rows (`.result-row`, demo) and a centered footer note. Per spec the main page has NO analytics cards — the full AI insights (review summary, best-for, red flags, reputation trend, score stats) live ONLY in a report MODAL opened via "View report" (`openReport`), which `loadAIAnalysis(data)` lazy-fills by POSTing real (non-demo) ratings to `/api/analyze-reviews` with a stale-guard (rule-based fallback restored on failure). External URLs are opened via `safeOpen` (http(s)-only, `noopener,noreferrer`). Clicking a similar-business row or its "View report" runs a fresh real search. A `?q=<name>` URL param deep-links into an auto-run search.
- Backend: `artifacts/api-server/src/routes/business.ts` (`/search-business`, `/find-offers`, `/reviewpay-reviews` + zod/v4) and `artifacts/api-server/src/lib/serpapi.ts` (SerpApi client + demo builders, returns the `BusinessReviews` shape). `artifacts/api-server/src/routes/analyze.ts` is the OpenAI-backed structured-analysis endpoint (`POST /api/analyze-reviews`).

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
- Facebook has no usable SerpApi rating source, so it always returns `null` with note "Not available yet".
- Review Pay is an internal platform: the backend returns deterministic demo data (hash of the name via `hashString`) and flags it in the `demo` array. It renders as a 5th platform row with a "Demo" badge but is excluded from Trust Score, metrics, and the AI analysis. `GET /api/reviewpay-reviews?businessName=` exposes it standalone.
- Offers (`offer` on `BusinessReviews`, also `GET /api/find-offers?businessName=&website=`) are deterministic demo data (`buildDemoOffer`, ~50% "available" by hash) flagged `demo: true` / `source: "Demo data"`. The UI labels them "Demo" and never presents them as verified real offers. Replace with a real public-results lookup later.
- Nearby comparison businesses (`nearby` on `BusinessReviews`, via `buildDemoNearby`) are illustrative demo data (3 picks from a fixed pool with deterministic per-platform ratings), flagged `demo: true` and clearly labelled in the UI. Clicking a nearby row runs a real search for that name.
- AI analysis: `POST /api/analyze-reviews` uses OpenAI (`gpt-5-mini` via the Replit AI Integrations proxy — `@workspace/integrations-openai-ai-server`, key never reaches the browser) with `response_format: json_object` to return structured `{ reviewSummary, bestFor[], redFlags[], reputationTrend, offerSummary }` from ONLY the real non-demo platform ratings sent by the client. Validated server-side with zod. The OpenAI client is imported lazily inside the handler so a missing integration returns a clean 503 instead of crashing server boot; the frontend keeps/restores rule-based fallbacks on any failure.
- Trust Score uses the spec formula `round(avg/5 * 100)` over available (non-null, non-demo) platforms; avg, total reviews and gap are also computed client-side over those platforms only, so missing platforms don't penalize the score.

## Product

Enter a business name (or deep-link with `?q=<name>`) to see a premium comparison dashboard: a featured AI-recommendation card with real Google, Yelp and TripAdvisor ratings (counts + horizontal text stars), computed tags, a 0–100 Trust Score panel, an available-offer section (demo), and a Review Pay row (demo); an AI analysis card (summary, best-for, red flags, reputation trend); nearby comparison rows (demo); and clearly-labelled "Not available yet" states (Facebook, or unmatched Yelp/TripAdvisor).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
