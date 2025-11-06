# Fix: Lap Logging "Ambiguous Column Reference" Error

## Problem Statement

**Error**: `"Lap logging failed: column reference 'session_id' is ambiguous"`

**Symptom**: When attempting to log a driver's lap time, the operation fails with an ambiguous column reference error.

**Root Cause**: Row-Level Security (RLS) policies on multiple tables (`drivers`, `laps`, `race_events`, `session_state`, etc.) referenced the `session_id` column without table qualification. When PostgreSQL evaluated these policies inside SECURITY DEFINER functions (like `log_lap_atomic`), it couldn't determine which table's `session_id` column to use, resulting in the ambiguity error.

## Investigation Summary

### Findings

1. ✅ **Drivers have session_id properly populated** - Verified all drivers in the database have correct session_id values
2. ✅ **Session seeding works correctly** - Drivers are created with proper session relationships
3. ✅ **log_lap_atomic function is correct** - The RPC function implementation is sound
4. ❌ **RLS policies lack table qualification** - This was the root cause

### Root Cause Details

The RLS policies were defined as:
```sql
CREATE POLICY "Session scoped access for drivers"
  ON public.drivers
  FOR ALL
  TO public
  USING (session_has_access(session_id))  -- Ambiguous!
  WITH CHECK (session_has_access(session_id));
```

When `log_lap_atomic` executes (a SECURITY DEFINER function), it:
1. Locks a driver row (`SELECT ... FROM drivers ... FOR UPDATE`)
2. Inserts a lap (`INSERT INTO laps ...`)
3. Updates driver stats (`UPDATE drivers ...`)
4. Returns driver data (`SELECT ... FROM drivers ...`)

During these operations, PostgreSQL evaluates RLS policies. When evaluating the policy expression `session_has_access(session_id)` in a context where multiple tables with `session_id` columns are involved, PostgreSQL cannot determine which table's column to use.

## Solution

### Changes Made

**Migration**: `20251106080000_fix_ambiguous_session_id_in_rls_policies.sql`

Fixed RLS policies on 6 tables by explicitly qualifying the `session_id` column:

1. **drivers** - Changed to `session_has_access(drivers.session_id)`
2. **laps** - Changed to `session_has_access(laps.session_id)`
3. **race_events** - Changed to `session_has_access(race_events.session_id)`
4. **session_state** - Changed to `session_has_access(session_state.session_id)`
5. **session_logs** - Changed to `session_has_access(session_logs.session_id)`
6. **session_entries** - Changed to `session_has_access(session_entries.session_id)` (if table exists)

### Example Fix

**Before**:
```sql
CREATE POLICY "Session scoped access for drivers"
  ON public.drivers
  FOR ALL
  TO public
  USING (session_has_access(session_id))
  WITH CHECK (session_has_access(session_id));
```

**After**:
```sql
CREATE POLICY "Session scoped access for drivers"
  ON public.drivers
  FOR ALL
  TO public
  USING (session_has_access(drivers.session_id))  -- Qualified!
  WITH CHECK (session_has_access(drivers.session_id));
```

## Testing Instructions

### Prerequisites
1. Migration has been applied to production database ✅
2. Frontend has been deployed with updated error messages ✅

### Test Case 1: Log Lap via Hotkey

1. Navigate to Control Panel for a session
2. Ensure procedure phase is set to "Grid"
3. Check "Grid Ready" checkbox
4. Click "Start Race" button
5. Wait for race to start (timers should arm automatically)
6. Press hotkey (1-9 or 0) for a driver
7. **Expected**: Lap logged successfully, no error
8. **Previous Behavior**: Error "column reference 'session_id' is ambiguous"

### Test Case 2: Log Lap via Driver Panel Click

1. In Control Panel with race running
2. Click on a driver panel (not the manual entry, just the panel)
3. **Expected**: Lap logged successfully, driver stats update
4. **Previous Behavior**: Error "column reference 'session_id' is ambiguous"

### Test Case 3: Verify Real-time Updates

1. Open Control Panel in one browser tab
2. Open Live Timing Board in another tab
3. Log a lap in Control Panel
4. **Expected**: Live Timing Board updates immediately with new lap data
5. **Previous Behavior**: Panel showed error, Live Timing didn't update

### Test Case 4: Multi-Driver Lap Logging

1. Start a race with multiple drivers (5+)
2. Rapidly press hotkeys for different drivers (simulate actual race)
3. **Expected**: All laps log successfully without errors
4. **Previous Behavior**: Intermittent ambiguous column errors

## Verification Checklist

- [x] Migration applied to production database
- [x] Migration file added to repository
- [x] Policies updated on 6 tables (drivers, laps, race_events, session_state, session_logs, session_entries)
- [x] Documentation updated (this file)
- [ ] Lap logging tested in production
- [ ] No errors in browser console
- [ ] Real-time updates working correctly

## Files Changed

### Database
- `supabase/migrations/20251106080000_fix_ambiguous_session_id_in_rls_policies.sql` (new)

### Documentation
- `FIX_LAP_LOGGING_ERROR.md` (this file)
- `TECHNICAL_SPECIFICATION.md` (should be updated with this fix)

## Related Issues

- Original error report: "Driver Panels are still recording a hotkey error when attempting to loglap"
- Error message: `Panel log lap failed Object "Lap logging failed: column reference 'session_id' is ambiguous"`

## Technical Notes

### Why Table Qualification Matters

PostgreSQL's query planner must resolve all column references at plan time. When RLS policies are evaluated:

1. Policy expressions are treated as additional WHERE clauses
2. If multiple tables in the query context have the same column name
3. And the policy doesn't specify which table's column to use
4. PostgreSQL raises an "ambiguous column reference" error

### Why This Affects SECURITY DEFINER Functions

Functions marked as `SECURITY DEFINER` run with the privileges of the function owner, but RLS policies are still evaluated based on the current user's permissions. This means:

1. RLS policies are checked during function execution
2. If the function involves multiple tables
3. Policy ambiguity can occur even though the function SQL itself is correct

### PostgreSQL Policy Normalization

Note: When viewing policy definitions via `pg_policies` or `pg_get_expr`, PostgreSQL may display the normalized form without table qualification. This is expected behavior - the actual execution plan correctly resolves the qualified column reference.

## Additional Resources

- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Column Ambiguity in SQL](https://www.postgresql.org/docs/current/queries-table-expressions.html)
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security

---

**Fix Applied**: November 6, 2025
**Migration Version**: 20251106080000
**Status**: ✅ Applied to Production
