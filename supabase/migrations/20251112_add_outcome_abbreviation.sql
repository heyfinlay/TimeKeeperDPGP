-- Add abbreviation column to outcomes table for LiveBetsTicker display
-- This column stores short forms of outcome names for compact UI display

ALTER TABLE public.outcomes
ADD COLUMN IF NOT EXISTS abbreviation text;

COMMENT ON COLUMN public.outcomes.abbreviation IS 'Short abbreviation for the outcome (e.g., "LSC" for "Los Santos Customs")';

-- Optionally populate abbreviations for existing outcomes
-- Example: Take first 3-4 characters or create custom abbreviations
UPDATE public.outcomes
SET abbreviation =
  CASE
    WHEN LENGTH(label) <= 4 THEN UPPER(label)
    ELSE UPPER(LEFT(REGEXP_REPLACE(label, '[^A-Za-z]', '', 'g'), 4))
  END
WHERE abbreviation IS NULL;
