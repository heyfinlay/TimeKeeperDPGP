# TimeKeeper DPGP - Technical Specification

## Project Overview

**TimeKeeper DPGP** is a comprehensive race timing and betting management system designed for motorsport events. It combines real-time race timing, driver management, and an integrated betting platform into a single cohesive application.

### Core Capabilities
- Real-time race timing and lap logging
- Multi-driver session management
- Live timing board for spectators
- Integrated betting markets and wagering system
- Admin market management and settlement
- Wallet system for betting funds
- Role-based access control (Admin, Marshal, Spectator)

### Technology Stack
- **Frontend**: React 18 with Vite
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL (via Supabase)
- **Real-time**: Supabase Realtime (WebSocket subscriptions)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage
- **Routing**: React Router v6
- **Icons**: Lucide React

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Application                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Dashboard   │  │ Control      │  │ Live Timing  │      │
│  │  Page        │  │ Panel        │  │ Board        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Markets     │  │ Admin        │  │ Account      │      │
│  │  Page        │  │ Panel        │  │ Setup        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase Client (API Layer)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  REST API    │  │  Realtime    │  │  Auth        │      │
│  │  Wrapper     │  │  Subscriptions│  │  Service     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Backend                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  PostgreSQL  │  │  RLS         │  │  Functions   │      │
│  │  Database    │  │  Policies    │  │  (RPCs)      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
TimeKeeperDPGP/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── layout/          # Layout components (AppLayout, Header)
│   │   ├── DriverTimingPanel.jsx
│   │   ├── LiveTimingBoard.jsx
│   │   └── ...
│   ├── context/             # React Context providers
│   │   └── SessionActionsContext.jsx
│   ├── pages/               # Page-level components
│   │   ├── dashboard/
│   │   ├── markets/
│   │   └── admin/
│   ├── routes/              # Route components
│   │   ├── NewSession.jsx
│   │   └── ...
│   ├── views/               # View components
│   │   ├── ControlPanel.jsx
│   │   └── ...
│   ├── services/            # API service layer
│   │   ├── laps.js
│   │   ├── sessions.js
│   │   └── markets.js
│   ├── state/               # State management
│   │   └── SessionContext.jsx
│   ├── utils/               # Utility functions
│   │   └── time.js
│   ├── lib/                 # Core libraries
│   │   └── supabaseClient.js
│   └── App.jsx              # Root component
├── supabase/
│   └── migrations/          # Database migration files
├── tests/                   # Test files
└── public/                  # Static assets
```

---

## Database Schema

### Core Tables

#### `sessions`
Race session container.
```sql
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- draft, active, completed
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
```

#### `session_state`
Real-time race state for each session.
```sql
CREATE TABLE public.session_state (
  id TEXT PRIMARY KEY, -- Same as session_id for simplicity
  session_id UUID NOT NULL REFERENCES sessions(id),
  event_type TEXT,
  total_laps INTEGER,
  total_duration INTEGER,
  procedure_phase TEXT, -- setup, warmup, grid, race
  flag_status TEXT,
  track_status TEXT,
  announcement TEXT,
  is_timing BOOLEAN,
  is_paused BOOLEAN,
  race_time_ms BIGINT,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
```

#### `drivers`
Driver information per session.
```sql
CREATE TABLE public.drivers (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id),
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  team TEXT,
  marshal_user_id UUID REFERENCES auth.users(id),
  laps INTEGER DEFAULT 0,
  last_lap_ms BIGINT,
  best_lap_ms BIGINT,
  pits INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ready',
  driver_flag TEXT DEFAULT 'none',
  pit_complete BOOLEAN DEFAULT false,
  total_time_ms BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);
