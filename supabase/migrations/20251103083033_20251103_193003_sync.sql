DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'profile_role'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.profile_role AS ENUM ('marshal', 'admin', 'race_control');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "public"."admin_credentials" (
    "id" uuid not null default gen_random_uuid(),
    "username" text not null,
    "password_hash" text not null,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "rotated_at" timestamp with time zone
);


alter table "public"."admin_credentials" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" uuid not null,
    "number" integer not null,
    "name" text not null,
    "team" text,
    "marshal_user_id" uuid,
    "laps" integer default 0,
    "last_lap_ms" bigint,
    "best_lap_ms" bigint,
    "pits" integer default 0,
    "status" text default 'ready'::text,
    "driver_flag" text default 'none'::text,
    "pit_complete" boolean default false,
    "total_time_ms" bigint default 0,
    "session_id" uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
    "updated_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."drivers" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."laps" (
    "id" uuid not null default gen_random_uuid(),
    "driver_id" uuid,
    "lap_number" integer not null,
    "lap_time_ms" bigint not null,
    "source" text,
    "session_id" uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
    "recorded_at" timestamp with time zone default timezone('utc'::text, now()),
    "invalidated" boolean default false,
    "checkpoint_missed" boolean default false
);


alter table "public"."laps" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" uuid not null,
    "handle" text,
    "display_name" text,
    "role" profile_role default 'marshal'::profile_role,
    "ic_phone_number" text,
    "assigned_driver_ids" uuid[],
    "team_id" uuid,
    "tier" text,
    "experience_points" integer,
    "created_at" timestamp with time zone default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."profiles" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."race_events" (
    "id" uuid not null default gen_random_uuid(),
    "message" text not null,
    "marshal_id" text,
    "session_id" uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
    "created_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."race_events" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."session_logs" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid not null,
    "object_path" text not null,
    "object_url" text,
    "format" text not null default 'json'::text,
    "created_by" uuid default auth.uid(),
    "created_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."session_logs" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."session_members" (
    "session_id" uuid not null,
    "user_id" uuid not null,
    "role" text not null default 'marshal'::text,
    "inserted_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."session_members" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."session_state" (
    "id" text not null,
    "event_type" text,
    "total_laps" integer,
    "total_duration" integer,
    "procedure_phase" text,
    "flag_status" text,
    "track_status" text,
    "announcement" text,
    "is_timing" boolean,
    "is_paused" boolean,
    "race_time_ms" bigint,
    "session_id" uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
    "updated_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."session_state" enable row level security;

CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "status" text not null default 'draft'::text,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "created_by" uuid default auth.uid(),
    "created_at" timestamp with time zone default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone default timezone('utc'::text, now())
);


alter table "public"."sessions" enable row level security;

CREATE UNIQUE INDEX IF NOT EXISTS admin_credentials_pkey ON public.admin_credentials USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS admin_credentials_username_idx ON public.admin_credentials USING btree (lower(username));

CREATE UNIQUE INDEX IF NOT EXISTS admin_credentials_username_key ON public.admin_credentials USING btree (username);

