# DBGP V2 – Timing & Race Control

_Last updated: Nov 2025_  
_Repo: TimeKeeperDPGP (Vite + React + Supabase)_

---

## 1. Purpose & Goals

### 1.1 Primary Objective

Make the DBGP timing system:

- **Deterministic** – Lap times and race clocks are always correct and reconstructable from DB.
- **Robust** – No more broken states from legacy two-marshal logic or half-applied updates.
- **Spectator-ready** – Live timing board is always in sync with race control.
- **Race-director-grade** – Race control has clear tools to run real races.

### 1.2 Core V2 Goals

1. **Lap logging V2**
   - One authoritative path for lap logging (`log_lap_atomic`).
   - No “local timer only” states; every lap is immediately persisted.
   - Support invalidation and recalculation cleanly.

2. **Race clock & procedure state V2**
   - Single source of truth in `session_state`.
   - Well-defined transitions: `setup → warmup → grid → race → finished`.
   - Proper handling of pause, red flag, and resumption.

3. **Driver status & gaps V2**
   - Correct derived stats (`laps`, `best_lap_ms`, `total_time_ms`).
   - Gaps and intervals computed server-side or via robust client helpers.
   - Proper classification (FIN, DNF, DSQ, DNS) on finalize.

4. **UI & role separation**
   - **Race Control Panel** (director-level).
   - **Marshal Panel** (one or few drivers).
   - **Live Timing Board** (public, read-only).
   - **Admin Sessions view** (management & debugging).

5. **Telemetry & logging**
   - `control_logs`, `race_events`, `session_logs`, `session_entries` used properly.
   - Everything reconstructable after the fact.

---

## 2. Pain Points in V1 (Why V2 Exists)

- Legacy **two-marshal system** logic scattered in DB and UI:
  - `drivers_marshal_map` + ad-hoc assignment masked real structure.
  - Leftover constraints and assumptions made control panel fragile.

- **Session state drift**:
  - `session_state` not always in sync with `sessions`.
  - Race clocks desynced after warmup/grid transitions or manual toggles.
  - Some updates went through RPC, some through ad-hoc table updates.

- **Lap logging inconsistency**:
  - Fallback paths and legacy behavior caused driver stats to misalign.
  - Lap invalidations weren’t consistently recalculating cumulative totals.
  - Marshal hotkey logic and DB state could diverge.

- **Spectator desync**:
  - Live timing board sometimes showed wrong positions/gaps.
  - Spectators didn’t see the exact same “truth” as race control.

V2 is explicitly designed to remove these failure modes.

---

## 3. Design Principles for Timing V2

1. **Single source of truth per concern**
   - Race clock: `session_state` only.
   - Driver stats: `drivers` + derived from `laps`.
   - Classification & final results: `results_final`.

2. **RPC-first write patterns**
   - Any stateful action (log lap, invalidate lap, change flag, finalize) goes through RPC.

3. **Append-only + auditability**
   - Never “hide” what happened; always log to `control_logs` / `race_events`.

4. **Role-appropriate UIs**
   - Race Director gets all the switches.
   - Marshals get only what they need.
   - Spectators get a polished, read-only view.

5. **Minimal timing logic on the client**
   - Clients mostly *display*; they don’t compute core timing state.

---

## 4. Data Model – Timing V2

Below is how each timing-related table is intended to be used in V2.

### 4.1 `sessions`

Used for:
- Identity of a race/qualifying session.
- High-level status (“draft”, “scheduled”, “active”, “completed”).

Key fields:
- `status`: `draft | scheduled | active | completed`
- `session_mode`: `race | qualifying`
- `single_marshal_mode`: whether we use simplified marshal view.
- `is_final`: set once `results_final` are validated.

**V2 rule:**
- `sessions.status = 'active'` for any session visible in Control / Live timing.
- Only admin can move `active → completed`.

---

### 4.2 `session_state`

Authoritative state machine for race flow.

Key fields:
- `session_id` (PK)
- `event_type`
- `total_laps` / `total_duration`
- `procedure_phase`: 
  - `setup | warmup | grid | race | finished`
- `flag_status`:
  - e.g. `none`, `red`, etc.
- `track_status`:
  - `green | yellow | vsc | sc | red | checkered`
- `is_timing`, `is_paused`
- `race_time_ms`
- `race_started_at`
- `accumulated_pause_ms`
- `pause_started_at`
- `announcement`

