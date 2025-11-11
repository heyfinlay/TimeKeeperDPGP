# Accounting & Reconciliation Guide

This document describes the double-entry ledger model, settlement bookkeeping, rounding rules, and monthly reconciliation procedures for the Diamond Sports Book wallet system.

## Table of Contents
1. [Double-Entry Ledger Model](#double-entry-ledger-model)
2. [Wallet System Architecture](#wallet-system-architecture)
3. [Settlement Bookkeeping](#settlement-bookkeeping)
4. [Rounding & Dust Rules](#rounding--dust-rules)
5. [Monthly Reconciliation Checklist](#monthly-reconciliation-checklist)
6. [Audit Trails](#audit-trails)

---

## Double-Entry Ledger Model

The wallet system uses an **append-only transaction log** (`wallet_transactions`) with a derived balance view.

### Core Principles

1. **Immutability**: Transactions are never modified or deleted
2. **Completeness**: Every balance change is recorded as a transaction
3. **Traceability**: Each transaction links to its source (wager_id, market_id, etc.)
4. **Double-Entry**: Every debit has a corresponding credit (implicitly or explicitly)

---

### Transaction Types

| Type | Sign | Description | Meta Fields |
|------|------|-------------|-------------|
| `deposit` | + | Admin deposits funds | `admin_id`, `memo` |
| `bonus` | + | Promotional bonus | `admin_id`, `memo`, `campaign_id` |
| `correction` | +/- | Admin balance adjustment | `admin_id`, `memo`, `reason`, `old_balance`, `new_balance` |
| `wager` | - | User places bet | `market_id`, `outcome_id`, `wager_id` |
| `payout` | + | User wins bet | `market_id`, `outcome_id`, `wager_id`, `rake_bps` |
| `refund` | + | Bet refunded | `market_id`, `wager_id`, `reason` |
| `withdrawal` | - | User withdraws funds | `withdrawal_id`, `method`, `destination` |

---

### Schema

```sql
CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN ('deposit', 'bonus', 'correction', 'wager', 'payout', 'refund', 'withdrawal')),
  amount bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_amount_direction_check CHECK (
    (direction = 'debit' AND amount <= 0) OR
    (direction = 'credit' AND amount >= 0)
  )
);

CREATE TABLE wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

### Balance Calculation

**Option 1: Derived Balance** (always accurate, slower for frequent queries)
```sql
SELECT user_id, COALESCE(SUM(amount), 0) AS balance
FROM wallet_transactions
GROUP BY user_id;
```

**Option 2: Cached Balance** (fast queries, maintained by triggers)
```sql
-- wallet_accounts.balance is updated by triggers or RPCs
SELECT balance FROM wallet_accounts WHERE user_id = $1;
```

**Current Implementation**: Option 2 with manual updates in RPCs

---

## Wallet System Architecture

```
┌─────────────────┐
│  User Action    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   RPC Function  │ ◄─── Validation, Auth Check
│ (place_wager)   │
└────────┬────────┘
         │
         ├─── 1. Lock wallet_accounts row (SELECT FOR UPDATE)
         │
         ├─── 2. Check balance >= stake
         │
         ├─── 3. Debit: UPDATE wallet_accounts SET balance = balance - stake
         │
         ├─── 4. Record: INSERT INTO wallet_transactions (kind='wager', amount=-stake)
         │
         └─── 5. Create: INSERT INTO wagers (...)
                         │
                         ▼
                   Transaction Committed
                   (all or nothing)
```

---

## Settlement Bookkeeping

Market settlement creates multiple transaction entries:

### Settlement Flow

```
1. Market Closed
   └─► Admin calls settle_market(market_id, winning_outcome_id)

2. Lock All Wagers
   └─► SELECT * FROM wagers WHERE market_id = $1 AND status = 'pending' FOR UPDATE

3. Calculate Pools
   ├─► total_pool = SUM(all wagers.stake)
   ├─► winning_pool = SUM(winning wagers.stake)
   ├─► rake_amount = FLOOR(total_pool * rake_bps / 10000)
   └─► net_pool = total_pool - rake_amount

4. Distribute Payouts (FOR EACH winning wager)
   ├─► payout = FLOOR((wager.stake / winning_pool) * net_pool)
   ├─► UPDATE wallet_accounts SET balance = balance + payout
   ├─► INSERT INTO wallet_transactions (kind='payout', amount=+payout, meta=...)
   └─► UPDATE wagers SET status = 'won'

5. Mark Losing Wagers
   └─► UPDATE wagers SET status = 'lost' WHERE outcome_id != winning_outcome_id

6. Calculate Dust
   └─► dust = net_pool - SUM(payouts)

7. Record Settlement Audit
   └─► INSERT INTO market_settlements (...)

8. Update Market Status
   └─► UPDATE markets SET status = 'settled'
```

---

### Settlement Audit Record

```sql
CREATE TABLE market_settlements (
  id uuid PRIMARY KEY,
  market_id uuid NOT NULL UNIQUE REFERENCES markets(id),
  winning_outcome_id uuid NOT NULL,
  total_pool bigint NOT NULL,      -- Total stakes
  winning_pool bigint NOT NULL,    -- Stakes on winning outcome
  rake_amount bigint NOT NULL,     -- House commission
  net_pool bigint NOT NULL,        -- total_pool - rake_amount
  total_paid bigint NOT NULL,      -- Actual payouts (sum of all payouts)
  dust bigint NOT NULL,            -- net_pool - total_paid (rounding remainder)
  winners_count int NOT NULL,
  losers_count int NOT NULL,
  settled_by uuid REFERENCES auth.users(id),
  settled_at timestamptz NOT NULL DEFAULT now()
);
```

**Invariant**: `total_pool = rake_amount + total_paid + dust`

---

### Transaction Entries Created During Settlement

#### For Each Winning Wager:
```sql
INSERT INTO wallet_transactions (user_id, kind, amount, meta)
VALUES (
  winner_user_id,
  'payout',
  payout_amount, -- Positive
  jsonb_build_object(
    'market_id', market_id,
    'wager_id', wager_id,
    'outcome_id', winning_outcome_id,
    'rake_bps', rake_bps
  )
);
```

#### For Voided Markets (All Wagers):
```sql
INSERT INTO wallet_transactions (user_id, kind, amount, meta)
VALUES (
  wager_user_id,
  'refund',
  original_stake, -- Positive
  jsonb_build_object(
    'market_id', market_id,
    'wager_id', wager_id,
    'reason', 'market_voided'
  )
);
```

---

## Rounding & Dust Rules

### Rationale
Diamond Sports Book uses integer amounts (smallest denomination, e.g., cents or "diamonds"). Division during payout calculation can produce fractional results.

---

### Rounding Policy

1. **Payout Calculation**: Use `FLOOR()` to round down to nearest integer
   ```sql
   payout := FLOOR((wager.stake::numeric / winning_pool::numeric) * net_pool);
   ```

2. **Dust Allocation**: Remainder stays in house
   ```sql
   dust := net_pool - SUM(payouts);
   ```

3. **Rake Calculation**: Use `FLOOR()` to round down
   ```sql
   rake_amount := FLOOR(total_pool * rake_bps / 10000.0);
   ```

---

### Dust Examples

**Example 1: Simple Payout**
```
Market:
- Total pool: 1000 diamonds
- Rake: 5% (50 diamonds)
- Net pool: 950 diamonds

Winning wagers:
- User A: 333 stake
- User B: 333 stake
- User C: 334 stake

Payouts:
- User A: FLOOR((333 / 1000) * 950) = FLOOR(316.35) = 316
- User B: FLOOR((333 / 1000) * 950) = FLOOR(316.35) = 316
- User C: FLOOR((334 / 1000) * 950) = FLOOR(317.30) = 317

Total paid: 316 + 316 + 317 = 949
Dust: 950 - 949 = 1 diamond (stays with house)
```

**Example 2: High Dust**
```
Market:
- Total pool: 100 diamonds
- Rake: 10% (10 diamonds)
- Net pool: 90 diamonds

Winning wagers:
- User A: 3 stake
- User B: 3 stake
- User C: 3 stake
- (Total winning: 9 stake)

Payouts:
- Each user: FLOOR((3 / 9) * 90) = FLOOR(30.0) = 30

Total paid: 90
Dust: 0 diamonds
```

---

### Dust Tracking

Dust is recorded in `market_settlements.dust` for audit purposes.

**Query Total Dust**:
```sql
SELECT SUM(dust) AS total_dust_retained
FROM market_settlements
WHERE settled_at >= '2025-01-01'
  AND settled_at < '2025-02-01';
```

Typical dust per market: **0-10 units** (negligible)

---

### When Dust is Zero

Dust is zero when:
1. Payouts divide evenly (e.g., net_pool = 100, winners with equal 25% stakes each)
2. Single winner (gets entire net_pool)

---

## Monthly Reconciliation Checklist

Run these checks at the end of each month to ensure accounting integrity.

---

### 1. Balance Integrity Check
**Verify**: Cached balances match transaction sum

```sql
SELECT
  wa.user_id,
  wa.balance AS cached_balance,
  COALESCE(SUM(wt.amount), 0) AS calculated_balance,
  wa.balance - COALESCE(SUM(wt.amount), 0) AS discrepancy
FROM wallet_accounts wa
LEFT JOIN wallet_transactions wt ON wt.user_id = wa.user_id
GROUP BY wa.user_id, wa.balance
HAVING wa.balance != COALESCE(SUM(wt.amount), 0);
```

**Expected**: 0 rows (no discrepancies)

**If discrepancies found**:
1. Investigate transaction log for missing entries
2. Check for direct UPDATEs to wallet_accounts (should never happen)
3. Recompute balance from transaction log and correct

---

### 2. Settlement Reconciliation
**Verify**: All settlements balance correctly

```sql
SELECT
  settlement_id,
  market_id,
  total_pool,
  rake_amount,
  total_paid,
  dust,
  (rake_amount + total_paid + dust) AS calculated_total,
  total_pool - (rake_amount + total_paid + dust) AS discrepancy
FROM market_settlements
WHERE settled_at >= date_trunc('month', now() - interval '1 month')
  AND settled_at < date_trunc('month', now())
HAVING total_pool != (rake_amount + total_paid + dust);
```

**Expected**: 0 rows

**Invariant**: `total_pool = rake_amount + total_paid + dust` must always hold

---

### 3. Wager Status Consistency
**Verify**: No wagers stuck in pending for settled markets

```sql
SELECT COUNT(*)
FROM wagers w
JOIN markets m ON m.id = w.market_id
WHERE m.status = 'settled'
  AND w.status = 'pending';
```

**Expected**: 0

**If found**:
- Settlement may have failed mid-process
- Re-run `settle_market()` (idempotent)

---

### 4. Transaction Volume Report
**Generate**: Summary of all transaction activity

```sql
SELECT
  kind,
  COUNT(*) AS transaction_count,
  SUM(amount) AS total_amount
FROM wallet_transactions
WHERE created_at >= date_trunc('month', now() - interval '1 month')
  AND created_at < date_trunc('month', now())
GROUP BY kind
ORDER BY kind;
```

**Expected Output**:
```
 kind        | transaction_count | total_amount
-------------+-------------------+--------------
 deposit     |               150 |    500000
 wager       |              1250 |   -350000
 payout      |               900 |    320000
 refund      |                50 |     15000
```

**Checks**:
- `wager` amount should be negative
- `payout + refund` should be <= `deposit + bonus` (house edge)

---

### 5. User Balance Audit
**Verify**: No negative balances

```sql
SELECT user_id, balance
FROM wallet_accounts
WHERE balance < 0;
```

**Expected**: 0 rows

**If found**: Critical bug - investigate immediately

---

### 6. Unclaimed Dust Report
**Calculate**: Total dust retained by house

```sql
SELECT
  COUNT(*) AS settled_markets,
  SUM(dust) AS total_dust,
  AVG(dust) AS avg_dust_per_market,
  MAX(dust) AS max_dust
FROM market_settlements
WHERE settled_at >= date_trunc('month', now() - interval '1 month')
  AND settled_at < date_trunc('month', now());
```

**Expected**: avg_dust < 5 diamonds per market

---

### 7. Orphaned Transactions Check
**Verify**: All wager/payout transactions link to valid wagers

```sql
-- Check wager transactions
SELECT COUNT(*)
FROM wallet_transactions wt
WHERE wt.kind = 'wager'
  AND NOT EXISTS (
    SELECT 1 FROM wagers w
    WHERE w.id = (wt.meta->>'wager_id')::uuid
  );

-- Check payout transactions
SELECT COUNT(*)
FROM wallet_transactions wt
WHERE wt.kind = 'payout'
  AND NOT EXISTS (
    SELECT 1 FROM wagers w
    WHERE w.id = (wt.meta->>'wager_id')::uuid
  );
```

**Expected**: 0 for both

---

## Audit Trails

### Transaction Audit Query
```sql
-- View all transactions for a user
SELECT
  wt.id,
  wt.kind,
  wt.amount,
  wt.created_at,
  wt.meta,
  CASE
    WHEN wt.kind IN ('wager', 'payout', 'refund') THEN
      (SELECT m.name FROM markets m WHERE m.id = (wt.meta->>'market_id')::uuid)
    ELSE NULL
  END AS market_name
FROM wallet_transactions wt
WHERE wt.user_id = $1
ORDER BY wt.created_at DESC
LIMIT 100;
```

---

### Settlement Audit Query
```sql
-- View settlement details
SELECT
  ms.id AS settlement_id,
  m.name AS market_name,
  o.label AS winning_outcome,
  ms.total_pool,
  ms.winning_pool,
  ms.rake_amount,
  ms.net_pool,
  ms.total_paid,
  ms.dust,
  ms.winners_count,
  ms.losers_count,
  p.display_name AS settled_by,
  ms.settled_at
FROM market_settlements ms
JOIN markets m ON m.id = ms.market_id
JOIN outcomes o ON o.id = ms.winning_outcome_id
LEFT JOIN profiles p ON p.id = ms.settled_by
WHERE ms.market_id = $1;
```

---

### Wager Trace Query
```sql
-- Trace complete lifecycle of a wager
SELECT
  'wager_placed' AS event,
  w.placed_at AS timestamp,
  -w.stake AS amount,
  'pending' AS status
FROM wagers w
WHERE w.id = $1

UNION ALL

SELECT
  CASE
    WHEN wt.kind = 'payout' THEN 'wager_won'
    WHEN wt.kind = 'refund' THEN 'wager_refunded'
  END AS event,
  wt.created_at AS timestamp,
  wt.amount,
  w.status
FROM wallet_transactions wt
JOIN wagers w ON w.id = (wt.meta->>'wager_id')::uuid
WHERE w.id = $1
  AND wt.kind IN ('payout', 'refund')

ORDER BY timestamp ASC;
```

---

## Error Scenarios & Recovery

### Scenario 1: Settlement Interrupted
**Symptom**: Market status = 'closed', but no settlement record exists

**Diagnosis**:
```sql
SELECT * FROM markets
WHERE status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM market_settlements ms WHERE ms.market_id = markets.id
  );
```

**Recovery**: Call `settle_market()` again (idempotent)

---

### Scenario 2: Balance Drift
**Symptom**: `wallet_accounts.balance` != SUM(transactions)

**Diagnosis**: Run Balance Integrity Check (above)

**Recovery**:
```sql
-- Recompute and correct balance
UPDATE wallet_accounts wa
SET balance = (
  SELECT COALESCE(SUM(amount), 0)
  FROM wallet_transactions wt
  WHERE wt.user_id = wa.user_id
),
updated_at = now()
WHERE wa.user_id = $1;
```

---

### Scenario 3: Dust Exceeds Threshold
**Symptom**: `market_settlements.dust` > 100 for a market

**Diagnosis**:
```sql
SELECT * FROM market_settlements WHERE dust > 100;
```

**Cause**: Likely a bug in payout calculation

**Recovery**:
1. Investigate payout calculation in `settle_market()` function
2. If confirmed bug, void and re-settle market with corrected function
3. Issue manual adjustments to affected users

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2025-11-11 | Claude Code | Initial accounting and reconciliation documentation |

---

## References

- [State Machines](/docs/STATE_MACHINES.md)
- [Settlement RPC](/supabase/migrations/20251111_idempotent_settle_market.sql)
- [Wager Placement RPC](/supabase/migrations/20251111_idempotent_place_wager.sql)
