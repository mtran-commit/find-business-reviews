---
name: iOS ~60s hard request timeout
description: WKWebView/Capacitor kills any fetch at ~60s; long server work must be phased into sub-60s requests.
---

iOS (WKWebView, so any Capacitor app and Safari) enforces a hard ~60s timeout on web requests — no client-side override. Desktop browsers wait minutes, so slow endpoints "work on laptop, fail on iPhone".

**Why:** The full 6-platform review search took 50–80s; iPhone users intermittently got "Couldn't load that business" while laptops succeeded.

**How to apply:** Any endpoint that can exceed ~50s must be split into phases: return the fast core result first, then let the client resolve slow pieces via separate parallel requests, each with a server-side cap (~50s) that degrades honestly ("Lookup timed out"). Guard the client merge with a per-search token so stale responses never paint into a newer search.