**V2 behavior:**

- `procedure_phase` transitions:
  - `setup` (pre-session)
  - `warmup` (out lap / warmup)
  - `grid` (cars on grid, engines on)
  - `race` (clock running)
  - `finished` (clock frozen, checkered flag)

- `race_time_ms`:
  - Always derived from:
    - `race_started_at`, `accumulated_pause_ms`, `pause_started_at`, `is_timing`, `is_paused`.
  - Client should use the canonical helper formula (already in docs).

- **Single RPC** `update_session_state_atomic()` handles:
  - phase changes
  - flag changes
  - timing start/pause/resume/finish
  - logs to `control_logs` and `race_events`.

---

### 4.3 `drivers`

Per-session driver record.

Key fields:
- `session_id`
- `number`, `name`, `team`
- `marshal_user_id`
- `laps`
- `last_lap_ms`
- `best_lap_ms`
- `total_time_ms`
- `status`: `ready | retired | dnf | dns`
- `driver_flag`: `none | black | blue | white`
- `pits`, `pit_complete`

**V2 rules:**

- `laps`, `last_lap_ms`, `best_lap_ms`, `total_time_ms` are **only** mutated by:
  - `log_lap_atomic`
  - `invalidate_last_lap_atomic`
  - `finalize_session_results` (for final adjustments).

- `status`:
  - Marshals / Race Control can set:
    - `dns` before race start.
    - `retired` or `dnf` during/after race.
  - Final classification is mirrored in `results_final`.

- `marshal_user_id`:
  - The user responsible for logging this driver’s laps in Marshal View.
  - V2 simplifies: **zero or one marshal per driver** (no multi-marshal combos).

---

### 4.4 `laps`

Atomic lap records; every lap is one row.

Key fields:
- `session_id`
- `driver_id`
- `lap_number`
- `lap_time_ms`
- `source`: e.g. `manual`
- `invalidated`, `checkpoint_missed`
- `recorded_at`

**V2 rules:**

- Insert-only (apart from invalidation).
- `lap_number` monotonically increasing per driver.
- `invalidated = true` never deletes; just marks and triggers stat recalculation.

---

### 4.5 `race_events`

Used for user-visible race notifications and event feed.

Examples:
- Flag change
- Safety car deployed
- Yellow in sector 1
- Incident messages (“Car 12 off at Turn 5”)

---

### 4.6 `control_logs`

System-level audit trail (power tool for debugging):

- `action`: `lap_logged | lap_invalidated | flag_changed | phase_changed | penalty_applied | session_finalized | etc.`
- `payload`: JSON; must include user + session + timestamp.

---

### 4.7 `penalties`, `pit_events`, `results_final`, `session_entries`, `session_logs`

V2 usage:

- `penalties`: time penalties only (no more hiding adjustments; every penalty is explicit).
- `pit_events`: “in” / “out” for pits; can be used to calculate pit duration in UI.
- `results_final`:
  - Final classification
  - `final_time_ms = total_time_ms + total_penalty_ms`
  - `classification` (FIN / DNF / DSQ / DNS)
  - `validated` once race director signs off.
- `session_entries`: ensures driver list is clearly tied to session.
- `session_logs`: used for exported session JSON / CSV / timing logs.

---

## 5. RPCs – Timing V2

These are the **canonical ways** to mutate timing state.

### 5.1 `create_session_atomic(p_session jsonb) → uuid`

Already exists; V2 requires:

- Ensures:
  - `sessions` row
  - `session_state` initialized with `procedure_phase = 'setup'`
  - `drivers` created
  - `session_members` seeded
  - `session_entries` created

- Logs a `control_logs` event: `session_created`.

---

### 5.2 `log_lap_atomic(p_session_id, p_driver_id, p_lap_time_ms) → lap`

Responsibilities:

1. Validate:
   - Session is `active` and `procedure_phase = 'race'`.
   - Driver belongs to session.
   - Caller has permission (marshal for that driver, or admin).

2. Insert into `laps`:
   - Next `lap_number`.
   - `lap_time_ms`, `source = 'manual'`, `recorded_at = now()`.

3. Recalculate `drivers` stats:
   - `laps`++
   - `last_lap_ms`
   - `best_lap_ms` (min of valid laps)
   - `total_time_ms` (sum of valid laps).

4. Append to `control_logs` and `race_events` (optional) with a short message.

