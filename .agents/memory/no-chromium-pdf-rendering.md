---
name: No Chromium on Replit — PDF/report rendering
description: Why report PDFs are rendered with pdf-lib + a parallel styled-HTML dashboard instead of Puppeteer/headless Chrome.
---

There is no Chromium/headless-Chrome binary available on Replit (checked PATH, the
puppeteer cache dir, and system packages — none present). Do NOT reach for
Puppeteer / Playwright-chromium / html-to-pdf-via-browser to render documents; it
will fail at runtime even if it installs.

**Chosen approach:** build the report ONCE as a structured JSON, then render two
views from it — a styled HTML dashboard (inline CSS, served on a route) and a
styled PDF built with `pdf-lib` (manual layout: header band, KPI cards, tables,
badges, pagination). Both are rebuilt on demand from the persisted JSON; nothing
is stored as a blob.

**Why:** keeps the HTML and PDF perfectly in sync (one source of truth) and avoids
the missing-browser dependency entirely. `pdf-lib` is esbuild/CJS-bundle safe.

**How to apply:** any "generate a document/PDF" feature on Replit should render from
data with a library (pdf-lib for PDF, inline-CSS HTML for on-screen), not by
screenshotting a headless browser. When both an HTML and a PDF view are needed,
drive them from the same normalized data object and normalise arbitrary persisted
JSON before rendering so old/partial shapes never crash the renderer.
