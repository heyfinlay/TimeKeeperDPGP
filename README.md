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
2. Run the SQL in [`supabase/schema.sql`](./supabase/schema.sql) inside the Supabase SQL editor to provision the required tables (`drivers`, `laps`, `session_state`, `race_events`) and enable realtime streaming.
3. Set the following environment variables before running the app:

   ```bash
   export VITE_SUPABASE_URL="https://<your-project>.supabase.co"
   export VITE_SUPABASE_ANON_KEY="<your-anon-key>"
   ```

   For local development you can place these values in a `.env.local` file at the project root.

The control panel will fall back to local-only mode if the variables are missing, but realtime broadcasting and persistence require Supabase to be configured.

## Features

- Multi-phase race control workflow (warmup, final call, countdown, green flag, suspension, completion).
- Real-time race clock with countdown, pause/resume, and lap recording via buttons or keyboard hotkeys.
- Track status controls with rich banner states (Green, Sector Yellows, VSC, Safety Car, Red Flag) and a live announcement ticker.
- Supabase-backed storage for drivers, laps, session state, and control room logs with realtime streaming to all connected clients.
- A spectator-friendly **Live Timing Board** view that shows positions, gaps, fastest laps, track status, and the most recent lap feed.
- Driver management including lap counts, best laps, pit tracking, marshal flags, retirements, and CSV export.
- Tailwind CSS styling and Lucide icons.
