# Race Control V2 Overview

This document summarizes the new race control surfaces introduced in the V2 rollout.

## Key Interfaces

- **Director Control** (`/control/:sessionId`)
  - Modern phase/flag banner with authoritative timer readout.
  - Director toolbar for start, pause, resume, and finalize workflows.
  - Flag toolbar with single-click banner management.
  - Eight-slot driver command grid with lap, invalidate, pit, and flag affordances.
  - Embedded control log and steward penalty feed.
  - Live timing preview ordered by laps and total race time.

- **Marshal Panel** (`/marshal/:sessionId`)
  - Condensed single-marshal layout with session telemetry.
  - Lap logging prompts persist to Supabase and create control log entries.
  - Invalidations and removals intentionally locked pending steward tooling.

- **Spectator Timing** (`/timing/:sessionId`)
  - Alias route to the public timing page for consistency with the new URL blueprint.

## Supabase Schema Additions

New schema primitives ship with this release:

- Authoritative columns on `sessions` (`phase`, `banner_state`, `started_at`, `clock_ms`, `lap_limit`, `is_final`).
- Stewarding tables: `control_logs`, `penalties`, and `results_final`.
- Driver metadata (`tri_code`, `team_color`, `slot_number`, `status`).
- Lap extensions (`lap_no`, `lap_ms`, `valid`, `source`).
- RPC helpers: `start_session`, `pause_session`, `resume_session`, `set_flag`, and `finalize_results`.

See `supabase/schema.sql` for full definitions.

## Manual Follow-Up Tasks

The following items require manual execution after deploying the code:

1. **Apply Supabase schema changes.**
   - Run the diff in `supabase/schema.sql` against the project database.
   - Confirm realtime publication includes `control_logs`, `penalties`, and `results_final`.
2. **Backfill new columns.**
   - Populate `sessions.phase`, `banner_state`, and `started_at` for active sessions.
   - Seed `drivers.team_color` and `slot_number` where applicable.
3. **Timer reconciliation.**
   - Validate that `pause_session`/`resume_session` update `clock_ms` correctly.
   - If existing sessions were paused, reset `started_at` to avoid incorrect elapsed time.
4. **Marshal assignments.**
   - Update permissions or RPCs if additional marshal roles are required beyond single panel support.

Document any manual verification in release notes so on-call staff can trace expected state changes.

## Testing Notes

- `npm run test` (Bun-powered) validates unit coverage.
- UI verified via manual inspection; run `npm run dev` to preview the new layouts.

