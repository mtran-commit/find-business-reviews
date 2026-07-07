---
name: Website logo scraping (trust-safe brand logos)
description: How business logos are sourced under the zero-tolerance "never show a wrong logo" rule, and the SSRF/trust guards that must stay in place.
---

# Website logo scraping

The ONLY confident brand-logo source is the business's OWN official website
homepage, scraped server-side (`artifacts/api-server/src/lib/logo.ts`,
`resolveWebsiteLogo`). Do not resurrect logos from Google/Facebook/favicon
services — those were the historical trust failures the rule exists to prevent.

## Confidence ladder (priority order)
- schema.org / JSON-LD `logo` → high
- `apple-touch-icon` → high
- scalable `<link rel=icon>` png/svg → medium
- og:image / twitter:image → medium
- nothing safe → null → UI shows navy initials

A `high` mark hosted OFF the business's own domain is downgraded to `medium`.
Bare `.ico` favicons are skipped (builder-default / low quality).

## Non-obvious guards that MUST stay
- **SSRF**: the scraper fetches arbitrary remote websites, so it is an untrusted
  outbound sink. Redirects are followed MANUALLY (`redirect: "manual"`, capped
  hops) and every hop's host is checked with `isPublicHost` — localhost,
  `.local`/`.internal`, and private/loopback/link-local/CGNAT/metadata IP
  literals (v4 + v6) are rejected. A public URL must never be able to redirect
  us into the private network.
- **Same-site check**: use full-host / subdomain comparison, NOT "last two
  labels". Under public suffixes like `*.com.au` the two-label heuristic treats
  unrelated domains as the same site and skips the off-domain downgrade.
- **Image shape**: icon/apple-touch/JSON-LD candidates must carry an image file
  extension; only og/twitter meta images are allowed extensionless (CDNs serve
  them that way).
- **Banned-list** (host+path substring): site builders, review/social CDNs,
  Wix (`parastorage`/`wixstatic`/`pfavico`), favicon services, placeholders.
- Frontend repeats a defence-in-depth banned-list check and only renders
  high|medium; business photos always render regardless of logo outcome.

**Why:** trust is the product's whole premise — one wrong logo is worse than no
logo. The guards are deliberately conservative; loosen only with equal care.

**How to apply:** any change to logo sourcing must preserve honest fallback to
initials, keep the SSRF host checks on every redirect hop, and never widen the
confidence gate past medium without a genuinely business-owned source.
