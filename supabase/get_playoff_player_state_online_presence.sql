CREATE OR REPLACE FUNCTION public.get_playoff_player_state(input_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user_id uuid;
    v_event public.playoff_events%rowtype;
    v_participant public.playoff_participants%rowtype;
    v_question public.playoff_questions%rowtype;

    v_question_visible boolean := false;

    v_total_invited integer := 0;
    v_joined_count integer := 0;
    v_joined_players jsonb := '[]'::jsonb;
    v_online_count integer := 0;
    v_online_players jsonb := '[]'::jsonb;

    v_now timestamptz := clock_timestamp();
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Authentication required.';
    end if;

    if input_event_id is null then
        raise exception using
            errcode = '22004',
            message = 'Event ID is required.';
    end if;

    select p.*
    into v_participant
    from public.playoff_participants p
    where p.event_id = input_event_id
      and p.user_id = v_user_id;

    if not found then
        raise exception using
            errcode = '42501',
            message = 'You are not a participant in this playoff.';
    end if;

    -- --------------------------------------------------------
    -- PRESENCE HEARTBEAT
    --
    -- Player state is polled every 2.5 seconds.
    -- Refresh last_seen_at at most once every 10 seconds so
    -- presence stays current without writing on every poll.
    --
    -- This is informational presence only.
    -- It does NOT change competition status or eligibility.
    -- --------------------------------------------------------

    if v_participant.last_seen_at is null
       or v_participant.last_seen_at < v_now - interval '10 seconds' then

        update public.playoff_participants
        set last_seen_at = v_now
        where id = v_participant.id;

        v_participant.last_seen_at := v_now;
    end if;

    select e.*
    into v_event
    from public.playoff_events e
    where e.id = input_event_id;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Playoff event not found.';
    end if;

    /*
     * Waiting-room totals.
     * Denominator: every participant attached to this event.
     * Numerator: participants whose joined_at value is present.
     */
    select
        count(*)::integer,
        count(*) filter (
            where p.joined_at is not null
        )::integer
    into
        v_total_invited,
        v_joined_count
    from public.playoff_participants p
    where p.event_id = input_event_id;

    /*
     * Joined-player roster.
     * LEFT JOIN ensures a missing profile does not remove a participant.
     */
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'displayName',
                    coalesce(
                        nullif(pr.display_name, ''),
                        nullif(p.display_name, ''),
                        'A player'
                    ),
                'avatarKey', pr.avatar_key,
                'avatarUrl', pr.avatar_url,
                'joinedAt', p.joined_at
            )
            order by p.joined_at asc
        ),
        '[]'::jsonb
    )
    into v_joined_players
    from public.playoff_participants p
    left join public.profiles pr
      on pr.id = p.user_id
    where p.event_id = input_event_id
      and p.joined_at is not null;

    select count(*)::integer
    into v_online_count
    from public.playoff_participants p
    where p.event_id = input_event_id
      and p.joined_at is not null
      and p.last_seen_at is not null
      and p.last_seen_at >= v_now - interval '90 seconds';

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'displayName',
                    coalesce(
                        nullif(pr.display_name, ''),
                        nullif(p.display_name, ''),
                        'A player'
                    ),
                'avatarKey', pr.avatar_key,
                'avatarUrl', pr.avatar_url,
                'joinedAt', p.joined_at
            )
            order by p.joined_at asc
        ),
        '[]'::jsonb
    )
    into v_online_players
    from public.playoff_participants p
    left join public.profiles pr
      on pr.id = p.user_id
    where p.event_id = input_event_id
      and p.joined_at is not null
      and p.last_seen_at is not null
      and p.last_seen_at >= v_now - interval '90 seconds';

    if v_event.active_question_number is not null then
        select q.*
        into v_question
        from public.playoff_questions q
        where q.event_id = v_event.id
          and q.question_number = v_event.active_question_number
        limit 1;

        if found then
            v_question_visible :=
                v_question.opened_at is not null
                and v_question.closed_at is null
                and v_event.status <> 'paused'
                and v_participant.current_status <> 'eliminated'
                and not (
                    v_question.question_number = 3
                    and v_participant.is_finalist = false
                );
        end if;
    end if;

    return jsonb_build_object(
        'ok', true,

        'event_id', v_event.id,
        'event_name', v_event.name,
        'event_status', v_event.status,
        'active_question_number', v_event.active_question_number,
        'winner_participant_id', v_event.winner_participant_id,

        'participant_id', v_participant.id,
        'display_name', v_participant.display_name,
        'participant_status', v_participant.current_status,
        'question_2_slot', v_participant.question_2_slot,
        'is_finalist', v_participant.is_finalist,
        'is_winner', v_participant.is_winner,
        'eliminated_at', v_participant.eliminated_at,

        'totalInvited', v_total_invited,
        'joinedCount', v_joined_count,
        'joinedPlayers', v_joined_players,
        'onlineCount', v_online_count,
        'onlinePlayers', v_online_players,

        'question',
            case
                when v_question_visible then
                    jsonb_build_object(
                        'id', v_question.id,
                        'question_number', v_question.question_number,
                        'prompt', v_question.prompt,
                        'opened_at', v_question.opened_at,
                        'advancement_mode', v_question.advancement_mode,
                        'advance_limit', v_question.advance_limit
                    )
                else null
            end
    );
end;
$function$;