CREATE UNIQUE INDEX IF NOT EXISTS drivers_pkey ON public.drivers USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS laps_pkey ON public.laps USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS race_events_pkey ON public.race_events USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS session_logs_pkey ON public.session_logs USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS session_members_pkey ON public.session_members USING btree (session_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS session_state_pkey ON public.session_state USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS session_state_session_unique_idx ON public.session_state USING btree (session_id);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_pkey ON public.sessions USING btree (id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_credentials_pkey') THEN
    alter table "public"."admin_credentials" add constraint "admin_credentials_pkey" PRIMARY KEY using index "admin_credentials_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_pkey') THEN
    alter table "public"."drivers" add constraint "drivers_pkey" PRIMARY KEY using index "drivers_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'laps_pkey') THEN
    alter table "public"."laps" add constraint "laps_pkey" PRIMARY KEY using index "laps_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pkey') THEN
    alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_events_pkey') THEN
    alter table "public"."race_events" add constraint "race_events_pkey" PRIMARY KEY using index "race_events_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_logs_pkey') THEN
    alter table "public"."session_logs" add constraint "session_logs_pkey" PRIMARY KEY using index "session_logs_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_members_pkey') THEN
    alter table "public"."session_members" add constraint "session_members_pkey" PRIMARY KEY using index "session_members_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_state_pkey') THEN
    alter table "public"."session_state" add constraint "session_state_pkey" PRIMARY KEY using index "session_state_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_pkey') THEN
    alter table "public"."sessions" add constraint "sessions_pkey" PRIMARY KEY using index "sessions_pkey";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_credentials_username_key') THEN
    alter table "public"."admin_credentials" add constraint "admin_credentials_username_key" UNIQUE using index "admin_credentials_username_key";
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_marshal_user_id_fkey') THEN
    alter table "public"."drivers" add constraint "drivers_marshal_user_id_fkey" FOREIGN KEY (marshal_user_id) REFERENCES auth.users(id) not valid;
  END IF;
END;
$$;

alter table "public"."drivers" validate constraint "drivers_marshal_user_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_session_id_fkey') THEN
    alter table "public"."drivers" add constraint "drivers_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) not valid;
  END IF;
END;
$$;

alter table "public"."drivers" validate constraint "drivers_session_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'laps_driver_id_fkey') THEN
    alter table "public"."laps" add constraint "laps_driver_id_fkey" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."laps" validate constraint "laps_driver_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'laps_session_id_fkey') THEN
    alter table "public"."laps" add constraint "laps_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."laps" validate constraint "laps_session_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey') THEN
    alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_events_session_id_fkey') THEN
    alter table "public"."race_events" add constraint "race_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."race_events" validate constraint "race_events_session_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_logs_session_id_fkey') THEN
    alter table "public"."session_logs" add constraint "session_logs_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."session_logs" validate constraint "session_logs_session_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_members_session_id_fkey') THEN
    alter table "public"."session_members" add constraint "session_members_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."session_members" validate constraint "session_members_session_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_members_user_id_fkey') THEN
    alter table "public"."session_members" add constraint "session_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
  END IF;
END;
$$;

alter table "public"."session_members" validate constraint "session_members_user_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_state_session_id_fkey') THEN
    alter table "public"."session_state" add constraint "session_state_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) not valid;
  END IF;
END;
$$;

alter table "public"."session_state" validate constraint "session_state_session_id_fkey";

set check_function_bodies = off;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.is_admin()'::regprocedure) THEN
    EXECUTE 'DROP FUNCTION public.is_admin() CASCADE';
  END IF;
END;
$$;
DO $$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.is_admin()
     RETURNS boolean
     LANGUAGE plpgsql
     STABLE
     SECURITY DEFINER
     SET search_path TO 'public', 'pg_temp'
    AS $function$
    declare
      v_user_id uuid := auth.uid();
    begin
      if v_user_id is null then
        return false;
      end if;

      return exists (
        select 1
        from public.profiles p
        where p.id = v_user_id
          and p.role = 'admin'
      );
    end;
    $function$
    ;
  $fn$;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.session_has_access(uuid)'::regprocedure) THEN
    EXECUTE 'DROP FUNCTION public.session_has_access(uuid) CASCADE';
  END IF;
END;
$$;
DO $$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.session_has_access(target_session_id uuid)
     RETURNS boolean
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $function$
      select
        public.is_admin()
        or (
          target_session_id is not null
          and (
            exists (
              select 1
              from public.sessions s
              where s.id = target_session_id
                and (s.created_by = auth.uid() or s.created_by is null)
            )
            or exists (
              select 1
              from public.session_members sm
              where sm.session_id = target_session_id
                and sm.user_id = auth.uid()
            )
          )
        );
    $function$
    ;
  $fn$;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.invalidate_last_lap_atomic(uuid, uuid, text)'::regprocedure) THEN
    EXECUTE 'DROP FUNCTION public.invalidate_last_lap_atomic(uuid, uuid, text) CASCADE';
  END IF;
END;
$$;
DO $$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.invalidate_last_lap_atomic(p_session_id uuid, p_driver_id uuid, p_mode text DEFAULT 'time_only'::text)
     RETURNS TABLE(invalidated_lap_id uuid, session_id uuid, driver_id uuid, laps integer, last_lap_ms bigint, best_lap_ms bigint, total_time_ms bigint)
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $function$
    declare
      v_lap_id uuid;
      v_lap_time bigint;
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

      select l.id, l.lap_time_ms
        into v_lap_id, v_lap_time
      from public.laps l
      where l.session_id = p_session_id
        and l.driver_id = p_driver_id
        and coalesce(l.invalidated, false) = false
      order by l.recorded_at desc
      limit 1
      for update;

      if v_lap_id is null then
        return;
      end if;

      update public.laps
         set invalidated = true,
             checkpoint_missed = (p_mode = 'remove_lap')
       where id = v_lap_id;

      update public.drivers d
         set last_lap_ms = (
                select lap_time_ms
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
                order by recorded_at desc
                limit 1
             ),
             best_lap_ms = (
                select min(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ),
             total_time_ms = coalesce((
                select sum(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ), 0),
             laps = case when p_mode = 'remove_lap'
                         then greatest(coalesce(d.laps, 0) - 1, 0)
                         else d.laps end,
             updated_at = timezone('utc', now())
       where d.id = p_driver_id and d.session_id = p_session_id;

      return query
      select v_lap_id,
             p_session_id,
             p_driver_id,
             d.laps,
             d.last_lap_ms,
             d.best_lap_ms,
             d.total_time_ms
      from public.drivers d
      where d.id = p_driver_id and d.session_id = p_session_id;
    end;
    $function$
    ;
  $fn$;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.log_lap_atomic(uuid, uuid, bigint, text)'::regprocedure) THEN
    EXECUTE 'DROP FUNCTION public.log_lap_atomic(uuid, uuid, bigint, text) CASCADE';
  END IF;
END;
$$;
DO $$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.log_lap_atomic(p_session_id uuid, p_driver_id uuid, p_lap_time_ms bigint, p_source text DEFAULT 'manual'::text)
     RETURNS TABLE(lap_id uuid, session_id uuid, driver_id uuid, laps integer, last_lap_ms bigint, best_lap_ms bigint, total_time_ms bigint)
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $function$
    declare
      v_new_lap_id uuid;
      v_best bigint;
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

      insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
      values (
        p_session_id,
        p_driver_id,
        coalesce((select max(lap_number) from public.laps where session_id = p_session_id and driver_id = p_driver_id), 0) + 1,
        p_lap_time_ms,
        p_source
      )
      returning id into v_new_lap_id;

      select best_lap_ms into v_best from public.drivers where id = p_driver_id;

      update public.drivers
         set laps          = coalesce(laps, 0) + 1,
             last_lap_ms   = p_lap_time_ms,
             best_lap_ms   = case when v_best is null then p_lap_time_ms else least(v_best, p_lap_time_ms) end,
             total_time_ms = coalesce(total_time_ms, 0) + p_lap_time_ms,
             updated_at    = timezone('utc', now())
       where id = p_driver_id and session_id = p_session_id;

      return query
      select v_new_lap_id,
             p_session_id,
             p_driver_id,
             d.laps,
             d.last_lap_ms,
             d.best_lap_ms,
             d.total_time_ms
      from public.drivers d
      where d.id = p_driver_id and d.session_id = p_session_id;
    end;
    $function$
    ;
  $fn$;
END;
$$;

grant delete on table "public"."admin_credentials" to "anon";

grant insert on table "public"."admin_credentials" to "anon";

grant references on table "public"."admin_credentials" to "anon";

grant select on table "public"."admin_credentials" to "anon";

grant trigger on table "public"."admin_credentials" to "anon";

grant truncate on table "public"."admin_credentials" to "anon";

grant update on table "public"."admin_credentials" to "anon";

grant delete on table "public"."admin_credentials" to "authenticated";

grant insert on table "public"."admin_credentials" to "authenticated";

grant references on table "public"."admin_credentials" to "authenticated";

grant select on table "public"."admin_credentials" to "authenticated";

grant trigger on table "public"."admin_credentials" to "authenticated";

grant truncate on table "public"."admin_credentials" to "authenticated";

grant update on table "public"."admin_credentials" to "authenticated";

grant delete on table "public"."admin_credentials" to "service_role";

grant insert on table "public"."admin_credentials" to "service_role";

grant references on table "public"."admin_credentials" to "service_role";

grant select on table "public"."admin_credentials" to "service_role";

grant trigger on table "public"."admin_credentials" to "service_role";

grant truncate on table "public"."admin_credentials" to "service_role";

grant update on table "public"."admin_credentials" to "service_role";

grant delete on table "public"."drivers" to "anon";

grant insert on table "public"."drivers" to "anon";

grant references on table "public"."drivers" to "anon";

grant select on table "public"."drivers" to "anon";

grant trigger on table "public"."drivers" to "anon";

grant truncate on table "public"."drivers" to "anon";

grant update on table "public"."drivers" to "anon";

grant delete on table "public"."drivers" to "authenticated";

grant insert on table "public"."drivers" to "authenticated";

grant references on table "public"."drivers" to "authenticated";

grant select on table "public"."drivers" to "authenticated";

grant trigger on table "public"."drivers" to "authenticated";

grant truncate on table "public"."drivers" to "authenticated";

grant update on table "public"."drivers" to "authenticated";

grant delete on table "public"."drivers" to "service_role";

grant insert on table "public"."drivers" to "service_role";

grant references on table "public"."drivers" to "service_role";

grant select on table "public"."drivers" to "service_role";

grant trigger on table "public"."drivers" to "service_role";

grant truncate on table "public"."drivers" to "service_role";

grant update on table "public"."drivers" to "service_role";

grant delete on table "public"."laps" to "anon";

grant insert on table "public"."laps" to "anon";

grant references on table "public"."laps" to "anon";

grant select on table "public"."laps" to "anon";

grant trigger on table "public"."laps" to "anon";

grant truncate on table "public"."laps" to "anon";

grant update on table "public"."laps" to "anon";

grant delete on table "public"."laps" to "authenticated";

grant insert on table "public"."laps" to "authenticated";

grant references on table "public"."laps" to "authenticated";

grant select on table "public"."laps" to "authenticated";

grant trigger on table "public"."laps" to "authenticated";

grant truncate on table "public"."laps" to "authenticated";

grant update on table "public"."laps" to "authenticated";

grant delete on table "public"."laps" to "service_role";

grant insert on table "public"."laps" to "service_role";

grant references on table "public"."laps" to "service_role";

grant select on table "public"."laps" to "service_role";

grant trigger on table "public"."laps" to "service_role";

grant truncate on table "public"."laps" to "service_role";

grant update on table "public"."laps" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."race_events" to "anon";

grant insert on table "public"."race_events" to "anon";

grant references on table "public"."race_events" to "anon";

grant select on table "public"."race_events" to "anon";

grant trigger on table "public"."race_events" to "anon";

grant truncate on table "public"."race_events" to "anon";

grant update on table "public"."race_events" to "anon";

grant delete on table "public"."race_events" to "authenticated";

grant insert on table "public"."race_events" to "authenticated";

grant references on table "public"."race_events" to "authenticated";

grant select on table "public"."race_events" to "authenticated";

grant trigger on table "public"."race_events" to "authenticated";

grant truncate on table "public"."race_events" to "authenticated";

grant update on table "public"."race_events" to "authenticated";

grant delete on table "public"."race_events" to "service_role";

grant insert on table "public"."race_events" to "service_role";

grant references on table "public"."race_events" to "service_role";

grant select on table "public"."race_events" to "service_role";

grant trigger on table "public"."race_events" to "service_role";

grant truncate on table "public"."race_events" to "service_role";

grant update on table "public"."race_events" to "service_role";

grant delete on table "public"."session_logs" to "anon";

grant insert on table "public"."session_logs" to "anon";

grant references on table "public"."session_logs" to "anon";

grant select on table "public"."session_logs" to "anon";

grant trigger on table "public"."session_logs" to "anon";

grant truncate on table "public"."session_logs" to "anon";

grant update on table "public"."session_logs" to "anon";

grant delete on table "public"."session_logs" to "authenticated";

grant insert on table "public"."session_logs" to "authenticated";

grant references on table "public"."session_logs" to "authenticated";

grant select on table "public"."session_logs" to "authenticated";

grant trigger on table "public"."session_logs" to "authenticated";

grant truncate on table "public"."session_logs" to "authenticated";

grant update on table "public"."session_logs" to "authenticated";

grant delete on table "public"."session_logs" to "service_role";

grant insert on table "public"."session_logs" to "service_role";

grant references on table "public"."session_logs" to "service_role";

grant select on table "public"."session_logs" to "service_role";

grant trigger on table "public"."session_logs" to "service_role";

grant truncate on table "public"."session_logs" to "service_role";

grant update on table "public"."session_logs" to "service_role";

grant delete on table "public"."session_members" to "anon";

grant insert on table "public"."session_members" to "anon";

grant references on table "public"."session_members" to "anon";

grant select on table "public"."session_members" to "anon";

grant trigger on table "public"."session_members" to "anon";

grant truncate on table "public"."session_members" to "anon";

grant update on table "public"."session_members" to "anon";

grant delete on table "public"."session_members" to "authenticated";

grant insert on table "public"."session_members" to "authenticated";

grant references on table "public"."session_members" to "authenticated";

grant select on table "public"."session_members" to "authenticated";

grant trigger on table "public"."session_members" to "authenticated";

grant truncate on table "public"."session_members" to "authenticated";

grant update on table "public"."session_members" to "authenticated";

grant delete on table "public"."session_members" to "service_role";

grant insert on table "public"."session_members" to "service_role";

grant references on table "public"."session_members" to "service_role";

grant select on table "public"."session_members" to "service_role";

grant trigger on table "public"."session_members" to "service_role";

grant truncate on table "public"."session_members" to "service_role";

grant update on table "public"."session_members" to "service_role";

grant delete on table "public"."session_state" to "anon";

grant insert on table "public"."session_state" to "anon";

grant references on table "public"."session_state" to "anon";

grant select on table "public"."session_state" to "anon";

grant trigger on table "public"."session_state" to "anon";

grant truncate on table "public"."session_state" to "anon";

grant update on table "public"."session_state" to "anon";

grant delete on table "public"."session_state" to "authenticated";

grant insert on table "public"."session_state" to "authenticated";

grant references on table "public"."session_state" to "authenticated";

grant select on table "public"."session_state" to "authenticated";

grant trigger on table "public"."session_state" to "authenticated";

grant truncate on table "public"."session_state" to "authenticated";

grant update on table "public"."session_state" to "authenticated";

grant delete on table "public"."session_state" to "service_role";

grant insert on table "public"."session_state" to "service_role";

grant references on table "public"."session_state" to "service_role";

grant select on table "public"."session_state" to "service_role";

grant trigger on table "public"."session_state" to "service_role";

grant truncate on table "public"."session_state" to "service_role";

grant update on table "public"."session_state" to "service_role";

grant delete on table "public"."sessions" to "anon";

grant insert on table "public"."sessions" to "anon";

grant references on table "public"."sessions" to "anon";

grant select on table "public"."sessions" to "anon";

grant trigger on table "public"."sessions" to "anon";

grant truncate on table "public"."sessions" to "anon";

grant update on table "public"."sessions" to "anon";

grant delete on table "public"."sessions" to "authenticated";

grant insert on table "public"."sessions" to "authenticated";

grant references on table "public"."sessions" to "authenticated";

grant select on table "public"."sessions" to "authenticated";

grant trigger on table "public"."sessions" to "authenticated";

grant truncate on table "public"."sessions" to "authenticated";

grant update on table "public"."sessions" to "authenticated";

grant delete on table "public"."sessions" to "service_role";

grant insert on table "public"."sessions" to "service_role";

grant references on table "public"."sessions" to "service_role";

grant select on table "public"."sessions" to "service_role";

grant trigger on table "public"."sessions" to "service_role";

grant truncate on table "public"."sessions" to "service_role";

grant update on table "public"."sessions" to "service_role";

create policy "Admin full access to drivers"
on "public"."drivers"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Session scoped access for drivers"
on "public"."drivers"
as permissive
for all
to public
using (session_has_access(session_id))
with check (session_has_access(session_id));


create policy "Admin full access to laps"
on "public"."laps"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Session scoped access for laps"
on "public"."laps"
as permissive
for all
to public
using (session_has_access(session_id))
with check (session_has_access(session_id));


create policy "Profiles are manageable by owner or admins"
on "public"."profiles"
as permissive
for all
to public
using (((auth.uid() = id) OR is_admin()))
with check (((auth.uid() = id) OR is_admin()));


create policy "Profiles are readable by owner or admins"
on "public"."profiles"
as permissive
for select
to public
using (((auth.uid() = id) OR is_admin()));


create policy "Admin full access to race events"
on "public"."race_events"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Session scoped access for race events"
on "public"."race_events"
as permissive
for all
to public
using (session_has_access(session_id))
with check (session_has_access(session_id));


create policy "Admin full access to session logs"
on "public"."session_logs"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Members view session logs"
on "public"."session_logs"
as permissive
for select
to public
using (session_has_access(session_id));


create policy "Owners record session logs"
on "public"."session_logs"
as permissive
for insert
to public
with check (session_has_access(session_id));


create policy "Admin full access to session members"
on "public"."session_members"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Members view membership"
on "public"."session_members"
as permissive
for select
to public
using ((is_admin() OR (auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_members.session_id) AND ((s.created_by = auth.uid()) OR (s.created_by IS NULL)))))));


create policy "Owners manage membership"
on "public"."session_members"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_members.session_id) AND (s.created_by = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_members.session_id) AND (s.created_by = auth.uid())))));


create policy "Admin full access to session state"
on "public"."session_state"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Session scoped access for session state"
on "public"."session_state"
as permissive
for all
to public
using (session_has_access(session_id))
with check (session_has_access(session_id));


create policy "Admin full access to sessions"
on "public"."sessions"
as permissive
for all
to public
using (is_admin())
with check (is_admin());


create policy "Members view shared sessions"
on "public"."sessions"
as permissive
for select
to public
using (session_has_access(id));


create policy "Owners manage their sessions"
on "public"."sessions"
as permissive
for all
to public
using (((auth.uid() = created_by) OR (created_by IS NULL)))
with check (((auth.uid() = created_by) OR (created_by IS NULL)));
