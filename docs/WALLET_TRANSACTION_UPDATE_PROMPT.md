# Wallet Transaction Direction Update Prompt

Use the following prompt when you need to describe the recently enforced wallet transaction direction rules:

> Summarize how the Supabase migrations now enforce debit and credit directions on `wallet_transactions`, including the new `direction` column, trigger validation, and the updates to wager placement, settlement, refund, and withdrawal routines that ensure debits are recorded as negative amounts and credits as positive amounts. Mention that the documentation in `docs/ACCOUNTING_AND_RECONCILIATION.md` was refreshed to explain the invariant.

This snippet captures the essential context for support tickets, changelogs, or release notes referencing the April 2025 ledger update.