```

#### `laps`
Individual lap records.
```sql
CREATE TABLE public.laps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  driver_id UUID REFERENCES drivers(id),
  lap_number INTEGER NOT NULL,
  lap_time_ms BIGINT NOT NULL,
  source TEXT, -- manual, hotkey, automatic
  recorded_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  invalidated BOOLEAN DEFAULT false,
  checkpoint_missed BOOLEAN DEFAULT false
);
```

#### `session_members`
Users with access to specific sessions.
```sql
CREATE TABLE public.session_members (
  session_id UUID NOT NULL REFERENCES sessions(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT DEFAULT 'marshal', -- marshal, observer
  inserted_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  PRIMARY KEY (session_id, user_id)
);
```

#### `profiles`
Extended user profile information.
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT DEFAULT 'spectator', -- spectator, driver, marshal, admin
  display_name TEXT,
  handle TEXT UNIQUE,
  assigned_driver_ids UUID[],
  driver_ids UUID[],
  team_id UUID,
  tier TEXT,
  experience_points INTEGER DEFAULT 0,
  ic_phone_number TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  CONSTRAINT profiles_role_check CHECK (role IN ('spectator', 'driver', 'marshal', 'admin'))
);
```

### Betting System Tables

#### `markets`
Betting markets for events.
```sql
CREATE TABLE public.markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- winner, podium, head_to_head, etc.
  rake_bps INTEGER DEFAULT 500, -- Rake in basis points (500 = 5%)
  status TEXT DEFAULT 'open', -- open, locked, settled, cancelled
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `outcomes`
Possible outcomes for each market.
```sql
CREATE TABLE public.outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
```

#### `wagers`
Individual bets placed by users.
```sql
CREATE TABLE public.wagers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  outcome_id UUID NOT NULL REFERENCES outcomes(id),
  stake BIGINT NOT NULL CHECK (stake > 0),
  placed_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending' -- pending, won, lost, refunded
);
```

#### `wallet_accounts`
User wallet balances.
```sql
CREATE TABLE public.wallet_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  balance BIGINT DEFAULT 0 -- Balance in cents
);
```

#### `wallet_transactions`
Transaction history for wallets.
```sql
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  kind TEXT NOT NULL, -- deposit, withdrawal, wager, payout, refund
  amount BIGINT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Admin Tables

#### `admin_credentials`
Admin username/password authentication.
```sql
CREATE TABLE public.admin_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  rotated_at TIMESTAMPTZ
);
```

