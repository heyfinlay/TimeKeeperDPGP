# Settlement Approval System - Implementation Guide

## Overview

This guide documents the new **Settlement Approval System** that has been implemented to prevent conflicts between the timing system and betting markets. The system adds a critical manual verification step before market settlements are executed, ensuring that race results match the proposed winning outcomes before releasing payouts.

## Problem Solved

### Critical Issues Fixed

1. **Session Creation Error (Error 42P10)**
   - **Cause**: Missing unique constraint on `session_members(session_id, user_id)`
   - **Fix**: Migration `20251112_fix_session_constraints.sql` ensures the constraint exists
   - **Impact**: Session wizard now completes successfully

2. **Wagers Foreign Key Error**
   - **Cause**: Frontend query tried to join `wagers` → `profiles` using wrong FK hint
   - **Fix**: Updated `LiveBetsFeed.jsx` to use correct relationship path
   - **Impact**: Live bets feed now loads correctly

3. **Realtime Subscription Churn**
   - **Cause**: Unstable dependency array causing subscriptions to reconnect repeatedly
   - **Fix**: Used `useRef` to stabilize the callback in `useMarketWagers.js`
   - **Impact**: Reduced network overhead and console spam

4. **No Manual Approval for Market Settlement**
   - **Cause**: `settle_market()` executed immediately without verification
   - **Fix**: Added `pending_settlements` workflow with approval requirement
   - **Impact**: Admins now verify results before payouts

---

## New Settlement Workflow

### Before (Dangerous)

```
Race Ends → Admin Calls settle_market() → Immediate Payout
```

**Problem**: No verification that the winning outcome matches actual race results!

### After (Safe)

```
Race Ends
  ↓
Auto-Propose Settlement (with timing snapshot)
  ↓
Admin Reviews Proposal
  ↓
Verify Timing Data Matches Outcome
  ↓
Approve Settlement
  ↓
Execute Payout
```

**Protection**: Requires explicit admin verification at every step.

---

## Database Changes

### New Tables

#### `pending_settlements`

Tracks market settlements awaiting admin approval.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `market_id` | uuid | Market to be settled |
| `session_id` | uuid | Associated session (optional) |
| `proposed_outcome_id` | uuid | Proposed winning outcome |
| `proposed_by` | uuid | User who proposed |
| `timing_data` | jsonb | Snapshot of driver lap times |
| `notes` | text | Explanation for proposal |
| `status` | text | `pending`, `approved`, `rejected`, `cancelled` |
| `created_at` | timestamptz | When proposed |
| `reviewed_at` | timestamptz | When reviewed |
| `reviewed_by` | uuid | Admin who reviewed |
| `rejection_reason` | text | Why rejected (if applicable) |

**Constraint**: Only one pending settlement per market at a time.

### New Functions

#### `propose_settlement(market_id, outcome_id, timing_data, notes)`

Creates a settlement proposal for admin review.

**Parameters**:
- `p_market_id`: UUID of the market
- `p_proposed_outcome_id`: UUID of the proposed winning outcome
- `p_timing_data`: JSONB snapshot of timing results (optional)
- `p_notes`: Text notes explaining the proposal (optional)

**Returns**: Settlement ID

**Example**:
```sql
SELECT propose_settlement(
  '123e4567-e89b-12d3-a456-426614174000',
  '789e4567-e89b-12d3-a456-426614174000',
  '[{"driver_id": "...", "laps": 50, "total_time_ms": 123456}]'::jsonb,
  'Winner based on most laps completed'
);
```

#### `approve_settlement(settlement_id, payout_policy)`

Approves a pending settlement and executes it immediately.

**Parameters**:
- `p_settlement_id`: UUID of the pending settlement
- `p_payout_policy`: `'refund_if_empty'` or `'house_takes_all'`

**Returns**: JSONB with settlement details

**Example**:
```sql
SELECT approve_settlement(
  '456e4567-e89b-12d3-a456-426614174000',
  'refund_if_empty'
);
```

#### `reject_settlement(settlement_id, reason)`

Rejects a pending settlement with a reason.

**Parameters**:
- `p_settlement_id`: UUID of the pending settlement
- `p_rejection_reason`: Text explaining why rejected

**Example**:
```sql
SELECT reject_settlement(
  '456e4567-e89b-12d3-a456-426614174000',
  'Timing data shows different winner'
);
```

