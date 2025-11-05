# Diamond Sports Book (DSB) - Post-QA Repair & Expansion Plan

## Objective
- Restore broken session/admin tooling, align Supabase schema, and expand TimeKeeper into the parody Diamond Sports Book tote experience.
- Ship wallet + pari-mutuel markets with realtime feedback, then layer on admin controls, polish, and the optional Discord companion.
- Treat this doc as the living backlog. Update checkboxes as work lands and mirror schema changes in `supabase/migrations/**` and `supabase/schema.sql`.

## Key Repo Touchpoints
- Frontend: `src/pages/WelcomePage.jsx`, `src/components/layout/AppLayout.jsx`, `src/views/ControlPanel.jsx`, `src/components/DriverTimingPanel.jsx`, new betting UIs under `src/pages/markets/**` and `src/pages/dashboard/**`.
- State/Context: `src/context/AuthContext.jsx`, `src/context/SessionContext.jsx`, `src/state/SessionContext.jsx` (extend with SessionActions provider).
- Services & hooks: `src/services/laps.js`, upcoming wallet/betting services under `src/services/**`, realtime helpers in `src/lib/supabaseClient.js`.
- Supabase: migrations in `supabase/migrations/`, helper SQL in `supabase/seed_initial_admin.sql`, CLI config in `supabase/config.toml`.
- Tests: `tests/**` (Vitest + Testing Library). Add coverage for new contexts, RPC wrappers, and UI state transitions.

---

## Milestone A - Unblock Sessions/Admin (Day 1-2)

### A0. Brand & Landing Refresh (Immediate)
- [x] Update `src/pages/WelcomePage.jsx` hero copy:
  - Headline `Diamond Sports Book`.
  - Sub-copy `Gamble on everything- from podiums to power plays. Los Santos� premier tote for races, rumbles, and vendor wars.`
  - Primary CTA `Enter the Sports Book` -> `/dashboard` (auto-route authenticated users).
  - Secondary CTA `View Live Markets` -> `/markets`.
  - Add legal microcopy beneath CTAs: `All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.`
- [x] Mirror brand voice on authenticated landing surfaces:
  - `src/pages/dashboard/DashboardPage.jsx` hero banner.
  - New `/markets` route intro (see Milestone B3).
- [x] Persist wallet indicator top-right in `src/components/layout/AppLayout.jsx` once balances are wired:
  - Display `?? <formatted balance>` for authenticated users; fall back to `?? 0` placeholder until wallet hydrates.
  - Hook into new WalletContext (Milestone B3) so balance live-updates on realtime events.

Acceptance: Copy matches across `/`, `/dashboard`, `/markets`; wallet pill is visible on all authenticated views and updates without refresh.

### A1. Restore Session Seeding (PGRST204)
- [x] Create migration `supabase/migrations/<timestamp>_ensure_session_entries_created_at.sql`:
  ```sql
  alter table public.session_entries
    add column if not exists created_at timestamptz not null default now();

  grant usage on schema public to anon, authenticated;
  grant select, insert, update on table public.session_entries to anon, authenticated;
  grant select (created_at) on public.session_entries to anon, authenticated;
  ```
- [ ] If RLS is enabled, confirm policies do not self-select. Use (or add) a `session_has_access(session_id uuid)` SECURITY DEFINER function and reference it in policies.
- [ ] After push, force PostgREST cache refresh if the 400 persists. Easiest: run `comment on table public.session_entries is 'expose for cache';`.
- [ ] Add regression test in `tests/sessions/sessionSeeding.test.js` that stubs Supabase insert and asserts we surface friendly errors when the column is missing.

Acceptance: Creating a session via `/sessions/new` succeeds; entry appears immediately in `/sessions`.

### A2. Harden Session Actions (onLogLap)
- [x] Introduce `SessionActionsContext` under `src/context/SessionActionsContext.jsx` to expose `onLogLap`, `invalidateLastLap`, `setFlagState`, etc.
- [x] Wrap `<ControlPanel />` in the provider inside `src/routes/Control.jsx`.
- [x] Refactor `src/views/ControlPanel.jsx` to consume the context instead of prop drilling. Ensure `handleDriverPanelLogLap` is registered as the context handler.
- [x] Update `src/components/DriverTimingPanel.jsx` to rely on `useSessionActions()` and remove undefined prop access. Keep prop fallback so component stays testable.
- [x] Add Vitest coverage in `tests/control/DriverTimingPanel.test.jsx` mounting with a mocked context to prevent regressions.
- [x] **CRITICAL FIX**: Race start timing synchronization - auto-arm all driver lap timers SYNCHRONOUSLY when race starts (before network round-trip), with useEffect safety net for remote clients. Ensures lap clocks stay synchronized with session clock even under network latency (src/views/ControlPanel.jsx:331-342, 354-376).

