---
name: jsdom tests for the single-file app
description: How to test the inline-JS index.html (search token guards, async paint races) in vitest via jsdom.
---

The self-contained `index.html` (classic inline script, no build step) can be tested for async race guards by loading it with `new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" })` and stubbing `window.fetch`, `scrollTo`, and `alert` in `beforeParse`.

**Why:** top-level function declarations in a classic script land on `window`, so `window.runSearch(...)` is directly callable; deferred fetch promises let a test control exactly when an "old search's" response lands, proving the searchToken guard drops it.

**How to apply:** reuse the `bootApp` harness in the compare-reviews tests dir; use a `VirtualConsole` to swallow app console noise, plain `{ ok, status, json }` objects as fetch responses, and `setTimeout(0)` flushes between steps. Mutation-check new guard tests by temporarily deleting the guard and confirming failure.
