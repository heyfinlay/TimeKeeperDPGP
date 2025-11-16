# DSB Market Console North Star

## Core Product Philosophy
- **Liquidity as the hero:** Every layout decision foregrounds pool size, share distribution, and payout math before any decorative treatment.
- **Console-first energy:** Interfaces should feel like a precision trading terminal infused with motorsport broadcast drama—minimal chrome, maximal clarity.
- **Speed as brand:** Any interaction above 150 ms demands a redesign or different transport; optimistic UI is acceptable only when reconciled instantly with authoritative responses.

## Experience Principles
1. **Single Glow Rule**
   - Exactly one luminous element per view; all other surfaces remain matte to preserve focus and trust.
2. **Hierarchy by Scale**
   - Large typography for market pools and wallet balance, medium scale for share percentages, small for metadata and controls.
3. **Motion Equals Meaning**
   - Animations only acknowledge financial or state changes (liquidity spikes, confirmations, state transitions); no ornamental loops.
4. **Truthful Odds**
   - Surfaces display real pool math: share percentages, rake, and estimated payouts clearly labeled as provisional until market close.
5. **Auditability**
   - Every bet, settlement, or void leaves an immutable receipt and joins the admin event log; the UI should expose that trail without clutter.

## Information Architecture
- **Global Top Bar:** DSB logo, Markets, Dashboard, Wallet HUD (always visible, real-time balance updates).
- **/markets (Event Lobby):** Market cards listing title, gross pool, rake %, status dot, countdown. Card pulses subtly when liquidity jumps ≥ 2%.
- **/market/:id (Market Console):**
  - Center: Net Pool ring visualization with rake tick, logarithmic fill speed, single glow focus.
  - Right rail: Driver rows (team stripe, name, share %, Bet CTA) with hover glow exclusivity.
  - Footer tabs: Bets, Stats, Results—contextual content that never competes with the main flow.
- **Bet Slip Drawer:** Slides from the right on tap; shows driver selection, quick chips (+1k/+10k/+100k/+1M), custom input, estimated payout, confirm button.
- **/dashboard:** Organizes Active Bets, Settled bets, Withdrawals for profit tracking.
- **/admin:** Tools for market lifecycle (create/edit, rake %, open/close, settle, void) plus withdrawal approvals and event log overlay.

## Market Math Invariants
- `gross_pool = Σ(stakes)`
- `rake = gross_pool × rake_percent`
- `net_pool = gross_pool − rake`
- `winning_payout = (user_stake / Σ(winner_stakes)) × net_pool`
- UI must surface share %, net pool, and continuously updating payout estimates until the market closes.

## Interaction Choreography
- **Liquidity Spike:** Pool ring emits a single outward pulse; relevant driver rows breathe gently for 800 ms.
- **Place Bet:** Bet slip appears within 40 ms, confirm compresses button with coin chime, Wallet HUD updates immediately.
- **Close Market:** Ring shutters, bet CTAs disable, "Closed" banner folds in.
- **Settle:** Winner row glows gold, micro confetti burst, payout toast enumerates the exact credited amount.

## Visual Language Tokens
- **Palette:** Near-black matte backgrounds (`#0A0A0F → #12121A`); cyan `#00FFE0` as primary accent, violet `#9B5CFF` secondary.
- **Typography:** Orbitron for headings (all caps, tight tracking), Inter for body with tabular numerals.
- **Depth:** Glass layers with 8 px blur, subtle inner shadows, and a single bloom reserved for the active element.
- **Borders:** Single 1 px `rgba(255,255,255,0.06)` strokes; never stack borders.

## State Model
- **Market:** `open → closing_soon → closed → settled | void`
- **Wager:** `pending → won | lost | void`
- **Wallet:** Exposes `available` and `pending_withdraw`; HUD derives balance solely from these fields.

## Edge Case Handling
- **Insufficient Funds:** Confirm button performs a soft shake and morphs to "Add Funds" with a guided return path.
- **Race Delay:** Markets remain closed with a calm banner: "Start delayed—bets remain frozen."
- **Late Bet Rejection:** Optimistic confirmation rolls back instantly with an authoritative toast message.
- **Settlement Tie / Steward Overturn:** Results tab logs the override (e.g., "Result updated by Steward #12 at 21:43").

## Operational Guardrails
- Bet cutoff hits a hard stop before race start; countdown switches to "Closing Soon" at T−60 s.
- House seeding flagged internally to stabilize early liquidity.
- Exposure caps enforce per-user and per-market maximums.
- Steward-triggered voids refund automatically with clear, calm messaging.

## Observability & Truth
- Admin event log overlay records wagers, state changes, settlements, and voids in human-readable form.
- User receipts capture immutable lines with timestamp, market, driver, wager, and pre/post balances.
- Admin "Rebuild Payout" action replays settlement math to verify integrity.

## Performance & Device Strategy
- First interaction must acknowledge within 100 ms; optimistic UI reconciles immediately.
- Real-time fan-out throttled to 10 Hz, batching minor updates.
- Desktop aims for 120 fps micro animations; laptops degrade bloom before sacrificing numeric clarity.

## Security & Integrity
- Discord SSO as the single identity provider.
- Admin privileges solely via `profiles.role = 'admin'`.
- Guardrails include exposure caps, cooldowns, and steward locks for results; abuse signals logged for review.
- Operational separation between race control, bookmaking, and stewarding.

## QA & Rollout Cadence
- **Golden Path:** deposit → bet → close → settle → payout → withdraw → approval.
- **Chaos Suite:** simultaneous bets, close during confirm, settle with tiny winner pool, void post-payout (must revert cleanly).
- **Visual Diff:** Record pool ring fills; differences over 1% trigger investigation.
- **Release Rhythm:**
  - Alpha: tote math accuracy, clean console UI, truthful state handling.
  - Beta: motion polish, single-glow discipline, celebratory micro moments.
  - v1: admin workflows, caps, void ergonomics, receipts.
  - v1.1: enhancements like H2H markets, streaks, 0% rake promos, social exports.

## Why This Works
- **Elegance over excess:** Simple, honest tote math keeps liquidity center stage.
- **Visual discipline builds trust:** Single glow, truthful numbers, explicit states encourage confident wagering.
- **Speed communicates premium quality:** Sub-150 ms reactions reinforce the brand's precision ethos.
- **Auditability fuels loyalty:** Transparent receipts and replayable settlements turn skeptics into advocates.
- **Cinematic restraint scales:** Designs should look sharper as markets grow, not busier.
