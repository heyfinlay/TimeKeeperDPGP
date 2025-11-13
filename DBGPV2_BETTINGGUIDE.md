DBGP V2 — Betting & Tote System (Full Specification)

The complete, authoritative documentation for rebuilding the DBGP betting stack.

1. Purpose of DBGP Betting V2

The goal of V2 is to stabilize, simplify, and professionalize the DBGP tote betting engine and its UI/UX so it can:

Correctly accept wagers with deterministic price impact.

Settle markets reliably through a clean admin settlement flow.

Render accurate odds, share %, and pool values across all devices.

Support realtime spectatorship with Market Depth + historical analytics.

Guarantee wallet + wager atomicity and zero broken states.

Eliminate legacy/buggy marshal & timing code interfering with markets.

V2 is the foundation upon which future features (parlays, live betting, prop markets) can be built.

2. High-Level System Overview

DBGP is a parimutuel tote betting system:

All wagers go into a shared pool.

The pool is distributed only after the race outcome is known.

Odds float based on share % of total pool.

Admin closes market → picks winner → generates payout → updates wallets.

To achieve this reliably, V2 is structured around 3 pillars:

Pillar 1: Correct data model (DB-Safe design)

Tables:
markets, outcomes, wagers, wallet_accounts, wallet_transactions,
pool_snapshots, quote_telemetry, market_settlements, pending_settlements.

Pillar 2: Deterministic RPCs

Key RPCs:

place_wager()

preview_wager()

close_market()

settle_market()

get_market_depth()

admin_list_pending_wagers()

approve_wager() / reject_wager()

Pillar 3: Presentation layer

Public markets page

Betslip

Market Depth View

Admin Console

Wager Monitoring View

Settlement Review Page

“Your Bets” personal portfolio

3. V2 Data Model (Finalized)

Below are the tables required, their roles, and the V2 rules.

3.1 Markets

Represents a single contest (e.g. “Fastest Lap”, “Race Winner”).

Columns that matter:

status enum: draft | open | closed | settled | cancelled

rake_bps (default 500 = 5%)

requires_approval (boolean)

takeout (% used for odds math)

closes_at

event_id

Invariants

A market must have ≥2 outcomes.

A market cannot accept wagers when status != open.

A market can only be settled once.

Rake must be between 0–25%.

3.2 Outcomes

Represents each possible choice (EMS, FLY, BHM etc).

V2 fields:

driver_id (optional link to DBGP drivers)

color

abbreviation (“EMS”, “FLY”, etc.)

deleted_at soft-delete

Invariants:

Outcomes can’t be removed from open markets.

Must have a sort_order for stable UI.

3.3 Wagers

Represents each bet a user places.

Essential fields:

status enum:
pending | accepted | rejected | settled_win | settled_loss | cancelled

stake

user_id, market_id, outcome_id

V2 rules:

If requires_approval = false → immediately accepted.

If requires_approval = true → stored as pending until admin approves.

Must always be atomic with wallet debits.

3.4 Wallet Accounts
Rules:

Created automatically on first access.

Balance always stored in bigint diamonds.

RLS: users can only see their own.

3.5 Wallet Transactions

Tracks money movement.

Required:

direction: 'credit' | 'debit'

reference_type: 'wager' | 'payout' | 'deposit' | 'withdrawal'

reference_id

Invariants:

Debits can only occur if balance >= amount.

Every wager must have 1 matching debit transaction.

Every winning payout must have 1 matching credit transaction.

3.6 Pool Snapshots

Every N seconds, a row is written representing:

market_id

outcome_id

outcome_pool

total_pool

takeout

timestamp

Purpose:

Depth charts

Trend arrows

Historical analytics

Settlement auditing

3.7 Quote Telemetry

Each wager preview writes:

stake

baseline multiplier

effective post-stake multiplier

price impact (%)

timestamp

Used for the Market Depth View + admin fraud detection.

3.8 Market Settlements

Stores the final settlement record:

winning_outcome_id

total_pool

winning_pool

net_pool

total_paid

dust

winners_count

losers_count

This is the ground truth.

4. V2 RPC Architecture (Final)

Here are the RPCs that must exist and what they do:

4.1 preview_wager(market_id, outcome_id, stake)

Returns:

Baseline odds

Effective odds after stake

Price impact

Share after bet

Implied probability

Max payout

Estimated payout

Why this matters:

This powers the odds calculator in the betslip.

4.2 place_wager(market_id, outcome_id, stake)

Atomic guarantee:

Locks wallet

Debits diamonds

Inserts wager

Updates pool totals

Inserts telemetry

Inserts wallet_transaction

Returns new balance + wager ID

If any step fails → entire transaction rolls back.

4.3 close_market(market_id)

Admin-only.

Sets status → closed, stops wagers.

Also triggers:

final pool_snapshot

freezes odds UI

disables betslip

4.4 settle_market(market_id, outcome_id)

Admin selects winner and:

Computes payouts

Creates rows in wager_payouts

Credits winners via wallet_transactions

Logs settlement metadata

Marks market settled

Additionally:

Updates market_settlements

Writes settlement into admin_actions_log

4.5 admin_list_pending_wagers(market_id)

Used in the admin panel.

