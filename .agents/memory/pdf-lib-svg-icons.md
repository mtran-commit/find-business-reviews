---
name: pdf-lib drawSvgPath icons
description: Constraints for drawing SVG icons in pdf-lib PDFs via drawSvgPath.
---

Rule: icons drawn in pdf-lib must be single-path SVG `d` strings only — no `<rect>`, `<circle>`, `<line>` elements and no `transform`s, since `page.drawSvgPath` accepts only a raw path string.

**Why:** pdf-lib has no general SVG renderer; multi-element icons silently lose shapes if you only pass one path.

**How to apply:**
- Keep a shared icon module of pure 24x24 path-`d` strings so the HTML renderer (inline `<svg><path d=.../></svg>`) and PDF renderer share the same set.
- In `drawSvgPath`, the `y` option is the TOP of the icon (SVG-style, not PDF baseline); scale with `scale: size / 24`.
- Stroke-style icons: use `borderColor` + `borderWidth` (~1.3 at 24px) and `borderLineCap: 1` for rounded caps; leave fill undefined.
- For pill/badge text colour on arbitrary grey backgrounds, compute relative luminance and switch black/white text (light bg → black text) instead of hardcoding.
