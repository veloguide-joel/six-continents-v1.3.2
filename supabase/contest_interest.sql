-- =============================================================================
-- Supabase Schema: Contest Interest (Future Contests & Challenges Signup)
-- Table: public.contest_interest
-- RPC: public.submit_contest_interest(text, text)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contest_interest (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    source text NOT NULL DEFAULT 'completed_landing_page',
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT contest_interest_email_unique UNIQUE (email),
    CONSTRAINT contest_interest_email_check CHECK (
        char_length(email) BETWEEN 3 AND 320 AND
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

CREATE INDEX IF NOT EXISTS contest_interest_created_at_idx
    ON public.contest_interest (created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.contest_interest ENABLE ROW LEVEL SECURITY;

-- Revoke all table privileges from public, anon, and authenticated
-- (No direct SELECT, INSERT, UPDATE, or DELETE on the table from client keys)
REVOKE ALL ON TABLE public.contest_interest FROM PUBLIC;
REVOKE ALL ON TABLE public.contest_interest FROM anon;
REVOKE ALL ON TABLE public.contest_interest FROM authenticated;

-- Ensure NO direct client insert/select policies exist
DROP POLICY IF EXISTS "Allow public insert to contest_interest" ON public.contest_interest;
DROP POLICY IF EXISTS "Allow public read" ON public.contest_interest;

-- =============================================================================
-- RPC Function: submit_contest_interest
-- Only this SECURITY DEFINER function can insert into public.contest_interest
-- =============================================================================
CREATE OR REPLACE FUNCTION public.submit_contest_interest(
    input_email text,
    input_source text DEFAULT 'completed_landing_page'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_clean_email text;
    v_clean_source text;
    v_already_exists boolean := false;
BEGIN
    v_clean_email := lower(btrim(coalesce(input_email, '')));
    v_clean_source := coalesce(btrim(input_source), 'completed_landing_page');

    -- Basic validation
    IF v_clean_email = '' OR v_clean_email NOT ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Please enter a valid email address.'
        );
    END IF;

    IF char_length(v_clean_email) > 320 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Email address is too long.'
        );
    END IF;

    -- Check if email already registered
    SELECT EXISTS (
        SELECT 1
        FROM public.contest_interest
        WHERE email = v_clean_email
    )
    INTO v_already_exists;

    IF v_already_exists THEN
        RETURN jsonb_build_object(
            'ok', true,
            'already_registered', true,
            'message', 'You are already on the list! We will keep you updated on future challenges.'
        );
    END IF;

    -- Insert new email
    INSERT INTO public.contest_interest (email, source)
    VALUES (v_clean_email, v_clean_source);

    RETURN jsonb_build_object(
        'ok', true,
        'already_registered', false,
        'message', 'Thanks for joining! You are on the list for future challenges and giveaways.'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'ok', true,
            'already_registered', true,
            'message', 'You are already on the list! We will keep you updated on future challenges.'
        );
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Unable to record signup at this moment. Please try again.'
        );
END;
$function$;

-- Permissions for the RPC function
REVOKE ALL ON FUNCTION public.submit_contest_interest(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_contest_interest(text, text) TO anon, authenticated;
