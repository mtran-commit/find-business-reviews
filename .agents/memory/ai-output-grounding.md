---
name: AI output grounding
description: Never rely on prompt-only "never invent" rules for AI report content — enforce deterministically after parsing.
---

Rule: when a spec says AI-generated content must "never invent" facts (tags, complaints, counts), prompt instructions alone are insufficient — add a deterministic post-parse grounding step that overwrites/filters the AI output against the real source data.

**Why:** Architect review failed a feature where anti-invention lived only in the system prompt; the model can still emit unseen tags/counts. Fixed by rebuilding the tag list from the real source array (AI keeps only interpretation columns) and clearing concern lists when no grounding text exists.

**How to apply:** after zod-parsing an AI JSON response, run a grounding function that (a) replaces factual fields (names, counts) with the exact input data, keeping AI text only for interpretation fields matched by key, and (b) forces honest empty/fallback states when the underlying evidence (e.g. snippet count) is zero.