#### `admin_actions_log`
Audit log for admin actions.
```sql
CREATE TABLE public.admin_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  market_id UUID REFERENCES markets(id),
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Supporting Tables

**Tables that exist in production but lack migration definitions:**
- `drivers_marshal_map` - Maps legacy marshal IDs to auth.users
- `session_entries` - Junction table for driver-session relationships
- `teams` - Team information
- `events` - Event container for markets
- `withdrawals` - Withdrawal requests
- `session_logs` - Session data exports
- `race_events` - Race event log messages

---

## Database Functions (RPCs)

### `log_lap_atomic`
Atomically logs a lap and updates driver statistics.

```sql
CREATE FUNCTION public.log_lap_atomic(
  p_session_id UUID,
  p_driver_id UUID,
  p_lap_time_ms BIGINT,
  p_source TEXT DEFAULT 'manual'
)
RETURNS TABLE(
  lap_id UUID,
  session_id UUID,
  driver_id UUID,
  laps INTEGER,
  last_lap_ms BIGINT,
  best_lap_ms BIGINT,
  total_time_ms BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DECLARE
    v_new_lap_id UUID;
    v_best BIGINT;
  BEGIN
    -- Lock driver row for update
    PERFORM 1 FROM public.drivers d
      WHERE d.id = p_driver_id AND d.session_id = p_session_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'driver % not in session %', p_driver_id, p_session_id;
    END IF;

    -- Insert new lap
    INSERT INTO public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
    VALUES (
      p_session_id,
      p_driver_id,
      COALESCE((SELECT MAX(lap_number) FROM public.laps WHERE session_id = p_session_id AND driver_id = p_driver_id), 0) + 1,
      p_lap_time_ms,
      p_source
    )
    RETURNING id INTO v_new_lap_id;

    -- Get current best lap
    SELECT best_lap_ms INTO v_best FROM public.drivers WHERE id = p_driver_id;

    -- Update driver statistics
    UPDATE public.drivers
      SET laps = COALESCE(laps, 0) + 1,
          last_lap_ms = p_lap_time_ms,
          best_lap_ms = CASE WHEN v_best IS NULL THEN p_lap_time_ms ELSE LEAST(v_best, p_lap_time_ms) END,
          total_time_ms = COALESCE(total_time_ms, 0) + p_lap_time_ms,
          updated_at = timezone('utc', now())
      WHERE id = p_driver_id AND session_id = p_session_id;

    -- Return updated driver stats
    RETURN QUERY
    SELECT v_new_lap_id, p_session_id, p_driver_id, d.laps, d.last_lap_ms, d.best_lap_ms, d.total_time_ms
    FROM public.drivers d
    WHERE d.id = p_driver_id AND d.session_id = p_session_id;
  END;
$$;
```

### `invalidate_last_lap_atomic`
Atomically invalidates the most recent lap and recalculates driver statistics.

```sql
CREATE FUNCTION public.invalidate_last_lap_atomic(
  p_session_id UUID,
  p_driver_id UUID,
  p_mode TEXT -- 'time_only' or 'remove_lap'
)
RETURNS TABLE(
  invalidated_lap_id UUID,
  session_id UUID,
  driver_id UUID,
  laps INTEGER,
  last_lap_ms BIGINT,
  best_lap_ms BIGINT,
  total_time_ms BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
-- Implementation omitted for brevity
```

### `session_has_access`
Security function to check if current user has access to a session.

```sql
CREATE FUNCTION public.session_has_access(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session_members
    WHERE session_id = target_session_id
      AND user_id = auth.uid()
  ) OR public.is_admin();
$$;
```

### `is_admin`
Security function to check if current user is an admin.

```sql
CREATE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
```

### Market Management Functions

- `settle_market_rpc` - Settles a market with winning outcome
- `cancel_market_rpc` - Cancels market and refunds all wagers
- `calculate_market_payouts` - Calculates payouts for settled markets
- `process_withdrawal_approval` - Approves/rejects withdrawal requests

---

## Row-Level Security (RLS) Policies

### Drivers Table
```sql
-- Admins have full access
CREATE POLICY "Admin full access to drivers"
  ON public.drivers FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());

-- Session members can access drivers in their sessions
CREATE POLICY "Session scoped access for drivers"
  ON public.drivers FOR ALL TO public
  USING (session_has_access(session_id))
  WITH CHECK (session_has_access(session_id));
```

### Laps Table
```sql
CREATE POLICY "Admin full access to laps"
  ON public.laps FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Session scoped access for laps"
  ON public.laps FOR ALL TO public
  USING (session_has_access(session_id))
  WITH CHECK (session_has_access(session_id));
```

### Session State Table
```sql
CREATE POLICY "Admin full access to session state"
  ON public.session_state FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Session scoped access for session state"
  ON public.session_state FOR ALL TO public
  USING (session_state_has_access(session_id))
  WITH CHECK (session_state_has_access(session_id));
```

### Markets Table
```sql
CREATE POLICY "Anyone can view open markets"
  ON public.markets FOR SELECT TO public
  USING (true);

CREATE POLICY "Admins can manage markets"
  ON public.markets FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());
```

### Wagers Table
```sql
CREATE POLICY "Users can view their own wagers"
  ON public.wagers FOR SELECT TO public
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "Users can place wagers"
  ON public.wagers FOR INSERT TO public
  WITH CHECK (user_id = auth.uid());
```

### Wallet Accounts Table
```sql
CREATE POLICY "Users can view their own wallet"
  ON public.wallet_accounts FOR SELECT TO public
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "Users can update their own wallet"
  ON public.wallet_accounts FOR UPDATE TO public
  USING (user_id = auth.uid() OR is_admin());
```

### Admin Credentials Table
```sql
CREATE POLICY "Admin full access to admin credentials"
  ON public.admin_credentials FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());