Acceptance: Admin or marshal opens `/control/:sessionId` without console errors and can log laps via panel + hotkeys; Live Timing view updates accordingly. **Driver lap clocks start immediately with race clock (zero latency for local operator) and display accurate current lap times. Remote clients/observers auto-arm when they receive realtime state change.**

### A3. Realtime Bootstrap Guard
- [x] Audit `.env.local.example` (add if missing) with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Mirror values in Vercel environment groups.
- [x] Ensure single Supabase client initialisation in `src/lib/supabaseClient.js`; delay realtime subscription setup until auth/session contexts resolve.
- [x] Add logging hooks around `supabaseClient.channel(...).subscribe` to trace channel status (`open/error/closed`). Surface a toast on websocket failure in UI.
- [x] Implement retry/backoff (e.g., exponential with jitter) inside `subscribeToTable` helper.

Acceptance: Realtime websocket connects within ~1s on `/dashboard` and `/control`; console shows channel lifecycle logs with no premature closes.

### A4. Session & Timing Parity Safeguards
- [ ] Guarantee `SessionContext` exposes assigned drivers and actions through the new `SessionActionsContext`.
- [ ] Ensure `log_lap_atomic`, `invalidate_last_lap_atomic` SQL functions are called for all mutations (`src/services/laps.js`).
- [ ] Filter Live Timing subscriptions by `session_id` to avoid cross-session bleed.

Acceptance: Marshals only view their drivers; Admin sees all; Live Timing remains in sync within 1s.

---

## Milestone B - Wallet + Markets Skeleton (Day 2-5)

### B1. Schema Foundations
- [x] Create migration `supabase/migrations/<timestamp>_wallet_and_markets.sql` containing tables:
  - `events`, `markets`, `outcomes`, `wallet_accounts`, `wallet_transactions`, `wagers`, `withdrawals`.
- [x] Add idempotent creation SQL (see block below) and update `supabase/schema.sql`.
- [x] Extend `supabase/config.toml` publication to include realtime on `events, markets, outcomes, wagers, wallet_accounts`.
- [x] Define helper functions in the same migration:
  - `is_admin()` (SECURITY DEFINER) returning boolean via profile/claim lookup (existed in sync migration).
  - `session_has_access(session_id uuid)` for marshal gating (reuse, existed in sync migration).
- [x] Implement RLS policies (in migration `20250412_wallet_markets_rls_grants.sql`):
  - Wallet: users can select/update their row; service role handles adjustments.
  - Transactions: user selects own; only admin/service inserts `rake`/`adjust`.
  - Wagers: user inserts/selects own when market status = 'open'.
  - Withdrawals: user insert/select own; admin can approve/reject.
  - Events/markets/outcomes: read-only to public; admin mutate.
- [ ] SQL baseline (include in migration):
  ```sql
  create table if not exists public.events (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    venue text,
    starts_at timestamptz,
    ends_at timestamptz,
    status text not null default 'upcoming'
  );

  create table if not exists public.markets (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    name text not null,
    type text not null,
    rake_bps int not null default 500,
    status text not null default 'open',
    closes_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists public.outcomes (
    id uuid primary key default gen_random_uuid(),
    market_id uuid not null references public.markets(id) on delete cascade,
    label text not null,
    sort_order int not null default 0
  );

  create table if not exists public.wallet_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    balance bigint not null default 0
  );

  create table if not exists public.wallet_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null,
    amount bigint not null,
    meta jsonb,
    created_at timestamptz not null default now()
  );

  create table if not exists public.wagers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    market_id uuid not null references public.markets(id) on delete cascade,
    outcome_id uuid not null references public.outcomes(id) on delete cascade,
    stake bigint not null check (stake > 0),
    placed_at timestamptz not null default now(),
    status text not null default 'pending'
  );

  create table if not exists public.withdrawals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    amount bigint not null check (amount > 0),
    status text not null default 'queued',
    created_at timestamptz not null default now()
  );

  alter publication supabase_realtime
    add table public.events,
    add table public.markets,
    add table public.outcomes,
    add table public.wallet_accounts,
    add table public.wagers;
  ```

