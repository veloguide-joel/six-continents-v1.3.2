// supabase/Functions/validate-answer/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS helper
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { stage, step, answer } = await req.json();

    // Normalize exactly like the app
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

    // Read salt from function secrets (we’ll confirm/set this next)
    const ANSWER_SALT = Deno.env.get("ANSWER_SALT") || "";
    console.log("[VAL] salt_end =", ANSWER_SALT.slice(-6));

    // Supabase client (Edge Functions normally have these envs available)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch the correct row (table+column names from your DB)
    const { data: row, error: rowErr } = await supabase
      .from("stage_answers")
      .select("stage, step, answer_hash")
      .eq("stage", stage)
      .eq("step", step)
      .single();

    console.log("[VAL] row =", row, "rowErr =", rowErr ? rowErr.message : null);

    const normalized = normalize(String(answer || ""));
    console.log("[VAL] normalized =", normalized);

    // Compute SHA-256 HEX of (salt + normalized)
    const enc = new TextEncoder().encode(ANSWER_SALT + normalized);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    console.log("[VAL] computed_sha256_hex =", hex);

    const ok = !!row && hex === row.answer_hash;

    return new Response(JSON.stringify({ ok }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 200,
    });
  } catch (e) {
    console.log("[VAL] error", String(e));
    return new Response(JSON.stringify({ ok: false, error: "bad request" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 200,
    });
  }
});
