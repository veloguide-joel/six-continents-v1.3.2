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
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      console.log(`[${requestId}] Auth error:`, authError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { stage } = body;
    if (!stage || typeof stage !== 'number' || stage < 1 || stage > 16) {
      return new Response(JSON.stringify({ error: 'Invalid stage number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    console.log(`[${requestId}] Attempting to register winner for stage ${stage}, user: ${user.email}`);

    // Get username from user metadata
    const username = user.user_metadata?.username || 
                    user.user_metadata?.full_name || 
                    user.email.split('@')[0];

    // Determine prize amount
    let prizeAmount;
    if (stage <= 14) {
      prizeAmount = '$50';
    } else if (stage === 15) {
      prizeAmount = '50K Miles';
    } else if (stage === 16) {
      prizeAmount = '100K Miles';
    }

    // Check if winner already exists for this stage
    const { data: existingWinner } = await supabase
      .from('app_5fe11f8255_stage_winners')
      .select('*')
      .eq('stage', stage)
      .single();

    if (existingWinner) {
      console.log(`[${requestId}] Stage ${stage} already has winner: ${existingWinner.winner_username}`);
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Stage already has a winner',
        winner: existingWinner
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Register as winner (first solver wins)
    const { data: newWinner, error: insertError } = await supabase
      .from('app_5fe11f8255_stage_winners')
      .insert({
        stage,
        winner_user_id: user.id,
        winner_username: username,
        prize_amount: prizeAmount
      })
      .select()
      .single();

    if (insertError) {
      console.log(`[${requestId}] Insert error:`, insertError);
      
      // Check if it's a duplicate key error (someone else won while we were processing)
      if (insertError.code === '23505') {
        const { data: actualWinner } = await supabase
          .from('app_5fe11f8255_stage_winners')
          .select('*')
          .eq('stage', stage)
          .single();

        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Someone else won this stage first',
          winner: actualWinner
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      throw insertError;
    }

    console.log(`[${requestId}] Successfully registered winner:`, newWinner);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Congratulations! You are the first to solve this stage!',
      winner: newWinner
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