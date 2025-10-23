# TimeKeeperDPGP Maintenance & Extension Guide

This document summarises how the DayBreak Grand Prix timing system is wired together, how to verify that the Race Control panel keeps the Live Timing Board in sync, and what to consider when extending the product with new authentication and page flows.

## 1. Architectural overview

- **Entry point (`src/App.jsx`)** – the app maintains a two-tab layout that swaps between the Race Control panel and the public Live Timing Board. State for which view to render is local to the component, so both panels mount/unmount cleanly when switching views.
- **Race Control (`src/components/TimingPanel.jsx`)** – coordinates driver timing, track status, race control logs, and session metadata. It stores the authoritative session state locally while propagating persistence changes to Supabase when configured.
- **Live Timing Board (`src/components/LiveTimingBoard.jsx`)** – subscribes to Supabase realtime channels for the `drivers`, `laps`, and `session_state` tables so that spectator data updates immediately when Race Control makes changes.
- **Shared utilities** – `src/utils/raceData.js` handles mapping between Supabase rows and in-memory driver/session representations, while `src/utils/time.js` converts raw millisecond values to UI-ready strings.
- **Backend integration** – `src/lib/supabaseClient.js` exposes thin wrappers around the Supabase REST and realtime APIs. All database reads/writes funnel through these helpers, which makes it easier to intercept errors and future-proof credentials management.

## 2. Data model & persistence

- SQL definitions live in `supabase/schema.sql`. Tables are purpose-built for session orchestration: `drivers`, `laps`, `session_state`, and `race_events`. Realtime streaming is enabled for each table.
- `SESSION_ROW_ID` in `src/utils/raceData.js` hardcodes the single-row session record used to broadcast the current event configuration across clients.
- Every driver update writes through `toDriverRow` before calling `supabaseUpsert`, ensuring we normalise timers, pit data, and marshal flag status into column shapes that match the schema.
- When Supabase credentials are absent the UI falls back to fully local state, but realtime syncing and persistence require valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values.

## 3. Race Control functionality checklist

The following checklist validates that the Race Control panel is operating correctly and that each action propagates to persistence:

1. **Bootstrap session** – load the app with credentials configured. `TimingPanel` calls `bootstrapSupabase`, which seeds default drivers and session data when tables are empty and hydrates component state from existing rows.
2. **Start and pause timing** – the control panel uses `raceStartRef` and `pauseStartRef` to manage the global race clock. Verify that pressing the Start, Pause, and Resume controls updates `is_timing`, `is_paused`, and `race_time_ms` via `supabaseUpsert` so other clients reflect the new clock state.
3. **Record laps** – trigger automatic buttons or keyboard hotkeys (1–0) to call `handleLap` for a driver. The panel writes a lap row (`supabaseInsert('laps', …)`) and updates the driver snapshot (`supabaseUpsert('drivers', …)`). Confirm that new laps appear in the control panel history and are streamed to the live board.
4. **Manage flags & announcements** – toggling track flags or editing the announcement bar updates the `session_state` row and publishes the change through Supabase realtime. Ensure combinations like SC, VSC, or Red Flag update banner styling in both views.
5. **Driver admin** – using retire/undo, pit completion, best-lap overrides, or manual lap entry updates the driver row and may append race control log entries to `race_events`. Check that the log feed caps at 200 entries and most recent actions float to the top.
6. **Supabase resilience** – disconnecting credentials should surface user-friendly errors while continuing to operate in local-only mode. Reconnecting should trigger `refreshDriversFromSupabase`/`refreshSessionFromSupabase` to resynchronise state.

## 4. Live Timing Board synchronisation

- On mount the board calls `refreshDriverData` and `refreshSessionState`, then sets up realtime subscriptions for `drivers`, `laps`, and `session_state`. Any change from Race Control triggers a re-fetch ensuring gaps, intervals, and status banners stay current.
- Leaderboard ordering depends on the session type. In race sessions it sorts by lap count then cumulative time. In qualifying/practice it sorts by best lap. The helper also computes leader gaps and intervals to the car ahead.
- The "Recent Laps" feed is derived from the `laps` table ordered by `recorded_at`, so it automatically reflects manual lap entries and corrections made from Race Control.

