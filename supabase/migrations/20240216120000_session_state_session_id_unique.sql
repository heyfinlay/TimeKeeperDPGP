-- Ensure session_state rows remain unique per session
-- Before applying any schema change, verify that the updated constraint and ON CONFLICT clause match,
-- and confirm you're not breaking existing data or migrations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'session_state'
  ) THEN
    -- Keep the most recently updated row for any duplicated session_id
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY session_id
          ORDER BY updated_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM public.session_state
    )
    DELETE FROM public.session_state
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'session_state_session_id_key'
    ) THEN
      ALTER TABLE public.session_state
        ADD CONSTRAINT session_state_session_id_key UNIQUE (session_id);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
