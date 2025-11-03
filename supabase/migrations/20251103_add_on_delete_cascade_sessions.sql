-- Add ON DELETE CASCADE to all FKs referencing public.sessions
-- Safely rebuilds constraints to preserve column order, match type, deferrability,
-- and ON UPDATE behaviour, while enforcing ON DELETE CASCADE.
-- Generated via maintenance task; safe to run multiple times.

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_child_cols text;
  v_parent_cols text;
  v_on_update text;
  v_match text;
  v_deferrable text;
  v_not_valid text;
BEGIN
  FOR r IN
    SELECT
      con.oid              AS con_oid,
      con.conname,
      con.conrelid,
      con.confrelid,
      child_ns.nspname     AS child_schema,
      child.relname        AS child_table,
      parent_ns.nspname    AS parent_schema,
      parent.relname       AS parent_table,
      con.conkey,
      con.confkey,
      con.confupdtype,
      con.confdeltype,
      con.conmatchtype,
      con.condeferrable,
      con.condeferred,
      con.convalidated
    FROM pg_constraint con
    JOIN pg_class child        ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent       ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE con.contype = 'f'
      AND parent_ns.nspname = 'public'
      AND parent.relname = 'sessions'
  LOOP
    -- Skip if already ON DELETE CASCADE
    IF r.confdeltype = 'c' THEN
      CONTINUE;
    END IF;

    -- Child column list
    SELECT string_agg(quote_ident(att.attname), ', ' ORDER BY s.ord)
      INTO v_child_cols
    FROM unnest(r.conkey) WITH ORDINALITY AS s(attnum, ord)
    JOIN pg_attribute att ON att.attrelid = r.conrelid AND att.attnum = s.attnum;

    -- Parent column list
    SELECT string_agg(quote_ident(att.attname), ', ' ORDER BY s.ord)
      INTO v_parent_cols
    FROM unnest(r.confkey) WITH ORDINALITY AS s(attnum, ord)
    JOIN pg_attribute att ON att.attrelid = r.confrelid AND att.attnum = s.attnum;

    -- Preserve ON UPDATE action
    v_on_update := CASE r.confupdtype
      WHEN 'a' THEN 'ON UPDATE NO ACTION'
      WHEN 'r' THEN 'ON UPDATE RESTRICT'
      WHEN 'c' THEN 'ON UPDATE CASCADE'
      WHEN 'n' THEN 'ON UPDATE SET NULL'
      WHEN 'd' THEN 'ON UPDATE SET DEFAULT'
      ELSE ''
    END;

    -- Preserve MATCH type
    v_match := CASE r.conmatchtype
      WHEN 'f' THEN 'MATCH FULL'
      WHEN 's' THEN 'MATCH SIMPLE'
      ELSE ''
    END;

    -- Preserve deferrability
    v_deferrable := CASE
      WHEN r.condeferrable AND r.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED'
      WHEN r.condeferrable AND NOT r.condeferred THEN 'DEFERRABLE INITIALLY IMMEDIATE'
      ELSE 'NOT DEFERRABLE'
    END;

    -- Preserve NOT VALID state if it existed
    v_not_valid := CASE WHEN r.convalidated THEN '' ELSE 'NOT VALID' END;

    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I;', r.child_schema, r.child_table, r.conname);

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I.%I (%s) %s ON DELETE CASCADE %s %s;',
      r.child_schema, r.child_table, r.conname,
      v_child_cols,
      r.parent_schema, r.parent_table, v_parent_cols,
      v_match, v_on_update, v_deferrable
    ) || CASE WHEN v_not_valid <> '' THEN ' ' || v_not_valid ELSE '' END;
  END LOOP;
END;
$$;

COMMIT;