## 5. Manual verification routine

Before each event or release run the following smoke test:

1. Configure Supabase URL/key and reload the Control panel.
2. Cycle procedure phases through warmup → final call → countdown → green → checkered, confirming each banner update on the Live Timing Board.
3. Start the race clock, record multiple laps for two drivers, and pause/resume mid-session to ensure total time accumulation remains accurate.
4. Retire a driver and clear the retirement to confirm leaderboard updates and status chips change colour appropriately.
5. Trigger a safety car flag and confirm marshal flag indicators propagate to the Live Timing Board.
6. Announce a message and verify the ticker updates immediately for spectators.
7. Review the race control log to ensure the latest 200 entries display without duplicates.

## 6. Discord authentication blueprint

The project currently relies on Supabase REST APIs without authentication. To add Discord login with Supabase Auth:

1. Enable the Discord provider inside the Supabase dashboard (Authentication → Providers) and supply the Discord client ID/secret.
2. Store the Supabase service role key securely on the server-side API (never ship it to the browser).
3. In the React app install `@supabase/supabase-js` and create a dedicated auth client alongside the existing REST helper. Configure it with the public URL and anon key.
4. Build a sign-in page that calls `supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: <callback-url> } })`. Handle the redirected session in `supabase.auth.onAuthStateChange` and store the access token in memory.
5. Use Supabase Row Level Security (RLS) policies to restrict timing mutations to authenticated roles. For example, allow inserts/updates on `drivers`, `laps`, and `session_state` only when `auth.uid()` matches a control-room Discord role table.
6. Gate the Race Control view in `App.jsx` behind auth state. Render the Live Timing Board for anonymous users while redirecting unauthenticated controllers to the login route.
7. For local development create a `.env.local` file containing `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPABASE_REDIRECT_URL`.

## 7. Adding new pages & user flows

- Introduce a router (e.g. `react-router-dom`) when the product expands past the two existing views. Define routes for `/control`, `/live`, and any forthcoming management tools.
- Co-locate form logic inside dedicated components and validate inputs before writing to Supabase. You can reuse helpers in `src/utils/raceData.js` to normalise driver/session objects.
- For new data entry screens, funnel persistence through the `supabaseClient` helpers to keep request semantics consistent (they handle headers, ordering, and error parsing already).
- Build UI state machines for procedure-heavy flows (e.g. scrutineering, parc fermé). Mirror the approach in `TimingPanel` by storing the canonical state and broadcasting via Supabase so spectators and controllers stay aligned.
- Whenever you create a new table, add its definition to `supabase/schema.sql`, update publication statements for realtime streaming, and extend `subscribeToTable` listeners in relevant components.

## 8. Testing & quality gates

- Run `npm run build` to ensure the Vite production bundle compiles without errors. Pair this with browser smoke tests covering both the Race Control and Live Timing views.
- For Supabase-dependent features, exercise flows with and without credentials configured to confirm graceful degradation.
- Consider adding component tests around `TimingPanel` and `LiveTimingBoard` using a library such as React Testing Library with mocked Supabase clients to automate regression checks.

## 9. Operational playbook

- Keep environment variables out of version control (`.env.local` is ignored by default). Rotate the Supabase anon key if exposed.
- Monitor Supabase rate limits: batching writes via `supabaseUpsert` and keeping lap inserts lean avoids hitting thresholds during peak race updates.
- When shipping new control workflows, document the intended operator steps and update the smoke test checklist above.
- Review Supabase server logs periodically to ensure realtime channels remain subscribed and there are no authentication failures.

Maintaining these practices will keep Race Control responsive, the Live Timing Board accurate, and provide a foundation for expanding into richer authenticated experiences.
