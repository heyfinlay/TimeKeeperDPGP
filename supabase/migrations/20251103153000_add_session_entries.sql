DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'session_entries'
  ) THEN
    CREATE TABLE public.session_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      driver_id uuid NOT NULL,
      driver_number integer,
      driver_name text,
      team_name text,
      position integer,
      marshal_user_id uuid,
      created_at timestamp with time zone DEFAULT timezone('utc', now()),
      updated_at timestamp with time zone DEFAULT timezone('utc', now())
    );

    ALTER TABLE public.session_entries ENABLE ROW LEVEL SECURITY;

    CREATE UNIQUE INDEX session_entries_session_driver_unique_idx
      ON public.session_entries USING btree (session_id, driver_id);

    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'session_entries_session_id_fkey'
      ) THEN
        ALTER TABLE public.session_entries
          ADD CONSTRAINT session_entries_session_id_fkey
          FOREIGN KEY (session_id)
          REFERENCES public.sessions (id)
          ON DELETE CASCADE
          NOT VALID;
        ALTER TABLE public.session_entries
          VALIDATE CONSTRAINT session_entries_session_id_fkey;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'session_entries_driver_id_fkey'
      ) THEN
        ALTER TABLE public.session_entries
          ADD CONSTRAINT session_entries_driver_id_fkey
          FOREIGN KEY (driver_id)
          REFERENCES public.drivers (id)
          ON DELETE CASCADE
          NOT VALID;
        ALTER TABLE public.session_entries
          VALIDATE CONSTRAINT session_entries_driver_id_fkey;
      END IF;
    END;
    $inner$;

    -- Policies mirror other session-scoped resources
    CREATE POLICY "Admin full access to session entries"
      ON public.session_entries
      AS PERMISSIVE
      FOR ALL
      TO public
      USING (is_admin())
      WITH CHECK (is_admin());

    CREATE POLICY "Session scoped access for session entries"
      ON public.session_entries
      AS PERMISSIVE
      FOR ALL
      TO public
      USING (session_has_access(session_id))
      WITH CHECK (session_has_access(session_id));

    GRANT ALL PRIVILEGES ON TABLE public.session_entries TO service_role;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.session_entries TO authenticated;
  END IF;
END;
$$;
