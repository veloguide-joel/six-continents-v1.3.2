CREATE OR REPLACE FUNCTION public.host_recover_playoff_event(input_event_id uuid, input_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user_id uuid;
    v_user_email text;
    v_is_admin boolean := false;

    v_event public.playoff_events%rowtype;
    v_q1 public.playoff_questions%rowtype;
    v_q2 public.playoff_questions%rowtype;
    v_q3 public.playoff_questions%rowtype;

    v_action text;
    v_effective_status text;
    v_old_status text;
    v_new_status text;

    v_restart_round smallint := null;
    v_rollback_target_round smallint := null;
    v_recovery_question_id uuid := null;

    v_deleted_submissions integer := 0;
    v_affected_participants integer := 0;

    v_now timestamptz := clock_timestamp();
begin
    -- --------------------------------------------------------
    -- 1. AUTHENTICATION / AUTHORIZATION
    -- Same admin model as existing host RPCs.
    -- --------------------------------------------------------

    v_user_id := auth.uid();
    v_user_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
    v_action := lower(btrim(coalesce(input_action, '')));

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
        from public.admin_emails a
        where lower(btrim(a.email)) = v_user_email
    )
    into v_is_admin;

    if not v_is_admin then
        raise exception using
            errcode = '42501',
            message = 'Administrator access required.';
    end if;

    if input_event_id is null then
        raise exception using
            errcode = '22004',
            message = 'Event ID is required.';
    end if;

    if v_action not in (
        'restart_current_round',
        'rollback_one_round',
        'full_reset'
    ) then
        raise exception using
            errcode = '22023',
            message = 'Unsupported playoff recovery action.';
    end if;


    -- --------------------------------------------------------
    -- 2. LOCK EVENT
    -- --------------------------------------------------------

    select e.*
    into v_event
    from public.playoff_events e
    where e.id = input_event_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Playoff event not found.';
    end if;

    v_old_status := v_event.status;

    -- Closed/archived historical events are intentionally not
    -- reopened by emergency live-event recovery.
    if v_event.status in ('closed', 'archived') then
        raise exception using
            errcode = 'P0001',
            message = format(
                'Recovery is not allowed while event status is %s.',
                v_event.status
            );
    end if;

    v_effective_status :=
        case
            when v_event.status = 'paused'
                then v_event.pre_pause_status
            else v_event.status
        end;

    if v_event.status = 'paused'
       and v_effective_status is null then
        raise exception using
            errcode = 'P0001',
            message = 'Paused event has no recoverable pre-pause state.';
    end if;


    -- --------------------------------------------------------
    -- 3. LOCK QUESTIONS
    -- --------------------------------------------------------

    select q.*
    into v_q1
    from public.playoff_questions q
    where q.event_id = input_event_id
      and q.question_number = 1
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Round 1 question was not found.';
    end if;

    select q.*
    into v_q2
    from public.playoff_questions q
    where q.event_id = input_event_id
      and q.question_number = 2
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Round 2 question was not found.';
    end if;

    select q.*
    into v_q3
    from public.playoff_questions q
    where q.event_id = input_event_id
      and q.question_number = 3
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Round 3 question was not found.';
    end if;

    -- Serialize participant/submission mutation with any other
    -- operation touching this event.

    perform 1
    from public.playoff_participants p
    where p.event_id = input_event_id
    for update;

    perform 1
    from public.playoff_submissions s
    where s.event_id = input_event_id
    for update;


    -- ========================================================
    -- ACTION: FULL RESET
    --
    -- Return event to DRAFT.
    --
    -- Preserve:
    --   event / question identity
    --   prompts / answer data
    --   advancement configuration
    --   invitation hashes
    --   expected emails
    --   user_id bindings
    --
    -- Clear all runtime competition state.
    -- ========================================================

    if v_action = 'full_reset' then

        if v_event.status = 'draft' then
            raise exception using
                errcode = 'P0001',
                message = 'Event is already in draft.';
        end if;

        delete from public.playoff_submissions s
        where s.event_id = input_event_id;

        get diagnostics v_deleted_submissions = row_count;

        update public.playoff_questions
        set
            opened_at = null,
            closed_at = null,
            updated_at = v_now
        where event_id = input_event_id;

        update public.playoff_participants
        set
            current_status = 'invited',
            joined_at = null,
            last_seen_at = null,
            question_2_slot = null,
            is_finalist = false,
            is_winner = false,
            eliminated_at = null,
            updated_at = v_now
        where event_id = input_event_id;

        get diagnostics v_affected_participants = row_count;

        update public.playoff_events
        set
            status = 'draft',
            active_question_number = null,
            pre_pause_status = null,
            winner_participant_id = null,
            winner_selection_type = null,
            started_at = null,
            paused_at = null,
            completed_at = null,
            closed_at = null,
            archived_at = null,
            updated_at = v_now
        where id = input_event_id;

        v_new_status := 'draft';


    -- ========================================================
    -- ACTION: RESTART CURRENT ROUND
    -- ========================================================

    elsif v_action = 'restart_current_round' then

        if v_effective_status in (
            'question_1_open',
            'question_1_complete'
        ) then
            v_restart_round := 1;
            v_recovery_question_id := v_q1.id;

        elsif v_effective_status in (
            'question_2_open',
            'question_2_complete'
        ) then
            v_restart_round := 2;
            v_recovery_question_id := v_q2.id;

        elsif v_effective_status in (
            'question_3_open',
            'winner_locked'
        ) then
            v_restart_round := 3;
            v_recovery_question_id := v_q3.id;

        else
            raise exception using
                errcode = 'P0001',
                message = format(
                    'There is no current round to restart from status %s.',
                    coalesce(v_effective_status, v_event.status)
                );
        end if;


        -- ----------------------------------------------------
        -- Restart Round 1
        -- ----------------------------------------------------

        if v_restart_round = 1 then

            delete from public.playoff_submissions s
            using public.playoff_questions q
            where s.question_id = q.id
              and q.event_id = input_event_id
              and q.question_number >= 1;

            get diagnostics v_deleted_submissions = row_count;

            update public.playoff_questions
            set
                opened_at = case
                    when question_number = 1 then v_now
                    else null
                end,
                closed_at = null,
                updated_at = v_now
            where event_id = input_event_id;

            update public.playoff_participants
            set
                current_status = case
                    when user_id is not null
                         and joined_at is not null
                        then 'answering'
                    else 'invited'
                end,
                question_2_slot = null,
                is_finalist = false,
                is_winner = false,
                eliminated_at = null,
                updated_at = v_now
            where event_id = input_event_id;

            get diagnostics v_affected_participants = row_count;

            update public.playoff_events
            set
                status = 'question_1_open',
                active_question_number = 1,
                pre_pause_status = null,
                winner_participant_id = null,
                winner_selection_type = null,
                paused_at = null,
                completed_at = null,
                closed_at = null,
                updated_at = v_now
            where id = input_event_id;

            v_new_status := 'question_1_open';


        -- ----------------------------------------------------
        -- Restart Round 2
        --
        -- Preserve Round 1 submissions/results.
        -- Rebuild Round 1 qualifiers as Round 2 answerers.
        -- ----------------------------------------------------

        elsif v_restart_round = 2 then

            delete from public.playoff_submissions s
            using public.playoff_questions q
            where s.question_id = q.id
              and q.event_id = input_event_id
              and q.question_number >= 2;

            get diagnostics v_deleted_submissions = row_count;

            update public.playoff_questions
            set
                opened_at = case
                    when question_number = 2 then v_now
                    when question_number = 3 then null
                    else opened_at
                end,
                closed_at = case
                    when question_number >= 2 then null
                    else closed_at
                end,
                updated_at = v_now
            where event_id = input_event_id
              and question_number >= 2;

            -- Recovery safety: never-joined invitees are not competitors.
            -- Keep them INVITED and clear competition-only state.
            update public.playoff_participants p
            set
                current_status = case
                    when p.user_id is null or p.joined_at is null
                        then 'invited'
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q1.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q1.advancement_mode = 'all_correct'
                              or (
                                  v_q1.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q1.advance_limit
                              )
                          )
                    )
                    then 'answering'
                    else 'eliminated'
                end,
                question_2_slot = null,
                is_finalist = false,
                is_winner = false,
                eliminated_at = case
                    when p.user_id is null or p.joined_at is null
                        then null
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q1.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q1.advancement_mode = 'all_correct'
                              or (
                                  v_q1.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q1.advance_limit
                              )
                          )
                    )
                    then null
                    else coalesce(p.eliminated_at, v_now)
                end,
                updated_at = v_now
            where p.event_id = input_event_id;

            get diagnostics v_affected_participants = row_count;

            update public.playoff_events
            set
                status = 'question_2_open',
                active_question_number = 2,
                pre_pause_status = null,
                winner_participant_id = null,
                winner_selection_type = null,
                paused_at = null,
                completed_at = null,
                closed_at = null,
                updated_at = v_now
            where id = input_event_id;

            v_new_status := 'question_2_open';


        -- ----------------------------------------------------
        -- Restart Round 3
        --
        -- Preserve Q1/Q2.
        -- Rebuild finalists from Q2 results.
        -- Clear winner state.
        -- ----------------------------------------------------

        elsif v_restart_round = 3 then

            delete from public.playoff_submissions s
            where s.question_id = v_q3.id;

            get diagnostics v_deleted_submissions = row_count;

            update public.playoff_questions
            set
                opened_at = v_now,
                closed_at = null,
                updated_at = v_now
            where id = v_q3.id;

            -- Recovery safety: never-joined invitees are not competitors.
            -- Rebuild finalist state only for joined competitors.
            update public.playoff_participants p
            set
                is_finalist = case
                    when p.user_id is null or p.joined_at is null
                        then false
                    else exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q2.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q2.advancement_mode = 'all_correct'
                              or (
                                  v_q2.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q2.advance_limit
                              )
                          )
                    )
                end,
                is_winner = false,
                question_2_slot = case
                    when p.user_id is null or p.joined_at is null
                        then null
                    when v_q2.advancement_mode = 'first_n'
                    then (
                        select min(s.accepted_position)
                        from public.playoff_submissions s
                        where s.question_id = v_q2.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and s.accepted_position is not null
                    )
                    else null
                end,
                current_status = case
                    when p.user_id is null or p.joined_at is null
                        then 'invited'
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q2.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q2.advancement_mode = 'all_correct'
                              or (
                                  v_q2.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q2.advance_limit
                              )
                          )
                    )
                    then 'answering'
                    else 'eliminated'
                end,
                eliminated_at = case
                    when p.user_id is null or p.joined_at is null
                        then null
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q2.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q2.advancement_mode = 'all_correct'
                              or (
                                  v_q2.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q2.advance_limit
                              )
                          )
                    )
                    then null
                    else coalesce(p.eliminated_at, v_now)
                end,
                updated_at = v_now
            where p.event_id = input_event_id;

            get diagnostics v_affected_participants = row_count;

            if not exists (
                select 1
                from public.playoff_participants p
                where p.event_id = input_event_id
                  and p.is_finalist = true
            ) then
                raise exception using
                    errcode = 'P0001',
                    message = 'Round 3 cannot be restarted because no finalists can be reconstructed from Round 2.';
            end if;

            update public.playoff_events
            set
                status = 'question_3_open',
                active_question_number = 3,
                pre_pause_status = null,
                winner_participant_id = null,
                winner_selection_type = null,
                paused_at = null,
                completed_at = null,
                closed_at = null,
                updated_at = v_now
            where id = input_event_id;

            v_new_status := 'question_3_open';

        end if;


    -- ========================================================
    -- ACTION: ROLL BACK ONE ROUND
    -- ========================================================

    elsif v_action = 'rollback_one_round' then

        -- ----------------------------------------------------
        -- Round 2 -> Round 1 replay
        -- ----------------------------------------------------

        if v_effective_status in (
            'question_2_open',
            'question_2_complete'
        ) then

            v_rollback_target_round := 1;
            v_recovery_question_id := v_q1.id;

            delete from public.playoff_submissions s
            using public.playoff_questions q
            where s.question_id = q.id
              and q.event_id = input_event_id
              and q.question_number >= 1;

            get diagnostics v_deleted_submissions = row_count;

            update public.playoff_questions
            set
                opened_at = case
                    when question_number = 1 then v_now
                    else null
                end,
                closed_at = null,
                updated_at = v_now
            where event_id = input_event_id;

            update public.playoff_participants
            set
                current_status = case
                    when user_id is not null
                         and joined_at is not null
                        then 'answering'
                    else 'invited'
                end,
                question_2_slot = null,
                is_finalist = false,
                is_winner = false,
                eliminated_at = null,
                updated_at = v_now
            where event_id = input_event_id;

            get diagnostics v_affected_participants = row_count;

            update public.playoff_events
            set
                status = 'question_1_open',
                active_question_number = 1,
                pre_pause_status = null,
                winner_participant_id = null,
                winner_selection_type = null,
                paused_at = null,
                completed_at = null,
                closed_at = null,
                updated_at = v_now
            where id = input_event_id;

            v_new_status := 'question_1_open';


        -- ----------------------------------------------------
        -- Final -> Round 2 replay
        -- ----------------------------------------------------

        elsif v_effective_status in (
            'question_3_open',
            'winner_locked'
        ) then

            v_rollback_target_round := 2;
            v_recovery_question_id := v_q2.id;

            delete from public.playoff_submissions s
            using public.playoff_questions q
            where s.question_id = q.id
              and q.event_id = input_event_id
              and q.question_number >= 2;

            get diagnostics v_deleted_submissions = row_count;

            update public.playoff_questions
            set
                opened_at = case
                    when question_number = 2 then v_now
                    when question_number = 3 then null
                    else opened_at
                end,
                closed_at = case
                    when question_number >= 2 then null
                    else closed_at
                end,
                updated_at = v_now
            where event_id = input_event_id
              and question_number >= 2;

            -- Recovery safety: never-joined invitees are not competitors.
            -- Keep them INVITED and clear competition-only state.
            update public.playoff_participants p
            set
                current_status = case
                    when p.user_id is null or p.joined_at is null
                        then 'invited'
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q1.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q1.advancement_mode = 'all_correct'
                              or (
                                  v_q1.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q1.advance_limit
                              )
                          )
                    )
                    then 'answering'
                    else 'eliminated'
                end,
                question_2_slot = null,
                is_finalist = false,
                is_winner = false,
                eliminated_at = case
                    when p.user_id is null or p.joined_at is null
                        then null
                    when exists (
                        select 1
                        from public.playoff_submissions s
                        where s.question_id = v_q1.id
                          and s.participant_id = p.id
                          and s.is_correct = true
                          and (
                              v_q1.advancement_mode = 'all_correct'
                              or (
                                  v_q1.advancement_mode = 'first_n'
                                  and s.accepted_position is not null
                                  and s.accepted_position <= v_q1.advance_limit
                              )
                          )
                    )
                    then null
                    else coalesce(p.eliminated_at, v_now)
                end,
                updated_at = v_now
            where p.event_id = input_event_id;

            get diagnostics v_affected_participants = row_count;

            update public.playoff_events
            set
                status = 'question_2_open',
                active_question_number = 2,
                pre_pause_status = null,
                winner_participant_id = null,
                winner_selection_type = null,
                paused_at = null,
                completed_at = null,
                closed_at = null,
                updated_at = v_now
            where id = input_event_id;

            v_new_status := 'question_2_open';

        else
            raise exception using
                errcode = 'P0001',
                message = format(
                    'One-round rollback is not available from status %s.',
                    coalesce(v_effective_status, v_event.status)
                );
        end if;

    end if;


    -- --------------------------------------------------------
    -- 4. AUDIT RECOVERY
    --
    -- Existing audit_order generation is handled by the live
    -- audit table identity/default behavior used by host RPCs.
    -- --------------------------------------------------------

    insert into public.playoff_audit_log (
        event_id,
        actor_user_id,
        actor_type,
        action,
        participant_id,
        question_id,
        details,
        created_at
    )
    values (
        input_event_id,
        v_user_id,
        'host',
        'recovery_' || v_action,
        null,
        v_recovery_question_id,
        jsonb_build_object(
            'recovery_action', v_action,
            'old_status', v_old_status,
            'effective_old_status', v_effective_status,
            'new_status', v_new_status,
            'restart_round', v_restart_round,
            'rollback_target_round', v_rollback_target_round,
            'deleted_submissions', v_deleted_submissions,
            'affected_participants', v_affected_participants,
            'main_game_progression_touched', false
        ),
        v_now
    );

    return public.get_playoff_host_state(input_event_id);
end;
$function$
