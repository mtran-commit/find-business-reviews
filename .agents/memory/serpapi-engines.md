---
name: SerpApi engine quirks for review ratings
description: Which SerpApi engines expose aggregate ratings directly vs need derivation, for the Compare Reviews app.
---

When pulling public review ratings from SerpApi, the engines differ in whether they give an aggregate rating directly:

- **google_maps** — aggregate `rating` + `reviews` directly. One call.
- **tripadvisor** (search) — each result in `places[]` carries aggregate `rating` + `reviews` directly. One call; no `tripadvisor_reviews` call needed. Match the right place by distinctive-token name overlap, tie-break by highest review count.
- **yelp** (search) — does NOT expose an aggregate rating anymore. Only used to resolve a `place_id` by name. Then call **yelp_reviews** and average the first page of review stars; take the total count from `search_information.total_results`. Exact for low-review businesses, an estimate for high-volume.
- **facebook** — no usable public rating source; return null.

**Category hints gotcha:** the google_maps place `type` field is a **string OR an array** (e.g. `["Italian restaurant","Bar","Restaurant"]`), and `types`/`category` may be absent. When inferring a business category, gather all of `type`/`types`/`category` handling both shapes — reading `type` only as a string silently misses array-typed places (e.g. "Tipo 00" classified as generic instead of restaurant).

**Why:** verified live via curl during the build; the Yelp aggregate disappeared from the search engine, so it must be derived, while TripAdvisor still ships it inline (a wrong early assumption was that TripAdvisor had no usable source).

**How to apply:** to protect quota, only call the second-step engine (yelp_reviews) after a confident name match; non-matches short-circuit. Reuse the shared distinctive-token matcher for both Yelp and TripAdvisor name matching.
