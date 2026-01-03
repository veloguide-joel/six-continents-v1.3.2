-- Supabase Marketing Events Table Setup
-- Run this SQL in your Supabase Database SQL Editor

-- Create marketing_events table
CREATE TABLE IF NOT EXISTS marketing_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  event TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_marketing_events_session_id ON marketing_events (session_id);
CREATE INDEX IF NOT EXISTS idx_marketing_events_variant ON marketing_events (variant);
CREATE INDEX IF NOT EXISTS idx_marketing_events_event ON marketing_events (event);
CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at ON marketing_events (created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

-- Create a policy allowing anyone to insert (public write)
CREATE POLICY IF NOT EXISTS "Allow public insert" ON marketing_events
  FOR INSERT WITH CHECK (true);

-- Create a policy allowing anyone to read (public read)
CREATE POLICY IF NOT EXISTS "Allow public read" ON marketing_events
  FOR SELECT USING (true);

-- Optional: Create a view for analytics
CREATE OR REPLACE VIEW marketing_events_summary AS
SELECT
  variant,
  event,
  COUNT(*) as event_count,
  COUNT(DISTINCT session_id) as unique_sessions,
  DATE_TRUNC('hour', created_at) as hour,
  NOW() as generated_at
FROM marketing_events
GROUP BY variant, event, DATE_TRUNC('hour', created_at)
ORDER BY hour DESC, variant, event;

-- Sample queries for analytics:

-- 1. Event counts by variant
-- SELECT variant, event, COUNT(*) as count FROM marketing_events GROUP BY variant, event ORDER BY variant, event;

-- 2. Session funnel (views -> clicks -> signups)
-- SELECT 
--   variant,
--   SUM(CASE WHEN event = 'lp_view' THEN 1 ELSE 0 END) as views,
--   SUM(CASE WHEN event = 'cta_click' THEN 1 ELSE 0 END) as clicks,
--   SUM(CASE WHEN event = 'signup_started' THEN 1 ELSE 0 END) as signup_started,
--   SUM(CASE WHEN event = 'signup_success' THEN 1 ELSE 0 END) as signups
-- FROM marketing_events
-- GROUP BY variant;

-- 3. Conversion rates by variant
-- SELECT 
--   variant,
--   ROUND(100.0 * COUNT(DISTINCT CASE WHEN event = 'signup_success' THEN session_id END) / 
--         NULLIF(COUNT(DISTINCT CASE WHEN event = 'lp_view' THEN session_id END), 0), 2) as conversion_rate
-- FROM marketing_events
-- GROUP BY variant;

-- 4. Event timeline
-- SELECT created_at, variant, event, COUNT(*) as count 
-- FROM marketing_events 
-- GROUP BY DATE_TRUNC('minute', created_at), variant, event 
-- ORDER BY created_at DESC;
