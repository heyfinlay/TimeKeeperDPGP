# State Machines & Lifecycles

This document defines the exact state machines, valid transitions, and invariants for all stateful entities in the Diamond Sports Book application.

## Table of Contents
1. [Market Lifecycle](#market-lifecycle)
2. [Wager Lifecycle](#wager-lifecycle)
3. [Wallet Transaction Lifecycle](#wallet-transaction-lifecycle)
4. [Session Lifecycle](#session-lifecycle)
5. [Event Lifecycle](#event-lifecycle)
6. [Invariants](#invariants)

---

## Market Lifecycle

### States
```
draft → open → closed → settled
             ↓
           void (terminal)
```

### State Definitions

| State | Description | Who Can Transition | Actions Allowed |
|-------|-------------|-------------------|-----------------|
| `draft` | Market created but not accepting wagers | Admin | Edit outcomes, rake, closes_at |
| `open` | Accepting wagers | Admin (close), System (auto-close at closes_at) | place_wager |
| `closed` | No longer accepting wagers, awaiting result | Admin | settle_market, void_market |
| `settled` | Final result declared, payouts distributed | None (terminal) | View only |
| `void` | Market cancelled, all wagers refunded | None (terminal) | View only |

### Valid Transitions

```sql
-- Transition rules enforced by database triggers and RPC functions
draft → open        -- Admin: open_market()
open → closed       -- Admin: close_market() OR System: closes_at trigger
closed → settled    -- Admin: settle_market()
closed → void       -- Admin: void_market()
open → void         -- Admin: void_market() (emergency only)
draft → void        -- Admin: delete or void before opening
```

### Transition Rules

1. **draft → open**
   - Preconditions:
     - Market must have at least 2 outcomes
     - `closes_at` must be set and in the future
     - Event must be in `upcoming` or `in_progress` state
   - Actions: Set status to `open`

2. **open → closed**
   - Preconditions:
     - Current time >= `closes_at` OR admin manual close
   - Actions: Set status to `closed`, prevent new wagers
   - Trigger: Automatic at `closes_at` or admin `close_market()`

3. **closed → settled**
   - Preconditions:
     - Market must be `closed`
     - Winning outcome must be specified
   - Actions:
     - Calculate payouts
     - Update wager statuses (won/lost)
     - Credit wallet accounts
     - Record settlement audit log
     - Set status to `settled`
   - Trigger: Admin `settle_market(winning_outcome_id)`

4. **closed → void or open → void**
   - Preconditions:
     - Admin decision (e.g., event cancelled, technical issue)
   - Actions:
     - Refund all pending wagers
     - Credit wallet accounts
     - Set wager status to `refunded`
     - Set status to `void`
   - Trigger: Admin `void_market(reason)`

### Edge Cases

#### Abandoned Race
- Transition: `open` → `void`
- Action: Refund all wagers with reason "event_cancelled"

#### Photo Finish / Tie
- Two approaches:
  1. **Dead Heat**: Settle with multiple winning outcomes, split pool proportionally
  2. **Refund**: Void market and refund all wagers
- Default policy: Configurable per market type

#### Partial Refunds
- Not currently supported
- If needed in future: Add `partial_void` state with outcome-specific refunds

---

## Wager Lifecycle

### States
```
pending → won (terminal)
        → lost (terminal)
        → refunded (terminal)
```

### State Definitions

| State | Description | Wallet Impact | Can Change |
|-------|-------------|---------------|------------|
| `pending` | Wager placed, awaiting market settlement | Debit on placement | No |
| `won` | Market settled, wager won | Credit on settlement | No |
| `lost` | Market settled, wager lost | None | No |
| `refunded` | Market voided or refund issued | Credit refund amount | No |

### Valid Transitions

```sql
pending → won       -- settle_market() selects this outcome as winner
pending → lost      -- settle_market() selects different outcome as winner
pending → refunded  -- void_market() OR settle_market() with no winners and refund policy
```

### Transition Rules

1. **pending → won**
   - Trigger: `settle_market(market_id, winning_outcome_id)` where `wager.outcome_id = winning_outcome_id`
   - Actions:
     - Calculate payout: `floor((stake / winning_pool) * net_pool)`
     - Credit wallet with payout
     - Record `wallet_transactions` entry (kind='payout')
     - Set wager status to `won`

2. **pending → lost**
   - Trigger: `settle_market()` where `wager.outcome_id != winning_outcome_id`
   - Actions:
     - Set wager status to `lost`
     - No wallet credit (stake already debited at placement)

3. **pending → refunded**
   - Trigger: `void_market()` OR `settle_market()` with payout_policy='refund_if_empty' and no winners
   - Actions:
     - Credit wallet with original stake
     - Record `wallet_transactions` entry (kind='refund')
     - Set wager status to `refunded`

### Invariants

- A wager can never transition from a terminal state (won/lost/refunded)
- Sum of all payouts for a market must never exceed `net_pool` (pool - rake)
- Wager stake is always debited from wallet at placement (kind='wager')

---

## Wallet Transaction Lifecycle

Wallet transactions are **immutable** (append-only ledger).

### Transaction Kinds

| Kind | Amount | Description | Related Entity |
|------|--------|-------------|----------------|
| `deposit` | Positive | Admin deposits funds | User ID |
| `bonus` | Positive | Admin grants bonus | User ID |
| `correction` | Positive/Negative | Admin balance correction | User ID |
| `wager` | Negative | User places wager | Wager ID |
| `payout` | Positive | User wins wager | Wager ID |
| `refund` | Positive | Wager refunded | Wager ID |
| `withdrawal` | Negative | User withdraws funds | Withdrawal ID |

### Balance Calculation

```sql
-- Current balance is derived from transaction history
SELECT COALESCE(SUM(amount), 0) AS balance
FROM wallet_transactions
WHERE user_id = $1;
```

Or maintained in `wallet_accounts.balance` with triggers to keep it synchronized.

### Invariants

- Balance must never go negative (enforced by `place_wager` check)
- Every debit (`wager`, `withdrawal`) must have sufficient balance at transaction time
- Transactions are never deleted or modified (immutable log)

---

## Session Lifecycle

### States
```
created → in_progress → completed
                      → abandoned
```

### State Definitions

| State | Description | Actions Allowed |
|-------|-------------|-----------------|
| `created` | Session scheduled, not started | Edit config, add drivers |
| `in_progress` | Session actively running | Log laps, pit stops, penalties |
| `completed` | Session finished normally | View only, create markets |
| `abandoned` | Session cancelled or incomplete | View only |

### Valid Transitions

```sql
created → in_progress  -- start_session()
in_progress → completed  -- end_session()
in_progress → abandoned  -- abandon_session(reason)
created → abandoned     -- cancel_session()
```

### Session-Specific Invariants

- Only one `in_progress` session of the same type per track at a time
- Session cannot be deleted while markets reference it
- Laps cannot be added to `completed` or `abandoned` sessions

---

## Event Lifecycle

### States
```
upcoming → in_progress → completed
                       → cancelled
```

### Valid Transitions

```sql
upcoming → in_progress  -- Event starts (manual or scheduled trigger)
in_progress → completed -- Event ends successfully
in_progress → cancelled -- Event abandoned
upcoming → cancelled    -- Event cancelled before start
```

### Event-Market Relationship

- Events contain multiple markets
- All markets for an event should settle before event transitions to `completed`
- If event is cancelled → all open/closed markets transition to `void`

---

## Invariants

These rules must **always** hold true in the system:

### Financial Invariants

1. **Balance Non-Negativity**
   ```sql
   CHECK (wallet_accounts.balance >= 0)
   ```

2. **Market Pool Conservation**
   ```
   For any settled market:
   total_pool = rake_amount + total_paid + dust
   ```
   Where `dust` is rounding remainder (typically 0-10 units).

3. **No Double-Payout**
   ```
   A wager can only be paid out once (status IN ('won', 'lost', 'refunded'))
   ```

4. **Payout Never Exceeds Net Pool**
   ```
   SUM(payouts for market M) <= (total_pool - rake)
   ```

### Data Integrity Invariants

5. **Wager Belongs to Market Outcome**
   ```sql
   EXISTS (
     SELECT 1 FROM outcomes o
     WHERE o.id = wager.outcome_id
       AND o.market_id = wager.market_id
   )
   ```

6. **Market Has Valid Close Time**
   ```sql
   -- For open markets
   closes_at IS NOT NULL AND closes_at > created_at
   ```

7. **Session Members Are Unique**
   ```sql
   UNIQUE (session_id, user_id) -- enforced by constraint
   ```

8. **Only One Active Session per Track**
   ```sql
   -- Business rule enforced by application logic
   SELECT COUNT(*) FROM sessions
   WHERE status = 'in_progress' AND track_id = $1
   -- Should return <= 1
   ```

### Access Control Invariants

9. **Only Admins Can Settle Markets**
   ```sql
   -- Enforced by RLS and security definer functions
   public.is_admin() = true
   ```

10. **Users Can Only View Their Own Wagers**
    ```sql
    -- RLS policy
    wager.user_id = auth.uid() OR public.is_admin()
    ```

---

## Failure Modes & Recovery

### Market Settlement Failures

**Symptom**: Market is `closed` but not `settled` after settlement attempt

**Causes**:
- Network interruption during settlement
- Partial transaction rollback
- Admin error selecting wrong outcome

**Recovery**:
1. Check `market_settlements` table for existing settlement record
2. If record exists → settlement succeeded (idempotent)
3. If no record → safe to retry `settle_market()`
4. Settlement function is idempotent and uses row-level locks

### Wager Placement Race Condition

**Symptom**: User clicks "Place Bet" multiple times rapidly

**Prevention**:
- Use idempotency key: `place_wager(..., p_idempotency_key)`
- Client generates key: `{user_id}_{market_id}_{outcome_id}_{timestamp}`
- Duplicate keys return existing wager without double-debit

### Market Closure Race

**Symptom**: Wager placed exactly at `closes_at` time

**Behavior**:
- `place_wager()` checks `closes_at <= now()` with row lock
- If closed → reject with "Market has closed"
- If open → allow (market closes after current transaction)

---

## Testing State Transitions

### Unit Test Template

```sql
-- Test: Cannot settle a draft market
BEGIN;
  INSERT INTO markets (id, name, status) VALUES ('test-id', 'Test Market', 'draft');
  SELECT settle_market('test-id', 'outcome-id');
  -- Expected: EXCEPTION "Market must be closed"
ROLLBACK;
```

### Property-Based Tests

- **Idempotency**: Calling `settle_market()` twice with same args produces identical result
- **Conservation**: Sum of all wallet transactions for a market = 0 (or rake amount if tracking separately)
- **Terminal States**: Once `settled` or `void`, market status cannot change

---

## Diagram: Complete Market Lifecycle

```
┌─────────┐
│  DRAFT  │ (Admin creates market, adds outcomes)
└────┬────┘
     │ open_market()
     ▼
┌─────────┐
│  OPEN   │◄─────────────────────────────┐
└────┬────┘                              │
     │ closes_at OR close_market()       │ place_wager()
     ▼                                   │ (users bet)
┌─────────┐                              │
│ CLOSED  │──────────────────────────────┘
└────┬────┘
     │
     ├─── settle_market(winner) ───► SETTLED (terminal)
     │
     └─── void_market(reason) ─────► VOID (terminal)

Terminal states: No further transitions allowed
All wagers reach terminal state (won/lost/refunded) when market reaches terminal state
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2025-11-11 | Claude Code | Initial state machine documentation |

---

## References

- [Market Settlement RPC](/supabase/migrations/20251111_idempotent_settle_market.sql)
- [Wager Placement RPC](/supabase/migrations/20251111_idempotent_place_wager.sql)
- [RLS Policy Matrix](/docs/RLS_POLICY_MATRIX.md)