Returns:

All pending wagers

User details

ID references

Stake

Timestamp

Price impact

4.6 approve_wager(wager_id)

Marks wager as accepted

Immediately debits user wallet (atomic)

Writes wallet transaction

4.7 reject_wager(wager_id)

Credits user back (if pre-debited)

Marks wager as rejected

4.8 get_market_depth(market_id, window)

Returns:

Pool snapshots

Telemetry deltas

Recent big wagers

Largest bettors

Outcome trending data

Share % changes

Depth graph data

Used exclusively by the Market Depth View.

5. Market Math (Final Formulas)
5.1 Total Pool
total_pool = SUM(outcome_pool)

5.2 Net Pool
net_pool = total_pool * (1 - rake_bps / 10000)

5.3 Outcome Share
share = outcome_pool / total_pool

5.4 Decimal Odds
odds = net_pool / outcome_pool

5.5 Price Impact (pp)
price_impact_pp = (new_share - old_share) * 100

5.6 Estimated Payout
expected_payout = stake * odds

6. V2 UI Specification

This section defines all UI required for V2.

6.1 Markets Overview
Shows:

Event

Active market

Time left

Pool size

Outcome list with:

Share %

Diamonds staked

Odds

Trend arrows

Outcome color

“Open Betslip” button

Tabs:

Overview

Depth

Your Bets

6.2 Betslip

States:

No outcome selected

Outcome selected

Stake preview

Preview (quotes)

Confirm wager

Success

Error

Must show:

Baseline odds

Price impact

Max payout

Estimated payout

Share after bet

Takeout amount

User balance

Quick stakes (10k, 25k, 50k, 100k, 250k, 1M)

6.3 Market Depth View (Final)

Includes:

Left column — Outcome distribution:

Outcome chips with team colors

Share %

Share change (pp up/down)

Odds

Diamonds staked

Number of wagers

Gradient depth bar

Right column:

Pool depth chart (5m, 15m, 1h)

Largest recent wagers

Price impact events

Pressure index

Whales list

Bottom:

“Pool Distribution” breakdown

Historic % graph

6.4 Admin Console (V2)

Pages:

Admin/Markets

List of all markets

Columns: status, pool size, wagers, pending approval

Actions:

Open market

Close market

View market

Settlement

Admin/Market/:id

Tabs:

Overview

Pending wagers

Settlement

Snapshots

Telemetry

Actions

Settlement Page

Shows:

Winners

Losers

Total pool

Net pool

Payout per stake

Wager-by-wager preview

Auto-generated settlement summary

“Confirm Settlement” button

6.5 Wager Monitoring Console

Shows:

Live list of wagers

Big wagers flagged

User histories

Price-impact over time

Wager funnel (pending → accepted → settled)

You’ll use this to debug ALL stuck wager issues.

6.6 Your Bets

User personal ledger:

Active bets

Past bets

Settled payouts

Profit/loss

Filters by event + market

7. Realtime & Event Handling

V2 uses:

pool_snapshots as the authoritative source for depth

Supabase Realtime on:

markets

outcomes

wagers (accepted only)

wallet_accounts

Rules:

Betslip re-quotes every 2–3 seconds

Depth view refreshes snapshots every 5–10 seconds

Pending wagers DO NOT appear in public UI

Admin receives realtime pending wagers

8. Error Handling & Edge Cases
Critical edge cases handled in V2:

Wallet missing → auto-create

User tries to bet over balance → show “Insufficient Diamonds”

Market closes mid-bet → RPC rejects

Stuck wagers → impossible due to atomicity

Late snapshots → ignored

Market settlement double-click → protected via DB unique constraint

9. Security Model (RLS)
Users:

Can only view their own:

wagers

wallet

wallet_transactions

Admin:

Full access with role = 'admin'

Admin credentials no longer required (OAuth + profiles.role)

RLS per table:

wagers: user sees only their wagers unless admin

wallet_accounts: user sees only their row

wallet_transactions: same

market_settlements: public read

pool_snapshots: public read

quote_telemetry: admin only

pending_settlements: admin only

10. Implementation Plan
Phase 1 — Data Hardening

Cleanup legacy marshal code

Remove ghost session/timing cross-references

Normalize markets + outcomes

Rebuild RPCs

Phase 2 — Wallets & Wagers

Fix auto-wallet creation

Implement atomic place_wager()

Add pending wagers + approval system

Phase 3 — Markets UI & Betslip V2

Accurate odds

Accurate share %

Price impact

Estimated payout

Phase 4 — Market Depth View

Add snapshots

Add telemetry

Add whales list

Phase 5 — Admin Console

Approvals, closing, settlement

Settlement review

Settlement execution

Phase 6 — QA & Load Tests

Test 100+ simulated bettors

Test race-day traffic

Test settlement under load

11. What This V2 Fixes Permanently
✓ Stuck wagers
✓ Market not closing
✓ No UI for settlement
✓ Wallet not updating
✓ Odds unstable
✓ Trend arrows wrong
✓ Missing snapshots
✓ Race control code interfering
✓ Real-time spam
✓ Admin inability to manage or monitor markets

This doc is the definitive foundation for the fully functional, professional-grade DBGP betting engine.