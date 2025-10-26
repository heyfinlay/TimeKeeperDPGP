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
