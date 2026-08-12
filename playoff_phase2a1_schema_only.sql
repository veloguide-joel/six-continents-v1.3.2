BEGIN;

-- Add columns to playoff_questions
ALTER TABLE public.playoff_questions
ADD COLUMN IF NOT EXISTS advancement_mode text;

ALTER TABLE public.playoff_questions
ADD COLUMN IF NOT EXISTS advance_limit integer;

-- Set default for future rows
ALTER TABLE public.playoff_questions
ALTER COLUMN advancement_mode SET DEFAULT 'all_correct';

-- Backfill only the verified Stage 15 event
UPDATE public.playoff_questions q
SET advancement_mode = 'all_correct',
    advance_limit = NULL
FROM public.playoff_events e
WHERE e.id = '591ec441-e182-46b5-82d5-345c7d9c82c0'
  AND q.event_id = e.id
  AND q.question_number = 1;

UPDATE public.playoff_questions q
SET advancement_mode = 'first_n',
    advance_limit = 2
FROM public.playoff_events e
WHERE e.id = '591ec441-e182-46b5-82d5-345c7d9c82c0'
  AND q.event_id = e.id
  AND q.question_number = 2;

UPDATE public.playoff_questions q
SET advancement_mode = 'first_n',
    advance_limit = 1
FROM public.playoff_events e
WHERE e.id = '591ec441-e182-46b5-82d5-345c7d9c82c0'
  AND q.event_id = e.id
  AND q.question_number = 3;

-- Safety guard: abort if any rows remain unbackfilled
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.playoff_questions
        WHERE advancement_mode IS NULL
    ) THEN
        RAISE EXCEPTION 'unbackfilled playoff_questions rows still have NULL advancement_mode';
    END IF;
END $$;

-- Set NOT NULL only after the backfill guard passes
ALTER TABLE public.playoff_questions
ALTER COLUMN advancement_mode SET NOT NULL;

-- Add enforcement check for advancement_mode/advance_limit
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.playoff_questions'::regclass
          AND conname = 'playoff_questions_advancement_mode_chk'
    ) THEN
        ALTER TABLE public.playoff_questions
        ADD CONSTRAINT playoff_questions_advancement_mode_chk
        CHECK (
            (advancement_mode = 'all_correct' AND advance_limit IS NULL)
            OR
            (advancement_mode = 'first_n' AND advance_limit IS NOT NULL AND advance_limit > 0)
        );
    END IF;
END $$;

-- Generalize existing accepted_position constraint on playoff_submissions
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.playoff_submissions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%accepted_position%'
    LOOP
        EXECUTE format('ALTER TABLE public.playoff_submissions DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.playoff_submissions
ADD CONSTRAINT playoff_submissions_accepted_position_generalized_chk
CHECK (accepted_position IS NULL OR accepted_position >= 1);

-- Generalize existing question_2_slot constraint on playoff_participants
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.playoff_participants'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%question_2_slot%'
    LOOP
        EXECUTE format('ALTER TABLE public.playoff_participants DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.playoff_participants
ADD CONSTRAINT playoff_participants_question_2_slot_generalized_chk
CHECK (question_2_slot IS NULL OR question_2_slot >= 1);

COMMIT;