**No client should manually update `drivers` or `laps` directly.**

---

### 5.3 `invalidate_last_lap_atomic(p_session_id, p_driver_id, p_mode text)`

Modes:
- `'time_only'` – mark last lap invalid but keep lap count.
- `'remove_lap'` – mark invalid + decrement lap count and rebase totals.

Steps:

1. Find last valid lap for driver.
2. Mark it `invalidated = true`.
3. Recompute:
   - `laps`
   - `last_lap_ms`
   - `best_lap_ms`
   - `total_time_ms`.
4. Log a `control_logs` entry: `lap_invalidated`.

---

### 5.4 `update_session_state_atomic(p_session_id, p_patch jsonb)`

Handles:

- `procedure_phase` transitions.
- `flag_status`, `track_status`.
- Timing toggles:
  - Start (`race_started_at`, `is_timing = true`, `is_paused = false`)
  - Pause (`is_paused = true`, `pause_started_at`)
  - Resume (update `accumulated_pause_ms`, clear `pause_started_at`)
  - Finish (`is_timing = false`, `procedure_phase = 'finished'`, `track_status = 'checkered'`)

This RPC:

- Validates allowed transitions (e.g. `setup → warmup → grid → race → finished`).
- Writes descriptive `race_events` messages.
- Always writes to `control_logs`.

---

### 5.5 `apply_penalty(p_session_id, p_driver_id, p_category, p_time_penalty_ms, p_reason)`

- Inserts row into `penalties`.
- Optionally updates `results_final` if race already finalized (or we run `finalize_session_results` again).
- Logs to `control_logs` and optionally `race_events`.

---

### 5.6 `finalize_session_results(p_session_id)`

Steps:

1. For each driver in session:
   - Compute:
     - `total_laps`
     - `total_time_ms` (sum of valid laps)
     - `best_lap_ms`
     - `total_penalty_ms` from `penalties`
     - `final_time_ms = total_time_ms + total_penalty_ms`
     - `classification` (FIN / DNF / DNS / DSQ).
2. Insert/update `results_final`.
3. Set `sessions.is_final = true`.
4. Set `session_state.procedure_phase = 'finished'` if not already.
5. Log `session_finalized` in `control_logs`.

---

### 5.7 `export_session_log(p_session_id)`

Optional but recommended:

- Generates a JSON “timing pack” with:
  - `sessions`, `session_state`, `drivers`, `laps`, `penalties`, `results_final`.
- Uploads to storage (`session_logs` row created with `object_url`).
- Used for archival and post-race review.

---

## 6. UI – Timing V2

### 6.1 Race Control Panel (V2)

Route: `/control/:sessionId`

Core sections:

1. **Header**
   - Session name, mode (Race/Quali), phase, track status.
   - Current race clock (from `session_state`).
   - “Admin pills”: `Start`, `Pause`, `Resume`, `Finish`, `Red Flag`, `SC`, `VSC`, `Yellow`, `Green`.

2. **Track & Procedure Controls**
   - Big buttons for:
     - `Warmup`, `Grid`, `Race`, `Finish`.
   - Flag / status control:
     - `Green`, `Yellow`, `VSC`, `SC`, `Red`, `Checkered`.
   - All actions call `update_session_state_atomic`.

3. **Driver Timing Grid**
   - 1 row per driver:
     - Pos (client-calculated by laps/total_time_ms).
     - Car number & name.
     - Team chip.
     - Laps / total laps.
     - Last lap.
     - Best lap.
     - Gap to leader.
     - Status/flags (`retired`, `blue flag` etc.).
     - Inline buttons:
       - `Log Lap` (for quick single-driver logging).
       - `Invalidate` (with mode selection or default).

4. **Lap Log Event Feed**
   - Scrollable sidebar:
     - `driver`, `lap`, `lap_time`, `delta`, timestamp.

5. **Incident / Race Events Log**
   - `race_events` feed:
     - Flag changes, SC deployments, penalties, etc.

6. **Keyboard shortcuts hint panel**
   - `1–9` for top drivers, `Space` for toggling start/pause, etc.
   - Mapped to `log_lap` and `update_session_state_atomic`.

---

### 6.2 Marshal View (V2)

Route: `/control/:sessionId?view=marshal` or `/marshal/:sessionId`

Purpose: single-driver focus view for assigned marshal.

Features:

