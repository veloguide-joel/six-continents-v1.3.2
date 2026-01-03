// marketing.js
// Lightweight client-side marketing event logger (Supabase -> marketing_events)
// Loads as regular script (defer, non-blocking) - attaches to window

(function() {
  const LS_SESSION = "sc_session_id";
  const LS_VARIANT = "sc_lp_variant";
  const LS_VIEW_ONCE = "sc_lp_view_once"; // session-level view dedupe

  function randomId() {
    // Good enough for session_id (not security-sensitive)
    return (crypto?.randomUUID?.() || `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  }

  function getOrCreateSessionId() {
    let sid = localStorage.getItem(LS_SESSION);
    if (!sid) {
      sid = randomId();
      localStorage.setItem(LS_SESSION, sid);
    }
    return sid;
  }

  function getOrAssignVariant() {
    // Variant A/B (stable per browser via localStorage)
    let v = localStorage.getItem(LS_VARIANT);
    if (!v) {
      v = Math.random() < 0.5 ? "A" : "B";
      localStorage.setItem(LS_VARIANT, v);
    }
    return v;
  }

  function createMarketingTracker(supabaseClient) {
    if (!supabaseClient) {
      console.warn("[marketing] Missing supabaseClient");
    }

    const session_id = getOrCreateSessionId();
    const variant = getOrAssignVariant();

    async function log(event, meta = {}) {
      try {
        if (!supabaseClient) return;

        const payload = {
          session_id,
          variant,
          event,
          meta: {
            ...meta,
            path: window.location.pathname,
            href: window.location.href,
            referrer: document.referrer || null,
            ua: navigator.userAgent,
            ts: new Date().toISOString(),
          },
        };

        const { error } = await supabaseClient
          .from("marketing_events")
          .insert(payload);

        if (error) {
          console.warn("[marketing] insert error:", error);
        }
      } catch (e) {
        console.warn("[marketing] log failed:", e);
      }
    }

    function logLpViewOnce(meta = {}) {
      // Dedupe within this browser session so refresh spam doesn't pollute data
      const already = sessionStorage.getItem(LS_VIEW_ONCE);
      if (already) return;
      sessionStorage.setItem(LS_VIEW_ONCE, "1");
      log("lp_view", meta);
    }

    return {
      session_id,
      variant,
      log,
      logLpViewOnce,
    };
  }

  // ✅ Attach to window for use by other scripts
  window.createMarketingTracker = createMarketingTracker;
  console.log("[MARKETING] Module loaded, createMarketingTracker available");
})();