#### `validate_settlement_approval(market_id, outcome_id)`

Checks if a market settlement has been approved.

**Returns**: Boolean

### New Views

#### `pending_settlements_with_context`

Combines pending settlements with full context (market name, driver info, session details, wager stats).

**Columns**:
- All `pending_settlements` fields
- Market details (name, status, type)
- Outcome details (label, driver)
- Session details (name, status)
- Wager stats (total pool, winning pool, wager count)
- Proposer and reviewer names

---

## Frontend Components

### `SettlementApprovalQueue.jsx`

Admin component for reviewing and approving pending settlements.

**Location**: `src/components/admin/SettlementApprovalQueue.jsx`

**Features**:
- Lists all pending settlements
- Displays timing data snapshot
- Shows pool statistics and payout multipliers
- Approve/Reject actions
- Real-time updates (polls every 10 seconds)

**Usage**:
```jsx
import SettlementApprovalQueue from '@/components/admin/SettlementApprovalQueue';

// In your admin dashboard
<SettlementApprovalQueue />
```

### Updated Service Functions

**Location**: `src/services/admin.js`

New functions added:
- `fetchPendingSettlements()` - Get all pending settlements
- `proposeSettlement({ marketId, outcomeId, timingData, notes })` - Create proposal
- `approveSettlement({ settlementId, payoutPolicy })` - Approve and execute
- `rejectSettlement({ settlementId, reason })` - Reject with reason

---

## Auto-Proposal Trigger

When a session status changes to `'completed'`, the system automatically:

1. Finds all open `race_outcome` markets for that session
2. Determines the winner from timing data (most laps, then best time)
3. Creates a pending settlement with timing snapshot
4. **DOES NOT execute settlement** - waits for admin approval

**Trigger**: `auto_propose_settlement_trigger` on `sessions.status` update

---

## Migration Files

Run these migrations in order:

1. **`20251112_fix_session_constraints.sql`**
   - Fixes the session creation bug (Error 42P10)
   - Ensures `session_members` has proper unique constraint

2. **`20251112_add_settlement_approval.sql`**
   - Creates `pending_settlements` table
   - Adds proposal/approve/reject functions
   - Creates auto-proposal trigger
   - Sets up RLS policies

3. **`20251112_add_settlement_validation_option.sql`**
   - Adds `requires_approval` column to `markets`
   - Creates validation wrapper functions
   - Adds `pending_settlements_with_context` view

4. **`20251112_add_outcome_abbreviation.sql`** (already exists)
   - Adds `abbreviation` column to `outcomes` for compact UI display

---

## How to Use the New System

### For Admins

#### 1. When a Race Completes

After the race ends and you mark the session as `'completed'`:

```javascript
// Session status update triggers auto-proposal
await updateSessionState(sessionId, { status: 'completed' });
```

The system will automatically create pending settlements for all open race markets.

#### 2. Review Pending Settlements

Navigate to the admin dashboard and add the `SettlementApprovalQueue` component:

```jsx
import SettlementApprovalQueue from '@/components/admin/SettlementApprovalQueue';

function AdminDashboard() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      <SettlementApprovalQueue />
    </div>
  );
}
```

#### 3. Verify Results

For each pending settlement:

1. **Check the proposed winner** against actual race results
2. **Review the timing data table** showing:
   - Final positions
   - Lap counts
   - Best lap times
   - Total times
3. **Verify the winner matches** the outcome with the most laps/best time
4. **Review pool statistics** to understand payout impact

#### 4. Approve or Reject

- **Approve**: Click "Approve & Execute" to settle the market and release payouts
- **Reject**: Click "Reject" and provide a reason if the winner doesn't match

### For Developers

#### Manual Proposal (Alternative to Auto-Trigger)

```javascript
import { proposeSettlement } from '@/services/admin';

// Get timing data from your timing system
const timingData = drivers.map(d => ({
  driver_id: d.id,
  driver_name: d.name,
  driver_number: d.number,
  laps: d.laps,
  total_time_ms: d.total_time_ms,
  best_lap_ms: d.best_lap_ms,
}));

// Propose settlement
const settlementId = await proposeSettlement({
  marketId: 'market-uuid',
  outcomeId: 'winning-outcome-uuid',
  timingData,
  notes: 'Winner determined by most laps completed',
});
```

