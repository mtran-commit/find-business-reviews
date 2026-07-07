# Review Sources — API Usage & Implementation

_How Find Business Reviews fetches, matches, and uses ratings from each of the six review platforms._

Last updated: 07 July 2026.

---

## At a glance

| Platform | Provider | API / engine | Mode | Rating source |
|---|---|---|---|---|
| **Google** | DataForSEO | `serp/google/maps/live/advanced` (+ `business_data/google/reviews` for snippets) | Live (async for snippets) | `rating.value` / `rating.votes_count` |
| **Yelp** | SerpApi | `yelp` search → `yelp_reviews` | Live | Averaged from first review page |
| **TripAdvisor** | DataForSEO | `business_data/tripadvisor/search` | Async task, priority 2 | `rating.value` / `rating.votes_count` |
| **Trustpilot** | DataForSEO | `business_data/trustpilot/search` (+ `.../reviews` for snippets) | Async task, priority 2 | `rating.value` / `rating.votes_count` |
| **Product Review** | DataForSEO | `serp/google/organic/live/advanced` (rich snippet) | Live | Google rich-snippet rating, scoped to `productreview.com.au` |
| **Facebook** | DataForSEO | `serp/google/organic/live/advanced` (rich snippet) | Live | Google rich-snippet rating, scoped to `facebook.com` |

**Core principle across all six:** ratings are only ever shown when a source is confidently matched. When a platform can't be matched or is unavailable, it degrades **honestly** — it's marked "No match found" / "Lookup unavailable" and never faked.

---

## Providers & credentials

Both providers run **server-side only** — no credential or key ever reaches the browser.

- **DataForSEO** — HTTP Basic Auth via `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`. Primary provider for Google, TripAdvisor, Trustpilot, Product Review, Facebook, nearby competitors and branding discovery. If credentials are missing, the search routes return `503`.
- **SerpApi** — `SERPAPI_API_KEY` (optional). Kept only for Yelp and for Facebook/Instagram branding profiles. If the key is absent, Yelp and social branding degrade cleanly to unavailable.

Implementation lives in `artifacts/api-server/src/lib/dataforseo.ts` (provider transport + async task helpers) and `artifacts/api-server/src/lib/serpapi.ts` (per-platform resolvers + the `BusinessReviews` shape).

---

## Per-platform detail

### 1. Google
- **Provider / endpoint:** DataForSEO `serp/google/maps/live/advanced` (the Maps SERP search, `dataforseoLive`). Review snippets come separately from the async `business_data/google/reviews` task (`dataforseoReviews`, depth 20, sorted newest).
- **Mode:** Business profile is a **live** call (30s timeout); snippets are an **async** task (post → poll → get).
- **Why the Maps SERP, not `my_business_info/live`:** `my_business_info` only resolves a single exact business, returns `40102 No Search Results` for common multi-location queries (e.g. "Apple Melbourne") and can take ~30s. The Maps item is a superset of the fields we read and handles free-text queries.
- **Extraction:** rating = `rating.value`, count = `rating.votes_count`. Google is the primary lookup and the top-ranked Maps item is used.
- **Degradation:** `40102 No Search Results` → clean empty result (404), not an error; snippets → `[]` on timeout.
- **Extra:** Google review "topic chips" are derived by us (document-frequency, stop-word-filtered, top 15) because DataForSEO reviews don't return a topics array.

### 2. Yelp
- **Provider / endpoint:** SerpApi — `yelp` search engine to resolve the listing (`findYelpPlaceId`), then `yelp_reviews` to read ratings (`fetchYelpRating`).
- **Mode:** Live.
- **Extraction:** Yelp has **no aggregate-rating engine**, so the rating is derived by **averaging the first page** of `yelp_reviews` (up to 49 reviews); the count comes from `search_information.total_results`. Exact for low-review businesses, a close estimate for high-volume ones.
- **Matching:** resolve `place_id` by distinctive-token name match against `organic_results` (≥50% of distinctive tokens must match).
- **Quota protection:** `yelp_reviews` is only called **after** a confident name match — weak matches short-circuit so no extra call is burned.
- **Degradation:** "No match found" on a weak/no match; "Lookup unavailable" when `SERPAPI_API_KEY` is absent.

