-- Fix missing unique constraint on session_members that causes ON CONFLICT error
-- This migration is idempotent and safe to run multiple times

-- Ensure the unique constraint exists for the create_session_atomic function
DO $$
BEGIN
  -- Check if the unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'session_members'
    AND indexname = 'session_members_pkey'
  ) THEN
    RAISE NOTICE 'Creating unique index session_members_pkey';
    CREATE UNIQUE INDEX session_members_pkey
      ON public.session_members (session_id, user_id);
  ELSE
    RAISE NOTICE 'Index session_members_pkey already exists';
  END IF;

  -- Ensure it's used as primary key constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND connamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE 'Adding primary key constraint session_members_pkey';
    ALTER TABLE public.session_members
      ADD CONSTRAINT session_members_pkey
      PRIMARY KEY USING INDEX session_members_pkey;
  ELSE
    RAISE NOTICE 'Primary key constraint session_members_pkey already exists';
  END IF;
END;
$$;

-- Verify the constraint is in place
DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND contype = 'p'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE 'SUCCESS: session_members primary key constraint verified';
  ELSE
    RAISE EXCEPTION 'FAILED: session_members primary key constraint not found after migration';
  END IF;
END;
$$;
