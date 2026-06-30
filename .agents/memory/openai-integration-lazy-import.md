---
name: Replit OpenAI AI-integration client must be imported lazily
description: The @workspace/integrations-openai-ai-server client throws at module load when env vars are missing — defer the import.
---

The Replit AI-integrations OpenAI client (`@workspace/integrations-openai-ai-server`) constructs the `OpenAI` instance at module top level and **throws immediately** if `AI_INTEGRATIONS_OPENAI_BASE_URL` or `AI_INTEGRATIONS_OPENAI_API_KEY` is unset.

**Why:** a top-level `import { openai } from "..."` in a route file makes that throw run at server boot, so the server crashes before any handler can return a graceful 503. The copied template's `image/client.ts` also had a pre-existing `response.data` possibly-undefined type error that breaks `tsc --build` of the lib even if you only use chat.

**How to apply:** check both env vars in the handler, return 503 if missing, then `const { openai } = await import("@workspace/integrations-openai-ai-server")` inside the try. esbuild still bundles the dynamic import fine. When copying the AI-integration template lib, expect to fix the image-client type errors so `typecheck:libs` passes.