```

---

## Frontend Architecture

### State Management

#### SessionContext
Provides session data and actions throughout the app.

```javascript
const SessionContext = createContext({
  sessions: [],
  selectedSessionId: null,
  selectSession: (id) => {},
  refreshSessions: () => {},
  isLoading: false,
});
```

#### SessionActionsContext
Provides lap logging and driver actions.

```javascript
const SessionActionsContext = createContext({
  onLogLap: (driverId) => {},
  onInvalidateLap: (driverId) => {},
  onTogglePit: (driverId) => {},
});
```

### Key Components

#### ControlPanel (`src/views/ControlPanel.jsx`)
**Purpose**: Primary race control interface for marshals.

**Features**:
- Race timer control (start, pause, resume, reset, finish)
- Procedure phase management (setup → warmup → grid → race)
- Driver timing panels with hotkey support
- Announcements and track status
- Pit stop tracking
- Lap invalidation

**Race Start Workflow**:
1. Set procedure phase to "Grid"
2. Check "Grid Ready" confirmation
3. Click "Start Race" button
4. All driver lap timers auto-armed synchronously
5. Race clock begins ticking

**Lap Logging**:
- Hotkeys (1-0 keys) for drivers 1-10
- Click driver panel to log lap
- Timers ONLY armed on race start (no manual arming)
- Armed start times stored in localStorage
- Pause/resume adjusts armed times automatically

**Timer Persistence**:
- Armed start times survive page refresh
- Client-side timer ticks independently (250ms interval)
- Syncs with database race_time_ms as source of truth

#### LiveTimingBoard (`src/components/LiveTimingBoard.jsx`)
**Purpose**: Public-facing live timing display.

**Features**:
- Real-time driver standings
- Current lap times (ticking)
- Best lap, last lap, pit counts
- Race clock display
- Session announcements
- Track status and flags

**Client-Side Timer**:
```javascript
const [displayRaceTime, setDisplayRaceTime] = useState(0);
const tickingRef = useRef(false);
const startEpochRef = useRef(null);
const baseTimeRef = useRef(0);

const computeDisplayTime = useCallback(() => {
  if (!sessionState.isTiming || sessionState.isPaused ||
      !tickingRef.current || !startEpochRef.current) {
    return baseTimeRef.current;
  }
  const now = Date.now();
  return baseTimeRef.current + (now - startEpochRef.current);
}, [sessionState.isTiming, sessionState.isPaused]);

useEffect(() => {
  const timer = setInterval(() => {
    setDisplayRaceTime(computeDisplayTime());
  }, 250);
  return () => clearInterval(timer);
}, [computeDisplayTime]);
```

#### DriverTimingPanel (`src/components/DriverTimingPanel.jsx`)
**Purpose**: Individual driver timing card.

**Displays**:
- Driver number, name, team
- Lap count badge
- Last lap time
- Best lap time
- Total laps completed
- Pit stop count
- Total time

**Interaction**:
- Click to log lap (only if race started)
- No manual lap entry form
- No manual timer arming

#### NewSession (`src/routes/NewSession.jsx`)
**Purpose**: Multi-step wizard for creating racing sessions.

**Steps**:
1. Basic Info (session name, event type)
2. Race Configuration (laps, duration)
3. Add Drivers (number, name, team)
4. Review & Create

**Key Features**:
- Drag-to-reorder drivers
- Duplicate driver validation
- Session data seeding via RPC
- Automatic session member assignment
- Error handling (critical vs non-critical)

#### DashboardPage (`src/pages/dashboard/DashboardPage.jsx`)
**Purpose**: User dashboard showing account info and quick actions.

**Sections**:
- Account tier and experience
- Wallet balance (collapsible dropdown)
- Active wagers
- Open betting markets
- Recent sessions

**Wallet UI**:
- Displays balance in top-right corner
- Click to expand dropdown menu
- Shows formatted balance ($X.XX)
- "Request Top-Up" button links to `/account/setup`

#### Markets Page (`src/pages/markets/MarketsPage.jsx`)
**Purpose**: Browse and place bets on racing markets.

**Features**:
- Filter markets by status (open, locked, settled)
- View market odds/pools
- Place wagers
- View bet history

#### Admin Panel (`src/pages/admin/AdminPanel.jsx`)
**Purpose**: Market management for administrators.

**Features**:
- Create markets for events
- Add outcomes to markets
- Lock markets (stop accepting bets)
- Settle markets (declare winner)
- Cancel markets (refund all bets)
- View market analytics

---

## API Service Layer

### Supabase Client (`src/lib/supabaseClient.js`)

**Core Functions**:

#### REST API Wrappers
```javascript
export const supabaseSelect = (table, options = {}) =>
  request(table, { ...options, method: 'GET' });

