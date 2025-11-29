import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // Generate unique request ID for logging
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] ${req.method} ${req.url}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[${requestId}] Fetching all stage winners`);

    // Get all winners
    const { data: winners, error } = await supabase
      .from('app_5fe11f8255_stage_winners')
      .select('stage, winner_username, prize_amount, completed_at')
      .order('stage', { ascending: true });

    if (error) {
      console.error(`[${requestId}] Database error:`, error);
      throw error;
    }

    console.log(`[${requestId}] Found ${winners?.length || 0} winners`);

    // Create a map for easy lookup by stage
    const winnersMap = {};
    if (winners) {
      winners.forEach(winner => {
        winnersMap[winner.stage] = {
          username: winner.winner_username,
          prizeAmount: winner.prize_amount,
          completedAt: winner.completed_at
        };
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      winners: winnersMap 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});