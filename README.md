# TimeKeeperDPGP

A Vite + React implementation of the DayBreak Grand Prix timing and scoring panel with Supabase-backed persistence and a public live timing board.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run the automated tests:

```bash
bun test
```

## Supabase Setup

1. Create a Supabase project and install the Supabase CLI (`brew install supabase/tap/supabase`).
2. Authenticate and link the CLI to your project:

   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   ```

3. Apply the tracked migrations and edge functions:

   ```bash
   supabase db push
   ```

   This loads the schema from `supabase/migrations/**` and syncs the `admin-auth` edge function. To rebuild the database locally with seed data (including the initial admin credential) run `supabase db reset`.

4. Provide the following environment variables to the Vite app (e.g. in `.env.local`):

   ```bash
   VITE_SUPABASE_URL="https://<your-project>.supabase.co"
   VITE_SUPABASE_ANON_KEY="<your-anon-key>"
   # Optional override; defaults to your project's functions domain.
   VITE_ADMIN_AUTH_ENDPOINT="https://<your-project>.functions.supabase.co"
   ```

   Without these values the UI runs in offline fallback mode and skips Supabase features.

5. Configure the secrets required by the `admin-auth` edge function:

   ```bash
   supabase secrets set \
     admin_credentials='[{"username":"control","password":"<plain-text-pass>","user_id":"<supabase-user-uuid>","role":"admin"}]' \
     JWT_SECRET='<32+ char random secret>'
   ```

   - `admin_credentials` accepts an array/object of entries containing the plain-text password that race control staff will use.
   - `JWT_SECRET` must match the signing key configured under **Project Settings → API → JWT Auth** (or use `supabase secrets set JWT_SECRET=$(openssl rand -hex 32)` and copy the value into the dashboard).

Regenerate tokens whenever rotating admin accounts and keep the secrets out of version control.

## Features

- Multi-phase race control workflow (warmup, final call, countdown, green flag, suspension, completion).
- Real-time race clock with countdown, pause/resume, and lap recording via buttons or keyboard hotkeys.
- Track status controls with rich banner states (Green, Sector Yellows, VSC, Safety Car, Red Flag) and a live announcement ticker.
- Supabase-backed storage for drivers, laps, session state, and control room logs with realtime streaming to all connected clients.
- A spectator-friendly **Live Timing Board** view that shows positions, gaps, fastest laps, track status, and the most recent lap feed.
- Driver management including lap counts, best laps, pit tracking, marshal flags, retirements, and CSV export.
- Tailwind CSS styling and Lucide icons.

## Maintenance & Operations

- Follow the [Maintenance & Extension Guide](./docs/MAINTENANCE_GUIDE.md) for deep dives into data flow, manual verification checklists, and plans for adding Discord authentication or new user flows.
- Run `npm run build` before each release to confirm the production bundle compiles. Pair this with the smoke tests outlined in the guide to validate Race Control ↔ Live Timing synchronisation.