export const supabaseInsert = (table, rows, options = {}) =>
  request(table, { method: 'POST', body: rows, ...options });

export const supabaseUpdate = (table, patch, options = {}) =>
  request(table, { method: 'PATCH', body: patch, ...options });

export const supabaseDelete = (table, options = {}) =>
  request(table, { method: 'DELETE', ...options });
```

#### Realtime Subscriptions
```javascript
export const subscribeToTable = (
  { schema = 'public', table, event = '*', filter },
  callback,
  options = {}
) => {
  // Creates channel subscription
  // Implements retry logic (max 5 retries, exponential backoff)
  // Returns cleanup function
};
```

**Retry Logic**:
- Max 5 retries with exponential backoff
- Base delay: 500ms, max delay: 30s
- Auto-retry on: CHANNEL_ERROR, TIMED_OUT, CLOSED
- Logs retry attempts to console

#### Error Handling
```javascript
export const isTableMissingError = (error, table) => {
  return error.code === 'PGRST205' || error.status === 404;
};

export const isColumnMissingError = (error, column) => {
  return error.code === '42703' || error.status === 400;
};
```

### Lap Service (`src/services/laps.js`)

```javascript
export async function logLapAtomic({ sessionId, driverId, lapTimeMs }) {
  const { data, error } = await supabase.rpc('log_lap_atomic', {
    p_session_id: sessionId,
    p_driver_id: driverId,
    p_lap_time_ms: lapTimeMs,
  });
  if (error) {
    if (isMissingRpcError(error, 'log_lap_atomic')) {
      return fallbackLogLap({ sessionId, driverId, lapTimeMs });
    }
    throw error;
  }
  return data?.[0] ?? null;
}

export async function invalidateLastLap({ sessionId, driverId, mode = 'time_only' }) {
  const { data, error } = await supabase.rpc('invalidate_last_lap_atomic', {
    p_session_id: sessionId,
    p_driver_id: driverId,
    p_mode: mode,
  });
  // ... error handling and fallback
}
```

### Session Service (`src/services/sessions.js`)

```javascript
export async function seedSessionData(sessionId, { sessionState, drivers, entries, members }) {
  // Inserts session_state row
  // Inserts all drivers
  // Inserts session_entries (driver-session relationships)
  // Inserts session_members (user access)
}
```

### Market Service (`src/services/markets.js`)

```javascript
export async function settleMarket(marketId, winningOutcomeId) {
  return await supabase.rpc('settle_market_rpc', {
    p_market_id: marketId,
    p_winning_outcome_id: winningOutcomeId,
  });
}