### B2. Server RPCs & Helpers
- [x] Add migration `supabase/migrations/20250412_markets_functions.sql` defining:
  - `place_wager(market_id uuid, outcome_id uuid, stake bigint)` with transactional wallet debit + inserts.
  - `close_market(market_id uuid)` to flip status.
  - `settle_market(market_id uuid, winning_outcome_id uuid, payout_policy text default 'refund_if_empty')`.
- [x] Handle rake math (flooring) and credit any dust to a `house_user_id` (configure via project setting or function parameter).
- [x] Emit `wallet_transactions` entries for every RPC mutation.
- [x] Add audit trigger `admin_actions_log` capturing `action`, `market_id`, `actor_id`, `meta` for admin RPC invocations.
- [x] Grant execute on RPCs to `authenticated`; admin-only paths gated via `is_admin()`.
- [ ] Create RPC unit tests (SQL `assert` or via Supabase test harness) to ensure payouts sum to net pool and refund path covers `winning_total = 0`.

### B3. Client Foundations
- [x] Build Wallet context/hook (`src/context/WalletContext.jsx`) sourcing balance + transactions from Supabase, subscribing to realtime.
- [x] Add `/markets` route and page:
  - Group markets by event.
  - Live pool + odds updating every 5s (fallback to polling if realtime silent).
  - Outcome list showing estimated odds (`stake_on_outcome / total_pool`) with "Est." badge.
- [x] Implement `Betslip` component (in `src/components/betting/Betslip.jsx`) with quick stake buttons (1k/10k/100k/1m Diamonds) and submit via `rpc.place_wager`.
- [x] Hook wallet debits + toast notifications; show confetti animation on success.
- [x] Update Dashboard to include Active Bets, Settled Bets sections consuming wagers + transactions (added `useWagers` hook in `src/hooks/useWagers.js`).
- [ ] Wire wallet CTA from dashboard to top-up modal (existing `TopUpModal` can be repurposed for deposits vs off-chain instructions).

Acceptance: User can see events/markets, place a wager while open, and view pending entry on dashboard. Wallet balance decrements instantly.

---

## Milestone C - Polish & Admin Console (Day 5-8)

### C1. Admin Market Management Page
- [ ] Add `/admin/markets` route gating via `AuthGuard requireAdmin`.
- [ ] Build page structure:
  - Market Controls (create/edit/delete/open/close/settle with confirmation modals).
  - Pending Actions pane (bets awaiting approval + deposit/withdraw queues).
  - User Wallets panel (search by username or wallet ID).
  - Results & Payouts tab for settlement preview.
  - Logs & Analytics tab (historical actions, rake summary, export CSV/JSON).
- [ ] Use Supabase realtime to stream new wagers, withdrawals, deposits.
- [ ] Surface activity indicators per market (green=open, red=closed, blue=settling).

### C2. Funds Administration
- [x] Allow admins to top-up/deduct wallets manually via `adjust_wallet_balance()` RPC (writes `wallet_transactions` with `adjust`/`deposit`/`bonus` kind + optional memo).
- [ ] Implement deposit/withdraw approval flows:
  - Approving deposit credits wallet via RPC or direct SQL function.
  - Approving withdrawal marks row as `approved` and optionally integrates with off-chain payout queue.
  - Reject flows re-credit balance when needed.
- [ ] Inline audit log entry for every admin action (tie into `admin_actions_log` trigger).

### C3. UX Polish
- [ ] Neon gradient pool ring component reacting to `pool_gross`.
- [ ] Micro-interactions: subtle scale/glow on betslip inputs, confetti on placement, winner highlight banner.
- [ ] Winner celebration copy: `Payout complete! Congratulations-your wager returned ?? {{payout}}.`

### C4. Testing & Observability
- [ ] Add integration tests under `tests/betting/**`:
  - Wallet context initialises with mock data.
  - Betslip validation (insufficient funds, closed markets).
  - Admin settlement flow (mock RPC responses).
