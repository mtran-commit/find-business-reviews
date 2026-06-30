# Compare Reviews

A single-page web app where someone enters a business name and compares its public review ratings across Google, TripAdvisor, Yelp and Facebook, with a computed Trust Score, rating-gap alerts, red flags and a review summary.

## Where things live

- Frontend: self-contained single file `artifacts/compare-reviews/index.html` (inline CSS + JS, no React/build deps). `fetchBusinessReviews(query)` calls the live backend at `GET /api/reviews?q=<name>` and throws a user-friendly Error on failure.
- Backend: `artifacts/api-server/src/routes/reviews.ts` (route + zod/v4 validation) and `artifacts/api-server/src/lib/serpapi.ts` (SerpApi client). The route returns the `BusinessReviews` shape defined in `serpapi.ts`.

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
- TripAdvisor and Facebook have no usable SerpApi source, so they always return `null` with a per-platform `notes` entry ("Not available yet"). Yelp non-matches return `null` with note "No Yelp match found".
- Frontend metrics (avg, total reviews, gap, Trust Score) are computed over available (non-null) platforms only; the "nearby" cards remain illustrative placeholder data.

## Product

Enter a business name to see its public ratings side by side: real Google and Yelp ratings (with review counts and stars), a 0–100 Trust Score, a rating-gap alert, a plain-language review summary, and platform cards that clearly mark sources with no data yet (TripAdvisor, Facebook, or unmatched Yelp).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
