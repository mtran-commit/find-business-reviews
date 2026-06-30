---
name: Featured card grid column widths
description: Why the Compare Reviews featured card does NOT use the spec's literal 330/1fr/330/230 column widths.
---

The Compare Reviews featured card (`artifacts/compare-reviews/index.html`, `.featured-card`) is a 4-column grid: image | details(info) | ratings-by-platform | trust-score, inside a `.page-shell` capped at `max-width: 1180px`.

**Rule:** keep the three non-details columns modest (image ~270px, ratings ~260px, score ~180px) so the flexible `minmax(0,1fr)` details column keeps ~300px. Make `.featured-image`/fallback `width:100%` (fill their column, not a hardcoded 330px). Cap `.biz-name` font at ~32px with `overflow-wrap: break-word`.

**Why:** The original spec mockup literally specified `grid-template-columns: 330px 1fr 330px 230px`. At a 1180px shell that leaves only ~110px for the details column, so a long business name (test case: "Re/Max Hometown Realtors, Dennis O'Brien") breaks one-word-per-line and clips ("Hometown" → "Hometov"). The spec ALSO explicitly demands the name must not break the layout and the details column must not be too narrow — that requirement overrides its own literal pixel values when they conflict.

**How to apply:** If asked to match the spec's exact 330px widths, don't — re-test with the long-name deep link `/?q=Re%2FMax%20Hometown%20Realtors%2C%20Dennis%20O'Brien` and confirm the name wraps to ≤3 lines with nothing clipped before changing column widths.
