-- Seed the first admin credential with a bcrypt-hashed password.
--
-- Usage:
--   psql \ \
--     -v admin_username='race-control-root' \
--     -v admin_password='use-a-strong-secret' \
--     -f supabase/seed_initial_admin.sql \
--     "$SUPABASE_DB_URL"
--
-- Optional: supply -v admin_id='<uuid>' to control the admin identifier.

\set admin_username 'initial-admin'
\set admin_password 'ChangeMeNow!'
\set admin_id ''

with seed_input as (
  select
    case
      when trim(:'admin_id') = '' then gen_random_uuid()
      else :'admin_id'::uuid
    end as admin_id,
    trim(:'admin_username') as username,
    :'admin_password'::text as raw_password
)
insert into public.admin_credentials as ac (id, username, password_hash, rotated_at)
select
  admin_id,
  username,
  crypt(raw_password, gen_salt('bf')) as password_hash,
  timezone('utc', now())
from seed_input
where length(username) > 0
on conflict (username)
  do update
    set password_hash = excluded.password_hash,
        rotated_at = timezone('utc', now());
