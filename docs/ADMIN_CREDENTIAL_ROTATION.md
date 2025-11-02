# Admin Credential Rotation

This guide explains how to manage the `admin_credentials` table that backs privileged access to Supabase row level security (RLS) protected tables. Keep the bcrypt hashes private and rotate secrets whenever someone leaves the race-control team.

## 1. Seeding the first admin

1. Generate a strong password and store it in your password manager.
2. Run the seeding helper so the hash is stored inside Supabase:
   ```bash
   psql \
     -v admin_username='race-control-root' \
     -v admin_password='super-long-random-secret' \
     -f supabase/seed_initial_admin.sql \
     "$SUPABASE_DB_URL"
   ```
3. Share the plain-text password only through a secure channel.

The script uses `pgcrypto.crypt()` with a bcrypt salt and updates `rotated_at` whenever the credentials are reseeded.

## 2. Rotating the admin password

1. Choose a new strong password and update the shared secret in your password manager.
2. Re-run the same seeding command with the new password. You can optionally pin the UUID by adding `-v admin_id='<existing-admin-uuid>'`.
3. Confirm the rotation timestamp:
   ```sql
   select username, rotated_at
   from public.admin_credentials
   order by rotated_at desc
   limit 1;
   ```
4. Invalidate the previous secret wherever it was stored (chat logs, runbooks, environment variables).

## 3. Adding a secondary admin

- Run the seed script with a different `admin_username`. Provide an explicit `admin_id` if you want to map the admin to an existing Supabase user profile.
- Update the corresponding profile row so the operator receives admin UI access:
  ```sql
  update public.profiles
  set role = 'admin'
  where id = '<supabase-user-uuid>';
  ```
- Ask the new admin to sign out/in so the fresh `admin` role claim is applied client-side.

## 4. Emergency recovery

If the existing password is lost:

1. Connect with the Supabase service role key via `psql`.
2. Insert a new row (or reseed the existing username) using the script above.
3. Audit the `rotated_at` history to ensure there are no unexpected resets.

Always rotate credentials immediately after incident response and document the action in your operations log.
