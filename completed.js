// =============================================================================
// Six Continents Challenge - Completed Landing Page Controller
// =============================================================================

/**
 * PROMOTED YOUTUBE VIDEO CONFIGURATION
 * 
 * To change the promoted video on the completed landing page,
 * update the PROMOTED_YOUTUBE_VIDEO_ID below with the 11-character YouTube video ID.
 */
export const PROMOTED_YOUTUBE_VIDEO_ID = "cobNDyMOvY4";
export const PROMOTED_YOUTUBE_URL = `https://www.youtube.com/watch?v=${PROMOTED_YOUTUBE_VIDEO_ID}`;
export const MARAVILLA_URL = "https://www.maravillanayarit.com/";

function getSupabaseClient() {
  if (window.supabaseClient && typeof window.supabaseClient === "object") {
    return window.supabaseClient;
  }
  if (window.__supabaseClient && typeof window.__supabaseClient === "object") {
    window.supabaseClient = window.__supabaseClient;
    return window.__supabaseClient;
  }
  if (window.supabase && typeof window.supabase.createClient === "function") {
    const url = window.SUPABASE_URL || "https://vlcjilzgntxweomnyfgd.supabase.co";
    const key = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsY2ppbHpnbnR4d2VvbW55ZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTM0MzUsImV4cCI6MjA3NzQ4OTQzNX0.MeIJpGfdAGqQwx9t0_Tdog9W-Z1cWX3z4cUffeoQW-c";
    const client = window.supabase.createClient(url, key);
    window.supabaseClient = client;
    window.__supabaseClient = client;
    return client;
  }
  return null;
}

function isValidEmail(email) {
  const pattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return pattern.test(email);
}

function setFeedback(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = `completed-form-feedback completed-form-feedback--${type}`;
}

function initEmailSignup() {
  const form = document.getElementById("contest-interest-form");
  const input = document.getElementById("contest-interest-email");
  const button = document.getElementById("contest-interest-submit");
  const feedback = document.getElementById("contest-interest-feedback");

  if (!form || !input || !button || !feedback) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const rawEmail = String(input.value || "").trim();
    const cleanEmail = rawEmail.toLowerCase();

    if (!cleanEmail) {
      setFeedback(feedback, "Please enter your email address.", "error");
      input.focus();
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setFeedback(feedback, "Please enter a valid email address.", "error");
      input.focus();
      return;
    }

    // Set submitting state
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "SAVING...";
    setFeedback(feedback, "Saving your email...", "info");

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Service temporarily unavailable. Please try again later.");
      }

      // ONLY invoke the SECURITY DEFINER RPC - no direct table inserts
      const { data, error } = await supabase.rpc("submit_contest_interest", {
        input_email: cleanEmail,
        input_source: "completed_landing_page"
      });

      if (error) {
        throw error;
      }

      if (data && data.ok) {
        const responseMessage = data.message || "Thanks for joining! We'll keep you posted on future contests and travel challenges.";
        setFeedback(feedback, responseMessage, "success");
        input.value = "";
      } else {
        const errorMsg = data?.error || "Unable to save your submission. Please try again.";
        setFeedback(feedback, errorMsg, "error");
      }
    } catch (err) {
      console.warn("[SIGNUP] Contest interest signup error:", err?.message || err);
      const userMsg = err?.message && !err.message.includes("fetch") && !err.message.includes("42501") && !err.message.includes("function")
        ? err.message
        : "Unable to record signup at this moment. Please try again.";
      setFeedback(feedback, userMsg, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function initYouTubeSection() {
  const iframe = document.getElementById("completed-youtube-iframe");
  const ctaBtn = document.getElementById("completed-youtube-cta");

  if (iframe) {
    iframe.src = `https://www.youtube-nocookie.com/embed/${PROMOTED_YOUTUBE_VIDEO_ID}?rel=0`;
  }

  if (ctaBtn) {
    ctaBtn.setAttribute("href", PROMOTED_YOUTUBE_URL);
  }
}

function initMaravillaSection() {
  const ctaBtn = document.getElementById("completed-maravilla-cta");
  if (ctaBtn) {
    ctaBtn.setAttribute("href", MARAVILLA_URL);
  }
}

function isHistoricalGameRequested() {
  const params = new URLSearchParams(window.location.search);
  const view = (params.get("view") || params.get("play") || "").toLowerCase();
  return view === "game" || view === "1" || view === "true" || params.get("ft") === "1";
}

function enforceCompletedView() {
  const isGameRequested = isHistoricalGameRequested();

  const landing = document.getElementById("landingPage");
  const game = document.getElementById("gameContainer");
  const admin = document.getElementById("adminContainer");

  if (isGameRequested) {
    // Explicit game access requested via URL parameter (?view=game, ?play=1)
    if (landing) landing.style.display = "none";
    if (game) game.style.display = "block";
    if (admin) admin.style.display = "none";

    // Ensure Stage 1 and game panels render
    if (window.contestApp && typeof window.contestApp.renderCurrentStage === "function") {
      if (!window.contestApp.currentStage) window.contestApp.currentStage = 1;
      window.contestApp.renderCurrentStage();
    }
    return;
  }

  // Default normal public visit: completed landing page
  if (landing) landing.style.display = "flex";
  if (game) game.style.display = "none";
  if (admin) admin.style.display = "none";
}

function initModals() {
  const openHowToPlay = (e) => {
    e?.preventDefault?.();
    if (window.howToPlayModal && typeof window.howToPlayModal.open === "function") {
      window.howToPlayModal.open();
    }
  };

  const openTerms = (e) => {
    e?.preventDefault?.();
    if (window.termsModal && typeof window.termsModal.open === "function") {
      window.termsModal.open();
    }
  };

  const howToPlayLink = document.getElementById("howToPlayLink") || document.getElementById("completedHowToPlayLink");
  if (howToPlayLink) {
    howToPlayLink.addEventListener("click", openHowToPlay);
  }

  const termsLink = document.getElementById("termsLink") || document.getElementById("completedTermsLink");
  if (termsLink) {
    termsLink.addEventListener("click", openTerms);
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    enforceCompletedView();
    initEmailSignup();
    initYouTubeSection();
    initMaravillaSection();
    initModals();
  });
} else {
  enforceCompletedView();
  initEmailSignup();
  initYouTubeSection();
  initMaravillaSection();
  initModals();
}

// Post-load synchronization: if explicit game view is requested, make sure it stays active
window.addEventListener("load", () => {
  setTimeout(() => {
    enforceCompletedView();
  }, 100);
});
