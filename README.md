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

## Supabase Setup

1. Create a Supabase project and copy the project URL and anon public key.
2. Apply the database schema from [`supabase/schema.sql`](./supabase/schema.sql) (see the migration instructions below).
2. Run the SQL in [`supabase/schema.sql`](./supabase/schema.sql) inside the Supabase SQL editor to provision the required tables (`drivers`, `laps`, `session_state`, `race_events`) and enable realtime streaming.
3. Set the following environment variables before running the app:

   ```bash
   export VITE_SUPABASE_URL="https://<your-project>.supabase.co"
   export VITE_SUPABASE_ANON_KEY="<your-anon-key>"
   ```

   For local development you can place these values in a `.env.local` file at the project root.

The control panel will fall back to local-only mode if the variables are missing, but realtime broadcasting and persistence require Supabase to be configured.

### Running the Supabase migration

The schema file creates the required tables, indexes, and realtime publication entries. You can apply it in one of two ways:

**Using the Supabase dashboard**

1. Open your project in the Supabase dashboard and navigate to **SQL Editor**.
2. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) into a new query.
3. Execute the script. If prompted, enable the `pgcrypto` extension so `gen_random_uuid()` is available.

**Using the Supabase CLI**

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and authenticate with `supabase login`.
2. Link the CLI to your project: `supabase link --project-ref <project-ref>`.
3. Execute the SQL against the remote database: `supabase db execute --file supabase/schema.sql`.

After the schema is applied, the `drivers`, `sessions`, `laps`, `session_state`, and `race_events` tables will be ready for the application, and realtime updates will flow automatically.

## Features

- Multi-phase race control workflow (warmup, final call, countdown, green flag, suspension, completion).
- Real-time race clock with countdown, pause/resume, and lap recording via buttons or keyboard hotkeys.
- Track status controls with rich banner states (Green, Sector Yellows, VSC, Safety Car, Red Flag) and a live announcement ticker.
- Supabase-backed storage for drivers, laps, session state, and control room logs with realtime streaming to all connected clients.
- A spectator-friendly **Live Timing Board** view that shows positions, gaps, fastest laps, track status, and the most recent lap feed.
- Driver management including lap counts, best laps, pit tracking, marshal flags, retirements, and CSV export.
- Tailwind CSS styling and Lucide icons.
