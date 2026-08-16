BEGIN;

CREATE TABLE IF NOT EXISTS public.playoff_event_target_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.playoff_event_target_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.playoff_event_target_map FROM PUBLIC;
REVOKE ALL ON TABLE public.playoff_event_target_map FROM anon;
REVOKE ALL ON TABLE public.playoff_event_target_map FROM authenticated;

CREATE OR REPLACE FUNCTION public.ensure_stage16_playoff_enrollment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_source_key text := 'stage16';
  v_target_row public.playoff_event_target_map%rowtype;
  v_event_id uuid;
  v_event public.playoff_events%rowtype;
  v_existing_participant public.playoff_participants%rowtype;
  v_existing_by_email public.playoff_participants%rowtype;
  v_raw_token text;
  v_hash bytea;
  v_participant_id uuid;
  v_stage16_solved boolean := false;
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

  select exists (
    select 1
    from public.solves s
    where s.user_id = v_user_id
      and s.stage = 16
      and coalesce(s.max_step_solved, 0) >= 1
  )
  into v_stage16_solved;

  if not v_stage16_solved then
    raise exception using
      errcode = 'P0001',
      message = 'Stage 16 qualification required.';
  end if;

  select *
  into v_target_row
  from public.playoff_event_target_map
  where lower(btrim(source_key)) = lower(btrim(v_source_key))
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No Stage 16 enrollment target is configured.';
  end if;

  v_event_id := v_target_row.event_id;

  select *
  into v_event
  from public.playoff_events
  where id = v_event_id
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Target playoff event not found.';
  end if;

  if v_event.status in ('closed', 'archived') then
    raise exception using
      errcode = 'P0001',
      message = 'Target playoff event is not accepting enrollment.';
  end if;

  select *
  into v_existing_participant
  from public.playoff_participants
  where event_id = v_event_id
    and user_id = v_user_id
  limit 1
  for update;

  if found then
    v_participant_id := v_existing_participant.id;
    update public.playoff_participants
    set expected_email = coalesce(expected_email, v_user_email),
        display_name = coalesce(display_name, coalesce(split_part(v_user_email, '@', 1), v_user_email)),
        updated_at = now()
    where id = v_existing_participant.id;
  else
    select *
    into v_existing_by_email
    from public.playoff_participants
    where event_id = v_event_id
      and lower(btrim(coalesce(expected_email, ''))) = v_user_email
    limit 1
    for update;

    if found then
      if v_existing_by_email.user_id is null then
        update public.playoff_participants
        set user_id = v_user_id,
            expected_email = v_user_email,
            display_name = coalesce(display_name, coalesce(split_part(v_user_email, '@', 1), v_user_email)),
            updated_at = now()
        where id = v_existing_by_email.id;
        v_participant_id := v_existing_by_email.id;
      elsif v_existing_by_email.user_id = v_user_id then
        v_participant_id := v_existing_by_email.id;
      else
        raise exception using
          errcode = '23505',
          message = 'Playoff participant ownership conflict.';
      end if;
    else
      v_raw_token := public.playoff_generate_invitation_token();
      v_hash := public.playoff_hash_invitation_token(v_raw_token);

      begin
        insert into public.playoff_participants (
          event_id,
          user_id,
          expected_email,
          display_name,
          current_status,
          invitation_token_hash,
          is_finalist,
          is_winner,
          eliminated_at,
          created_at,
          updated_at
        )
        values (
          v_event_id,
          v_user_id,
          v_user_email,
          coalesce(split_part(v_user_email, '@', 1), v_user_email),
          'invited',
          v_hash,
          false,
          false,
          null,
          now(),
          now()
        )
        returning id into v_participant_id;
      exception when unique_violation then
        select *
        into v_existing_participant
        from public.playoff_participants
        where event_id = v_event_id
          and user_id = v_user_id
        limit 1
        for update;

        if found then
          v_participant_id := v_existing_participant.id;
        else
          select *
          into v_existing_by_email
          from public.playoff_participants
          where event_id = v_event_id
            and lower(btrim(coalesce(expected_email, ''))) = v_user_email
          limit 1
          for update;

          if found then
            if v_existing_by_email.user_id is null then
              update public.playoff_participants
              set user_id = v_user_id,
                  expected_email = v_user_email,
                  display_name = coalesce(display_name, coalesce(split_part(v_user_email, '@', 1), v_user_email)),
                  updated_at = now()
              where id = v_existing_by_email.id;
              v_participant_id := v_existing_by_email.id;
            elsif v_existing_by_email.user_id = v_user_id then
              v_participant_id := v_existing_by_email.id;
            else
              raise exception using
                errcode = '23505',
                message = 'Playoff participant ownership conflict.';
            end if;
          else
            raise;
          end if;
        end if;
      end;
    end if;
  end if;

  select *
  into v_existing_participant
  from public.playoff_participants
  where id = v_participant_id
  limit 1;

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'participant_id', v_existing_participant.id,
    'enrolled', true,
    'has_joined', v_existing_participant.joined_at is not null,
    'already_exists', v_existing_participant.user_id = v_user_id and v_existing_participant.event_id = v_event_id
  );

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.ensure_stage16_playoff_enrollment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_stage16_playoff_enrollment() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_stage16_playoff_enrollment() TO authenticated;

COMMIT;
