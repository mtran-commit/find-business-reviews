---
name: pnpm add can dangle peer-scoped symlinks → esbuild "Could not resolve"
description: After `pnpm add` in this monorepo, a workspace lib's node_modules symlink can point to a stale peer-hashed .pnpm dir, breaking esbuild server bundling.
---

Running `pnpm --filter <pkg> add <dep>` can re-resolve an UNRELATED package's peer set and rename its `.pnpm/<name>@<ver>_<peerhash>` directory. A workspace lib that symlinks that package (e.g. `lib/integrations-openai-ai-server/node_modules/openai -> .pnpm/openai@X_ws@Y_zod@Z/...`) is left DANGLING when the peer hash changes (e.g. `ws` peer dropped → `.pnpm/openai@X_zod@Z`). The esbuild server build then fails with `Could not resolve "openai"` even though `openai` is installed and the code (lazy `await import(...)`) is unchanged.

**Why:** esbuild bundles dynamic imports too, so it must resolve the transitive dep; the dangling symlink makes resolution fail.

**How to apply:** After any `pnpm add`/`pnpm remove`, if a server workflow build suddenly can't resolve a dep it never touched, run a plain `pnpm install` at the workspace root — it rebuilds the symlinks to the current `.pnpm` layout. Verify with `readlink -f lib/<pkg>/node_modules/<dep>`. Do NOT reach for adding the dep to esbuild `external` first; the real cause is usually the stale symlink.
