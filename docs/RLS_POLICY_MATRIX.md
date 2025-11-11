# RLS Policy Matrix

This document provides a complete matrix of Row-Level Security (RLS) policies for all tables in the Diamond Sports Book application.

## Table of Contents
1. [Overview](#overview)
2. [Policy Matrix](#policy-matrix)
3. [Helper Functions](#helper-functions)
4. [Attack Paths Blocked](#attack-paths-blocked)
5. [Testing Policies](#testing-policies)

---

## Overview

All tables in the `public` schema have RLS enabled. Policies use the following helper functions:
- `auth.uid()` - Returns the current authenticated user's ID
- `public.is_admin()` - Returns true if current user is an admin
- `public.session_has_access(uuid)` - Returns true if user can access the specified session

### Policy Types
- **SELECT**: Who can read rows
- **INSERT**: Who can create rows
- **UPDATE**: Who can modify rows
- **DELETE**: Who can remove rows

---

## Policy Matrix

### Core Tables

#### `profiles`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `profiles_viewable_by_all` | authenticated | `true` (all can view) |
| INSERT | `profiles_insertable_by_owner` | authenticated | `id = auth.uid()` |
| UPDATE | `profiles_updatable_by_owner` | authenticated | `id = auth.uid()` |
| UPDATE | `profiles_updatable_by_admin` | authenticated | `public.is_admin()` |
| DELETE | `profiles_deletable_by_owner` | authenticated | `id = auth.uid()` |

**Purpose**: Users can view all profiles, modify their own, admins can modify any

---

#### `sessions`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `sessions_select_policy` | authenticated | `is_public = true OR created_by = auth.uid() OR public.is_admin() OR EXISTS (session_members match)` |
| INSERT | `sessions_insert_policy` | authenticated | `created_by = auth.uid() OR public.is_admin()` |
| UPDATE | `sessions_update_policy` | authenticated | `created_by = auth.uid() OR public.is_admin()` |
| DELETE | `sessions_delete_policy` | authenticated | `created_by = auth.uid() OR public.is_admin()` |

**Purpose**: Users can see public sessions or sessions they created/joined; only creators and admins can modify

---

#### `session_members`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `session_members_select_policy` | authenticated | `user_id = auth.uid() OR public.is_admin() OR public.session_has_access(session_id)` |
| INSERT | `session_members_insert_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |
| DELETE | `session_members_delete_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |

**Purpose**: Users can see members of sessions they belong to; can add/remove themselves; admins have full control

---

#### `drivers`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `drivers_select_policy` | authenticated | `public.session_has_access(session_id)` |
| INSERT | `drivers_insert_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| UPDATE | `drivers_update_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| DELETE | `drivers_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: Anyone with session access can view drivers; session members and admins can modify; only admins can delete

---

#### `laps`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `laps_select_policy` | authenticated | `public.session_has_access(session_id)` |
| INSERT | `laps_insert_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| UPDATE | `laps_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `laps_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: Session members can view and add laps; only admins can modify/delete (integrity)

---

### Betting Tables

#### `events`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `events_select_policy` | authenticated | `true` (public) |
| INSERT | `events_insert_policy` | authenticated | `public.is_admin()` |
| UPDATE | `events_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `events_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: All users can view events; only admins can create/modify

---

#### `markets`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `markets_select_policy` | authenticated | `true` (public) |
| INSERT | `markets_insert_policy` | authenticated | `public.is_admin()` |
| UPDATE | `markets_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `markets_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: All users can view markets; only admins can create/modify

---

#### `outcomes`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `outcomes_select_policy` | authenticated | `true` (public) |
| INSERT | `outcomes_insert_policy` | authenticated | `public.is_admin()` |
| UPDATE | `outcomes_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `outcomes_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: All users can view outcomes; only admins can create/modify

---

#### `wagers`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `wagers_select_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |
| INSERT | `wagers_insert_policy` | authenticated | `user_id = auth.uid()` |
| UPDATE | `wagers_update_policy` | authenticated | `public.is_admin()` (status changes only) |
| DELETE | `wagers_delete_policy` | authenticated | `false` (never allowed) |

**Purpose**: Users can only see their own wagers; insertion via RPC only; no manual deletion

---

#### `wallet_accounts`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `wallet_accounts_select_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |
| INSERT | `wallet_accounts_insert_policy` | authenticated | `user_id = auth.uid()` (auto-created by system) |
| UPDATE | `wallet_accounts_update_policy` | authenticated | `false` (RPC only) |
| DELETE | `wallet_accounts_delete_policy` | authenticated | `false` (never) |

**Purpose**: Users can view own balance; modifications via RPC only (audit trail)

---

#### `wallet_transactions`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `wallet_transactions_select_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |
| INSERT | `wallet_transactions_insert_policy` | authenticated | `false` (RPC only) |
| UPDATE | `wallet_transactions_update_policy` | authenticated | `false` (immutable) |
| DELETE | `wallet_transactions_delete_policy` | authenticated | `false` (immutable) |

**Purpose**: Append-only ledger; users view own history; admins view all; modifications via RPC only

---

### Race Control Tables

#### `penalties`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `penalties_select_policy` | authenticated | `public.session_has_access(session_id)` |
| INSERT | `penalties_insert_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| UPDATE | `penalties_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `penalties_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: Session members can view and add penalties; only admins can modify/delete

---

#### `pit_events`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `pit_events_select_policy` | authenticated | `public.session_has_access(session_id)` |
| INSERT | `pit_events_insert_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| UPDATE | `pit_events_update_policy` | authenticated | `public.is_admin()` |
| DELETE | `pit_events_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: Session members can view and log pit stops; only admins can modify/delete

---

#### `control_logs`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `control_logs_select_policy` | authenticated | `public.session_has_access(session_id)` |
| INSERT | `control_logs_insert_policy` | authenticated | `public.is_admin() OR public.session_has_access(session_id)` |
| UPDATE | `control_logs_update_policy` | authenticated | `false` (immutable) |
| DELETE | `control_logs_delete_policy` | authenticated | `public.is_admin()` |

**Purpose**: Append-only race control log; session members can view and add; only admins can delete

---

### Admin Tables

#### `admin_actions_log`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `admin_actions_log_admin_only` | authenticated | `public.is_admin()` |
| INSERT | `admin_actions_log_insert` | authenticated | `false` (RPC only) |
| UPDATE | `admin_actions_log_update` | authenticated | `false` (immutable) |
| DELETE | `admin_actions_log_delete` | authenticated | `false` (immutable) |

**Purpose**: Admin action audit log; only admins can view; append-only via RPC

---

#### `admin_credentials` (DEPRECATED)
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `admin_credentials_read_only_for_admins` | authenticated | `public.is_admin()` |
| INSERT | `admin_credentials_no_inserts` | authenticated | `false` |
| UPDATE | `admin_credentials_no_updates` | authenticated | `false` |
| DELETE | `admin_credentials_no_deletes` | authenticated | `false` |

**Purpose**: Deprecated table; read-only for historical reference; no modifications allowed

---

### Communication Tables

#### `room_messages`
| Operation | Policy Name | Who | Condition |
|-----------|-------------|-----|-----------|
| SELECT | `room_messages_select_policy` | authenticated | `true` (public rooms) OR (room visibility check) |
| INSERT | `room_messages_insert_policy` | authenticated | `user_id = auth.uid()` |
| UPDATE | `room_messages_update_policy` | authenticated | `user_id = auth.uid()` (own messages) |
| DELETE | `room_messages_delete_policy` | authenticated | `user_id = auth.uid() OR public.is_admin()` |

**Purpose**: Users can send messages, edit/delete own; admins can delete any

---

## Helper Functions

### `public.is_admin()`
```sql
CREATE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;
```

**Purpose**: Central admin check; returns true if current user has admin role

---

### `public.session_has_access(uuid)`
```sql
CREATE FUNCTION public.session_has_access(target_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT
    public.is_admin()
    OR (
      target_session_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.sessions s
          WHERE s.id = target_session_id
            AND (s.created_by = auth.uid() OR s.is_public = true)
        )
        OR EXISTS (
          SELECT 1 FROM public.session_members sm
          WHERE sm.session_id = target_session_id
            AND sm.user_id = auth.uid()
        )
      )
    );
$$;
```

**Purpose**: Returns true if user is admin, session creator, member, or session is public

---

## Attack Paths Blocked

### 1. Unauthorized Wager Viewing
**Attack**: User tries to view another user's wagers to infer betting patterns

```sql
-- Attempt to view all wagers
SELECT * FROM wagers;

-- Result: Only returns wagers WHERE user_id = auth.uid()
```

**Blocked By**: `wagers_select_policy`

---

### 2. Inferring Private Session Members
**Attack**: Non-member tries to query session members to learn who's in a private session

```sql
-- Attempt to view members of session user doesn't belong to
SELECT * FROM session_members WHERE session_id = 'private-session-uuid';

-- Result: Empty (no rows visible)
```

**Blocked By**: `session_members_select_policy`

---

### 3. Balance Manipulation
**Attack**: User tries to directly UPDATE wallet balance

```sql
-- Attempt to increase balance
UPDATE wallet_accounts SET balance = 999999 WHERE user_id = auth.uid();

-- Result: ERROR - RLS policy blocks UPDATE
```

**Blocked By**: `wallet_accounts_update_policy` (returns `false`)

**Correct Method**: Use `place_wager()` RPC with proper validation

---

### 4. Transaction History Tampering
**Attack**: User tries to DELETE or UPDATE wallet transactions

```sql
-- Attempt to delete wager transaction
DELETE FROM wallet_transactions WHERE user_id = auth.uid();

-- Result: ERROR - RLS policy blocks DELETE
```

**Blocked By**: `wallet_transactions_delete_policy` (returns `false`)

---

### 5. Market Result Manipulation
**Attack**: Non-admin tries to settle market with fake winning outcome

```sql
-- Attempt to settle market as regular user
UPDATE markets SET status = 'settled' WHERE id = 'market-uuid';

-- Result: ERROR - RLS policy blocks UPDATE (admin only)
```

**Blocked By**: `markets_update_policy`

**Correct Method**: Admin calls `settle_market()` RPC

---

### 6. Wager After Market Close
**Attack**: User modifies closes_at or tries to INSERT wager directly

```sql
-- Attempt to insert wager after close
INSERT INTO wagers (user_id, market_id, outcome_id, stake, status)
VALUES (auth.uid(), 'closed-market', 'outcome', 1000, 'pending');

-- Result: ERROR - RLS allows INSERT but RPC validation rejects
```

**Blocked By**: `place_wager()` RPC validates `closes_at <= now()`

---

## Testing Policies

### Test Setup

```sql
-- Create test users
INSERT INTO auth.users (id, email) VALUES
  ('user-1', 'user1@example.com'),
  ('user-2', 'user2@example.com'),
  ('admin-1', 'admin@example.com');

INSERT INTO public.profiles (id, role) VALUES
  ('user-1', 'user'),
  ('user-2', 'user'),
  ('admin-1', 'admin');

-- Create test session
INSERT INTO public.sessions (id, created_by, is_public) VALUES
  ('session-1', 'user-1', false);

INSERT INTO public.session_members (session_id, user_id) VALUES
  ('session-1', 'user-1');
```

---

### Test Cases

#### Test 1: User Can Only See Own Wagers
```sql
-- Set context to user-1
SET LOCAL request.jwt.claims = '{"sub": "user-1"}';

-- User-1 places wager
INSERT INTO wagers (user_id, market_id, outcome_id, stake) VALUES
  ('user-1', 'market-1', 'outcome-1', 1000);

-- User-2 tries to see user-1's wagers
SET LOCAL request.jwt.claims = '{"sub": "user-2"}';
SELECT * FROM wagers WHERE user_id = 'user-1';

-- Expected: 0 rows (blocked by RLS)
```

---

#### Test 2: Session Access Control
```sql
-- User-1 (member) can see drivers
SET LOCAL request.jwt.claims = '{"sub": "user-1"}';
SELECT * FROM drivers WHERE session_id = 'session-1';
-- Expected: Success

-- User-2 (non-member) cannot see drivers
SET LOCAL request.jwt.claims = '{"sub": "user-2"}';
SELECT * FROM drivers WHERE session_id = 'session-1';
-- Expected: 0 rows (blocked by RLS)

-- Admin can see all
SET LOCAL request.jwt.claims = '{"sub": "admin-1"}';
SELECT * FROM drivers WHERE session_id = 'session-1';
-- Expected: Success
```

---

#### Test 3: Wallet Transaction Immutability
```sql
SET LOCAL request.jwt.claims = '{"sub": "user-1"}';

-- Insert transaction
INSERT INTO wallet_transactions (user_id, kind, amount) VALUES
  ('user-1', 'deposit', 5000);

-- Attempt to modify
UPDATE wallet_transactions SET amount = 10000 WHERE user_id = 'user-1';
-- Expected: 0 rows updated (policy blocks UPDATE)

-- Attempt to delete
DELETE FROM wallet_transactions WHERE user_id = 'user-1';
-- Expected: 0 rows deleted (policy blocks DELETE)
```

---

#### Test 4: Admin Override
```sql
-- Regular user cannot settle market
SET LOCAL request.jwt.claims = '{"sub": "user-1"}';
UPDATE markets SET status = 'settled' WHERE id = 'market-1';
-- Expected: 0 rows (policy blocks)

-- Admin can settle market
SET LOCAL request.jwt.claims = '{"sub": "admin-1"}';
UPDATE markets SET status = 'settled' WHERE id = 'market-1';
-- Expected: Success (or use settle_market RPC)
```

---

## Verification Queries

### List All RLS Policies
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

---

### Check If RLS Is Enabled
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected: `rowsecurity = true` for all tables

---

### Simulate User Context
```sql
-- Test as specific user
BEGIN;
  SET LOCAL role = authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "user-id-here"}';
  -- Run queries
  SELECT * FROM wagers;
ROLLBACK;
```

---

## Maintenance

### Adding a New Policy

1. **Enable RLS on table** (if new table):
   ```sql
   ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;
   ```

2. **Create policies** for each operation (SELECT, INSERT, UPDATE, DELETE):
   ```sql
   CREATE POLICY "new_table_select_policy"
     ON public.new_table
     FOR SELECT
     TO authenticated
     USING (/* condition */);
   ```

3. **Grant table access**:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.new_table TO authenticated;
   ```

4. **Test** with multiple user contexts

5. **Document** in this matrix

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2025-11-11 | Claude Code | Initial RLS policy matrix documentation |

---

## References

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [State Machines](/docs/STATE_MACHINES.md)
- [Migration: Bootstrap Access Functions](/supabase/migrations/20250106_bootstrap_access_functions.sql)