### 3. TripAdvisor
- **Provider / endpoint:** DataForSEO `business_data/tripadvisor/search` (`dataforseoTripadvisorSearch`).
- **Mode:** **Async only** — TripAdvisor has **no `/live` endpoint** (a live call `40400`s). Uses `task_post` → poll → `task_get` on **priority 2** (fast queue), 30s overall timeout with 2s→6s backoff.
- **Extraction:** rating = `rating.value`, count = `rating.votes_count` (nested shape, read via `dfsRating`).
- **Matching:** name + location search; pick the item with the most distinctive title-token overlap (≥50%), ties broken by highest review count.
- **Degradation:** `null` + note "No match found".

### 4. Trustpilot
- **Provider / endpoint:** DataForSEO `business_data/trustpilot/search` (`dataforseoTrustpilotSearch`), plus `business_data/trustpilot/reviews` for snippets (`dataforseoTrustpilotReviews`).
- **Mode:** **Async task**, priority 2 — mirrors TripAdvisor.
- **Extraction:** rating = `rating.value`, count = `rating.votes_count`.
- **Matching:** distinctive-token title match (≥50%) against search results.
- **Note:** Trustpilot search returns a rating without a reliable count, so the UI **omits the "(count)" chip** when the count is 0 rather than showing a misleading "(0)".
- **Degradation:** `null` rating / `[]` snippets on failure.

### 5. Product Review (productreview.com.au)
- **Provider / endpoint:** DataForSEO `serp/google/organic/live/advanced` — a **best-effort Google rich-snippet** rating, not a dedicated Product Review API.
- **Mode:** Live.
- **Extraction:** reads the Google rich-snippet `rating` object from the organic result (`organicRating`); if `rating_max` is present and not 5, it's normalised to a 5-point scale via `(value / max) * 5`.
- **Matching:** query `"<name> <suburb> productreview.com.au"`; accept the first result whose host is **exactly** `productreview.com.au` (exact/subdomain match — not substring) with a ≥50% title-token match.
- **Degradation:** `null` when no confident rich-snippet exists.

### 6. Facebook
- **Provider / endpoint:** DataForSEO `serp/google/organic/live/advanced` — same **rich-snippet** approach as Product Review.
- **Mode:** Live.
- **Extraction:** Google rich-snippet `rating` object (`organicRating`), normalised to /5.
- **Matching:** query `"<name> <suburb> Facebook reviews"`; accept the first result whose host is **exactly** `facebook.com` (guards against look-alike domains like `notfacebook.com`) with a ≥50% title-token match.
- **Degradation:** `null` when no rated match exists.

---

## How the ratings are used downstream

Once collected, all six platform ratings flow through the same pipeline:

1. **`BusinessReviews` shape** — every platform (rating, count, and an honest `note` / `unavailable[]` entry when missing) is carried on one object returned by `/api/search-business`. The 5 non-Google lookups run **in parallel** so one slow/failed platform never blocks the others.
2. **Comparison UI** (`artifacts/compare-reviews/index.html`) — the frontend `PLATFORMS` array drives the ratings-by-platform panel, the hero platform strip, and the analyze payload. Unavailable platforms render as "Not available yet".
3. **Trust Score** — computed as `round(avg / 5 × 100)` over **available (non-null, non-demo) platforms only**, so a missing platform never penalizes the score. Average, total review count and rating gap are computed the same way.
4. **AI analysis** — `POST /api/analyze-reviews` (OpenAI `gpt-5-mini` via the Replit AI Integrations proxy) receives only the real, non-demo platform ratings and returns the structured review summary, best-for, red flags and reputation trend shown in the report modals.
5. **Paid Business Report** — the admin fulfilment pipeline re-fetches live review data plus Trustpilot/Google review snippets, computes deterministic metrics, and feeds them into the multi-section PDF/HTML report.

---

## Notable implementation gotchas

- DataForSEO `task_post` returns per-task status **`20100` "Task Created."**, not `20000` — the post handler must accept `20100`.
- TripAdvisor and Trustpilot are **async-only**; there is no live endpoint for either.
- Product Review and Facebook ratings are **opportunistic** (scraped from Google rich snippets) — they're the least guaranteed of the six and frequently return "No match found", which is expected, not a bug.
- Host matching for the rich-snippet sources is **exact-domain / subdomain**, never substring, to avoid attaching a look-alike domain's rating.