- [ ] Implement feature toggles/feature flags if needed (`src/constants/features.js`) to gate in-progress UI.
- [ ] Add logging breadcrumbs (e.g., `console.info`) around settlement actions for easier QA reproduction.

Acceptance: Admin can run book end-to-end via UI without manual SQL; realtime updates propagate to Markets/Dashboard views.

---

## Milestone D - Discord Companion (Day 8-10, Optional)
- [ ] Stand up bot skeleton (Node or Deno) under `discord-bot/` with commands:
  - `/balance`, `/deposit <amount>`, `/market [event]`, `/bet <market> <outcome> <amount>`, `/withdraw <amount>`.
- [ ] OAuth linking flow storing `profiles.discord_id` (extend Supabase profile table/migration if missing).
- [ ] Service role JWT for bot with RLS allowances (via `jwt.claims.discord_id` or server-side RPC).
- [ ] Event broadcasts: market closed, results posted, winner announcements via embeds.
- [ ] Write deployment notes (Railway/Fly/Deno Deploy) and environment expectations.

Acceptance: Bot responds in staging guild; `/balance` and `/market` reflect live Supabase data.

---

## QA Checklist (Run Before Handoff)
- [ ] Welcome copy + wallet indicator verified on `/`, `/dashboard`, `/markets`.
- [ ] Session creation works; new session selectable in `/sessions`.
- [ ] `/control/:sessionId` renders without `onLogLap` errors; lap logging updates Live Timing.
- [ ] Realtime websocket stable; channel logs show sustained `open`.
- [ ] Markets page shows seeded event with multiple markets/outcomes; pools update (mock data acceptable in dev).
- [ ] Betslip places wager; wallet debits; wager visible in dashboard Active Bets.
- [ ] Admin can Close ? Settle market; payouts + rake persisted.
- [ ] Withdrawal request reserves funds; admin approval releases/updates balance.
- [ ] Discord bot (if enabled) returns `/balance` & `/market` successfully in test guild.

---

## Implementation Notes & Gotchas

### Security Critical ⚠️
- **WALLET INSERT VULNERABILITY (FIXED)**: Initial B1 implementation allowed authenticated users to insert wallet rows with arbitrary balances. An attacker could `POST /wallet_accounts` with `balance=999999999` and mint unlimited Diamonds. **FIX**: Removed `grant insert` for authenticated users and set RLS policy to `with check (false)` to block all user inserts. Wallets now created ONLY via SECURITY DEFINER RPCs (`place_wager`, `adjust_wallet_balance`) which enforce zero or controlled starting balances.
- **RLS + GRANTS DEFENSE IN DEPTH**: Always pair restrictive RLS policies with minimal grants. Even if grant allows operation, RLS blocks at runtime. But removing unnecessary grants (e.g., INSERT on wallet_accounts) provides extra protection against misconfigured policies.
- **SECURITY DEFINER PRIVILEGE**: RPCs marked `SECURITY DEFINER` run with function owner's privileges (typically postgres superuser), bypassing RLS and grants for authenticated role. This allows `place_wager` to insert wallets even though users can't.

### General
- PostgREST only exposes columns with explicit grants. Always pair `alter table` with `grant select(column)` before relying on API.
- Avoid RLS recursion: policies should call immutable SECURITY DEFINER helpers rather than selecting from guarded tables directly.
- Settlement math must run in a single transaction (`perform ... for update`) to lock wagers and prevent race conditions.
- Use integer math for Diamonds; floor per-user payouts and record leftover dust as house rake.
- Maintain deterministic ordering with `outcomes.sort_order` for stable UI presentation.
- Update `supabase/schema.sql` after every migration so local `supabase db reset` stays authoritative.

---

## Timeline Snapshot
| Day | Focus | Key Deliverables |
| --- | ----- | ---------------- |
| 1-2 | Milestone A | Session seeding fix, SessionActionsContext, realtime/bootstrap hardening, brand copy refresh |
| 2-5 | Milestone B | Wallet/markets schema + RPCs, Wallet context, Markets page, Dashboard sections |
| 5-8 | Milestone C | Admin market management UI, funds approvals, polish, integration tests |
| 8-10 | Milestone D (opt) | Discord bot MVP, OAuth linking, command coverage |

Keep this plan updated as work completes or scope shifts. Include links to Supabase migration IDs and PRs for traceability.

