# Security Architecture Notes

## Session membership visibility

Row Level Security (RLS) on `public.session_members` enforces that:

- Admins (`public.is_admin() = true`) retain unrestricted access to membership rows.
- Non-admin members can only read their own membership entry for a session.
- Requests authenticated as other, non-member accounts are denied with PostgREST error code `PGRST116` when they attempt to coerce a single row (for example via `.maybeSingle()`), rather than producing a generic server error.

The integration test in `tests/sessionMembershipRls.test.js` provisions dedicated admin, marshal, and spectator accounts, seeds a session and membership, and verifies each of these expectations. Update the policies and test together whenever session visibility rules change so that spectators continue to receive a deterministic authorization error instead of a 500 response.
