---
name: DataForSEO async task quirks
description: Non-obvious behaviors of DataForSEO task_post/task_get endpoints (TripAdvisor, Google reviews) learned during the SerpApi→DataForSEO migration.
---

# DataForSEO async task quirks

**Rule:** A successful `task_post` returns per-task `status_code` **20100 "Task Created."**, NOT 20000. Only `task_get` returns 20000 when the result is ready. Any generic "assert task ok == 20000" helper must NOT be applied to the post response, or every async task (TripAdvisor, Google reviews) silently breaks.

**Why:** A shared `assertTaskOk` was wrongly applied to task_post responses, which fail the 20000 check even though the post succeeded. This broke BOTH TripAdvisor and Google reviews. Fix: a generic `dataforseoTask(postPath, getPathPrefix, ...)` where the post-response accepts top 20000 + per-task 20000/20100, and only the get-response requires 20000.

**How to apply:** Whenever adding a new DataForSEO async endpoint, wrap it through `dataforseoTask` in `artifacts/api-server/src/lib/dataforseo.ts`. Never gate the post on 20000.

## TripAdvisor has NO live endpoint
- `business_data/tripadvisor/search/live` → 40400. TripAdvisor is async-only: `task_post` then poll `task_get`.
- Correct get path is `business_data/tripadvisor/search/task_get/{id}` (NO `/advanced` suffix — that suffix belongs to SERP endpoints, not this one).
- Add `priority: 2` to the task to use the fast queue → ready in ~3-4s instead of the slow default. Google reviews task is similarly fast (~4s).
- Aggregate rating is nested: `rating.value` / `rating.votes_count` (handled by `dfsRating`).

## Provider split (this project)
- DataForSEO: Google business info (`/my_business_info/live`), nearby competitors (`/serp/google/maps/live/advanced`), TripAdvisor (async), Google review snippets (async `/google/reviews`), branding slug discovery (`/serp/google/organic/live/advanced`).
- SerpApi KEPT ONLY for: Yelp (rating + snippets) and Facebook/Instagram branding profiles. Degrades cleanly when `SERPAPI_API_KEY` is absent.
- Yelp returning null for AU businesses is a Yelp coverage gap, not a bug.
