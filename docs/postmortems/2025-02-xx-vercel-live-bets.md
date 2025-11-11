# Vercel deployment failure after live bets ticker rollout

## Summary
The "Revamp markets page odds display and live bet ticker" change set introduced a Supabase-backed `LiveBetsTicker` on the markets page. The component queries the `public.wagers` table and eagerly joins the `public.outcomes` relation expecting new branding metadata. Production lacked the matching schema changes, so the PostgREST endpoint started returning 400 errors for every request. Because the ticker is mounted inside the betslip, those failures triggered during the build health check and Vercel marked the deployment as failed. Reverting the frontend code did not immediately resolve the issue because the database continued to reject requests until caches cleared.

## What went wrong
- `useMarketWagers` now executes `supabaseSelect('wagers', { select: '... outcomes(label,color,abbreviation) ...' })` whenever the betslip renders.【F:src/hooks/useMarketWagers.js†L27-L48】
- The Supabase schema that Vercel deploys against does not define an `abbreviation` column on `public.outcomes`, so PostgREST responds with `column outcomes.abbreviation does not exist`.【F:supabase/schema.sql†L23-L30】
- The new hook only downgrades gracefully when the entire `wagers` table is missing. Column-level errors bubble up as uncaught exceptions, so the Vercel build detects the failure and aborts the deployment.
- Because the ticker sits directly inside `Betslip.jsx`, the query fires on every markets page load, compounding the issue.【F:src/components/betting/Betslip.jsx†L1-L58】

## Action items
1. Add the `abbreviation` (and any other expected identity fields) to `public.outcomes`, and include the migration in `supabase/schema.sql` so all environments stay in sync.
2. Extend `useMarketWagers` to treat `isColumnMissingError('abbreviation')` the same way it handles missing tables so the UI can degrade without taking down builds.
3. Gate the ticker behind a feature flag or configuration check so deployments without Supabase realtime enabled do not attempt realtime subscriptions.
