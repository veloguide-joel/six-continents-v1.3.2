// === CONFETTI RELIABILITY PATCH (standalone) ===
console.log("[CONFETTI] Guard loaded");
const CONFETTI_NS = "confettiFired";
const CONFETTI_SESSION = new Set();

function confettiKey(userId, stage, step) {
  return `${CONFETTI_NS}:${userId || 'anon'}:${stage}:${step}`;
}
function hasFiredConfetti(userId, stage, step) {
  try {
    const key = confettiKey(userId, stage, step);
    return localStorage.getItem(key) === "1" || CONFETTI_SESSION.has(key);
  } catch (e) {
    console.warn("[CONFETTI] localStorage unavailable; session-only.", e);
    return false;
  }
}
function markConfettiFired(userId, stage, step) {
  const key = confettiKey(userId, stage, step);
  CONFETTI_SESSION.add(key);
  try { localStorage.setItem(key, "1"); } catch {}
}
function fireConfettiOnce(userId, stage, step) {
  if (hasFiredConfetti(userId, stage, step)) {
    console.log("[CONFETTI] Skipped — already fired for this step.");
    return;
  }
  try { if (typeof confetti === "function") confetti(); } catch (e) {
    console.warn("[CONFETTI] Missing confetti() function?", e);
  }
  markConfettiFired(userId, stage, step);
  console.log(`[CONFETTI] Fired for user:${userId || 'anon'} stage:${stage} step:${step}`);
}

function currentUserIdSafe() {
  try {
    if (window.authUser?.id) return window.authUser.id;
    if (window.state?.user?.id) return window.state.user.id;
    if (window.supabase?.auth?.getUser) {
      window.supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) window.authUser = data.user;
      });
    }
  } catch {}
  return null;
}
