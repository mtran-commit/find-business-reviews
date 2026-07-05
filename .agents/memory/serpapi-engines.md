---
name: SerpApi engine quirks for review ratings
description: Which SerpApi engines expose aggregate ratings directly vs need derivation, for the Compare Reviews app.
---

When pulling public review ratings from SerpApi, the engines differ in whether they give an aggregate rating directly:

- **google_maps** — aggregate `rating` + `reviews` directly. One call.
- **tripadvisor** (search) — each result in `places[]` carries aggregate `rating` + `reviews` directly. One call; no `tripadvisor_reviews` call needed. Match the right place by distinctive-token name overlap, tie-break by highest review count.
- **yelp** (search) — does NOT expose an aggregate rating anymore. Only used to resolve a `place_id` by name. Then call **yelp_reviews** and average the first page of review stars; take the total count from `search_information.total_results`. Exact for low-review businesses, an estimate for high-volume.
- **facebook** — no usable public rating source for the review comparison; return null.
- **facebook_profile / instagram_profile** — take a `profile_id` (page slug / username), NOT a search query; discover the slug first via a plain Google search ("<name> <suburb> Facebook/Instagram") and filter reserved slugs (login, pages, reels, etc.). FB returns followers/likes as display strings ("39M"), IG returns numeric followers/posts + `is_verified`. Both can throw "hasn't returned any results" for valid-looking slugs — always try/catch per platform and degrade to null. Profile/cover image URLs are CDN-signed and EXPIRE, so any UI/PDF using them needs an onerror/initials fallback.

**Social handle matching gotcha:** word-token overlap alone fails on social profiles because handles CONCATENATE the business name ("hopetountearooms" for "Hopetoun Tea Rooms" — zero token matches). Add a concatenated-name check, but PREFIX-ONLY (profile word equals or starts with the joined business name): a substring check would false-match tenant accounts like "layal_at_crownmelbourne" to "Crown Melbourne". Also: name-only PARTIAL matches must not be auto-accepted — parent-brand accounts ("Crown Hotels" for "Crown Melbourne") pass 50% token overlap; require a corroborator (phone / website domain / suburb-in-bio) for anything less than a full-name match. Google discovery returns wrong-business candidates in the top results routinely (news pages, sister brands, restaurants inside the venue), so evaluate 2–3 candidates, not just the first.

**Logo vs photo:** the google_maps `thumbnail` is a colour *photo* of the place, not a logo. There's no logo field. To get a brand logo with no extra API/key, derive it from the business website via Google's public favicon service (`https://www.google.com/s2/favicons?domain=<host>&sz=128`); always keep an initials fallback for businesses without a website.

**Category hints gotcha:** the google_maps place `type` field is a **string OR an array** (e.g. `["Italian restaurant","Bar","Restaurant"]`), and `types`/`category` may be absent. When inferring a business category, gather all of `type`/`types`/`category` handling both shapes — reading `type` only as a string silently misses array-typed places (e.g. "Tipo 00" classified as generic instead of restaurant).

**Why:** verified live via curl during the build; the Yelp aggregate disappeared from the search engine, so it must be derived, while TripAdvisor still ships it inline (a wrong early assumption was that TripAdvisor had no usable source).

**How to apply:** to protect quota, only call the second-step engine (yelp_reviews) after a confident name match; non-matches short-circuit. Reuse the shared distinctive-token matcher for both Yelp and TripAdvisor name matching.
