---
name: SPA client-routed pages need redeploy to appear in prod
description: Why a newly-added client-side route can show the public page in production while working in dev
---

The compare-reviews artifact is a static Vite deploy (`serve = "static"`) with an SPA rewrite `/* → /index.html`. New "pages" (e.g. `/admin-report-requests`) are handled inside `index.html`'s inline script by branching on `window.location.pathname` — there is NO Express/`server.js` in production.

**Symptom:** a newly-added client-routed page shows the public search page in production, but the admin/other page renders correctly in dev.

**Cause:** production serves the LAST PUBLISHED build. If the route code was written after the last deploy, prod's `index.html` has no branch for it and the rewrite falls through to the public app. Dev always reflects current code, so the mismatch looks like a routing bug.

**Fix:** republish. Do NOT add `app.get("*")`/`res.sendFile`/`server.js` — that architecture doesn't exist here; the deploy is static file hosting.

**Why:** static hosting can't run server routes; SPA routing + last-published-build is the whole model.
**How to apply:** when a client-side route "doesn't work in production" but works in dev, first compare deploy timing vs. when the route code landed — suspect a stale build before touching routing code.