- Big central lap timer for assigned driver.
- “LOG LAP” primary button.
- Last 5 laps list with times + colored delta vs best.
- Status indicators:
  - `Blue flag`, `Black flag`, pit status.
- Minimal race control; mostly view-only:
  - Info on race phase, track status, time elapsed.
- Strict permission:
  - Only sees drivers where `drivers.marshal_user_id = auth.uid()`.

All logging still uses `log_lap_atomic`.

---

### 6.3 Live Timing Board (V2)

Route: `/live/:sessionId`

Pure spectator view, read-only:

- Top bar:
  - Series name (DBGP), session name.
  - Phase, track status badge, race clock.

- Main table:
  - `POS`, `NO`, `DRIVER`, `TEAM`, `LAPS`, `LAST LAP`, `BEST LAP`, `GAP`, `INTERVAL`, `PIT`, `STATUS`.
- Color-coded teams (matching your DBGP team colors).
- Fixed update rate but driven by real-time subs (`drivers`, `session_state`, `race_events`).

No lap logging or admin controls here.

---

### 6.4 Admin Sessions View

Route: `/admin/sessions`

For management/debugging:

- Table of all sessions:
  - Status, mode, start time, driver count, last update.
- Per-session panel:
  - Quick links:
    - Open in Race Control
    - Open Live Timing
    - View Results
    - Export Logs
  - Health indicators:
    - Missing `session_state`?
    - Any drivers with no laps?
    - Any suspicious gaps (e.g., clock running but no laps for N minutes)?

---

## 7. Real-time Behaviour – Timing

### Subscriptions:

- `session_state` (by session_id)
- `drivers` (by session_id)
- `laps` (optional, for lap feed)
- `race_events`
- `control_logs` (admin-only view)

### Client handling:

- Use `session_state` to compute displayed race clock.
- Drivers table updates are enough for main timing display; no need to recompute from `laps` on every client.
- `laps` subscription used for lap feeds / deep analytics, not for core positions.

---

## 8. Error Handling & Edge Cases

### Edge cases handled in V2:

- Starting race without total laps:
  - UI prevents; RPC rejects.
- Logging a lap before race phase:
  - `log_lap_atomic` rejects.
- Inconsistent driver states:
  - If a driver has 0 laps after race finished, classification becomes `DNS` or `DNF` per rule.
- Phase desync:
  - Only `update_session_state_atomic` can change phase; manual updates forbidden.
- Red flag / paused:
  - Clock stops, `is_paused = true`, `pause_started_at` recorded.
- Restart after red flag:
  - `accumulated_pause_ms` updated so race time remains consistent.

---

## 9. Implementation Plan – Timing V2

### Phase T1 – Clean the DB & RPCs

1. Audit `log_lap_atomic`, `invalidate_last_lap_atomic`, `finalize_session_results`, `session_has_access`.
2. Ensure:
   - They exist in Supabase.
   - They implement V2 rules.
3. Mark (or delete) unused legacy RPCs.

### Phase T2 – Lock Down Writes

1. Update frontend services:
   - All lap logging uses `logLapAtomic`.
   - All lap invalidation uses `invalidateLastLap`.
   - All phase changes go through `update_session_state_atomic`.
2. Remove any direct `.update('drivers')` for lap stats.

### Phase T3 – Rebuild Race Control Panel

1. Implement V2 layout:
   - Header, controls, timing grid, lap feed, events.
2. Wire hotkeys to RPCs.
3. Add loading + error states.

### Phase T4 – Marshal View

1. Implement single-driver panel.
2. Route: `/control/:sessionId?view=marshal` or dedicated path.
3. Restrict data by `marshal_user_id`.

### Phase T5 – Live Timing Board V2

1. Verify:
   - Clock renders accurately from `session_state`.
   - Gaps/intervals computed from `drivers` derived stats.
2. Add `race_events` ticker or small feed.

### Phase T6 – Finalization & Export

1. Hook up `finalize_session_results` in admin tools.
2. Implement `export_session_log` and UI button.
3. Validate full race from start → finish → results → export.

---

## 10. What Timing V2 Fixes

- No more **broken timing panel** due to leftover two-marshal logic.
- No more **“phase says race but clock is wrong”**.
- No more **drivers with wrong laps/best times** after invalidations.
- Race control, marshals, and spectators all see a **shared truth**.
- Results can be **replayed, exported, and audited** any time.

---

_End of DBGP V2 Timing spec._