#### Approve Settlement

```javascript
import { approveSettlement } from '@/services/admin';

await approveSettlement({
  settlementId: 'settlement-uuid',
  payoutPolicy: 'refund_if_empty', // or 'house_takes_all'
});
```

#### Reject Settlement

```javascript
import { rejectSettlement } from '@/services/admin';

await rejectSettlement({
  settlementId: 'settlement-uuid',
  reason: 'Timing data shows #23 won, not #45',
});
```

---

## Configuration

### Market Approval Requirement

By default, all markets now require approval (`requires_approval = true`).

To disable approval for specific markets:

```sql
UPDATE public.markets
SET requires_approval = false
WHERE id = 'market-uuid';
```

**Use Case**: For non-race markets (e.g., "Will it rain?") where manual verification isn't needed.

### Bypass Approval (Use with Caution)

To settle a market without approval:

```sql
-- This bypasses the approval check
SELECT settle_market(
  'market-uuid',
  'winning-outcome-uuid',
  'refund_if_empty'
);
```

**Warning**: Only use for emergency situations or markets that don't require approval.

---

## Testing Checklist

- [ ] Run all migrations in order
- [ ] Create a test session with the wizard
- [ ] Verify session creation completes without Error 42P10
- [ ] Add drivers and marshals to the session
- [ ] Create a race outcome market for the session
- [ ] Place test wagers on different outcomes
- [ ] Complete the session (mark as `'completed'`)
- [ ] Verify pending settlement was auto-created
- [ ] Check timing data snapshot in settlement
- [ ] Approve the settlement via admin UI
- [ ] Verify payouts were distributed correctly
- [ ] Check wager statuses updated to `'won'`/`'lost'`
- [ ] Verify market status is `'settled'`
- [ ] Check `market_settlements` audit log

---

## Rollback Plan

If you need to revert these changes:

1. **Remove the trigger**:
```sql
DROP TRIGGER IF EXISTS auto_propose_settlement_trigger ON public.sessions;
DROP FUNCTION IF EXISTS public.auto_propose_settlement_on_session_complete();
```

2. **Disable approval requirement**:
```sql
UPDATE public.markets SET requires_approval = false;
```

3. **Continue using old workflow**:
```javascript
// Directly call settle_market (no approval needed)
await supabase.rpc('settle_market', {
  p_market_id: marketId,
  p_winning_outcome_id: outcomeId,
  p_payout_policy: 'refund_if_empty',
});
```

---

## Future Enhancements

### Recommended Additions

1. **Webhook Notifications**
   - Notify admins when settlements need approval
   - Send confirmation when settlements are executed

2. **Audit Dashboard**
   - View settlement history
   - Track approval/rejection rates
   - Monitor settlement times

3. **Automated Validation**
   - Cross-check proposed outcomes against timing data
   - Flag discrepancies automatically
   - Only require manual review for flagged settlements

4. **Multi-Admin Approval**
   - Require 2+ admins to approve large payouts
   - Implement approval thresholds based on pool size

5. **Session Wizard Enhancements**
   - Add betting configuration step
   - Set market creation preferences
   - Configure rake and betting windows
   - Auto-create markets when session starts

---

## Support & Troubleshooting

### Common Issues

#### Settlement Won't Approve

**Error**: `Settlement not approved. Market requires approval via pending_settlements.`

**Solution**: Make sure you're calling `approve_settlement()` first, not `settle_market()` directly.

#### No Pending Settlements After Race

**Possible Causes**:
1. Session status wasn't set to `'completed'`
2. Market was already closed/settled
3. Trigger didn't fire (check logs)

**Check**:
```sql
SELECT * FROM pending_settlements WHERE session_id = 'your-session-id';
```

#### Timing Data Not Showing

**Cause**: `timing_data` field is NULL in the proposal.

**Solution**: Make sure timing data is being passed when proposing settlement:

```javascript
const timingData = /* get from drivers table */;
await proposeSettlement({ marketId, outcomeId, timingData });
```

---

## Contact

For questions or issues:
- Check application logs for detailed error messages
- Review Supabase database logs for function errors
- Consult the investigation report in the codebase

---

**Last Updated**: 2025-11-12
**Version**: 1.0.0
