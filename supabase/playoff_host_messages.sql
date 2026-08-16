CREATE TABLE IF NOT EXISTS public.playoff_host_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.playoff_events(id),
    message text NOT NULL,
    is_important boolean NOT NULL DEFAULT false,
    is_pinned boolean NOT NULL DEFAULT false,
    created_by_user_id uuid NOT NULL,
    created_by_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT playoff_host_messages_message_length_check
        CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
    CONSTRAINT playoff_host_messages_pinned_important_check
        CHECK (is_pinned = false OR is_important = true)
);

CREATE INDEX IF NOT EXISTS playoff_host_messages_event_created_idx
    ON public.playoff_host_messages (event_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS playoff_host_messages_one_pinned_per_event_idx
    ON public.playoff_host_messages (event_id)
    WHERE is_pinned = true;

ALTER TABLE public.playoff_host_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.playoff_host_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.playoff_host_messages FROM anon;
REVOKE ALL ON TABLE public.playoff_host_messages FROM authenticated;

CREATE OR REPLACE FUNCTION public.host_send_playoff_message(
    input_event_id uuid,
    input_message text,
    input_is_important boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_user_email text;
    v_message text;
    v_is_important boolean;
    v_inserted public.playoff_host_messages%rowtype;
BEGIN
    v_user_id := auth.uid();
    v_user_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
    v_message := btrim(coalesce(input_message, ''));
    v_is_important := coalesce(input_is_important, false);

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required.';
    END IF;

    IF v_user_email = '' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authenticated account has no email address.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_emails a
        WHERE lower(btrim(a.email)) = v_user_email
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Administrator access required.';
    END IF;

    IF input_event_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22004',
            MESSAGE = 'Event ID is required.';
    END IF;

    IF char_length(v_message) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'Message must contain between 1 and 500 characters.';
    END IF;

    PERFORM 1
    FROM public.playoff_events e
    WHERE e.id = input_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'Playoff event not found.';
    END IF;

    IF v_is_important THEN
        UPDATE public.playoff_host_messages m
        SET is_pinned = false
        WHERE m.event_id = input_event_id
          AND m.is_pinned = true;
    END IF;

    INSERT INTO public.playoff_host_messages (
        event_id,
        message,
        is_important,
        is_pinned,
        created_by_user_id,
        created_by_email
    )
    VALUES (
        input_event_id,
        v_message,
        v_is_important,
        v_is_important,
        v_user_id,
        v_user_email
    )
    RETURNING * INTO v_inserted;

    RETURN jsonb_build_object(
        'id', v_inserted.id,
        'event_id', v_inserted.event_id,
        'message', v_inserted.message,
        'is_important', v_inserted.is_important,
        'is_pinned', v_inserted.is_pinned,
        'created_at', v_inserted.created_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_playoff_host_messages(
    input_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_user_email text;
    v_deleted_count integer := 0;
BEGIN
    v_user_id := auth.uid();
    v_user_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required.';
    END IF;

    IF v_user_email = '' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authenticated account has no email address.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_emails a
        WHERE lower(btrim(a.email)) = v_user_email
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Administrator access required.';
    END IF;

    IF input_event_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22004',
            MESSAGE = 'Event ID is required.';
    END IF;

    PERFORM 1
    FROM public.playoff_events e
    WHERE e.id = input_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'Playoff event not found.';
    END IF;

    DELETE FROM public.playoff_host_messages m
    WHERE m.event_id = input_event_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'ok', true,
        'deleted_count', v_deleted_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_playoff_host_messages(
    input_event_id uuid,
    input_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_user_email text;
    v_is_admin boolean := false;
    v_is_joined_player boolean := false;
    v_limit integer;
    v_pinned jsonb;
    v_messages jsonb;
BEGIN
    v_user_id := auth.uid();
    v_user_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
    v_limit := greatest(1, least(coalesce(input_limit, 20), 50));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required.';
    END IF;

    IF input_event_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22004',
            MESSAGE = 'Event ID is required.';
    END IF;

    IF v_user_email <> '' THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.admin_emails a
            WHERE lower(btrim(a.email)) = v_user_email
        )
        INTO v_is_admin;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.playoff_participants p
        WHERE p.event_id = input_event_id
          AND p.user_id = v_user_id
          AND p.joined_at IS NOT NULL
    )
    INTO v_is_joined_player;

    IF NOT v_is_admin AND NOT v_is_joined_player THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Playoff message access denied.';
    END IF;

    SELECT jsonb_build_object(
        'id', m.id,
        'message', m.message,
        'is_important', m.is_important,
        'is_pinned', m.is_pinned,
        'created_at', m.created_at
    )
    INTO v_pinned
    FROM public.playoff_host_messages m
    WHERE m.event_id = input_event_id
      AND m.is_pinned = true
    LIMIT 1;

    WITH latest_messages AS (
        SELECT
            m.id,
            m.message,
            m.is_important,
            m.is_pinned,
            m.created_at
        FROM public.playoff_host_messages m
        WHERE m.event_id = input_event_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT v_limit
    )
    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', lm.id,
                'message', lm.message,
                'is_important', lm.is_important,
                'is_pinned', lm.is_pinned,
                'created_at', lm.created_at
            )
            ORDER BY lm.created_at ASC, lm.id ASC
        ),
        '[]'::jsonb
    )
    INTO v_messages
    FROM latest_messages lm;

    RETURN jsonb_build_object(
        'pinned', v_pinned,
        'messages', v_messages
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.host_send_playoff_message(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.host_send_playoff_message(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.host_send_playoff_message(uuid, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_playoff_host_messages(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_playoff_host_messages(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_playoff_host_messages(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_playoff_host_messages(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_playoff_host_messages(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_playoff_host_messages(uuid, integer) TO authenticated;
