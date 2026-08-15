CREATE OR REPLACE FUNCTION public.join_playoff_by_account(input_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_event_id uuid := input_event_id;
  v_event public.playoff_events%rowtype;
  v_participant public.playoff_participants%rowtype;
  v_effective_status text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if v_user_email = '' then
    raise exception using
      errcode = '42501',
      message = 'Authenticated account has no email address.';
  end if;

  if v_event_id is null then
    raise exception using
      errcode = '22004',
      message = 'Event ID is required.';
  end if;

  select *
  into v_event
  from public.playoff_events
  where id = v_event_id
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Playoff event not found.';
  end if;

  if v_event.status in ('closed', 'archived') then
    raise exception using
      errcode = 'P0001',
      message = 'Playoff event is not accepting new entries.';
  end if;

  v_effective_status := v_event.status;
  if v_event.status = 'paused' and v_event.pre_pause_status is not null then
    v_effective_status := v_event.pre_pause_status;
  end if;

  select *
  into v_participant
  from public.playoff_participants
  where event_id = v_event_id
    and user_id = v_user_id
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Playoff participant not found for this account.';
  end if;

  if lower(btrim(coalesce(v_participant.expected_email, ''))) <> v_user_email then
    raise exception using
      errcode = '23505',
      message = 'Playoff participant email mismatch.';
  end if;

  if v_participant.joined_at is null then
    if v_effective_status not in ('draft', 'waiting_for_players', 'question_1_open') then
      raise exception using
        errcode = 'P0001',
        message = 'PLAYOFF_JOIN_CUTOFF';
    end if;

    if v_effective_status = 'question_1_open' then
      update public.playoff_participants
      set current_status = 'answering',
          joined_at = now(),
          last_seen_at = now(),
          updated_at = now()
      where id = v_participant.id;
    elsif v_effective_status = 'waiting_for_players' then
      update public.playoff_participants
      set current_status = 'ready',
          joined_at = now(),
          last_seen_at = now(),
          updated_at = now()
      where id = v_participant.id;
    else
      update public.playoff_participants
      set current_status = 'invited',
          joined_at = now(),
          last_seen_at = now(),
          updated_at = now()
      where id = v_participant.id;
    end if;
  else
    update public.playoff_participants
    set last_seen_at = now(),
        updated_at = now()
    where id = v_participant.id;
  end if;

  select *
  into v_participant
  from public.playoff_participants
  where id = v_participant.id
  limit 1;

  v_result := jsonb_build_object(
    'event_id', v_event.id,
    'event_name', v_event.name,
    'participant_id', v_participant.id,
    'player_status', coalesce(v_participant.current_status, 'waiting')
  );

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.join_playoff_by_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_playoff_by_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_playoff_by_account(uuid) TO authenticated;
