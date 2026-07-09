# Wowlette Integration — Security Notes

Notes on the server-to-server connection between Find Business Reviews and
Wowlette (`GET <WOWLETTE_BASE_URL>/api/public/offers/search?name=...`),
written 9 July 2026. For later consideration.

## What's already handled

1. **Wowlette responses are treated as untrusted.** Every response is strictly
   validated (shape, field types, length limits) on the server before anything
   reaches the page. Junk or unexpected data is discarded.

2. **Malicious links are blocked.** Any offer whose "Add to Wallet" link is not
   a normal `http(s)` address is rejected server-side (blocks `javascript:` /
   `data:` links). The browser double-checks before opening links, and opens
   them in a new tab with no access back to the page.

3. **Text injection (XSS) is prevented.** Offer titles, descriptions, terms,
   etc. are HTML-escaped before display — embedded HTML or script shows as
   plain text, never runs.

4. **Wowlette outages can't break search.** 8-second timeout; any failure
   quietly returns "no offers". The review search is never slowed or broken.

5. **The Wowlette address can't be tampered with.** The base URL comes only
   from the `WOWLETTE_BASE_URL` environment setting (never user input) and is
   validated as a proper http(s) origin — no SSRF via this path.

6. **No secrets in transit.** The Wowlette endpoint is deliberately public;
   no credentials are sent, so there is nothing to leak.

## For later consideration

- **The Wowlette offers endpoint is public.** Anyone can query it directly and
  see all published offers. That's fine today (offers are meant to be public),
  but if Wowlette ever exposes anything sensitive on that API, add an API key
  shared between the two apps (e.g. a secret header that Wowlette checks).
- If an API key is added, store it as a Replit secret on this side and send it
  from the server only — never from the browser.
