---
name: Stripe connector + bundling quirks
description: Replit Stripe connector settings field name, and why stripe-replit-sync must be external in esbuild bundles.
---

# Stripe connector credential field

The Replit connection API (`/api/v2/connection?connector_names=stripe`) returns the secret key under `settings.secret` (alongside `account_id`, `publishable`, `mcp`, `claim_url`) — NOT `settings.secret_key` as some templates assume.

**Why:** Our credential fetcher checked only `secret_key` and reported "not connected" even though the connection was healthy.

**How to apply:** When reading connector settings, accept both `secret_key` and `secret`, or inspect the live shape via `listConnections('stripe')` first.

# stripe-replit-sync must be external when bundling

`runMigrations` in `stripe-replit-sync` reads its SQL migration files with `path.resolve(__dirname, "./migrations")`. Inside an esbuild bundle, `__dirname` points at the app's `dist/`, so migrations silently do nothing / fail — the `stripe` schema stays empty and later calls fail with `relation "stripe.accounts" does not exist`.

**Why:** Boot logs showed StripeSync init succeed but webhook registration fail on missing tables, while running migrations manually via plain `node -e require(...)` worked.

**How to apply:** Add `stripe-replit-sync` to the esbuild `external` list and declare it as a real runtime dependency of the server package.
