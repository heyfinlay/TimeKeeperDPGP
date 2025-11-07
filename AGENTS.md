# Repository Guidelines

## Project Structure & Module Organization
Application code lives in `src/`. Keep reusable UI in `src/components/`, views in `src/pages/`, shared state in `src/context/`, and domain helpers in `src/utils/` and `src/lib/`. Styles originate from `src/index.css` with Tailwind utilities layered inline. End-to-end references and long-form docs belong in `docs/`, while automated tests reside in `tests/` with `*.test.js` naming. Supabase schema changes should update `supabase/schema.sql` so new environments can be provisioned consistently.

## Build, Test, and Development Commands
- `npm run dev` launches the Vite dev server at `http://localhost:5173` with hot reloading.
- `npm run build` creates the production bundle in `dist/`; run before tagging a release.
- `npm run preview` serves the built assets locally to confirm production parity.
- `npm run test` (or `bun test`) executes the Bun-powered unit test suite in `tests/`.
Install dependencies with `npm install`; Bun is only required for test execution.

## Coding Style & Naming Conventions
Favor React functional components and hooks with PascalCase filenames (`TimingPanel.jsx`) and camelCase functions (`formatLapTime`). Maintain 2-space indentation and single quotes to match existing modules. Centralize shared constants in `src/constants/` and keep Tailwind class lists declarative; extract complex layouts into smaller components under `src/components/`. When adding utilities, expose default exports for single helpers and named exports for groups to mirror current patterns.

## Testing Guidelines
Add unit tests in `tests/`, naming files after the module under test (e.g., `raceData.test.js`). Cover timing math, session transitions, and Supabase integration boundaries. Run `npm run test` locally before opening a PR and include negative cases for new helpers. When fixing regressions, add a test reproducing the issue to guard behaviour.

## Commit & Pull Request Guidelines
Follow the repository history by using short, imperative commit subjects (e.g., `Adjust Supabase session bootstrap`). Group related changes per commit and avoid mixing refactors with behavioural fixes. Pull requests should include: a concise summary, linked issues, environment notes (e.g., required `VITE_SUPABASE_*` values), and UI screenshots when visuals change. Highlight any manual verification steps performed so reviewers can replicate them.

## Supabase & Configuration Tips
The app falls back to offline mode, but realtime sync requires setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Update `supabase/schema.sql` when altering tables and mention required migrations in the PR description. Rotate keys before sharing recordings or logs that include connection strings.

## Admin Authentication - Single Source of Truth
**Admin access is determined solely by `profiles.role = 'admin'`.** Do not rely on JWT roles or separate credential tables.

### Authentication Flow
**Discord OAuth is the ONLY supported authentication method** for all users, including admins. The legacy admin credential system (username/password via `/admin-auth` endpoint) has been deprecated.

### Database Layer
- **`is_admin()` function**: Returns true only if the current user's profile has `role = 'admin'`. No JWT role checks.
- **RLS policies**: Use `is_admin()` or direct `profiles.role = 'admin'` checks. Never reference removed helpers like `session_has_access()`.
- **Admin RPCs**: All admin functions (`admin_adjust_wallet`, `admin_process_withdrawal`, etc.) are `SECURITY DEFINER` with `search_path = public, pg_temp` and granted to `authenticated` only (not `anon`).
- **`admin_credentials` table**: DEPRECATED and locked with restrictive RLS. Read-only for admins, preserved for historical reference only.

### Frontend Layer
- **Authentication**: All users sign in via `signInWithDiscord()` from `AuthContext` or `src/lib/auth.js`
- **AuthGuard component** (`src/components/auth/AuthGuard.jsx`): Checks `profile.role === 'admin'` loaded from Supabase. Does not use JWT claims.
- **Admin routes**: Protected by `<AuthGuard requireAdmin={true}>`. Will redirect if `profile.role !== 'admin'`.
- **OAuth callback** (`src/routes/AuthCallback.jsx`): Routes admins to `/admin/sessions`, regular users to `/dashboard`
- **Legacy routes**: `/admin/login` redirects to `/` (use Discord OAuth from home page)

### To Grant Admin Access
1. User signs in with Discord OAuth (via WelcomePage or any auth prompt)
2. Admin manually sets the user's profile: `UPDATE profiles SET role = 'admin' WHERE id = '<user_id>';`
3. User must sign out and back in to reload the profile with new role
4. Admin routes (`/admin/sessions`) will now be accessible

### Deprecated Components (Do Not Use)
- `loginWithAdminCredentials()` in `src/services/adminAuth.js` - throws error
- `AdminLoginPage` component - no longer in routing
- `/admin-auth` Edge Function endpoint - should return 410 Gone
- `admin_credentials` table - read-only, not used for authentication
- `verify_admin_credentials()` function - removed from database

## RLS Policy Architecture
All RLS policies follow a **non-recursive, membership-based pattern** to prevent infinite loops and 401 errors.

### Core Pattern
Policies check three authorization paths (in order):
1. **Admin**: `is_admin()` grants full access
2. **Session Creator**: `EXISTS (SELECT 1 FROM sessions WHERE id = <table>.session_id AND created_by = auth.uid())`
3. **Session Member**: `EXISTS (SELECT 1 FROM session_members WHERE session_id = <table>.session_id AND user_id = auth.uid())`

### Example: `session_state` Policies
- **SELECT**: Creator, members, and admins can read
- **INSERT**: Creator and members can insert (needed when session wizard seeds initial state)
- **UPDATE**: Same actors can update race state during live timing
- **DELETE**: Only admins and creators can delete

### Key Rules
- **No helper recursion**: Never call helpers that query tables whose policies recurse back
- **Explicit checks**: Always qualify columns (`sessions.created_by`, not `created_by`) to avoid ambiguity
- **SECURITY DEFINER functions**: Must set `search_path = public, pg_temp` and be owned by `postgres`
- **Granular policies**: Separate `SELECT`, `INSERT`, `UPDATE`, `DELETE` instead of using `ALL` to avoid permission errors

### Session Creation Flow
1. User calls `create_session_atomic(jsonb)` RPC
2. RPC inserts: `sessions` → `session_members` (owner + marshals) → `session_state` (default state)
3. All inserts succeed because RPC is `SECURITY DEFINER` and policies allow creator/member access
4. UI can immediately read/update `session_state` via REST without 401 errors