export async function cancelMarket(marketId) {
  return await supabase.rpc('cancel_market_rpc', {
    p_market_id: marketId,
  });
}
```

---

## Key Features and Workflows

### Race Timing System

#### Race Start Sequence
1. Marshal navigates to Control Panel
2. Sets procedure phase to "Warmup" (optional)
3. Sets procedure phase to "Grid"
4. Checks "Grid Ready" confirmation checkbox
5. Clicks "Start Race" button
6. System executes `startTimer` callback:
   - Sets race clock start time
   - Arms ALL driver lap timers SYNCHRONOUSLY
   - Stores armed start time in localStorage for each driver
   - Persists to database: `procedure_phase='race'`, `is_timing=true`
7. Realtime subscription broadcasts state change to all clients
8. Remote clients receive update and arm their timers (safety net)

#### Lap Logging Flow
1. Driver crosses timing line
2. Marshal presses hotkey (1-0) or clicks driver panel
3. System checks if timer is armed:
   - If NOT armed: Shows error with current phase and instructions
   - If armed: Calculates lap time (now - armed_start)
4. Calls `log_lap_atomic` RPC with lap time
5. RPC atomically:
   - Inserts lap record
   - Updates driver.laps (+1)
   - Updates driver.last_lap_ms
   - Updates driver.best_lap_ms (if new best)
   - Updates driver.total_time_ms (+lap_time)
6. Re-arms timer with current timestamp
7. Realtime subscription broadcasts driver update to all clients

#### Pause/Resume Handling
1. Marshal clicks "Pause"
2. System records pause epoch timestamp
3. When resumed, calculates pause duration
4. Adjusts all armed driver timers by pause duration
5. Prevents lap time gaps during pause

#### Race Finish Sequence
1. Marshal clicks "Finish Race" button
2. System executes `finishRace` callback:
   - Stops race clock ticking
   - Preserves final race_time_ms
   - Clears all driver lap timers from localStorage
   - Sets `procedure_phase='setup'`, `is_timing=false`

### Betting System

#### Market Creation Flow (Admin)
1. Admin navigates to Admin Panel
2. Clicks "Create Market"
3. Selects event
4. Enters market name and type
5. Adds outcomes (e.g., "Driver 1", "Driver 2", "Driver 3")
6. Sets rake percentage (default 5%)
7. Optionally sets close time
8. System creates market with status='open'

#### Placing a Wager Flow
1. User navigates to Markets page
2. Views open markets
3. Selects outcome to bet on
4. Enters stake amount
5. System validates:
   - Market is open
   - User has sufficient balance
   - Stake > 0
6. Creates wager record with status='pending'
7. Deducts stake from user's wallet
8. Logs transaction (kind='wager')

#### Market Settlement Flow (Admin)
1. Race completes
2. Admin navigates to Admin Panel
3. Finds market to settle
4. Selects winning outcome
5. Clicks "Settle Market"
6. System calls `settle_market_rpc`:
   - Updates market status='settled'
   - Calculates total pool
   - Deducts rake
   - Calculates winning pool share per winning wager
   - Updates all wager statuses (won/lost)
   - Credits payouts to winning users' wallets
   - Logs payout transactions
   - Logs admin action

#### Market Cancellation Flow (Admin)
1. Admin decides to cancel market
2. Clicks "Cancel Market"
3. System calls `cancel_market_rpc`:
   - Updates market status='cancelled'
   - Refunds all wagers
   - Credits stakes back to users' wallets
   - Logs refund transactions
   - Logs admin action

### User Account Management

#### Registration
1. User visits app
2. Clicks "Sign Up"
3. Enters email and password
4. Supabase Auth creates user account
5. Trigger automatically creates profile row
6. Trigger creates wallet_accounts row with balance=0

#### Wallet Top-Up Request
1. User clicks wallet dropdown
2. Clicks "Request Top-Up"
3. Navigates to Account Setup page
4. Submits top-up request (amount, payment method)
5. Admin reviews and approves/rejects

#### Role Assignment
Roles: spectator (default), driver, marshal, admin

**Spectator**: Can view live timing, browse markets, place bets
**Driver**: Can view their assigned driver stats
**Marshal**: Can control race timing, manage sessions
**Admin**: Full access + market management

---

## Real-Time Architecture

### Subscription Patterns

#### Session State Subscription (Control Panel)
```javascript
useEffect(() => {
  const channel = supabase
    .channel(`control-panel-session-${sessionId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'session_state',
      filter: `session_id=eq.${sessionId}`,
    }, (payload) => {
      if (payload?.new) applySessionStateRow(payload.new);
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}, [sessionId]);
```

#### Drivers Subscription (Live Timing Board)
```javascript
useEffect(() => {
  const channel = supabase
    .channel(`live-timing-drivers-${sessionId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'drivers',
      filter: `session_id=eq.${sessionId}`,
    }, (payload) => {
      if (payload.eventType === 'UPDATE' && payload.new) {
        setDrivers(prev => prev.map(d =>
          d.id === payload.new.id ? payload.new : d
        ));
      }
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}, [sessionId]);
```

#### Markets Subscription
```javascript
const cleanup = subscribeToTable(
  { schema: 'public', table: 'markets', event: 'UPDATE' },
  (payload) => {
    if (payload?.new) {
      setMarkets(prev => prev.map(m =>
        m.id === payload.new.id ? payload.new : m
      ));
    }
  }
);
```

### Broadcast Pattern
Custom realtime broadcast for session rooms:

```sql
CREATE FUNCTION room_messages_broadcast_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime'
AS $$
  DECLARE sid TEXT;
  BEGIN
    sid := COALESCE(
      (to_jsonb(NEW)->>'session_id'),
      (to_jsonb(OLD)->>'session_id'),
      (to_jsonb(NEW)->>'id'),
      (to_jsonb(OLD)->>'id')
    );

    PERFORM realtime.broadcast_changes(
      'room:' || sid,
      TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA,
      NEW, OLD
    );

    RETURN COALESCE(NEW, OLD);
  END;
$$;
```

---

## Security Model

### Authentication

**Supabase Auth** handles user authentication:
- Email/password authentication
- Session management (JWT tokens)
- Persistent sessions (localStorage)
- Auto token refresh

**Admin Authentication**:
- Separate username/password in `admin_credentials` table
- Password hashed with bcrypt
- Not using Supabase Auth (custom implementation)

### Authorization

**Row-Level Security (RLS)**:
- All tables have RLS enabled
- Policies enforce access control at database level
- Admin role bypasses most restrictions
- Session members can only access their assigned sessions

**Key Security Functions**:
- `is_admin()` - Checks if user has admin role
- `session_has_access(session_id)` - Checks session membership
- `session_state_has_access(session_id)` - Wrapper for state table

**Security Best Practices**:
- All SECURITY DEFINER functions have immutable search_path
- Prevents search_path manipulation attacks
- Functions validate inputs before execution
- Atomic operations prevent race conditions

### Data Validation

**Client-Side**:
- React form validation
- Type checking with PropTypes
- Input sanitization

**Server-Side** (Database):
- CHECK constraints on tables
- NOT NULL constraints
- UNIQUE constraints
- Foreign key constraints
- RPC parameter validation

---

## Deployment

### Environment Variables

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional
VITE_SENTRY_DSN=your-sentry-dsn
```

### Build Configuration

**Vite Config** (`vite.config.js`):
```javascript
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

### Deployment Steps

1. **Build Frontend**:
   ```bash
   npm run build
   ```

2. **Deploy to Vercel/Netlify**:
   - Connect GitHub repository
   - Set environment variables
   - Deploy from `main` branch
   - Build command: `npm run build`
   - Output directory: `dist`

3. **Database Migrations**:
   ```bash
   # Using Supabase CLI
   supabase db push

   # Or via Supabase Dashboard
   # Paste migration SQL in SQL Editor
   ```

4. **Configure Supabase**:
   - Set up authentication providers
   - Configure storage buckets
   - Enable realtime for required tables
   - Set up database backups

---

## Testing

### Test Structure

```
tests/
├── control/
│   └── DriverTimingPanel.test.jsx
├── sessions/
│   └── sessionSeeding.test.js
└── markets/
    └── marketSettlement.test.js
```

### Key Test Cases

**Driver Timing Panel**:
- Renders driver information correctly
- Displays metrics (laps, best lap, last lap)
- Handles lap logging clicks
- Respects canWrite permission

**Session Seeding**:
- Creates session_state row
- Creates driver rows with correct data
- Creates session_entries relationships
- Creates session_members access records
- Handles errors gracefully

**Market Settlement**:
- Calculates correct payouts
- Handles rake deduction
- Updates wager statuses
- Credits winning users
- Logs transactions properly

---

## Known Issues and Limitations

### Missing Table Definitions
The following tables exist in production but lack CREATE TABLE migrations:
- `drivers_marshal_map`
- `session_entries`
- `teams`

**Impact**: Fresh database setup will fail if migrations reference these tables.
**Workaround**: RLS policy migrations for these tables have been removed from repo.
**Future Fix**: Create proper migration files with table definitions.

### Timing Synchronization
Client-side timers may drift slightly from server time over long races.
**Mitigation**: Timer resyncs on every database state update.

### Realtime Connection Loss
If WebSocket connection drops, client must refresh to reconnect.
**Mitigation**: Retry logic with exponential backoff (max 5 retries).

### Race Condition in Lap Logging
Multiple rapid hotkey presses could cause race conditions.
**Mitigation**: `log_lap_atomic` uses row-level locks (`FOR UPDATE`).

---

## Future Enhancements

### Planned Features
1. **Automatic Lap Detection**: Transponder integration for automatic timing
2. **Live Video Streaming**: Embed video feed in Live Timing Board
3. **Mobile App**: React Native app for iOS/Android
4. **Advanced Analytics**: Race pace analysis, sector times
5. **Team Management**: Team dashboards, driver assignments
6. **Multi-Event Support**: Tournament brackets, championship standings
7. **Social Features**: Comments, reactions, driver profiles
8. **Payment Integration**: Stripe/PayPal for wallet top-ups
9. **Notifications**: Push notifications for race events, bet results

### Technical Improvements
1. **Offline Support**: Service worker for offline lap logging
2. **Performance Optimization**: Virtual scrolling for large driver lists
3. **Error Recovery**: Automatic retry for failed database operations
4. **Telemetry**: Better error tracking with Sentry
5. **E2E Testing**: Playwright tests for critical workflows
6. **API Documentation**: OpenAPI spec for public APIs
7. **Component Library**: Storybook for UI components

---

## Appendix

### Glossary

**Lap**: One complete circuit of the track
**Best Lap**: Fastest lap time for a driver in a session
**Last Lap**: Most recent lap time recorded
**Total Time**: Sum of all lap times (cumulative race time)
**Pit Stop**: Driver stops in pit lane (not timed)
**Invalidated Lap**: Lap marked invalid (penalty, track limits)
**DNF**: Did Not Finish
**DNS**: Did Not Start
**Pole Position**: Starting position #1 (fastest qualifier)
**Rake**: House commission on betting pools (default 5%)
**Outcome**: Possible result in a betting market
**Wager**: Individual bet placed by a user
**Stake**: Amount bet on an outcome

### Time Format Utilities

```javascript
// src/utils/time.js
export function formatLapTime(ms) {
  if (ms === null || ms === undefined || ms < 0) {
    return '--:--.---';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

export function parseLapInput(input) {
  // Parses formats: "1:23.456", "83.456", "1:23.4", etc.
  // Returns milliseconds or null if invalid
}
```

### Hotkey Configuration

Default hotkeys: 1, 2, 3, 4, 5, 6, 7, 8, 9, 0 (for drivers 1-10)
Modifier keys:
- **Shift + hotkey**: Toggle pit complete status
- **Alt + hotkey**: Invalidate last lap (time_only mode)

Hotkeys stored in localStorage:
```json
{
  "keys": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  "pitModifier": "Shift",
  "invalidateModifier": "Alt"
}
```

### Migration Naming Convention

Format: `YYYYMMDDHHMMSS_descriptive_name.sql`

Examples:
- `20250107_log_lap_atomic.sql`
- `20250108_invalidate_last_lap_atomic.sql`
- `20251106073027_fix_session_state_has_access_search_path.sql`

### Database Indexes

Recommended indexes for performance:
```sql
CREATE INDEX idx_laps_session_driver ON laps(session_id, driver_id);
CREATE INDEX idx_laps_recorded_at ON laps(recorded_at DESC);
CREATE INDEX idx_drivers_session ON drivers(session_id);
CREATE INDEX idx_wagers_user ON wagers(user_id);
CREATE INDEX idx_wagers_market ON wagers(market_id);
CREATE INDEX idx_wallet_transactions_user ON wallet_transactions(user_id);
```

---

## Contact and Support

**Project Repository**: https://github.com/heyfinlay/TimeKeeperDPGP
**Documentation**: This file
**Issue Tracker**: GitHub Issues

---

**Document Version**: 1.0
**Last Updated**: November 6, 2025
**Generated by**: Claude Code
**License**: Proprietary
