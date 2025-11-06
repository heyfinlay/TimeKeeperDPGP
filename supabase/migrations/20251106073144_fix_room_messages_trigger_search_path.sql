-- ============================================================================
-- Migration: Fix mutable search_path on room_messages_broadcast_trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.room_messages_broadcast_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime'
AS $function$
declare
  sid text;
begin
  -- Choose the right identifier
  sid :=
    coalesce(
      (to_jsonb(NEW)->>'session_id'),
      (to_jsonb(OLD)->>'session_id'),
      (to_jsonb(NEW)->>'id'),
      (to_jsonb(OLD)->>'id')
    );

  perform realtime.broadcast_changes(
    'room:' || sid,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return coalesce(NEW, OLD);
end;
$function$;
