# TimeKeeperDPGP - Comprehensive Documentation

**Last Updated:** November 2025  
**Version:** 0.1.0  
**Repository:** TimeKeeperDPGP (Vite + React + Supabase)

---

## Table of Contents

1. [Application Overview & Purpose](#1-application-overview--purpose)
2. [Core Features & Modules](#2-core-features--modules)
3. [Technical Architecture](#3-technical-architecture)
4. [All Pages & Routes](#4-all-pages--routes)
5. [Database Schema](#5-database-schema)
6. [Key Services & Utilities](#6-key-services--utilities)
7. [Components Structure](#7-components-structure)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Real-time Features](#9-real-time-features)
10. [Development Setup](#10-development-setup)

---

## 1. Application Overview & Purpose

### What is TimeKeeperDPGP?

TimeKeeperDPGP is a **Formula V race timing and sports betting application** built for the DayBreak Grand Prix (DPGP) event. It serves as a comprehensive race control and live spectator platform.

### Primary Use Cases

- **Race Control & Timing**: Marshals log laps, manage track status, record penalties, and monitor pit events during racing sessions
- **Live Timing Display**: Real-time spectator-facing dashboard showing driver positions, gaps, fastest laps, and track conditions
- **Parimutuel Betting**: "Diamond Sports Book" - an in-universe betting platform where spectators place wagers on race outcomes using in-game currency
- **Multi-Session Management**: Support for multiple racing sessions (Practice, Qualifying, Race) with independent timing state

### Target Users (Roles)

1. **Race Control (Admin)**: Full access to race management, session creation, lap logging, flag controls
2. **Marshals**: Log laps for assigned drivers, view session data, may have limited admin capabilities
3. **Spectators**: View live timing, place bets on public markets, no race control access
4. **Public Viewers**: Access live timing board without authentication

---

## 2. Core Features & Modules

### 2.1 Race Timing & Lap Logging

**Purpose**: Accurately track driver lap times during a session

**Key Components**:
- **DriverTimingPanel** (`src/components/DriverTimingPanel.jsx`): Per-driver lap timer UI
- **Lap Service** (`src/services/laps.js`): RPC calls to `log_lap_atomic()` and `invalidate_last_lap_atomic()`

**How It Works**:
1. Lap timers use "armed timestamps" stored in browser localStorage
2. When race transitions from grid to race phase, all driver timers auto-arm at race start
3. Marshal presses hotkey/button to log a lap → time calculated from armed start → lap saved to DB → timer re-arms
4. Lap times include: lap number, milliseconds, source (manual/automatic), invalidation status
5. Database maintains denormalized driver stats: `laps`, `last_lap_ms`, `best_lap_ms`, `total_time_ms`

**Data Persistence**:
- Atomic RPC: `log_lap_atomic(p_session_id, p_driver_id, p_lap_time_ms)` - transactional, updates driver + lap record
- Fallback: If RPC missing, performs manual multi-step inserts with calculated stats

### 2.2 Live Timing Display

**Purpose**: Broadcast real-time driver positions, gaps, and status to spectators

**Key Components**:
- **LiveTimingBoard** (`src/components/LiveTimingBoard.jsx`): Main spectator dashboard
- **SessionContext** (`src/state/SessionContext.jsx`): Per-session data subscriptions

**Features**:
- Authoritative clock calculated from `race_started_at` DB timestamp (not client-side time)
- Driver standings with gap calculations
- Track status banner (Green, Yellow, VSC, Safety Car, Red Flag, Checkered)
- Live lap feed showing recent lap times
- Procedure phase display (Pre-Session, Warm-Up, Grid, Race)

### 2.3 Session Management

**Purpose**: Support multiple independent racing sessions with different drivers and settings

**Key Entities**:
- **Sessions Table**: Each race gets unique ID, name, status (draft/scheduled/active/completed), timing defaults
- **Session State**: Event type, total laps/duration, procedure phase, race clock, flag status
- **Session Members**: Maps users (marshals) to sessions with role assignment
- **Drivers Table**: Per-session driver entries with number, name, team, assigned marshal
- **Laps Table**: Individual lap records linked to driver + session
- **Race Events**: Track status changes, flags, announcements (audit trail)

**Session Lifecycle**:
```
draft → scheduled → active → completed
        (can start when scheduled)
```

**Session Creation Flow** (`src/routes/NewSession.jsx`):
1. Admin creates session (name, optional start time)
2. Configure session defaults (event type, total laps, duration)
3. Select drivers from defaults or add custom
4. Assign marshals to drivers
5. Call `create_session_atomic()` RPC to atomically create all records

### 2.4 Betting/Parimutuel Markets

**Purpose**: Enable in-universe spectator betting using Diamond in-game currency

**Tables**:
- **Events**: Racing events (linked to sessions)
- **Markets**: Betting markets per event (e.g., race winner, fastest lap, safety car deployment)
- **Outcomes**: Options within a market (e.g., "Driver 1 wins", "Driver 2 wins")
- **Wagers**: Individual bets placed by users
- **Wallet Accounts**: User balances
- **Withdrawals**: User cash-out requests

**Parimutuel Model**:
- Fixed rake percentage (500 bps = 5% default)
- Odds calculated: `netPool / outcomeContribution` where `netPool = totalPool * (1 - rakeBps/10000)`
- Implied probability: `outcomeContribution / totalPool`

**Store Management** (`src/state/parimutuelStore.js`):
- Reducer-based state with events, markets, pools, placement status
- Methods: `loadEvents()`, `selectEvent()`, `selectMarket()`, `placeWager()`, `clearToast()`
- Local persistence of selected event/market IDs in localStorage

### 2.5 Track Status & Flag Control

**Purpose**: Communicate race conditions and control signals to drivers and spectators

**Track Statuses** (`src/constants/trackStatus.js`):
- **Green Flag**: Track clear, full speed
- **Yellow Flag**: Caution, slow down, no overtaking
- **Virtual Safety Car (VSC)**: Maintain delta, reduced speed
- **Safety Car (SC)**: Follow SC, no overtaking
- **Red Flag**: Session suspended, return to pits
- **Checkered Flag**: Session complete

**Implementation**:
- `session_state.track_status` field stores current status
- `session_state.flag_status` may differ (flag takes precedence if different)
- UI updates in real-time via Supabase subscriptions
- Race control can change status via `update_session_state()` RPC

### 2.6 User Authentication & Authorization

**Systems**:
1. **Discord OAuth** (Primary): All users (public, marshals, admins) authenticate via Discord
   - Supabase Auth handles OAuth flow
   - User profile auto-created on first login with role='marshal' default
2. **Deprecated Admin Credentials**: Legacy system for admin login (no longer functional)

**User Profiles**:
- Each authenticated user has `profiles` table entry
- Fields: `id` (Supabase UUID), `role` (admin/marshal/spectator), `display_name`, `assigned_driver_ids`, `team_id`

---

## 3. Technical Architecture

### 3.1 Frontend Stack

**Framework & Libraries**:
- **React 18.3.1**: Component library
- **React Router 6.23**: Page routing
- **Vite 7.1.12**: Build tool (development + production)
- **Tailwind CSS 3.4.3**: Utility-first styling
- **Lucide React 0.445**: Icon library
- **Supabase JS 2.76.1**: Database client + auth

**Key Concepts**:
- Component-driven UI with functional components
- Context API for global state (Auth, Session, Wallet, Parimutuel)
- Custom hooks for data fetching and subscriptions
- Real-time subscriptions via Supabase Realtime

### 3.2 Backend Infrastructure

**Database**: Supabase (Postgres)
- **Tables**: ~20 tables (sessions, drivers, laps, race_events, control_logs, penalties, results_final, pit_events, markets, wagers, wallet_accounts, etc.)
- **RLS Policies**: Row-level security restricts access based on user role and session membership
- **RPC Functions**: Server-side business logic (lap logging, session creation, market settlement, etc.)

**Edge Functions**: Deno-based serverless functions running on Supabase
- `admin-auth`: Issues JWT tokens for admin credential login (deprecated, no longer used)

**Real-time**: Supabase Realtime (websocket-based subscriptions)
- Clients subscribe to table changes with filters
- Events broadcast INSERT, UPDATE, DELETE operations

### 3.3 State Management

**Three-tier State Architecture**:

1. **Global Context Providers** (`src/context/`):
   - `AuthContext`: User session, profile, Discord sign-in
   - `SessionContext`: (EventSessionContext) List of sessions, active session selection, session CRUD
   - `WalletContext`: User balance and wallet operations
   - `SessionActionsContext`: Session-specific actions (lap logging, flag changes)

2. **Session-Level Provider** (`src/state/SessionContext.jsx`):
   - `SessionProvider` wraps pages that need session-specific access
   - Provides: `sessionId`, `isAdmin`, `hasAdminRole`, `assignedDriverIds`
   - Loaded from user's `profiles.assigned_driver_ids`

3. **Component-Level State** (`src/components/` and `src/views/`):
   - Local state for UI (forms, timers, animations)
   - Fetched data cached in component state with subscription handlers

**Parimutuel Store** (`src/state/parimutuelStore.js`):
- Custom reducer pattern with `useReducer` + `useContext`
- Actions: LOAD_START, LOAD_SUCCESS, LOAD_ERROR, SELECT_EVENT, SELECT_MARKET, PLACE_WAGER_*, etc.

**localStorage Persistence**:
- `timekeeper.activeSessionId`: Currently selected session
- `parimutuel-store:v1`: Selected event/market IDs
- Driver lap timer armed start times (per driver)

### 3.4 Data Flow

**Timing Data Flow** (Race Control → Live Timing):
```
Marshal logs lap via hotkey
  ↓
logLapAtomic() RPC called
  ↓
Postgres transaction: INSERT lap + UPDATE driver stats
  ↓
REALTIME broadcasts UPDATE to drivers table
  ↓
All connected LiveTimingBoard subscriptions receive update
  ↓
Client re-renders with new lap count, best lap, total time
```

**Betting Data Flow** (Spectator → Odds Update):
```
Spectator clicks "Place Bet"
  ↓
placeWager() RPC validation + insert into wagers table
  ↓
Wager stored with status='pending'
  ↓
REALTIME broadcasts INSERT to wagers table
  ↓
All clients update market pool totals
  ↓
Odds recalculated: odds = netPool / outcomeContribution
```

### 3.5 Environment Configuration

**Required ENV Variables** (`.env.local`):
```bash
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon-key>"
VITE_ADMIN_AUTH_ENDPOINT="https://<project>.functions.supabase.co"  # Optional
VITE_DISCORD_FALLBACK_AUTH_URL="https://discord.com/oauth2/..."    # For OAuth fallback
```

**Build Output**: `npm run build` creates `/dist` folder (compiled React + CSS)

---

## 4. All Pages & Routes

### Route Configuration (`src/App.jsx`)

```jsx
/                          → Welcome (public landing)
/markets                   → Market landing (public, betting)
/account/setup             → Account setup (auth required)
/dashboard                 → User dashboard (auth required)
/dashboard/admin           → Admin dashboard (admin only)
/sessions                  → List of sessions (auth required)
/sessions/new              → Create new session (auth required)
/control/:sessionId        → Race control panel (auth + session access)
/live/:sessionId           → Live timing board (public)
/admin/sessions            → Admin session management
/admin/markets             → Admin market wizard (admin only)
/auth/callback             → Discord OAuth redirect handler
```

### 4.1 Welcome Page (`src/pages/WelcomePage.jsx`)

**Purpose**: Landing page and authentication entry point

**Features**:
- Marketing copy for Diamond Sports Book
- Discord OAuth sign-in button (or fallback OAuth URL)
- Feature highlights (live tote telemetry, compliance, race control parity)
- Legal disclaimer about in-game currency only
- Redirects authenticated users to `/dashboard`

**Auth Flow**:
1. User clicks "Enter the Sports Book"
2. If Supabase configured: calls `signInWithDiscord()` from AuthContext
3. Redirects to Discord: `/auth/callback` as return URL
4. Discord returns auth code → Supabase client exchanges for session

### 4.2 Dashboard Page (`src/pages/dashboard/DashboardPage.jsx`)

**Purpose**: Main authenticated user hub

**Features**:
- User profile display (name, role, balance)
- Session selection (if multiple sessions exist)
- Quick links to markets, control panel, live timing
- Top-up wallet modal (for adding virtual currency)
- Wagers list (recent bets placed)
- Market display with base fallback markets

**Admin Dashboard** (`src/pages/dashboard/AdminDashboardPage.jsx`):
- View all sessions with detailed info (drivers, marshals, status)
- Create new sessions
- Edit session state
- View audit logs (control_logs table)

### 4.3 Session Management Pages

**LiveSessions** (`src/routes/LiveSessions.jsx`):
- Lists all non-completed sessions sorted by status (active → scheduled → draft)
- Shows creation date, last update, participant count
- Click to navigate to `/control/:sessionId`

**NewSession** (`src/routes/NewSession.jsx`):
- 4-step wizard:
  1. Session details (name, optional start time)
  2. Session state (event type, total laps/duration)
  3. Driver selection (enable/disable, assign marshals)
  4. Marshal assignment confirmation
- Calls `create_session_atomic()` RPC
- Redirects to Control panel on success

### 4.4 Race Control Panel (`src/routes/Control.jsx` → `src/views/ControlPanel.jsx`)

**Purpose**: Marshal interface for lap logging and race management

**Key Sections**:
1. **Race Clock Display**: MM:SS format, running during race
2. **Procedure Phase Control**: buttons to advance (setup → warmup → grid → race)
3. **Track Status Banner**: Click to change (green/yellow/vsc/sc/red/checkered)
4. **Driver Timing Grid**: Per-driver lap timers with hotkey bindings
5. **Layout Toggle**: Switch between "control" (race control) and "marshal" (single driver) views

**Single Marshal Mode** (`?view=marshal`):
- Locked to one driver
- Larger lap timer display
- Only that marshal's assigned driver visible

**Hotkey Bindings**:
- `1-9`: Log lap for drivers 1-9
- `Space`: Start/pause race clock
- `R`: Reset session
- `F`: Change flag status

**Timing Logic** (from ControlPanel.jsx documentation):
- Global race clock: `sessionState.raceTime` (milliseconds, persisted to DB)
- Per-driver lap clocks: Armed timestamps in localStorage
- On grid→race transition: ALL drivers auto-arm at race start moment
- Manual arming disabled (prevents accidental timer start before race)
- Pause/resume adjusts armed timestamps to maintain accuracy

**Real-time Subscriptions**:
- `drivers` table: lap counts, best laps, pit status
- `session_state` table: clock, flags, procedure phase
- `race_events` table: announcements, status changes
- `control_logs` table: audit trail

### 4.5 Live Timing Board (`src/routes/LiveTiming.jsx` → `src/pages/LiveTimingPage.jsx` → `src/components/LiveTimingBoard.jsx`)

**Purpose**: Spectator-facing dashboard (public access)

**Features**:
- **Driver Standings**: Position, number, name, laps completed, last lap, best lap, gap to leader, total time
- **Track Status**: Current flag/status with icon and description banner
- **Procedure Phase**: Displays current phase (Warm-Up, Grid, Race, etc.)
- **Race Clock**: MM:SS format, updated from authoritative DB timestamp
- **Lap Feed**: 10 most recent lap entries with driver, lap number, time
- **Session Dropdown**: Switch between sessions (if multiple)

**Authoritative Clock Calculation**:
```javascript
if (!sessionState.isTiming) return sessionState.raceTime;
if (!sessionState.raceStartedAt) return sessionState.raceTime;

const now = Date.now();
const raceStartMs = new Date(sessionState.raceStartedAt).getTime();
const elapsed = now - raceStartMs;
const accumulatedPause = sessionState.accumulatedPauseMs || 0;

if (sessionState.isPaused && sessionState.pauseStartedAt) {
  const pauseStartMs = new Date(sessionState.pauseStartedAt).getTime();
  const currentPauseDuration = now - pauseStartMs;
  return elapsed - accumulatedPause - currentPauseDuration;
}
return elapsed - accumulatedPause;
```

### 4.6 Markets Page (`src/routes/Markets.jsx` → `src/pages/markets/MarketsLanding.jsx`)

**Purpose**: Spectator betting interface

**Features**:
- Event selection dropdown
- Market cards showing:
  - Market name and type
  - Pool total (all wagers combined)
  - Outcomes with implied probability and odds
  - "Place Bet" button per outcome
- Wager placement modal
- Bet slip / recent wagers

**Market Status**:
- Markets can be "open" (accepting wagers) or "closed"
- Each market has optional `closes_at` timestamp
- Wager validation checks market status and deadline

### 4.7 Admin Markets Page (`src/pages/admin/AdminMarketsPage.jsx`)

**Purpose**: Admin creation and management of betting markets

**Features**:
- Market wizard for creating new events/markets
- Market settlement interface
- Outcome administration
- Wager resolution (mark winners, distribute payouts)

---

## 5. Database Schema

### 5.1 Core Timing Tables

#### `sessions`
```sql
id                    UUID PRIMARY KEY
name                  TEXT
status                TEXT ('draft'|'scheduled'|'active'|'completed')
starts_at             TIMESTAMPTZ
ends_at               TIMESTAMPTZ
created_by            UUID (auth.users)
created_at            TIMESTAMPTZ
updated_at            TIMESTAMPTZ
event_type            TEXT ('Practice'|'Qualifying'|'Race')
single_marshal_mode   BOOLEAN
locked_marshal_uuid   UUID (auth.users)
session_mode          TEXT ('race'|'qualifying')
is_final              BOOLEAN
```

#### `session_state`
```sql
id                UUID PRIMARY KEY
session_id        UUID (sessions)
event_type        TEXT
total_laps        INTEGER
total_duration    INTEGER (minutes)
procedure_phase   TEXT ('setup'|'warmup'|'grid'|'race')
flag_status       TEXT
track_status      TEXT
is_timing         BOOLEAN
is_paused         BOOLEAN
race_time_ms      BIGINT
race_started_at   TIMESTAMPTZ
accumulated_pause_ms BIGINT
pause_started_at  TIMESTAMPTZ
announcement      TEXT
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

#### `drivers`
```sql
id              UUID PRIMARY KEY
session_id      UUID (sessions)
number          INTEGER
name            TEXT
team            TEXT
marshal_user_id UUID (auth.users) -- assigned marshal
laps            INTEGER
last_lap_ms     BIGINT
best_lap_ms     BIGINT
total_time_ms   BIGINT
pits            INTEGER (pit stop count)
status          TEXT ('ready'|'retired'|'dnf'|'dns')
driver_flag     TEXT ('none'|'black'|'blue'|'white')
pit_complete    BOOLEAN
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

#### `laps`
```sql
id              UUID PRIMARY KEY
session_id      UUID (sessions)
driver_id       UUID (drivers)
lap_number      INTEGER
lap_time_ms     BIGINT
source          TEXT ('manual'|'automatic'|'gps')
invalidated     BOOLEAN
checkpoint_missed BOOLEAN
recorded_at     TIMESTAMPTZ
```

#### `race_events`
```sql
id              UUID PRIMARY KEY
session_id      UUID (sessions)
action          TEXT (flag change type)
payload         JSONB
created_at      TIMESTAMPTZ
```

### 5.2 Session Access & Membership Tables

#### `session_members`
```sql
session_id      UUID (sessions)
user_id         UUID (auth.users)
role            TEXT ('owner'|'marshal'|'spectator')
inserted_at     TIMESTAMPTZ
PRIMARY KEY (session_id, user_id)
```

#### `profiles`
```sql
id                  UUID PRIMARY KEY (auth.users)
role                TEXT ('admin'|'marshal'|'spectator')
display_name        TEXT
assigned_driver_ids UUID[] (array of driver IDs)
team_id             UUID
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

### 5.3 Control & Logging Tables

#### `control_logs`
```sql
id          UUID PRIMARY KEY
session_id  UUID (sessions)
action      TEXT ('lap_logged'|'lap_invalidated'|'flag_changed'|'penalty_applied'|...)
payload     JSONB
actor       UUID (auth.users)
created_at  TIMESTAMPTZ
INDEX (session_id, created_at DESC)
```

#### `penalties`
```sql
id              UUID PRIMARY KEY
session_id      UUID (sessions)
driver_id       UUID (drivers)
category        TEXT ('track_limits'|'false_start'|'causing_collision'|...)
time_penalty_ms BIGINT
reason          TEXT
issued_by       UUID (auth.users)
created_at      TIMESTAMPTZ
INDEX (session_id), INDEX (driver_id)
```

#### `pit_events`
```sql
id          UUID PRIMARY KEY
session_id  UUID (sessions)
driver_id   UUID (drivers)
event_type  TEXT ('in'|'out')
timestamp   TIMESTAMPTZ
duration_ms BIGINT
recorded_by UUID (auth.users)
INDEX (session_id, timestamp DESC), INDEX (driver_id, timestamp DESC)
```

#### `results_final`
```sql
session_id        UUID (sessions)
driver_id         UUID (drivers)
final_position    INTEGER
classification    TEXT ('FIN'|'DNF'|'DSQ'|'DNS')
total_laps        INTEGER
total_time_ms     BIGINT
best_lap_ms       BIGINT
total_penalty_ms  BIGINT
final_time_ms     BIGINT
validated         BOOLEAN
created_at        TIMESTAMPTZ
PRIMARY KEY (session_id, driver_id)
```

### 5.4 Betting Tables

#### `events`
```sql
id          UUID PRIMARY KEY
title       TEXT
venue       TEXT
starts_at   TIMESTAMPTZ
ends_at     TIMESTAMPTZ
status      TEXT ('upcoming'|'live'|'settled')
session_id  UUID (sessions) -- optional link back to race session
```

#### `markets`
```sql
id          UUID PRIMARY KEY
event_id    UUID (events)
name        TEXT
type        TEXT ('win'|'fastest_lap'|'safety_car'|...)
rake_bps    INTEGER (basis points, 500 = 5%)
status      TEXT ('open'|'closed'|'settled')
closes_at   TIMESTAMPTZ
created_at  TIMESTAMPTZ
INDEX (event_id)
```

#### `outcomes`
```sql
id          UUID PRIMARY KEY
market_id   UUID (markets)
label       TEXT
sort_order  INTEGER
color       TEXT (optional)
driver_id   UUID (drivers) (optional - for driver-specific markets)
is_winner   BOOLEAN
```

#### `wagers`
```sql
id          UUID PRIMARY KEY
user_id     UUID (auth.users)
market_id   UUID (markets)
outcome_id  UUID (outcomes)
stake       BIGINT (in smallest currency unit)
placed_at   TIMESTAMPTZ
status      TEXT ('pending'|'won'|'lost'|'voided')
payout      BIGINT (calculated after settlement)
INDEX (user_id), INDEX (market_id)
```

#### `wallet_accounts`
```sql
user_id     UUID PRIMARY KEY (auth.users)
balance     BIGINT (in smallest currency unit)
```

#### `wallet_transactions`
```sql
id          UUID PRIMARY KEY
user_id     UUID (auth.users)
kind        TEXT ('wager'|'payout'|'topup'|'withdrawal'|...)
amount      BIGINT
meta        JSONB
created_at  TIMESTAMPTZ
INDEX (user_id)
```

#### `withdrawals`
```sql
id          UUID PRIMARY KEY
user_id     UUID (auth.users)
amount      BIGINT
status      TEXT ('queued'|'approved'|'completed'|'rejected')
created_at  TIMESTAMPTZ
```

### 5.5 RLS Policies (Row-Level Security)

**Policy Philosophy**: 
- Admins (role='admin') have full access
- Marshals can view/edit only their assigned session and drivers
- Spectators can view public data (live timing, open markets)

**Key Policies**:
- `drivers`: User can view if admin OR in session_members for that session
- `laps`: User can view if they can view the parent driver
- `session_state`: Public read, authenticated user update (if in session_members)
- `wagers`: User can view/create only their own wagers
- `wallet_accounts`: User can view only their own

### 5.6 RPC Functions

#### `create_session_atomic(p_session jsonb) → uuid`
**Purpose**: Atomically create session, drivers, and session_members

**Payload Structure**:
```json
{
  "name": "Race 1",
  "status": "draft",
  "starts_at": "2025-11-20T14:00:00Z",
  "members": [
    { "user_id": "uuid", "role": "marshal" }
  ],
  "drivers": [
    { "number": 1, "name": "Driver 1", "team": "Team A" }
  ]
}
```

#### `log_lap_atomic(p_session_id uuid, p_driver_id uuid, p_lap_time_ms bigint) → lap record`
**Purpose**: Transactionally log a lap and update driver stats

**Returns**: Lap record with calculated driver totals

#### `invalidate_last_lap_atomic(p_session_id uuid, p_driver_id uuid, p_mode text) → driver record`
**Purpose**: Mark last lap as invalid and recalculate driver stats

**Modes**: `'time_only'` (lap stays in count) or `'remove_lap'` (decrement count)

#### `finalize_session_results(p_session_id uuid) → void`
**Purpose**: Calculate final results considering penalties, classify drivers (FIN/DNF/DSQ/DNS)

#### `place_wager(p_market_id uuid, p_outcome_id uuid, p_stake bigint) → {success: boolean, wager_id: uuid, message: text}`
**Purpose**: Place a bet, validate market status, deduct from wallet, insert wager record

#### `session_has_access(target_session_id uuid) → boolean`
**Purpose**: Check if current user (auth.uid()) has access to a session

**Logic**: 
```
Return true if:
  - User is admin, OR
  - User created the session, OR
  - User is in session_members for this session
```

---

## 6. Key Services & Utilities

### 6.1 Services (`src/services/`)

#### `laps.js`
**Exports**:
- `logLapAtomic({ sessionId, driverId, lapTimeMs })`: Call `log_lap_atomic` RPC with fallback
- `invalidateLastLap({ sessionId, driverId, mode })`: Call `invalidate_last_lap_atomic` RPC with fallback

**Fallback Strategy**: If RPC missing, manually performs INSERT/UPDATE operations

#### `admin.js`
**Exports**:
- `fetchAdminSessions()`: Get all sessions with driver/member relationships
- `fetchMarshalDirectory()`: Get list of all marshals (role='marshal')
- `updateSessionState(sessionId, patch)`: Update session_state fields
- `updateDriverStatus(sessionId, driverId, patch)`: Update driver record

#### `adminAuth.js` (Deprecated)
**Status**: DEPRECATED - always throws error
**Note**: Was used for username/password admin login. Now uses Discord OAuth only.

#### `penalties.js`
**Exports**:
- `applyPenalty({ sessionId, driverId, category, timePenaltyMs, reason })`
- `listPenalties(sessionId)`
- `removePenalty(penaltyId)`

#### `pitEvents.js`
**Exports**:
- `logPitEvent({ sessionId, driverId, eventType })`: Log pit in/out
- `listPitEvents(sessionId, driverId)`
- `calculatePitDuration(sessionId, driverId)`

#### `results.js`
**Exports**:
- `finalizeAndExport(sessionId)`: Finalize results, export as JSON/CSV, upload to storage
- `calculateGaps(sessionId)`: Compute gap-to-leader for each driver
- `generateResultsReport(sessionId)`

### 6.2 Library Files (`src/lib/`)

#### `supabaseClient.js`
**Exports**:
- `supabase`: Singleton Supabase client instance
- `isSupabaseConfigured`: Boolean flag if env vars present
- `supabaseSelect(table, options)`: Wrapper for `.from(table).select(...)`
- `supabaseInsert(table, rows)`: Wrapper for `.from(table).insert(rows)`
- `supabaseUpdate(table, updates, options)`: Wrapper for `.from(table).update(...)`
- `supabaseUpsert(table, rows)`: Insert with on-conflict update
- `subscribeToTable(filter, callback, options)`: Set up realtime subscription
- `supabaseStorageUpload(bucket, path, content, options)`: Upload to storage
- `isTableMissingError(error, tableName)`: Detect schema errors
- `isColumnMissingError(error, columnName)`: Detect column errors

**Error Handling**: Detects and provides fallback behavior for missing RPC/tables

#### `auth.js`
**Exports**:
- `signInWithDiscord(options)`: Trigger Discord OAuth flow
- `signOut()`: Logout current user
- `getCurrentUser()`: Get session user
- `isAdmin()`: Check if user has admin role

#### `profile.js`
**Exports**:
- `resolveProfileRole(profile, { claims })`: Determine user role (checks JWT claims)
- `saveProfile(patch, { supabase, userId })`: Update profile in DB

### 6.3 Utility Functions (`src/utils/`)

#### `time.js`
```javascript
formatLapTime(ms) → "1:23.456"     // M:SS.mmm format
formatRaceClock(ms) → "45:32"       // MM:SS format (no decimals)
```

#### `raceData.js`
```javascript
LEGACY_SESSION_ID → "00000000-0000-0000-0000-000000000000"
DEFAULT_SESSION_STATE → { eventType, totalLaps, totalDuration, ... }
groupLapRows(lapRows) → Map<driverId, lapArray>
hydrateDriverState(driverRow, lapRowsMap) → enriched driver object
sessionRowToState(sessionRow) → normalized session state object
```

#### `betting.js`
```javascript
calculateOdds(poolContribution, totalPool, rakeBps) → Number
calculateImpliedProbability(poolContribution, totalPool) → Number
validateWagerAmounts(stake, balance) → { valid, issues }
```

### 6.4 Custom Hooks (`src/hooks/`)

#### `useSessionDrivers.js`
```javascript
useSessionDrivers(sessionId) → {
  drivers: Array<Driver>,
  isLoading: Boolean,
  error: Error|null,
  refresh: Function
}
```
Fetches and subscribes to drivers for a session

#### `useControlLogs.js`
```javascript
useControlLogs(sessionId, options) → {
  logs: Array<ControlLog>,
  isLoading: Boolean,
  refresh: Function
}
```
Fetches audit trail for a session

#### `usePenalties.js`
```javascript
usePenalties(sessionId) → {
  penalties: Array<Penalty>,
  applyPenalty: Function,
  removePenalty: Function
}
```

#### `usePitEvents.js`
```javascript
usePitEvents(sessionId, driverId) → {
  events: Array<PitEvent>,
  logEvent: Function,
  calculateDuration: Function
}
```

#### `useWagers.js`
```javascript
useWagers(userId) → {
  wagers: Array<Wager>,
  placedToday: Number,
  totalWagered: Number
}
```

---

## 7. Components Structure

### 7.1 Layout & Page Components

#### `AppLayout` (`src/components/layout/AppLayout.jsx`)
- Main layout wrapper with header, navigation, footer
- Handles responsive design
- Contains `<Outlet>` for page content

#### `ControlPanel` (`src/views/ControlPanel.jsx`)
- Race control master component
- Contains DriverTimingPanel or SingleMarshalBoard based on mode
- Subscribes to session state, drivers, laps, race events
- Handles lap logging via hotkeys
- Contains SessionActionsProvider

### 7.2 Race Control Components

#### `DriverTimingPanel` (`src/components/DriverTimingPanel.jsx`)
- Grid of driver lap timers
- Per-driver: number, name, laps, last lap, best lap, total time
- Hotkey bindings (1-9 to log lap)
- Lap timer UI with millisecond precision

#### `SingleMarshalBoard` (`src/components/SingleMarshalBoard.jsx`)
- Large lap timer for single driver (marshal-focused view)
- Assigned driver display
- Prominent lap logging button
- Current lap time with larger font

#### `MarshalDriverCard` (`src/components/MarshalDriverCard.jsx`)
- Individual driver card within timing grid
- Shows lap timer, stats, flags
- Handles lap logging on click

### 7.3 Live Timing Components

#### `LiveTimingBoard` (`src/components/LiveTimingBoard.jsx`)
- Spectator dashboard (main component)
- Race clock with authoritative DB timestamp
- Driver standings table
- Track status banner
- Lap feed (recent laps)
- Procedure phase display

### 7.4 Authentication Components

#### `AuthGuard` (`src/components/auth/AuthGuard.jsx`)
- Wrapper component requiring authentication
- Optional `requireAdmin` prop for admin-only pages
- Redirects to login if not authenticated/authorized

#### `ProtectedRoute` (`src/components/auth/ProtectedRoute.jsx`)
- Higher-order route component
- Ensures user is authenticated before showing page
- Handles redirect to welcome page

#### `SessionAccessGuard` (`src/components/auth/SessionAccessGuard.jsx`)
- Restricts access to a specific session
- Checks `session_has_access()` RPC
- Ensures user is member of or created the session

#### `AuthGate` (`src/components/auth/AuthGate.jsx`)
- Conditional render based on auth status
- Can show different UI for authenticated vs unauthenticated users

### 7.5 Betting Components

#### `Betslip` (`src/components/betting/Betslip.jsx`)
- Bet placement modal
- Outcome selection
- Stake input
- Odds display
- Balance check
- Submit wager button

#### `MarketCard` (`src/components/betting/MarketCard.jsx`)
- Individual market preview
- Outcome buttons with implied probability
- Market status indicator
- Click to open betslip

### 7.6 Admin Components

#### `AdminMarketWizard` (`src/components/admin/markets/AdminMarketWizard.jsx`)
- Multi-step form to create events and markets
- Outcome configuration
- Rake adjustment
- Market activation

#### `SessionMarshalAssignments` (`src/components/admin/SessionMarshalAssignments.jsx`)
- Assign marshals to drivers
- Review coverage
- Batch operations

### 7.7 Other Components

#### `TopUpModal` (`src/components/dashboard/TopUpModal.jsx`)
- Modal to add virtual currency to wallet
- Amount selection / custom input
- Payment flow (if integrated)

---

## 8. Authentication & Authorization

### 8.1 Authentication Flow

**Current System: Discord OAuth**

```
User clicks "Sign In"
  ↓
Redirects to Discord OAuth consent page
  ↓
User approves, Discord sends auth code to /auth/callback
  ↓
AuthCallback component exchanges code for session via Supabase
  ↓
Session stored (JWT tokens in cookie/localStorage)
  ↓
AuthProvider detects session change → loads profile → updates context
  ↓
User can now access authenticated routes
```

**Profile Auto-Creation**:
- First login creates `profiles` entry with role='marshal' (default)
- Admin manually updates role in DB or via admin panel if needed
- Discord user metadata used for display_name

### 8.2 Role-Based Access Control

**Three Roles**:

1. **admin**: Full system access
   - Create/edit/delete sessions
   - Manage all drivers and laps
   - Access admin dashboard and market wizard
   - Issue penalties, change flags

2. **marshal**: Session-specific access
   - Log laps for assigned drivers
   - View own session data
   - See live timing but cannot modify race state

3. **spectator**: View-only access
   - View live timing board
   - Place wagers
   - Cannot access race control

### 8.3 Protected Routes

**Implementation** (`src/routes/`):

- `AuthGuard` wraps routes requiring authentication
  - Optional `requireAdmin` prop → only admins pass
- `ProtectedRoute` ensures authenticated before routing
- `SessionAccessGuard` ensures user has session access via RPC

**Example**:
```jsx
<Route 
  path="/control/:sessionId"
  element={
    <ProtectedRoute>
      <SessionAccessGuard>
        <Control />
      </SessionAccessGuard>
    </ProtectedRoute>
  }
/>
```

### 8.4 Session-Based Access

**Session Membership**:
- `session_members` table maps users to sessions with roles
- User must be in session_members OR be the session creator OR be admin

**RPC Check**: `session_has_access(target_session_id)` verifies access before allowing data modifications

---

## 9. Real-time Features

### 9.1 Real-time Subscriptions

**Via Supabase Realtime**:
- WebSocket connections to listen for DB changes
- Tables enabled for realtime: sessions, drivers, laps, race_events, markets, wagers, wallet_accounts, outcomes

**Subscription Pattern**:
```javascript
const unsubscribe = subscribeToTable(
  {
    schema: 'public',
    table: 'drivers',
    event: '*',  // 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    filter: `session_id=eq.${sessionId}`
  },
  (payload) => {
    // payload.eventType: 'INSERT', 'UPDATE', 'DELETE'
    // payload.new: new row values
    // payload.old: old row values
    // Update state
  },
  { maxRetries: 6 }
);

return () => unsubscribe();  // Cleanup
```

### 9.2 Real-time Use Cases

**Lap Logging** (Marshal → All Viewers):
1. Marshal logs lap via DriverTimingPanel hotkey
2. `logLapAtomic()` RPC inserts lap + updates driver stats
3. `drivers` table emits UPDATE event
4. All subscribed clients receive update
5. LiveTimingBoard re-renders with new position/lap count

**Flag Changes** (Race Control → Spectators):
1. Race control clicks "Red Flag" button
2. `updateSessionState()` updates `session_state.track_status`
3. `session_state` table emits UPDATE
4. LiveTimingBoard banner updates
5. All spectators see red flag immediately

**Wager Placement** (Spectator → Market Pool):
1. Spectator submits bet
2. `place_wager()` RPC validates and inserts wager
3. `wagers` table emits INSERT
4. `outcomes` table stats updated
5. All clients recalculate odds based on new pool total

### 9.3 Connection Management

**Retry Logic**:
- Up to 6 retries on connection drop
- Exponential backoff
- User notified if connection fails after retries

**Cleanup**:
- Unsubscribe in component `useEffect` cleanup
- Prevents memory leaks
- Stops listening when component unmounts

---

## 10. Development Setup

### 10.1 Prerequisites

- **Node.js** 18+ (includes npm)
- **Supabase Account** (free tier sufficient for development)
- **Supabase CLI** (`brew install supabase/tap/supabase`)
- **Discord OAuth App** (for authentication testing)

### 10.2 Installation & Configuration

**1. Clone Repository**:
```bash
git clone https://github.com/heyfinlay/TimeKeeperDPGP.git
cd TimeKeeperDPGP
```

**2. Install Dependencies**:
```bash
npm install
```

**3. Set Up Supabase**:
```bash
# Authenticate with Supabase
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Apply migrations (creates schema)
supabase db push

# Optional: reset DB with seed data
supabase db reset
```

**4. Configure Secrets** (for admin-auth edge function):
```bash
supabase secrets set \
  JWT_SECRET='<generate: openssl rand -hex 32>' \
  admin_credentials='[{"username":"admin","password":"pass123","user_id":"<uuid>","role":"admin"}]'
```

**5. Create `.env.local`**:
```bash
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_ANON_KEY="<copy from Supabase dashboard>"
VITE_ADMIN_AUTH_ENDPOINT="https://<project>.functions.supabase.co"
VITE_DISCORD_FALLBACK_AUTH_URL="https://discord.com/oauth2/authorize?client_id=<your-client-id>&..."
```

### 10.3 Running Locally

**Development Server**:
```bash
npm run dev
# Opens http://localhost:5173
```

**Production Build**:
```bash
npm run build
npm run preview
# Tests dist/ build locally
```

**Run Tests**:
```bash
npm run test
```

### 10.4 Project Structure

```
TimeKeeperDPGP/
├── src/
│   ├── components/          # React components
│   │   ├── auth/            # Authentication guards
│   │   ├── betting/         # Betting UI
│   │   ├── layout/          # Page layouts
│   │   ├── admin/           # Admin components
│   │   └── ...
│   ├── pages/               # Page components
│   │   ├── dashboard/
│   │   ├── auth/
│   │   ├── markets/
│   │   └── ...
│   ├── routes/              # Route entry points
│   ├── services/            # Business logic + API calls
│   ├── lib/                 # Utilities and clients
│   ├── utils/               # Helper functions
│   ├── hooks/               # Custom React hooks
│   ├── context/             # Context providers
│   ├── state/               # State management (parimutuel store)
│   ├── constants/           # Constants
│   ├── App.jsx              # Main router
│   └── main.jsx             # Entry point
├── supabase/
│   ├── migrations/          # Schema migrations (SQL)
│   └── functions/           # Edge functions (TypeScript)
├── package.json
├── vite.config.js
├── tailwind.config.js
├─�� index.html
└── README.md
```

### 10.5 Key Development Commands

```bash
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run test             # Run vitest suite
npm run create:marshal   # Create default marshal account

supabase db push         # Apply pending migrations
supabase db reset        # Reset to clean state
supabase db pull         # Pull changes from remote
supabase functions deploy admin-auth  # Deploy edge function
```

### 10.6 Common Development Tasks

**Add a New Route**:
1. Create page component in `src/pages/` or `src/routes/`
2. Add route to `src/App.jsx`
3. Wrap with `AuthGuard`/`ProtectedRoute` as needed
4. Create navigation link

**Add a New Service**:
1. Create file in `src/services/`
2. Export async function that calls Supabase RPC or query
3. Include error handling and fallback logic
4. Use in components via custom hooks

**Create a New Hook**:
1. Create file in `src/hooks/`
2. Use `useState`, `useEffect`, `useContext` as needed
3. Subscribe to Supabase tables if needed
4. Return state and methods
5. Export and use in components

**Create a Database Migration**:
1. Create `.sql` file in `supabase/migrations/` with timestamp: `20251120_description.sql`
2. Write idempotent SQL (use `IF NOT EXISTS`, etc.)
3. Run `supabase db push` to apply
4. Commit file to version control

### 10.7 Environment-Specific Setup

**Offline Mode** (No Supabase):
- If `VITE_SUPABASE_URL` not set, app falls back to offline mode
- Live timing board shows demo data
- Session management disabled
- Betting disabled

**Production Deployment**:
- Run `npm run build` to generate `/dist`
- Deploy `/dist` to Vercel, Netlify, or static host
- Configure environment variables in deployment platform
- Ensure Supabase URL and keys are production values

### 10.8 Troubleshooting

**Issue**: "Sessions table missing"
- **Solution**: Run `supabase db push` to apply migrations

**Issue**: "Supabase not configured"
- **Solution**: Verify `.env.local` has correct URL and anon key

**Issue**: "RPC not found" (log_lap_atomic missing)
- **Solution**: Check migration 20250107 was applied; app falls back to manual inserts

**Issue**: Real-time not updating
- **Solution**: Verify table is enabled in Supabase Dashboard (Publication: supabase_realtime)

**Issue**: Discord OAuth redirect loop
- **Solution**: Check Discord app redirect URI matches `window.location.origin/auth/callback`

---

## Maintenance & Future Enhancements

### Known Limitations

1. **Admin Credential Login Deprecated**: Moving to Discord OAuth only (already implemented)
2. **Single Process Timing**: No multi-location marshal support yet
3. **No Discord Webhooks**: Could integrate for announcements
4. **Basic Race Control**: Future could add more detailed session flow (red flag procedures, etc.)

### Recommended Next Features

1. **Discord Bot Integration**: Announce race results, lap records
2. **Mobile Companion App**: Dedicated iOS/Android for marshals
3. **More Market Types**: Driver-vs-driver, qualifying predictions
4. **Advanced Analytics**: Driver performance trends, seasonal stats
5. **Multi-class Support**: Support multiple car classes in one event

---

**End of Documentation**

For questions or updates, contact the development team or create an issue in the repository.
