// BUILD-ID 2025-11-12-logout+LB
console.log("BUILD-ID 2025-11-12-logout+LB");

// ✅ Import createMarketingTracker from window (loaded as non-blocking defer script)
// If marketing.js fails to load, function won't exist but app will still work
const createMarketingTracker = window.createMarketingTracker || (() => {
  console.warn("[MARKETING] createMarketingTracker not available (script load failed or deferred)");
  return {
    session_id: null,
    variant: null,
    log: () => {},
    logLpViewOnce: () => {},
  };
});

// --- Page mode detection (LP variants should NOT run full game UI) ---
const IS_LP_VARIANT = /\/lp-[ab]\.html$/i.test(window.location.pathname) ||
                      /lp-[ab]\.html/i.test(window.location.href);

// --- Auto-enter game flag (set after successful auth, cleared after use) ---
const SC_AUTO_ENTER_GAME_KEY = "SC_AUTO_ENTER_GAME";

// --- Auth modal default tab (remember which tab to show after signout) ---
const AUTH_MODAL_DEFAULT_TAB_KEY = "authModalDefaultTabOnce";
// values: "signin" | "signup"

// --- CANONICAL GLOBAL SOLVED STATE (for journey progress rendering) ---
window.__SOLVED_STAGES = [];
window.__MAX_SOLVED_STAGE = 0;

// ---------------------------
// ACCIDENTAL RETIREE CONTEST APP
// Auth + Leaderboard stabilized 2025-11-12
// - Minimal hard sign-out verified
// - Auto leaderboard refresh working
// - Stage advance + DB save confirmed
// - Duplicates removed (single landing render)
// A/B Landing Page Testing + Event Tracking Added 2025-01-02
// ---------------------------

// ===== MARKETING EVENT LOGGER =====
class MarketingEventLogger {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.sessionId = this.getOrCreateSessionId();
    this.variant = this.getVariant();
    this.initialized = false;
  }

  getOrCreateSessionId() {
    let sessionId = localStorage.getItem('lp_session_id');
    if (!sessionId) {
      sessionId = this.generateUUID();
      localStorage.setItem('lp_session_id', sessionId);
    }
    return sessionId;
  }

  getVariant() {
    return localStorage.getItem('lp_variant') || 'default';
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async logEvent(eventName, metadata = {}) {
    if (!this.supabase) {
      console.warn('[MARKETING] Supabase not initialized, event not logged:', eventName);
      return;
    }

    try {
      const { error } = await this.supabase
        .from('marketing_events')
        .insert({
          session_id: this.sessionId,
          variant: this.variant,
          event: eventName,
          meta: metadata,
        });

      if (error) {
        console.error('[MARKETING] Failed to log event:', eventName, error);
      } else {
        console.log('[MARKETING] Event logged:', eventName, { variant: this.variant, meta: metadata });
      }
    } catch (err) {
      console.error('[MARKETING] Error logging event:', err);
    }
  }

  async onPageLoad() {
    this.logEvent('lp_view', {
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });
  }

  async onCtaClick() {
    this.logEvent('cta_click', {
      button: 'play_game',
      timestamp: new Date().toISOString(),
    });
  }

  async onSignupStarted() {
    this.logEvent('signup_started', {
      timestamp: new Date().toISOString(),
    });
  }

  async onSignupSuccess(userId) {
    this.logEvent('signup_success', {
      user_id: userId,
      timestamp: new Date().toISOString(),
    });
  }
}

let marketingEventLogger = null;

// ===== SOLVES LOADING GATE =====
// Module-level promise to ensure DB solves load before journey renders
let solvesLoadedResolve = null;
const solvesLoadedPromise = new Promise((resolve) => {
  solvesLoadedResolve = resolve;
});

// Legacy shim so old code doesn't crash if it calls app.ensureAtNextUnsolved
const app = {
  ensureAtNextUnsolved: (...args) => {
    try {
      if (window.contestApp && typeof window.contestApp.ensureAtNextUnsolved === 'function') {
        window.contestApp.ensureAtNextUnsolved(...args);
      } else {
        console.warn('[NAV] ensureAtNextUnsolved shim: function not available');
      }
    } catch (err) {
      console.warn('[NAV] ensureAtNextUnsolved shim error:', err);
    }
  }
};

// ===== SIGN-IN TIMEOUT MANAGEMENT =====
// Module-level variables for robust timeout handling across async callbacks
let signInTimeoutId = null;
let signInResolved = false;

function clearSignInTimeout(reason) {
  if (signInTimeoutId !== null) {
    clearTimeout(signInTimeoutId);
    signInTimeoutId = null;
    console.log(`[AUTH] timeout cleared: ${reason}`);
  }
}

// ===== MY PROFILE MODULE =====
// Stock avatars configuration
const AVATAR_BASE_URL = 'https://vlcjilzgntxweomnyfgd.supabase.co/storage/v1/object/public/avatars/';

const STOCK_AVATARS = [
  { key: "beach-umbrella", label: "Beach umbrella", url: AVATAR_BASE_URL + "beach-umbrella.png" },
  { key: "cocktail", label: "Cocktail", url: AVATAR_BASE_URL + "cocktail.png" },
  { key: "suitcase", label: "Suitcase", url: AVATAR_BASE_URL + "suitcase.png" },
  { key: "travel-diary", label: "Travel diary", url: AVATAR_BASE_URL + "travel-diary.png" },
];

// Profile configuration
const DISPLAY_NAME_MAX_LEN = 15;
const DEFAULT_PLAYER_PREFIX = 'player_';

function generatePlayerName() {
  // 7-digit random number (1000000–9999999)
  const n = Math.floor(1000000 + Math.random() * 9000000);
  return `${DEFAULT_PLAYER_PREFIX}${n}`;
}

function isDefaultPlayerName(name) {
  return typeof name === 'string' && name.toLowerCase().startsWith(DEFAULT_PLAYER_PREFIX);
}

let currentProfile = null;

// PROFILE AVATAR STATE
let selectedAvatarKey = null;

function getAvatarUrlFromKey(avatarKey) {
  if (!avatarKey) return null;
  switch (avatarKey) {
    case 'beach-umbrella':
      return AVATAR_BASE_URL + 'beach-umbrella.png';
    case 'cocktail':
      return AVATAR_BASE_URL + 'cocktail.png';
    case 'suitcase':
      return AVATAR_BASE_URL + 'suitcase.png';
    case 'travel-diary':
      return AVATAR_BASE_URL + 'travel-diary.png';
    default:
      return null;
  }
}

// HEADER PROFILE RENDER START
window.currentProfile = null;
window.__didSoftNagProfile = false;

function getDisplayLabel(profile, user) {
  const name = (profile?.display_name || profile?.username || '').trim();
  if (name) return name;

  // fallback: show email only if no profile name
  return (user?.email || '').trim();
}

function renderHeaderUser(profile, user) {
  const nameEl = document.getElementById('userDisplayName');
  const avatarEl = document.getElementById('userAvatarImg');

  // NEVER show email; use display_name or fallback to "Player"
  const label = (profile?.display_name && profile.display_name.trim())
    ? profile.display_name.trim()
    : 'Player';

  // NAME: one place only
  if (nameEl) nameEl.textContent = label;

  // AVATAR: uploaded photo wins, else preset key -> Supabase public URL
  if (avatarEl) {
    if (profile?.avatar_url) {
      avatarEl.src = profile.avatar_url;
    } else if (profile?.avatar_key) {
      // IMPORTANT: use existing helper (already in your file)
      avatarEl.src = getAvatarUrlFromKey(profile.avatar_key);
    } else {
      // fallback to one of your stock avatars (pick one)
      avatarEl.src = getAvatarUrlFromKey('suitcase');
    }
  }

  console.log('[PROFILE] Header rendered', { label, avatar_key: profile?.avatar_key, avatar_url: profile?.avatar_url });
}
// HEADER PROFILE RENDER END

function applyProfileToUI(profile) {
  if (!profile) return;

  const displayName = profile.display_name || profile.displayName || '';
  const avatarKey = profile.avatar_key || profile.avatar || null;
  const avatarUrl = profile.avatar_url || null;

  // 1) Header user label (fallback to email if no display name)
  const headerNameEl = document.getElementById('journeyUserEmail');
  if (headerNameEl) {
    const fallback = profile.email || headerNameEl.textContent || '';
    headerNameEl.textContent = displayName || fallback;
  }

  // 2) Profile modal input
  const nameInput = document.getElementById('profileDisplayName');
  if (nameInput) {
    nameInput.value = displayName || '';
  }

  // 3) Header avatar
  const avatarImg = document.getElementById('headerAvatarImg');
  if (avatarImg) {
    const src = avatarUrl || getAvatarUrlFromKey(avatarKey);
    if (src) {
      avatarImg.src = src;
    }
  }
}

function updateHeaderAvatar(profile) {
  const img = document.getElementById('headerAvatarImg');
  if (!img || !profile) return;

  const src =
    profile.avatar_url ||
    getAvatarUrlFromKey(profile.avatar_key);

  if (src) {
    img.src = src;
  }
}

function updateHeaderUserLabel(user, profile) {
  const labelEl = document.getElementById('journeyUserEmail');
  if (!labelEl) return;

  const displayName =
    profile?.display_name?.trim() ||
    profile?.username?.trim() ||
    user?.email ||
    '';

  labelEl.textContent = displayName;
}

function isProfileComplete(profile) {
  const name = (profile?.display_name || profile?.username || '').trim();
  const hasName = name.length >= 3;

  // You appear to use avatar_key for presets and avatar_url/public url for uploads
  const hasAvatar =
    !!(profile?.avatar_key && String(profile.avatar_key).trim()) ||
    !!(profile?.avatar_url && String(profile.avatar_url).trim());

  return hasName && hasAvatar;
}

// PROFILE LOAD + HYDRATE START
async function loadMyProfileAndHydrateUI() {
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) return;

  const { data: profile, error } = await window.supabaseClient
    .from('profiles')
    .select('id, display_name, username, avatar_key, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[PROFILE] load profile failed', error);
    // still render something (email fallback)
    renderHeaderUser(null, user);
    return;
  }

  window.currentProfile = profile || null;
  renderHeaderUser(window.currentProfile, user);

  // SOFT NAG: prompt profile completion if they still have default name
  if (window.__didSoftNagProfile) return;
  window.__didSoftNagProfile = true;

  try {
    if (window.currentProfile?.display_name && isDefaultPlayerName(window.currentProfile.display_name)) {
      console.log('[PROFILE] Soft nag: default name detected, opening profile modal');
      openProfileModal(); // user can close and continue playing
    }
  } catch (e) {
    console.warn('[PROFILE] Soft nag skipped due to error', e);
  }
}
// PROFILE LOAD + HYDRATE END

let __profilePromptedThisSession = false;

async function promptProfileCompletionIfNeeded() {
  try {
    if (__profilePromptedThisSession) return;

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return;

    // You already have a profile loader somewhere; use it if it exists.
    // If not, this query is safe (adjust table/columns if yours differ).
    const { data: profile, error } = await window.supabaseClient
      .from('profiles')
      .select('id, display_name, username, avatar_key, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[PROFILE] Could not fetch profile for completion check', error);
      return;
    }

    if (!isProfileComplete(profile)) {
      __profilePromptedThisSession = true;
      console.log('[PROFILE] Incomplete profile -> opening modal');

      // You already have this (based on your logs/screens)
      openProfileModal();

      // Optional: prefill modal if you have a hydrate function
      if (typeof hydrateProfileModal === 'function') {
        hydrateProfileModal(profile);
      }

      // Optional: if you want to block closing until complete (see Step 4)
    } else {
      console.log('[PROFILE] Profile already complete');
      __profilePromptedThisSession = true;
    }

    // Auto-prompt if user still has a default player_XXXXX name
    if (profile?.display_name && isDefaultPlayerName(profile.display_name)) {
      console.log('[PROFILE] Default name detected; prompting user to complete profile');
      __profilePromptedThisSession = true;
      openProfileModal();
    }
  } catch (err) {
    console.error('[PROFILE] promptProfileCompletionIfNeeded failed', err);
  }
}

async function loadUserProfile() {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn('[PROFILE] No user found');
      return null;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[PROFILE] Load error:", error);
      return null;
    }
    
    // If display_name missing, assign a safe default and persist it
    if (!data?.display_name || !data.display_name.trim()) {
      const fallbackName = generatePlayerName();

      const { error: upErr } = await supabase
        .from('profiles')
        .update({ display_name: fallbackName })
        .eq('id', data.id);

      if (!upErr) {
        data.display_name = fallbackName;
        console.log('[PROFILE] Assigned default display_name:', fallbackName);
      } else {
        console.warn('[PROFILE] Failed to assign default display_name:', upErr);
        // still set locally so UI never shows email
        data.display_name = fallbackName;
      }
    }
    
    currentProfile = data;
    console.log('[PROFILE] Loaded:', data);
    
    // Update UI using consolidated helper
    if (data) {
      applyProfileToUI(data);
    }
    
    return data;
  } catch (err) {
    console.error('[PROFILE] Load exception:', err);
    return null;
  }
}

// ===== STAGE PROGRESS HELPERS =====
async function fetchDbCurrentStage(userId) {
  try {
    // Source of truth: profiles.current_stage
    const { data: prof, error: pErr } = await window.supabaseClient
      .from("profiles")
      .select("current_stage")
      .eq("id", userId)
      .maybeSingle();

    if (!pErr && prof?.current_stage != null) {
      const n = Number(prof.current_stage);
      if (Number.isFinite(n) && n >= 1) return n;
    }

    // Fallback: derive from solves (highest stage)
    const { data: solves, error: sErr } = await window.supabaseClient
      .from("solves")
      .select("stage")
      .eq("user_id", userId)
      .order("stage", { ascending: false })
      .limit(1);

    if (!sErr && solves?.length) {
      const n = Number(solves[0].stage);
      if (Number.isFinite(n) && n >= 1) return n;
    }

    return 1;
  } catch (e) {
    console.warn("[PROGRESS] fetchDbCurrentStage failed:", e);
    return 1;
  }
}

async function restoreStageFromSolves(userId) {
  try {
    const MAX_STAGE = 16;
    
    // Query solves table for this user
    const { data: solves, error } = await window.supabaseClient
      .from("solves")
      .select("stage")
      .eq("user_id", userId);

    if (error) {
      console.warn("[PROGRESS] restoreStageFromSolves query failed:", error);
      return 1;
    }

    // If no solves, start at stage 1
    if (!solves || solves.length === 0) {
      console.log("[PROGRESS] No solved stages found, starting at stage 1 (source: DB)");
      return 1;
    }

    // Find max solved stage
    const stages = solves.map(s => Number(s.stage)).filter(n => Number.isFinite(n));
    const maxStage = Math.max(...stages);
    const restoredStage = Math.min(maxStage + 1, MAX_STAGE);

    console.log("[PROGRESS] max solved stage:", maxStage, "(source: DB)");
    console.log("[PROGRESS] restored current stage:", restoredStage, "(source: DB)");

    return restoredStage;
  } catch (e) {
    console.warn("[PROGRESS] restoreStageFromSolves failed:", e);
    return 1;
  }
}

async function computeNextUnsolvedFromSolves(userId) {
  try {
    const MAX_STAGE = 16;

    // Query all solved stages from DB
    const { data: solves, error } = await window.supabaseClient
      .from("solves")
      .select("stage")
      .eq("user_id", userId);

    if (error) {
      console.warn("[NAV] Failed to query solves for nav:", error);
      return 1;
    }

    // Build set of solved stages
    const solvedSet = new Set(
      (solves || []).map(s => Number(s.stage)).filter(n => Number.isFinite(n) && n >= 1 && n <= MAX_STAGE)
    );

    // ✅ STORE GLOBALLY for Journey Progress UI to use
    window.__dbSolvedSet = solvedSet;
    window.__dbSolvedArray = Array.from(solvedSet).sort((a, b) => a - b);
    
    // ✅ Set canonical global solved state (for journey progress rendering)
    window.__SOLVED_STAGES = window.__dbSolvedArray;
    window.__MAX_SOLVED_STAGE = Math.max(...window.__dbSolvedArray, 0);
    console.log("[JOURNEY] Global solved stages set:", window.__SOLVED_STAGES, "max:", window.__MAX_SOLVED_STAGE);

    console.log("[NAV] solvedSet:", window.__dbSolvedArray);

    // Find next unsolved stage
    for (let i = 1; i <= MAX_STAGE; i++) {
      if (!solvedSet.has(i)) {
        console.log("[NAV] next unsolved computed:", i);
        // ✅ SIGNAL that solves have loaded (gate open)
        if (typeof solvesLoadedResolve === 'function') {
          solvesLoadedResolve();
        }
        return i;
      }
    }

    // All stages solved, return MAX_STAGE
    console.log("[NAV] All stages solved, returning:", MAX_STAGE);
    // ✅ SIGNAL that solves have loaded (gate open)
    if (typeof solvesLoadedResolve === 'function') {
      solvesLoadedResolve();
    }
    return MAX_STAGE;
  } catch (e) {
    console.warn("[NAV] computeNextUnsolvedFromSolves failed:", e);
    // ✅ SIGNAL that solves have loaded even on error (gate open)
    if (typeof solvesLoadedResolve === 'function') {
      solvesLoadedResolve();
    }
    return 1;
  }
}

/** ========== AVATAR UPLOAD VALIDATION CONSTANTS ========== **/
const AVATAR_MAX_UPLOAD_MB = 2;          // target final upload size
const AVATAR_HARD_LIMIT_MB = 12;         // hard reject limit
const AVATAR_OUTPUT_SIZE = 512;          // px square dimension
const AVATAR_JPEG_QUALITY = 0.82;        // quality 0.7-0.85 range

/** Center-crop, resize, compress image to square avatar blob */
async function imageFileToSquareAvatarBlob(file) {
  // Basic type guard
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file (JPG, PNG, or WEBP).');
  }

  // Hard limit (before we even try)
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > AVATAR_HARD_LIMIT_MB) {
    throw new Error(`That file is too large (${sizeMB.toFixed(1)} MB). Please choose a smaller photo.`);
  }

  // Decode image
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not read that image.'));
    i.src = URL.createObjectURL(file);
  });

  // Center square crop
  const side = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - side) / 2);
  const sy = Math.floor((img.height - side) / 2);

  // Draw to canvas at final size
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Better scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

  // Convert to JPEG blob
  const blob = await new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b),
      'image/jpeg',
      AVATAR_JPEG_QUALITY
    );
  });

  // Cleanup object URL
  try { URL.revokeObjectURL(img.src); } catch {}

  if (!blob) throw new Error('Could not process that image.');

  return blob; // image/jpeg
}

async function handleProfileSave(event) {
  if (event) {
    event.preventDefault();
  }

  console.log('[PROFILE] saving...');

  try {
    // Clear any previous error
    const errorEl = document.getElementById('profileDisplayNameError');
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.textContent = '';
    }
    
    // Get display name input with validation
    const nameInput = document.getElementById("profileDisplayName");
    let display_name = nameInput ? nameInput.value.trim() : '';
    
    // Validate display name length
    if (display_name.length > DISPLAY_NAME_MAX_LEN) {
      alert(`Display name must be ${DISPLAY_NAME_MAX_LEN} characters or less.`);
      return;
    }

    // Prevent saving a default player_XXXXX name
    if (isDefaultPlayerName(display_name)) {
      alert('Please choose a custom display name (not player_...).');
      return;
    }
    
    display_name = display_name || null;

    // Get avatar selection from global state (set by wireAvatarOptions)
    // selectedAvatarKey is managed by event delegation and preselection logic
    const avatar_key = selectedAvatarKey || null;

    const uploadInput = document.getElementById("profileAvatarUpload");

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn('[PROFILE] Cannot save - no user');
      return;
    }

    let avatar_url = currentProfile?.avatar_url || null;

    // Handle file upload with compression
    const file = uploadInput.files?.[0];
    if (file) {
      try {
        // Optional: show user something while processing
        console.log('[PROFILE] Processing avatar image...', { name: file.name, size: file.size });

        const avatarBlob = await imageFileToSquareAvatarBlob(file);

        // final size check (soft target - warn, don't block unless huge)
        const finalMB = avatarBlob.size / (1024 * 1024);
        console.log('[PROFILE] Avatar processed', { finalMB: finalMB.toFixed(2) });

        const fileNameSafe = `avatar-${user.id}-${Date.now()}.jpg`;

        const { error: uploadError } = await supabase
          .storage.from("avatars")
          .upload(fileNameSafe, avatarBlob, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (uploadError) {
          console.error("[PROFILE] Upload error:", uploadError);
          alert('Failed to upload image. Please try again.');
          return;
        } else {
          const { data: publicData } = supabase
            .storage.from("avatars")
            .getPublicUrl(fileNameSafe);
          avatar_url = publicData.publicUrl;
          console.log('[PROFILE] Uploaded to:', avatar_url);
        }
      } catch (compressionError) {
        console.error('[PROFILE] Image processing error:', compressionError);
        alert(compressionError.message || 'Could not process your image. Please try a different photo.');
        return;
      }
    }

    const email = user.email;
    const username = currentProfile?.username || user.email;

    const payload = {
      id: user.id,
      email,
      username,
      display_name,
      avatar_key,
      avatar_url,
      updated_at: new Date().toISOString(),
    };

    console.log('[PROFILE] Saving:', payload);
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("[PROFILE] Save error:", error);
      
      // Check for duplicate display_name error
      if (error.code === '23505') {
        const errorEl = document.getElementById('profileDisplayNameError');
        if (errorEl) {
          errorEl.textContent = 'That name is already taken. Choose another.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      
      alert('Failed to save profile. Please try again.');
    } else {
      currentProfile = payload;
      console.log('[PROFILE] saved ok');
      
      // Once a photo is uploaded, disable avatar switching
      if (file) {
        selectedAvatarKey = null;
      }
      
      // Reload and hydrate UI with fresh profile data
      await loadMyProfileAndHydrateUI();
      
      // Update UI using consolidated helper
      applyProfileToUI(payload);
      
      closeProfileModal();
      showToast('Profile updated successfully!', { type: 'success', durationMs: 3000 });
    }
  } catch (err) {
    console.error('[PROFILE] save error:', err);
    alert('An error occurred while saving your profile.');
  }
}

// Legacy function kept for compatibility
async function saveUserProfile() {
  return handleProfileSave();
}

/** Check if user has uploaded a custom avatar photo */
function hasUploadedAvatar(profile) {
  return !!profile?.avatar_url;
}

function renderAvatarGrid(profile) {
  const grid = document.getElementById("avatarPresetGrid");
  if (!grid) return;
  
  grid.innerHTML = "";
  STOCK_AVATARS.forEach((a) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-avatar-option";
    button.dataset.avatarKey = a.key;

    const img = document.createElement("img");
    img.src = a.url;
    img.alt = a.label;
    button.appendChild(img);

    if (profile?.avatar_key === a.key) {
      button.classList.add("selected");
    }

    button.addEventListener("click", (e) => {
      e.preventDefault();
      document
        .querySelectorAll(".profile-avatar-option")
        .forEach((el) => el.classList.remove("selected"));
      button.classList.add("selected");
    });

    grid.appendChild(button);
  });
}

async function openProfileModal() {
  try {
    // --- Defensive checks for required profile DOM elements ---
    const modal = document.getElementById("profileModal");
    const displayNameEl = document.getElementById("profileDisplayName");
    const saveBtn = document.getElementById("btnSaveProfile");
    const backdrop = document.getElementById("profileModalBackdrop");

    if (!modal || !displayNameEl || !saveBtn || !backdrop) {
      console.warn("[PROFILE] Missing profile DOM elements", {
        profileModal: !!modal,
        profileDisplayName: !!displayNameEl,
        btnSaveProfile: !!saveBtn,
        profileModalBackdrop: !!backdrop,
      });
      return;
    }

    const profile = (await loadUserProfile()) || {};
    displayNameEl.value = profile.display_name || "";
    const uploadInput = document.getElementById("profileAvatarUpload");
    if (uploadInput) uploadInput.value = "";
    renderAvatarGrid(profile);

    // Preselect the saved avatar key and update UI
    selectedAvatarKey = profile?.avatar_key || null;
    document.querySelectorAll('.profile-avatar-option').forEach(btn => {
      const key = btn.getAttribute('data-avatar-key');
      btn.classList.toggle('selected', !!selectedAvatarKey && key === selectedAvatarKey);
    });

    // Show/hide preset avatars vs. current photo preview
    const hasPhoto = hasUploadedAvatar(profile);

    // Elements
    const avatarGrid = document.getElementById('avatarPresetGrid');
    const uploadLabel = document.getElementById('avatarUploadLabel');
    const avatarPreview = document.getElementById('avatarCurrentPreview');

    // Safety checks
    if (!avatarGrid || !uploadLabel) {
      console.warn('[PROFILE] Missing avatar toggle elements');
    } else {
      if (hasPhoto) {
        // Hide preset avatars
        avatarGrid.style.display = 'none';

        // Show current photo preview
        if (avatarPreview) {
          avatarPreview.src = profile.avatar_url;
          avatarPreview.style.display = 'block';
        }

        // Change upload text
        uploadLabel.textContent = 'Change profile pic';
      } else {
        // No uploaded photo → show avatars
        avatarGrid.style.display = 'flex';

        if (avatarPreview) {
          avatarPreview.style.display = 'none';
        }

        uploadLabel.textContent = 'Or upload your own';
      }

      // Hide "Choose an avatar" label when user has uploaded photo
      const chooseLabel = document.getElementById('avatarChooseLabel');
      if (chooseLabel) {
        chooseLabel.style.display = hasPhoto ? 'none' : 'block';
      }
    }

    // Wire handlers AFTER avatar grid is rendered
    wireProfileModalControls();

    backdrop.classList.remove("hidden");
    console.log('[PROFILE] Modal opened');
  } catch (err) {
    console.error('[PROFILE] Error opening modal:', err);
  }
}

function closeProfileModal() {
  const backdrop = document.getElementById("profileModalBackdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
    console.log('[PROFILE] Modal closed');
  }
}

function hasCompleteProfile(profile) {
  if (!profile) return false;
  const hasName = !!(profile.display_name && profile.display_name.trim());
  const hasAvatar = !!(profile.avatar_key || profile.avatar_url);
  return hasName && hasAvatar;
}

function maybePromptForProfile(user, profile) {
  try {
    if (!user || !profile) return;
    if (hasCompleteProfile(profile)) return;
    console.log('[PROFILE] Prompting user to complete profile…');
    openProfileModal();
  } catch (err) {
    console.warn('[PROFILE] Failed to prompt for profile:', err);
  }
}

function initProfileUI() {
  console.log('[PROFILE] Initializing UI...');
  
  const profileBtn = document.getElementById("profileTriggerBtn");
  const backdrop = document.getElementById("profileModalBackdrop");
  const saveBtn = document.getElementById("btnSaveProfile");
  const cancelBtns = backdrop?.querySelectorAll("[data-profile-close]");
  const changePasswordBtn = document.getElementById("profileChangePasswordBtn");

  if (!backdrop || !saveBtn) {
    console.warn('[PROFILE] Missing modal elements');
    return;
  }

  if (profileBtn) {
    profileBtn.addEventListener("click", openProfileModal);
    console.log('[PROFILE] Trigger button wired');
  }

  saveBtn.addEventListener("click", handleProfileSave);
  console.log('[PROFILE] Save button wired to handleProfileSave');

  if (cancelBtns) {
    cancelBtns.forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        closeProfileModal();
      })
    );
  }

  // Password reset handler
  console.log('[PROFILE] UI initialized');
}

function wireAvatarOptions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.profile-avatar-option');
    if (!btn) return;

    e.preventDefault();

    selectedAvatarKey = btn.getAttribute('data-avatar-key');
    console.log('[PROFILE] selectedAvatarKey =', selectedAvatarKey);

    // UI highlight
    document.querySelectorAll('.profile-avatar-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
}

function wireProfileModalControls() {
  console.log('[PROFILE] Wiring modal controls...');
  
  const backdrop = document.getElementById('profileModalBackdrop');
  const closeBtns = document.querySelectorAll('[data-profile-close]');
  const saveBtnEls = document.querySelectorAll('#btnSaveProfile');
  const avatarOptions = document.querySelectorAll('.profile-avatar-option');

  // Wire all close buttons (X button and Cancel button)
  if (closeBtns && closeBtns.length > 0) {
    closeBtns.forEach(btn => {
      btn.onclick = (evt) => {
        evt.preventDefault();
        closeProfileModal();
      };
    });
    console.log(`[PROFILE] Wired ${closeBtns.length} close button(s)`);
  } else {
    console.warn('[PROFILE] No close buttons found with [data-profile-close]');
  }

  // Wire avatar option clicks
  if (avatarOptions && avatarOptions.length > 0) {
    avatarOptions.forEach((btn) => {
      btn.onclick = (evt) => {
        evt.preventDefault();
        const avatarKey = btn.dataset.avatarKey;
        
        // Remove 'selected' class from all avatars
        document.querySelectorAll('.profile-avatar-option').forEach((el) => {
          el.classList.remove('selected');
        });
        
        // Add 'selected' class to clicked avatar
        btn.classList.add('selected');
        
        console.log('[PROFILE] avatar selected:', { avatarKey });
      };
    });
    console.log(`[PROFILE] Wired ${avatarOptions.length} avatar option(s)`);
  } else {
    console.warn('[PROFILE] No avatar options found');
  }

  // Wire save button
  if (saveBtnEls && saveBtnEls.length > 0) {
    saveBtnEls.forEach((btn) => {
      // Remove old handlers by cloning the element
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      // Add new handler
      newBtn.addEventListener('click', (evt) => {
        evt.preventDefault();
        console.log('[PROFILE] save button clicked');
        handleProfileSave(evt);
      });
    });
    console.log(`[PROFILE] Wired save button`);
  } else {
    console.warn('[PROFILE] Save button not found');
  }

  // Optional: click on the dark backdrop closes modal
  if (backdrop) {
    backdrop.addEventListener('click', (evt) => {
      if (evt.target === backdrop) {
        closeProfileModal();
      }
    });
    console.log('[PROFILE] Backdrop click-to-close enabled');
  }
}

function initProfilePasswordChange() {
  const toggleBtn = document.getElementById('changePasswordToggle');
  const section = document.getElementById('passwordChangeSection');
  const formContainer = document.getElementById('passwordChangeForm');
  const saveBtn = document.getElementById('savePasswordChangeBtn');
  const cancelBtn = document.getElementById('cancelPasswordChange');
  const feedbackEl = document.getElementById('passwordChangeFeedback');

  if (!toggleBtn || !section || !formContainer || !saveBtn || !cancelBtn || !feedbackEl) {
    console.warn('[PROFILE] Password change elements not found – skipping init.');
    return;
  }

  const currentInput = document.getElementById('currentPassword');
  const newInput = document.getElementById('newPassword');
  const confirmInput = document.getElementById('confirmNewPassword');

  function clearFields() {
    if (currentInput) currentInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
  }

  function showSection(show) {
    section.style.display = show ? 'block' : 'none';
    feedbackEl.textContent = '';
    feedbackEl.className = 'password-change-feedback';
    if (!show) {
      clearFields();
    }
  }

  toggleBtn.addEventListener('click', () => {
    const isVisible = section.style.display === 'block';
    showSection(!isVisible);
  });

  cancelBtn.addEventListener('click', () => {
    showSection(false);
  });

  saveBtn.addEventListener('click', async () => {
    const currentPassword = currentInput.value.trim();
    const newPassword = newInput.value.trim();
    const confirmNewPassword = confirmInput.value.trim();

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setFeedback('Please fill in all fields.', 'error');
      return;
    }

    if (newPassword.length < 8) {
      setFeedback('New password must be at least 8 characters.', 'error');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setFeedback('New passwords do not match.', 'error');
      return;
    }

    try {
      setFeedback('Updating password…', 'info');

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error('[PROFILE] getUser error', userError);
        setFeedback('Session expired. Please log in again.', 'error');
        return;
      }

      const userEmail = userData.user.email;
      if (!userEmail) {
        setFeedback('Could not determine account email.', 'error');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (signInError) {
        console.warn('[PROFILE] Re-auth failed', signInError);
        setFeedback('Current password is incorrect.', 'error');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        console.error('[PROFILE] updateUser error', updateError);
        setFeedback('Failed to update password. Please try again.', 'error');
        return;
      }

      setFeedback('Password updated successfully.', 'success');

      setTimeout(() => {
        showSection(false);
        if (typeof closeProfileModal === 'function') {
          closeProfileModal();
        } else {
          const modal = document.getElementById('profileModal');
          if (modal) {
            modal.style.display = 'none';
          }
        }
      }, 1200);
    } catch (err) {
      console.error('[PROFILE] Unexpected error during password change', err);
      setFeedback('Something went wrong. Please try again.', 'error');
    }

    function setFeedback(message, type) {
      feedbackEl.textContent = message;
      feedbackEl.className = `password-change-feedback password-change-${type}`;
    }
  });
}

// ===== END MY PROFILE MODULE =====

// ===== HEADER AUTH UI WIRING =====
function wireHeaderAuthUI(user) {
  console.log('[HEADER] Wiring header auth UI for user:', user?.email || 'unknown');
  
  // Buttons / email in header
  const profileBtn = document.getElementById('btnMyProfile');
  const signOutBtn = document.getElementById('btnSignOut');
  const emailSpan  = document.getElementById('journeyUserEmail');

  // Defensive: avoid "Cannot set properties of null"
  if (profileBtn) {
    profileBtn.onclick = openProfileModal;
    console.log('[HEADER] Profile button wired');
  } else {
    console.warn('[HEADER] btnMyProfile not found in DOM');
  }

  if (signOutBtn) {
    // Wire hard sign-out handler (bind exactly once)
    signOutBtn.onclick = hardSignOut;
    console.log('[HEADER] Sign out button wired');
  } else {
    console.warn('[HEADER] btnSignOut not found in DOM');
  }

  if (emailSpan && user && user.email) {
    // Use centralized updateHeaderUserLabel function
    updateHeaderUserLabel(user, currentProfile);
    console.log('[HEADER] User label updated');
  } else if (!emailSpan) {
    console.warn('[HEADER] journeyUserEmail span not found in DOM');
  }

  // Wire profile button with defensive fallbacks
  (function wireProfileButton() {
    const btn = document.getElementById("btnMyProfile");

    if (!btn) {
      console.warn("[PROFILE] My Profile button not found in DOM");
      return;
    }

    btn.addEventListener("click", () => {
      console.log("[PROFILE] My Profile clicked");

      if (typeof openProfileModal === "function") {
        openProfileModal();
        return;
      }

      if (typeof profileUI?.open === "function") {
        profileUI.open();
        return;
      }

      if (typeof showProfile === "function") {
        showProfile();
        return;
      }

      console.warn("[PROFILE] No profile open handler found");
    });
  })();
}

// ===== SHARED STORAGE HELPER =====
/**
 * Clear Supabase auth tokens and app state from storage
 * Surgical approach: avoids localStorage.clear() to prevent collateral issues
 */
function clearSupabaseAuthStorage() {
  try {
    // Remove Supabase auth tokens (common patterns)
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (
        k.startsWith("sb-") && k.includes("-auth-token")
      ) {
        localStorage.removeItem(k);
      }
    }

    // Optional: if you store app state keys, clear them explicitly
    const appKeys = [
      "UI_MODE",
      "ADMIN_UI_MODE",
      "stage_cache",
      "leaderboard_cache",
      "user_cache"
    ];
    for (const k of appKeys) {
      if (localStorage.getItem(k) !== null) localStorage.removeItem(k);
    }
  } catch (e) {
    console.warn("[SIGNOUT] storage clear warning:", e);
  }

  try {
    // If you use sessionStorage anywhere, clear app keys there too
    sessionStorage.removeItem("UI_MODE");
    sessionStorage.removeItem("ADMIN_UI_MODE");
  } catch (e) {
    // ignore
  }
}

// ===== HARD SIGN-OUT HANDLER =====
// ===== HARD SIGN-OUT HANDLER (Full Cache Clear) =====
async function hardSignOut() {
  try {
    console.log('[AUTH] Starting full sign out...');

    // Step 1: Supabase sign out
    try {
      await supabase.auth.signOut();
      console.log('[AUTH] supabase.auth.signOut() complete');
    } catch (err) {
      console.error('[AUTH] Error during supabase.auth.signOut():', err);
      // Continue anyway
    }

    // Step 2: Clear in-memory cached state
    console.log('[AUTH] clearing memory');
    currentProfile = null;
    currentUser = null;
    currentStage = 1;
    solvedStages = {};
    if (window.contestApp) {
      window.contestApp.currentStage = 1;
    }
    if (progressManager) {
      progressManager.localProgress = {};
    }

    // Step 3: Clear app-specific localStorage keys (be explicit—don't nuke everything)
    console.log('[AUTH] clearing storage');
    const keysToClear = [
      "SC_AUTO_ENTER_GAME",
      "sc_lp_variant",
      "sc_session_id",
      "sc_lp_view_once",
      "current_stage",
      "solved_stages",
      "stageProgress",
      "progress",
      "test_user",
      "wrongAttempts",
      "lp_session_id",
      "lp_variant",
    ];

    keysToClear.forEach((k) => localStorage.removeItem(k));

    // Clear session-only flags (dedupe, etc.)
    sessionStorage.clear();

    // Step 4: Clear Supabase auth tokens from storage
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        localStorage.removeItem(k);
      }
    });

    // Step 5: Clean URL hash if it contains auth tokens
    if (location.hash && /access_token|refresh_token|type/.test(location.hash)) {
      history.replaceState({}, document.title, location.pathname + location.search);
    }

    // Step 6: Force UI to logged-out state
    console.log('[AUTH] signOut complete');
    try {
      hasAutoStartedGame = false;
      window.hasAutoStartedGame = false;
    } catch (e) {
      // noop
    }
    showLanding();

    // Step 7: Reload to index.html
    console.log('[AUTH] reload after sign out');
    window.location.href = "./index.html";
  } catch (err) {
    console.error('[AUTH] Unexpected error in hardSignOut:', err);
    window.location.href = "./index.html";
  }
}
// ===== END HEADER AUTH UI WIRING =====

// CRITICAL FIX: Complete validation function with proper API integration
async function validateAnswer(stage, step, answer) {
    console.log(`[VALIDATE] Validating stage ${stage}, step ${step}, answer: ${answer}`);
    
    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/validate-answer`, {
            method: 'POST',
            headers: {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
},
            body: JSON.stringify({
                stage: stage,
                step: step,
                answer: answer.toLowerCase().trim()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`[VALIDATE] API response:`, result);
        
        return {
    success: true,
    correct: result.ok,
    message: result.ok ? 'Correct!' : 'Incorrect answer'
};
    } catch (error) {
        console.error(`[VALIDATE] API error:`, error);
        // Fallback to local validation for basic answers
        const localResult = validateAnswerLocal(stage, step, answer);
        console.log(`[VALIDATE] Using local fallback:`, localResult);
        return localResult;
    }
}

// Local fallback validation
function validateAnswerLocal(stage, step, answer) {
    const cleanAnswer = answer.toLowerCase().trim();
    
    // Basic validation for known answers
    const knownAnswers = {
        1: { 1: 'istanbul' },
        2: { 1: 'cappadocia' },
        3: { 1: 'pamukkale' },
        4: { 1: 'ephesus' }
    };
    
    if (knownAnswers[stage] && knownAnswers[stage][step]) {
        return {
            success: true,
            correct: cleanAnswer === knownAnswers[stage][step],
            message: cleanAnswer === knownAnswers[stage][step] ? 'Correct!' : 'Incorrect answer'
        };
    }
    
    // Default to incorrect for unknown answers
    return {
        success: true,
        correct: false,
        message: 'Answer validation unavailable'
    };
}

// ===== SOLVE CELEBRATION MODAL =====
function showSolveCelebrationModal(stageNumber, { isMasterStage = false, isStageWinner = false } = {}) {
    const backdrop = document.getElementById('solveCelebrationModal');
    const title = document.getElementById('solveCelebrationTitle');
    const body = document.getElementById('solveCelebrationBody');
    
    if (!backdrop || !title || !body) {
        console.warn('[CELEBRATION] Modal elements not found');
        return;
    }
    
    // Set content based on stage and winner status
    if (isMasterStage) {
        title.textContent = 'You cracked the Master Stage!';
        body.textContent = "You've completed the journey. If you're the grand prize winner, we'll contact you with next steps.";
    } else if (isStageWinner) {
        title.textContent = `You won Stage ${stageNumber}!`;
        body.textContent = `You were the first to solve Stage ${stageNumber} and you've claimed the main prize for this stage. You're also entered into the draw for the bonus prizes. Keep going to get closer to the Master Stage.`;
    } else {
        title.textContent = `Stage ${stageNumber} solved!`;
        body.textContent = `Stage ${stageNumber} has already been won. However, you've been entered into the draw for this stage's bonus prizes. Keep going to get closer to the Master Stage.`;
    }
    
    // Show modal
    backdrop.classList.remove('hidden');
    console.log(`[CELEBRATION] Showing modal for stage ${stageNumber}, winner: ${isStageWinner}`);
}

async function closeSolveCelebrationModal(scrollToNext = false) {
    const backdrop = document.getElementById('solveCelebrationModal');
    if (!backdrop) return;
    
    backdrop.classList.add('hidden');
    console.log('[CELEBRATION] Modal closed');
    
    // Optionally scroll to next stage card
    if (scrollToNext && window.app) {
        const nextStage = window.app.findNextUnsolvedStage();
        if (nextStage && nextStage <= CONFIG.total) {
            setTimeout(() => {
                const nextCard = document.querySelector(`[data-stage="${nextStage}"]`);
                if (nextCard) {
                    nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }
    
    // Prompt user to complete profile if needed
    try {
        const { data: { user } } = await supabase.auth.getUser();
        maybePromptForProfile(user, currentProfile);
    } catch (err) {
        console.warn('[CELEBRATION] Failed to check profile:', err);
    }
}

// Wire up celebration modal close handlers
document.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.getElementById('solveCelebrationModal');
    const primaryBtn = document.getElementById('solveCelebrationPrimary');
    
    if (backdrop && primaryBtn) {
        // Close on primary button click
        primaryBtn.addEventListener('click', () => {
            closeSolveCelebrationModal(true);
        });
        
        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeSolveCelebrationModal(false);
            }
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) {
                closeSolveCelebrationModal(false);
            }
        });
    }
});

// Complete the ContestApp class
class ContestApp {
    constructor() {
        this.currentStage = Number(window.currentStage) || 1;
        this.solvedStages = [];
        this.firstRiddleSolved = [];
        this.modalCurrentStage = null;
        // NOTE: init() is called manually after DB restore in startContestForSignedInUser()
    }

    async init() {
        console.log('[ContestApp] Initializing...');
        this.loadInitialProgress();
        this.renderCurrentStage();
        this.renderStagesGrid();
        this.updateProgress();
        this.bindEvents();
        console.log('[ContestApp] Initialized');
    }

    loadInitialProgress() {
        // ✅ If stage was restored from DB (or set by login flow), DO NOT override it
        const preset = Number(window.currentStage) || Number(this.currentStage) || 1;
        if (preset > 1) {
            this.currentStage = preset;
            console.log("[ContestApp] Skipping localStorage stage calc, preset stage:", preset);
            // Still load solved stages from localStorage for UI rendering
            this.solvedStages = this.getSolvedStagesFromLocal();
            this.firstRiddleSolved = this.getFirstRiddleSolvedFromLocal();
            return;
        }

        // Only run localStorage-based progress loading if stage is 1 (new user)
        this.solvedStages = this.getSolvedStagesFromLocal();
        this.firstRiddleSolved = this.getFirstRiddleSolvedFromLocal();
        
        // IMPORTANT: Only compute stage if it hasn't been set externally (e.g., from DB restore)
        // If stage was set from DB (via window.currentStage), DO NOT override it with localStorage
        const stageIsPreset = this.currentStage > 1;
        if (!stageIsPreset) {
            // Only compute from localStorage if no stage is set
            this.currentStage = this.findNextUnsolvedStage() || 1;
            console.log(`[ContestApp] loadInitialProgress: computed stage from localStorage: ${this.currentStage}`);
        } else {
            console.log(`[ContestApp] loadInitialProgress: respecting pre-set stage: ${this.currentStage}`);
        }
    }

    getSolvedStagesFromLocal() {
        try {
            return JSON.parse(localStorage.getItem("contest_solved_stages") || "[]");
        } catch (e) {
            return [];
        }
    }

    setSolvedStagesLocal(stages) {
        const unique = [...new Set(stages)].sort((a, b) => a - b);
        localStorage.setItem("contest_solved_stages", JSON.stringify(unique));
        this.solvedStages = unique;
    }

    getFirstRiddleSolvedFromLocal() {
        try {
            return JSON.parse(localStorage.getItem("contest_first_riddle_solved") || "[]");
        } catch (e) {
            return [];
        }
    }

    setFirstRiddleSolvedLocal(stages) {
        const unique = [...new Set(stages)].sort((a, b) => a - b);
        localStorage.setItem("contest_first_riddle_solved", JSON.stringify(unique));
        this.firstRiddleSolved = unique;
    }

    isSolved(stage) {
        return this.solvedStages.includes(stage);
    }

    isFirstRiddleSolved(stage) {
        return this.firstRiddleSolved.includes(stage);
    }

    // UPDATED: Now checks both progression AND admin control
    isUnlocked(stage) {
        const progressUnlocked = stage === 1 || this.isSolved(stage - 1);
        const adminEnabled = stageControlManager ? stageControlManager.isStageEnabled(stage) : true;
        return progressUnlocked && adminEnabled;
    }

    // NEW: Check if stage is admin disabled
    isAdminDisabled(stage) {
        return stageControlManager ? !stageControlManager.isStageEnabled(stage) : false;
    }

    hasTwoRiddles(stage) {
        return stage >= 5 && stage <= 15;
    }

    getNextUnsolvedStage(fromStage) {
        for (let i = fromStage; i <= CONFIG.total; i++) {
            if (!this.isSolved(i)) return i;
        }
        return null;
    }

    // CRITICAL FIX: New method to find next unsolved stage
    findNextUnsolvedStage() {
        for (let i = 1; i <= CONFIG.total; i++) {
            if (!this.isSolved(i)) {
                return i;
            }
        }
        return null; // All stages solved
    }

    // CRITICAL FIX: Completely rewritten stage progression logic
    async markStageSolvedAndAdvance(stage) {
        console.log(`[ADVANCE] Marking stage ${stage} as solved and advancing...`);
        // === CONFETTI HOOK (fires once per user per step) ===
try {
  const userId =
    (window.authUser && window.authUser.id) ||
    (window.state && window.state.user && window.state.user.id) ||
    null;

  const s = Number(stage) || Number(window.state?.stage) || 1;
  // If you track per-stage multi-steps, replace the `1` with your step var (e.g., this.currentStep)
  const p = (typeof this?.currentStep !== "undefined") ? Number(this.currentStep) : 1;

  console.log("[CONFETTI] Hook reached with", { userId, stage: s, step: p });
  fireConfettiOnce(userId, s, p);
} catch (e) {
  console.warn("[CONFETTI] error calling fireConfettiOnce", e);
}
        // Step 1: Update local solved stages FIRST
        if (!this.isSolved(stage)) {
            const newSolved = [...this.solvedStages, stage];
            this.setSolvedStagesLocal(newSolved);
            console.log(`[ADVANCE] Stage ${stage} marked as solved locally. New progress:`, newSolved);
        }

        // Step 2: Save to database (async, don't block UI updates) and capture winner status
        let isStageWinner = false;
        if (leaderboardManager) {
            console.log(`[ADVANCE] Attempting to save stage ${stage} to database...`);
            try {
                const result = await leaderboardManager.logSolve(stage);
                if (result.success) {
                    console.log(`[ADVANCE] Database save successful for stage ${stage}:`, result.reason || 'saved');
                    isStageWinner = result.isStageWinner || false;
                } else {
                    console.warn(`[ADVANCE] Database save failed for stage ${stage}, but continuing...`);
                    console.error('[ADVANCE] Database save error:', result);
                    console.error('[ADVANCE] Supabase error details:', result && result.error ? result.error : result);
                }
            } catch (error) {
                console.warn(`[ADVANCE] Database save error for stage ${stage}:`, error);
                console.error('[ADVANCE] Database save error:', error);
                console.error('[ADVANCE] Supabase error details:', error && error.error ? error.error : error);
            }
        }

        // Step 3: Log progress (async)
        if (progressManager) {
            progressManager.logStageCompletion(`stage_${stage}`, `Stage ${stage} Complete`);
        }

        // Step 4: Force UI updates with fresh data
        console.log(`[ADVANCE] Updating UI for stage ${stage} completion...`);
        this.renderStagesGrid();
        this.updateProgress();
        updateStage16();
        
        // Step 4.5: Add visual highlight animation to the solved stage card
        setTimeout(() => {
            this.highlightSolvedStageCard(stage, isStageWinner);
        }, 100); // Small delay to ensure DOM is updated

        // Step 5: Update leaderboard
        setTimeout(() => {
            renderLeaderboard();
        }, 100);

        // Step 6: Find and advance to next stage
        const nextStage = this.findNextUnsolvedStage();
        
        if (nextStage && nextStage <= CONFIG.total) {
            console.log(`[ADVANCE] Advancing from stage ${stage} to stage ${nextStage}`);
            this.currentStage = nextStage;
            this.renderCurrentStage();
        } else {
            console.log(`[ADVANCE] All stages complete! Rendering grand prize.`);
            this.renderGrandPrize();
        }
        
        // Step 7: Show celebration modal (after confetti has fired)
        showSolveCelebrationModal(stage, { isMasterStage: stage === 16, isStageWinner });
        
        // Step 8: Hide Stage 1 helper bar permanently if Stage 1 was just solved
        if (stage === 1) {
            const helperBar = document.getElementById('stage1HelperBar');
            if (helperBar) {
                // Remove visible class for fade-out, then hide completely
                helperBar.classList.remove('stage-helper-visible');
                setTimeout(() => {
                    helperBar.classList.add('stage-helper-hidden');
                }, 220); // Match transition duration
            }
        }
    }

    setCurrentStage(stage) {
        this.currentStage = stage;
        console.log(`[ADVANCE] Current stage set to: ${stage}`);
    }

        // Ensure the app is positioned at the next unsolved stage (using DB data, not localStorage)
        async ensureAtNextUnsolved(reason = "auto") {
            try {
                const userId = supabaseAuth?.user?.id;
                if (!userId || !window.supabaseClient) {
                    console.warn("[NAV] No user ID or client, cannot compute next unsolved");
                    return;
                }

                // Query DB for next unsolved
                const nextStage = await computeNextUnsolvedFromSolves(userId);
                if (this.currentStage !== nextStage) {
                    console.log(`[NAV] Jumping to next unsolved: ${nextStage} (${reason})`);
                    this.currentStage = nextStage;
                    if (typeof this.renderCurrentStage === "function") this.renderCurrentStage();
                }
            } catch (e) {
                console.warn("[NAV] ensureAtNextUnsolved failed (non-fatal):", e);
            }
        }

    hideAllPanels() {
        document.getElementById('inputSection').style.display = 'none';
        document.getElementById('secondRiddlePanel').style.display = 'none';
        document.getElementById('successPanel').style.display = 'none';
        document.getElementById('errorMessage').style.display = 'none';
        document.getElementById('secondRiddleError').style.display = 'none';
        document.getElementById('stageDisabledPanel').style.display = 'none'; // NEW: Hide stage disabled panel
    }

    // Validation methods
    async validateAnswer(stage, step, answer) {
        return await validateAnswer(stage, step, answer);
    }

    validateAnswerLocal(stage, step, answer) {
        return validateAnswerLocal(stage, step, answer);
    }

    // Render current stage method
    renderCurrentStage() {
        console.log(`[RENDER] Rendering current stage: ${this.currentStage}`);
        updateStageStatusBanner(this.currentStage);
        
        this.hideAllPanels();
        
        // Check if current stage is admin disabled
        if (this.isAdminDisabled(this.currentStage)) {
            console.log(`[RENDER] Stage ${this.currentStage} is admin disabled, showing notification`);
            document.getElementById('disabledStageNumber').textContent = this.currentStage;
            document.getElementById('stageDisabledPanel').style.display = 'block';
            return;
        }
        
        // Update stage title and video
        const stageConfig = CONFIG.stages[this.currentStage];
        if (stageConfig) {
            document.querySelector('.stage-title').textContent = `Stage ${this.currentStage}`;
            document.getElementById('currentVideo').src = `https://www.youtube.com/embed/${stageConfig.yt}`;
        }
        
        // Show appropriate input section
        if (this.isSolved(this.currentStage)) {
            // Stage already solved, show success
            this.showSuccess(this.currentStage);
        } else if (this.hasTwoRiddles(this.currentStage) && this.isFirstRiddleSolved(this.currentStage)) {
            // Show second riddle for stages 5-15
            this.showSecondRiddle(this.currentStage);
        } else {
            // Show first riddle input
            document.getElementById('inputSection').style.display = 'flex';
        }

        // Re-attach profile button handler after stage render
        wireProfileButton();
    }

    // Show success panel
    showSuccess(stage) {
        const nextStage = this.findNextUnsolvedStage();
        const successText = document.getElementById('successText');
        const continueBtn = document.getElementById('continueBtn');
        
        if (nextStage && nextStage <= CONFIG.total) {
            successText.textContent = `Stage ${stage} complete! Ready for the next challenge?`;
            continueBtn.textContent = `Continue to Stage ${nextStage}`;
            continueBtn.onclick = () => {
                this.currentStage = nextStage;
                this.renderCurrentStage();
            };
        } else {
            successText.textContent = `Congratulations! You've completed all stages!`;
            continueBtn.textContent = 'View Your Achievement';
            continueBtn.onclick = () => this.renderGrandPrize();
        }
        
        document.getElementById('successPanel').style.display = 'block';
    }

    // Show second riddle
    showSecondRiddle(stage) {
        const clue = SECOND_RIDDLE_CLUES[stage] || 'Second riddle clue not available.';
        document.getElementById('secondRiddleClue').textContent = clue;
        document.getElementById('secondRiddlePanel').style.display = 'block';
    }

    // Render stages grid
    renderStagesGrid() {
        const grid = document.getElementById('stagesGrid');
        grid.innerHTML = '';
        
        for (let stage = 1; stage <= 15; stage++) {
            const tile = this.createStageTile(stage);
            grid.appendChild(tile);
        }
        
        // ✅ Apply canonical solved state to cards after render
        this.applySolvedStatesToCards();
        
        // Update Stage 16 separately
        updateStage16();
    }

    // Create individual stage tile
    createStageTile(stage) {
        // ✅ Use canonical global solved state
        const solvedStages = window.__SOLVED_STAGES || [];
        const solvedSet = new Set(solvedStages);
        const currentStage = window.contestApp?.currentStage || this.currentStage || 1;
        
        const tile = document.createElement('div');
        tile.className = 'stage-tile';
        tile.setAttribute('data-stage', stage);  // ✅ Stable selector
        
        // Canonical unlock/solve logic
        const isSolved = solvedSet.has(stage);
        const isCurrent = stage === currentStage;
        const isUnlocked = stage <= currentStage;
        const isAdminDisabled = this.isAdminDisabled(stage);
        
        if (isSolved) {
            tile.classList.add('solved');
        } else if (isAdminDisabled) {
            tile.classList.add('stage-status-locked');
        } else if (!isUnlocked) {
            tile.classList.add('stage-status-locked');
        }
        
        // Determine icon and status
        let iconClass, iconText, statusText, statusClass;
        if (isSolved) {
            iconClass = 'solved';
            iconText = '✓';
            statusText = 'Solved';
            statusClass = 'is-solved';
        } else if (isAdminDisabled) {
            iconClass = 'stage-status-locked';
            iconText = '⏸️';
            statusText = 'Opens as your journey unfolds';
            statusClass = 'is-locked';
        } else if (isUnlocked) {
            iconClass = 'open';
            iconText = stage;
            statusText = 'Open';
            statusClass = 'is-open';
        } else {
            iconClass = 'stage-status-locked';
            iconText = '🔒';
            statusText = 'Opens as your journey unfolds';
            statusClass = 'is-locked';
        }
        
        // Prize badge
        let prizeText = stage === 15 ? '50K<br>Miles' : '$50<br>$100 GC';
        
        tile.innerHTML = `
            <div class="prize-badge">
                <span class="prize-badge-line">${prizeText.split('<br>')[0]}</span>
                <span class="prize-badge-line">${prizeText.split('<br>')[1]}</span>
            </div>
            <div class="stage-icon ${iconClass}">${iconText}</div>
            <div class="stage-name">Stage ${stage}</div>
            <div class="stage-status stage-status-label ${statusClass}">${statusText}</div>
        `;
        
        // Add click handler for unlocked stages
        if (isUnlocked && !isAdminDisabled) {
            tile.style.cursor = 'pointer';
            tile.onclick = () => this.openStageModal(stage);
        }
        
        return tile;
    }

    // ✅ Apply canonical solved state to all rendered cards
    applySolvedStatesToCards() {
        const solvedStages = window.__SOLVED_STAGES || [];
        console.log("[JOURNEY] Applying solved states to cards using:", solvedStages);
        
        solvedStages.forEach(stage => {
            const card = document.querySelector(`[data-stage="${stage}"]`);
            if (card) {
                // Set status text
                const statusEl = card.querySelector('.stage-status');
                if (statusEl) {
                    statusEl.textContent = 'Solved';
                    statusEl.className = 'stage-status stage-status-label is-solved';
                }
                
                // Update badge with checkmark
                const iconEl = card.querySelector('.stage-icon');
                if (iconEl) {
                    iconEl.textContent = '✓';
                    iconEl.className = 'stage-icon solved';
                }
                
                // Add solved class to card
                card.classList.add('solved');
                console.log(`[JOURNEY] Applied solved state to stage ${stage}`);
            }
        });
    }

    // Open stage modal
    openStageModal(stage) {
        this.modalCurrentStage = stage;
        document.getElementById('modalTitle').textContent = `Stage ${stage}`;
        document.getElementById('stageModal').style.display = 'flex';
        
        // Set current stage and render
        this.currentStage = stage;
        this.renderCurrentStage();
        
        // Close modal
        setTimeout(() => {
            document.getElementById('stageModal').style.display = 'none';
        }, 2000);
    }

    // Update progress bar
    updateProgress() {
        // ✅ Use canonical global solved state
        const solvedCount = window.__SOLVED_STAGES.length;
        const percentage = (solvedCount / CONFIG.total) * 100;
        
        console.log("[JOURNEY] updateProgress using:", window.__SOLVED_STAGES, "count:", solvedCount);
        
        const progressCountEl = document.getElementById('progressCount');
        if (progressCountEl) {
            progressCountEl.textContent = `${solvedCount} / ${CONFIG.total} solved`;
        }
        
        // Update the new stage progress bar
        this.updateStageProgressUI();
    }

    // Update stage progress UI (horizontal bar with dots)
    updateStageProgressUI() {
        // ✅ Use canonical global solved state
        const solvedStages = window.__SOLVED_STAGES;
        console.log("[JOURNEY] renderJourneyProgress using:", solvedStages);
        
        const labelEl = document.querySelector('.stage-progress-label');
        const fillEl = document.querySelector('.stage-progress-fill');
        const dotsEl = document.querySelector('.stage-progress-dots');
        
        // Update label text (if it exists)
        if (labelEl) {
            if (this.currentStage === 1 && solvedStages.length === 0) {
                labelEl.textContent = 'Your Journey: Not started yet';
            } else {
                labelEl.textContent = `Your Journey: Stage ${this.currentStage} of 15`;
            }
        }
        
        // Calculate completion ratio (based on stages 1-15 only)
        const solvedCount = solvedStages.filter(s => s <= 15).length;
        const ratio = solvedCount / 15;
        
        // Update progress bar fill (if it exists)
        if (fillEl) {
            fillEl.style.width = `${ratio * 100}%`;
        }
        
        // Render 15 dots (if container exists)
        if (dotsEl) {
            dotsEl.innerHTML = '';
            for (let i = 1; i <= 15; i++) {
                const dot = document.createElement('span');
                dot.className = 'stage-dot';
                
                if (solvedStages.includes(i)) {
                    dot.classList.add('stage-dot-complete');
                } else if (i === this.currentStage) {
                    dot.classList.add('stage-dot-current');
                } else if (i > this.currentStage) {
                    dot.classList.add('stage-dot-locked');
                }
                
                dotsEl.appendChild(dot);
            }
        }
    }

    // Highlight the solved stage card with animation
    highlightSolvedStageCard(stageNumber, isStageWinner = false) {
        try {
            // Find the stage card in the grid
            const grid = document.getElementById('stagesGrid');
            if (!grid) return;
            
            // Cards are in order 1-15, so index is stageNumber - 1
            const cardIndex = stageNumber - 1;
            const stageCards = grid.querySelectorAll('.stage-tile');
            
            if (stageCards && stageCards[cardIndex]) {
                const card = stageCards[cardIndex];
                
                // Choose animation class based on winner status
                const animationClass = isStageWinner 
                    ? 'journey-card--stage-winner' 
                    : 'journey-card--just-solved';
                
                // Add the animation class
                card.classList.add(animationClass);
                
                // Remove the class after animation completes
                const duration = isStageWinner ? 700 : 650;
                setTimeout(() => {
                    card.classList.remove(animationClass);
                }, duration);
                
                console.log(`[ANIMATION] Applied ${animationClass} to stage ${stageNumber} card`);
            }
        } catch (error) {
            console.warn('[ANIMATION] Error highlighting stage card:', error);
        }
    }

    // Render grand prize (all stages complete)
    renderGrandPrize() {
        this.hideAllPanels();
        
        document.querySelector('.stage-title').textContent = '🎉 Congratulations! Journey Complete!';
        document.querySelector('.stage-subtitle').textContent = 'You have successfully completed all 16 stages of the Six Continents Challenge!';
        
        // Hide video container
        document.querySelector('.video-container').style.display = 'none';
        
        // Show celebration message
        const celebrationPanel = document.createElement('div');
        celebrationPanel.className = 'success-panel';
        celebrationPanel.style.display = 'block';
        celebrationPanel.innerHTML = `
            <div class="success-title">🏆 Amazing Achievement!</div>
            <div class="success-text">
                You've completed the ultimate travel challenge! Your journey across six continents is now complete.
                Check the leaderboard to see if you've won any prizes!
            </div>
        `;
        
        document.getElementById('currentStage').appendChild(celebrationPanel);
        
        // Trigger confetti (guarded: fires only once per user per step)
{
    const s = (this?.stage ?? window?.state?.stage ?? 1); // stage number fallback
    const p = (this?.step  ?? window?.state?.step  ?? 1); // step number fallback
    fireConfettiOnce(currentUserIdSafe(), s, p);
}
    }

    // Bind event handlers
    bindEvents() {
        // First riddle submission
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.onclick = () => this.handleFirstRiddleSubmit();
        }

        const answerInput = document.getElementById('answerInput');
        if (answerInput) {
            answerInput.onkeypress = (e) => {
                if (e.key === 'Enter') this.handleFirstRiddleSubmit();
            };
        }
        
        // Second riddle submission
        const secondRiddleSubmit = document.getElementById('secondRiddleSubmit');
        if (secondRiddleSubmit) {
            secondRiddleSubmit.onclick = () => this.handleSecondRiddleSubmit();
        }

        const secondRiddleInput = document.getElementById('secondRiddleInput');
        if (secondRiddleInput) {
            secondRiddleInput.onkeypress = (e) => {
                if (e.key === 'Enter') this.handleSecondRiddleSubmit();
            };
        }
        
        // Modal close
        const closeModal = document.getElementById('closeModal');
        if (closeModal) {
            closeModal.onclick = () => {
                const stageModal = document.getElementById('stageModal');
                if (stageModal) {
                    stageModal.style.display = 'none';
                }
            };
        }
        
        // Sign out buttons - NOTE: Regular user sign out is now handled by wireHeaderAuthUI()
        // Only wire admin sign out here
        const adminSignOutBtn = document.getElementById('adminSignOutBtn');
        if (adminSignOutBtn) {
            adminSignOutBtn.onclick = () => this.handleSignOut();
        }
    }

    // Handle first riddle submission
    async handleFirstRiddleSubmit() {
        const answer = document.getElementById('answerInput').value.trim();
        if (!answer) return;
        
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Checking...';
        
        try {
            const result = await this.validateAnswer(this.currentStage, 1, answer);
            
            if (result.correct) {
                // Clear input
                document.getElementById('answerInput').value = '';
                document.getElementById('errorMessage').style.display = 'none';
                // Reset wrong-attempt counter on success
                try { resetWrongAttempts(); } catch (e) { /* noop if not available */ }
                
                if (this.hasTwoRiddles(this.currentStage)) {
                    // Mark first riddle as solved and show second riddle
                    const newFirstRiddleSolved = [...this.firstRiddleSolved, this.currentStage];
                    this.setFirstRiddleSolvedLocal(newFirstRiddleSolved);
                    this.showSecondRiddle(this.currentStage);
                    document.getElementById('inputSection').style.display = 'none';
                } else {
                    // Single riddle stage - mark as completely solved
                    await this.markStageSolvedAndAdvance(this.currentStage);
                }
            } else {
                // Show error
                document.getElementById('errorMessage').style.display = 'block';
                try {
                    const attempts = incrementWrongAttempts();
                    if (attempts === 2) {
                        if (typeof showHintPopup === 'function') {
                            showHintPopup();
                        } else {
                            console.warn('[HINT] showHintPopup not defined yet');
                        }
                    }
                } catch (e) {
                    console.warn('[HINT] Failed to increment wrong attempts', e);
                }
            }
        } catch (error) {
            console.error('Validation error:', error);
            document.getElementById('errorMessage').style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        }
    }

    // Handle second riddle submission
    async handleSecondRiddleSubmit() {
        const answer = document.getElementById('secondRiddleInput').value.trim();
        if (!answer) return;
        
        const submitBtn = document.getElementById('secondRiddleSubmit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Checking...';
        
        try {
            const result = await this.validateAnswer(this.currentStage, 2, answer);
            
            if (result.correct) {
                // Clear input and hide error
                document.getElementById('secondRiddleInput').value = '';
                document.getElementById('secondRiddleError').style.display = 'none';
                // Reset wrong-attempt counter on success
                try { resetWrongAttempts(); } catch (e) { /* noop if not available */ }
                
                // Mark stage as completely solved
                await this.markStageSolvedAndAdvance(this.currentStage);
            } else {
                // Show error
                document.getElementById('secondRiddleError').style.display = 'block';
                try {
                    const attempts = incrementWrongAttempts();
                    if (attempts === 2) {
                        if (typeof showHintPopup === 'function') {
                            showHintPopup();
                        } else {
                            console.warn('[HINT] showHintPopup not defined yet');
                        }
                    }
                } catch (e) {
                    console.warn('[HINT] Failed to increment wrong attempts', e);
                }
            }
        } catch (error) {
            console.error('Second riddle validation error:', error);
            document.getElementById('secondRiddleError').style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        }
    }

    // Handle sign out
        async handleSignOut() {
            console.log('[SIGNOUT] handleSignOut called');

            try {
                const { data: { user: beforeUser }, error: beforeErr } = await supabase.auth.getUser();
                console.log('[SIGNOUT] User BEFORE signOut:', { userId: beforeUser?.id || null, error: beforeErr || null });
            } catch (err) {
                console.error('[SIGNOUT] Error calling getUser() BEFORE signOut:', err);
            }

            let signOutError = null;
            try {
                const { error } = await supabase.auth.signOut();
                signOutError = error || null;
                console.log('[SIGNOUT] supabase.auth.signOut() result:', signOutError || 'ok');
            } catch (err) {
                signOutError = err;
                console.error('[SIGNOUT] Exception during supabase.auth.signOut():', err);
            }

            try { localStorage.removeItem('supabase.auth.token'); } catch {}
            try { localStorage.removeItem('game_state'); } catch {}
            try { sessionStorage.clear(); } catch {}

            try {
                const { data: { user: afterUser }, error: afterErr } = await supabase.auth.getUser();
                console.log('[SIGNOUT] User AFTER signOut:', { userId: afterUser?.id || null, error: afterErr || null });
            } catch (err) {
                console.error('[SIGNOUT] Error calling getUser() AFTER signOut:', err);
            }

            try {
                console.log('[SIGNOUT] Forcing UI into logged-out state');
                showLanding();
            } catch (err) {
                console.error('[SIGNOUT] Error showing landing screen:', err);
            }

            if (signOutError) {
                console.warn('[SIGNOUT] Sign-out reported an error. Forcing hard reload as fallback.');
                setTimeout(() => {
                    const cleanUrl = window.location.origin + window.location.pathname;
                    window.location.href = cleanUrl;
                }, 250);
            }
        }
}
// --- Robust Supabase sign-out helpers ---
function getSupabaseProjectRef() {
  try {
    return new URL(window.SUPABASE_URL || SUPABASE_URL).hostname.split(".")[0];
  } catch {
    try { return window.supabase?.supabaseUrl?.split("//")[1]?.split(".")[0] || null; } catch { return null; }
  }
}

function purgeSupabaseAuthLocal() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("-auth-token")) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    console.log("[AUTH] Purged local Supabase auth keys:", keysToRemove);
  } catch (e) {
    console.warn("[AUTH] Failed to purge Supabase local auth:", e);
  }
}

function purgeAppLocalState() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("confettiFired:") || k.startsWith("stepSolved:") || k === "solvedStages" || k === "app_progress" || k === "authUser")) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    console.log("[AUTH] Purged app local state:", keys);
  } catch (e) {
    console.warn("[AUTH] Failed to purge app state:", e);
  }
}

// --- Wrong-attempt tracking ---
function resetWrongAttempts() {
    localStorage.setItem('wrongAttempts', '0');
}

function incrementWrongAttempts() {
    let n = parseInt(localStorage.getItem('wrongAttempts') || '0', 10);
    n++;
    localStorage.setItem('wrongAttempts', n.toString());
    return n;
}

let __signingOut = false;
// --- Minimal hard sign-out (fixed) ---
async function hardGameSignOut() {
  console.log("[SIGNOUT] initiated");
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("[SIGNOUT] supabase signOut warning:", e);
  }

  clearSupabaseAuthStorage();

  // Set flag to show Sign In tab when modal opens
  try {
    localStorage.setItem(AUTH_MODAL_DEFAULT_TAB_KEY, "signin");
  } catch (e) {}

  // Force a clean landing state (not history back)
  location.replace("/index.html");
}

// Compute next unsolved stage helper
function computeNextUnsolvedStage(solvedArray, totalStages = 16) {
    const solved = new Set(Array.isArray(solvedArray) ? solvedArray : []);
    for (let i = 1; i <= totalStages; i++) {
        if (!solved.has(i)) return i;
    }
    return totalStages; // fallback
}

// Global toast timeout tracker
let __globalToastTimeout = null;

function showToast(message, options = {}) {
    // Support both old signature (message, type, durationMs) and new options object
    let { type = 'success', durationMs = 3500, sticky = false } = 
        typeof options === 'string' ? { type: options } : options;
    
    const toast = document.getElementById('global-toast');
    const msgEl = document.getElementById('global-toast-message');
    if (!toast || !msgEl) {
        console.warn('[TOAST] Toast elements not found');
        return;
    }

    toast.classList.remove('hidden', 'error');
    if (type === 'error') {
        toast.classList.add('error');
    }

    msgEl.textContent = message;

    // Clear any existing timeout
    if (__globalToastTimeout) {
        window.clearTimeout(__globalToastTimeout);
        __globalToastTimeout = null;
    }

    // Auto-hide after duration (unless sticky)
    if (!sticky) {
        __globalToastTimeout = window.setTimeout(() => {
            toast.classList.add('hidden');
            __globalToastTimeout = null;
        }, durationMs);
    }
}

function hideGlobalToast() {
    const toast = document.getElementById('global-toast');
    if (!toast) return;
    
    // Clear any pending timeout
    if (__globalToastTimeout) {
        window.clearTimeout(__globalToastTimeout);
        __globalToastTimeout = null;
    }
    
    // Hide the toast
    toast.classList.add('hidden');
}

// Anchored toast: attempts to place toast above the answer input; falls back to bottom-center
function showAnchoredToast(message = "Welcome back!", {
    delay = 1000,
    duration = 3000,
    anchorSelectors = [
        '[data-role="answer-input"]',
        '#answerInput',
        'input[name="answer"]',
        'textarea[name="answer"]',
        '.answer-input'
    ],
    offsetPx = 56
} = {}) {
    try {
        // remove any prior toast
        const existing = document.getElementById("__ar_toast");
        if (existing) existing.remove();

        // find anchor
        let anchor = null;
        for (const sel of anchorSelectors) {
            const el = document.querySelector(sel);
            if (el) { anchor = el; break; }
        }

        // build element
        const toast = document.createElement("div");
        toast.id = "__ar_toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        toast.textContent = message;

        // base style (bigger + readable)
        Object.assign(toast.style, {
            position: "fixed",
            background: "rgba(0,0,0,0.85)",
            color: "#fff",
            padding: "12px 18px",
            borderRadius: "12px",
            fontSize: "16px",
            fontWeight: "600",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: "2147483647",
            pointerEvents: "none",
            opacity: "0",
            transform: "translateY(12px)",
            transition: "opacity 0.25s ease, transform 0.25s ease",
            maxWidth: "90vw",
            textAlign: "center",
            whiteSpace: "nowrap"
        });

        // positioner
        const place = () => {
            if (anchor) {
                const r = anchor.getBoundingClientRect();
                const top = Math.max(12, r.top - offsetPx);
                const left = Math.round(r.left + (r.width / 2));
                toast.style.top = `${top}px`;
                toast.style.left = `${left}px`;
                toast.style.transform = "translate(-50%, 12px)";
            } else {
                // fallback: bottom-center
                toast.style.bottom = "24px";
                toast.style.left = "50%";
                toast.style.transform = "translate(-50%, 12px)";
            }
        };

        const onScrollOrResize = () => place();

        setTimeout(() => {
            document.body.appendChild(toast);
            place();
            // animate in
            requestAnimationFrame(() => {
                toast.style.opacity = "1";
                // remove translateY
                toast.style.transform = "translate(-50%, 0)";
            });

            // keep it in place if viewport changes
            window.addEventListener("scroll", onScrollOrResize, { passive: true });
            window.addEventListener("resize", onScrollOrResize);

            // schedule hide + cleanup
            setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.transform = "translate(-50%, 12px)";
                setTimeout(() => {
                    window.removeEventListener("scroll", onScrollOrResize);
                    window.removeEventListener("resize", onScrollOrResize);
                    toast.remove();
                }, 300);
            }, duration);
        }, delay);
    } catch (e) {
        console.warn("[TOAST] Failed:", e);
    }
}

// Hint popup helpers
function showHintPopup() {
    const el = document.getElementById('hint-popup');
    if (!el) return;
    el.classList.remove('hint-hidden');
}

function hideHintPopup() {
    const el = document.getElementById('hint-popup');
    if (!el) return;
    el.classList.add('hint-hidden');
}

function openCurrentStageYouTube() {
    // Try to find the currently visible YouTube iframe for the active stage
    const iframe = document.querySelector('.stage-card.active iframe, .stage iframe, .video-container iframe, iframe');

    if (iframe && iframe.src) {
        try {
            const url = new URL(iframe.src);
            let watchUrl = iframe.src;

            // If it's a YouTube embed URL, convert to a normal watch URL
            if (url.hostname.includes('youtube.com') && url.pathname.startsWith('/embed/')) {
                const videoId = url.pathname.split('/embed/')[1].split('/')[0];
                watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
            }

            window.open(watchUrl, '_blank', 'noopener');
            return;
        } catch (e) {
            console.error('Failed to parse iframe URL for YouTube:', e);
        }
    }

    // Fallback: channel homepage
    window.open('https://www.youtube.com/@TheAccidentalRetiree', '_blank', 'noopener');
}

// Stage status banner helper
async function updateStageStatusBanner(currentStage) {
    const banner = document.getElementById('stage-status-banner');
    const textEl = document.getElementById('stageStatusText');

    if (!banner || !textEl) return;

    // If no Supabase client yet, bail
    if (!supabase) {
        banner.classList.add('hidden');
        return;
    }

    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;

    if (error || !user) {
        // Not logged in -> hide banner
        banner.classList.add('hidden');
        return;
    }

    const displayName = user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.user_metadata?.username
        || user.email;

    // Determine if this is a new or returning player
    const solvedStages = (window.contestApp?.solvedStages || []);
    const solvedCount = solvedStages.length;
    const isNewPlayer = solvedCount === 0 && currentStage === 1;

    if (isNewPlayer) {
        textEl.textContent = `Welcome to the game — you're on Stage ${currentStage} of 16`;
    } else {
        textEl.textContent = `Welcome back, ${displayName} — you're on Stage ${currentStage} of 16`;
    }
    
    banner.classList.remove('hidden');
    
    // Update Stage 1 helper bar visibility with animation
    const helperBar = document.getElementById('stage1HelperBar');
    if (helperBar) {
        if (isNewPlayer) {
            helperBar.classList.remove('stage-helper-hidden');
            // Trigger animation after brief delay
            setTimeout(() => {
                helperBar.classList.add('stage-helper-visible');
            }, 50);
        } else {
            helperBar.classList.remove('stage-helper-visible');
            helperBar.classList.add('stage-helper-hidden');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('hint-close-btn'); // if still present, optional
    const yesBtn = document.getElementById('hint-yes-btn');
    const noBtn = document.getElementById('hint-no-btn');

    if (closeBtn) {
        closeBtn.addEventListener('click', hideHintPopup);
    }
    if (noBtn) {
        noBtn.addEventListener('click', hideHintPopup);
    }
    if (yesBtn) {
        yesBtn.addEventListener('click', () => {
            openCurrentStageYouTube();
            hideHintPopup();
        });
    }
});

// CRITICAL: Global initialization guards to prevent circular dependencies
window.__appInitialized = false;
window.__gameShown = false;
// Auto-start guard to avoid multiple auth events triggering the UI start
let hasAutoStartedGame = false;
window.hasAutoStartedGame = false;

// FIXED: Supabase Configuration - Use window object for browser environment
const SUPABASE_URL = window.SUPABASE_URL || 'https://vlcjilzgntxweomnyfgd.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsY2ppbHpnbnR4d2VvbW55ZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTM0MzUsImV4cCI6MjA3NzQ4OTQzNX0.MeIJpGfdAGqQwx9t0_Tdog9W-Z1cWX3z4cUffeoQW-c';

/**
 * ADMIN CHECK AUDIT:
 * ==================
 * Current Implementation in script.js (INDEX.HTML ONLY)
 * 
 * Function: AdminManager.isAdmin() (line ~1823)
 * Check Method: Simple email string comparison
 * Database Query: NONE - uses hardcoded email constant
 * Expected Value: Email string must exactly match ADMIN_EMAIL constant
 * Storage: Stored as const ADMIN_EMAIL
 * 
 * Current Flow:
 * 1. User clicks "Play Game" button (line 3340-3350)
 * 2. Check: supabaseAuth.user.email === ADMIN_EMAIL
 * 3. If true: calls showAdmin() → displays adminContainer
 * 4. If false: calls startContestForSignedInUser() → shows game
 * 
 * ISSUES WITH CURRENT IMPLEMENTATION:
 * - No database lookup (hardcoded email only)
 * - Cannot add/remove admins without code changes
 * - Not using public.admin_emails table
 * - Will conflict with new /admin.html approach which queries public.admin_emails
 * 
 * NOTE: /admin.html (NEW) uses checkAdminAccess() which queries public.admin_emails table
 * This is a DUPLICATE admin system that should be consolidated.
 */

// Admin email for role detection
const ADMIN_EMAIL = 'hola@theaccidentalretiree.mx';

// Stage-specific second riddle clues
const SECOND_RIDDLE_CLUES = {
    5: "We slept where Ra's first light awoke, In walls that held the desert's smoke. Seek not the tombs of kings long gone, But the humble door our fate shone on— Three numbers guard the path once more, The code that wakes the chamber door.",
    6: "From city skies to seaside song, Where golden butter makes you strong. The name is whispered, soft and gone, A coastal town where flavors dawn.",
    7: "A whisper called before we flew, A brand appeared, then left our view. The clue was fleeting, yet it's true— One word, four numbers—seen and heard by few.",
    8: "A sign of steel, a steady hand, The numbers bold, the prices stand. For blade and shear, combine their wit— Old phrase says, 'two bits!'",
    9: "Between the floors we rose in steel, A glowing screen revealed the deal. Not where we slept, nor where we flew, but a city that flashed and vanished from view. Catch the name in that blink-short quirk, the word you seek is one place: no space.",
    10: "This clue isn’t spoken, it shines in the night. Two words are written next to neon so bright. No need to listen, just read what you see — What’s the first word staring back at thee?",
    11: `A quiet moment, poured just right.
Careful — it’s not what keeps you up all night.
One plus one is two, we all agree,
But one and two-thirds tells you what to see.`,
  12: "This is just a placeholder (you can just use that for now and I can update stage by stage). If you get stuck, go back to the video on YouTube and comment that you need help! Joel will give you a nudge.",
    13: "This is just a placeholder (you can just use that for now and I can update stage by stage). If you get stuck, go back to the video on YouTube and comment that you need help! Joel will give you a nudge.",
    14: "This is just a placeholder (you can just use that for now and I can update stage by stage). If you get stuck, go back to the video on YouTube and comment that you need help! Joel will give you a nudge.",
    15: "This is just a placeholder (you can just use that for now and I can update stage by stage). If you get stuck, go back to the video on YouTube and comment that you need help! Joel will give you a nudge."
};

// === SAFE SUPABASE SINGLETON (prevents redeclare crash) ===
// Initialize only if not already loaded (prevents crash if script.js loads twice)
if (typeof supabase === 'undefined') {
    var supabase = null;
}
let supabaseAuth = null;
let progressManager = null;
let leaderboardManager = null;
let authUI = null;
let stageControlManager = null;
let adminManager = null;

// Admin Manager for stage control functionality
class AdminManager {
    constructor() {
        this.stagesData = [];
        this.solveCounts = {};
        this.API_BASE = `${SUPABASE_URL}/functions/v1`;
    }

    // Check if current user is admin
    // FUNCTION: AdminManager.isAdmin()
    // MECHANISM: Direct string comparison (NO database lookup)
    // CONDITION: supabaseAuth.user.email === ADMIN_EMAIL (hardcoded const)
    // RESULT: Returns boolean true/false
    // STORAGE: Flag not stored; computed on each call
    isAdmin() {
        return supabaseAuth && supabaseAuth.user && supabaseAuth.user.email === ADMIN_EMAIL;
    }

    // Load stage data from API
    async loadStageData() {
        try {
            this.updateStatus('Loading stage data...', 'loading');
            
            const response = await fetch(`${this.API_BASE}/admin_stage_control`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.stagesData = data.stages || [];
                this.solveCounts = data.solve_counts || {};
                this.renderStages();
                this.updateStatus(`Data loaded successfully (${this.stagesData.length} stages)`, 'success');
                this.clearMessages();
            } else {
                throw new Error(data.error || 'Failed to load data');
            }
        } catch (error) {
            console.error('Failed to load stage data:', error);
            this.updateStatus('Failed to load data', 'error');
            this.showMessage(`Error loading data: ${error.message}`, 'error');
        }
    }

    // Render stages grid
    renderStages() {
        const container = document.getElementById('adminStagesContainer');
        
        if (!this.stagesData.length) {
            container.innerHTML = '<p class="admin-loading">No stage data available</p>';
            return;
        }

        const stagesHTML = this.stagesData.map(stage => {
            const solveCount = this.solveCounts[stage.stage] || 0;
            const isEnabled = stage.is_enabled;
            const lastUpdated = stage.updated_at ? new Date(stage.updated_at).toLocaleString() : 'Never';
            
            return `
                <div class="admin-stage-card ${isEnabled ? 'enabled' : 'disabled'}">
                    <div class="admin-stage-header">
                        <h3 class="admin-stage-title">Stage ${stage.stage}</h3>
                        <label class="stage-toggle">
                            <input type="checkbox" ${isEnabled ? 'checked' : ''} 
                                   onchange="adminManager.toggleStage(${stage.stage}, this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    
                    <div class="admin-stage-info">
                        <div class="admin-info-item">
                            <span class="admin-info-label">Status</span>
                            <span class="admin-info-value">${isEnabled ? '🟢 Live' : '🔴 Disabled'}</span>
                        </div>
                        <div class="admin-info-item">
                            <span class="admin-info-label">Solvers</span>
                            <span class="admin-info-value">${solveCount} users</span>
                        </div>
                        <div class="admin-info-item">
                            <span class="admin-info-label">Last Updated</span>
                            <span class="admin-info-value">${lastUpdated}</span>
                        </div>
                        <div class="admin-info-item">
                            <span class="admin-info-label">Updated By</span>
                            <span class="admin-info-value">${stage.updated_by || 'System'}</span>
                        </div>
                    </div>
                    
                    <div class="admin-stage-notes">
                        <textarea class="admin-notes-input" 
                                  placeholder="Add notes about this stage..."
                                  id="admin-notes-${stage.stage}">${stage.notes || ''}</textarea>
                        <button class="admin-update-btn" onclick="adminManager.updateStageNotes(${stage.stage})">
                            💾 Update Notes
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `<div class="admin-stages-grid">${stagesHTML}</div>`;
    }

    // Toggle individual stage
    async toggleStage(stageNumber, isEnabled) {
        try {
            this.updateStatus(`Updating Stage ${stageNumber}...`, 'loading');
            
            const response = await fetch(`${this.API_BASE}/admin_stage_control`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    stage: stageNumber,
                    is_enabled: isEnabled,
                    admin_user: 'admin_panel',
                    notes: `Stage ${isEnabled ? 'enabled' : 'disabled'} via admin panel`
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.showMessage(data.message, 'success');
                this.updateStatus('Update successful', 'success');
                
                // Refresh data after short delay
                setTimeout(() => this.loadStageData(), 1000);
                
                // Update stage control manager and refresh game UI
                if (stageControlManager) {
                    await stageControlManager.loadStageControl();
                }
            } else {
                throw new Error(data.error || 'Update failed');
            }
        } catch (error) {
            console.error('Failed to toggle stage:', error);
            this.showMessage(`Failed to update Stage ${stageNumber}: ${error.message}`, 'error');
            this.updateStatus('Update failed', 'error');
            
            // Revert toggle on error
            this.loadStageData();
        }
    }

    // Update stage notes
    async updateStageNotes(stageNumber) {
        const notesTextarea = document.getElementById(`admin-notes-${stageNumber}`);
        const notes = notesTextarea.value.trim();
        
        try {
            this.updateStatus(`Updating notes for Stage ${stageNumber}...`, 'loading');
            
            // Find current stage data
            const currentStage = this.stagesData.find(s => s.stage === stageNumber);
            if (!currentStage) {
                throw new Error('Stage not found');
            }
            
            const response = await fetch(`${this.API_BASE}/admin_stage_control`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    stage: stageNumber,
                    is_enabled: currentStage.is_enabled,
                    admin_user: 'admin_panel',
                    notes: notes || `Stage ${stageNumber} notes updated`
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.showMessage(`Notes updated for Stage ${stageNumber}`, 'success');
                this.updateStatus('Notes updated', 'success');
                
                // Refresh data after short delay
                setTimeout(() => this.loadStageData(), 1000);
            } else {
                throw new Error(data.error || 'Update failed');
            }
        } catch (error) {
            console.error('Failed to update notes:', error);
            this.showMessage(`Failed to update notes for Stage ${stageNumber}: ${error.message}`, 'error');
            this.updateStatus('Update failed', 'error');
        }
    }

    // Bulk operations
    async bulkOperation(action, stages = null) {
        try {
            this.updateStatus(`Performing bulk operation: ${action}...`, 'loading');
            
            const requestBody = {
                action: action,
                admin_user: 'admin_panel'
            };
            
            if (stages) {
                requestBody.stages = stages;
            }
            
            const response = await fetch(`${this.API_BASE}/admin_stage_control/bulk`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.showMessage(data.message, 'success');
                this.updateStatus('Bulk operation completed', 'success');
                
                // Refresh data after short delay
                setTimeout(() => this.loadStageData(), 1500);
                
                // Update stage control manager and refresh game UI
                if (stageControlManager) {
                    setTimeout(() => stageControlManager.loadStageControl(), 2000);
                }
            } else {
                throw new Error(data.error || 'Bulk operation failed');
            }
        } catch (error) {
            console.error('Bulk operation failed:', error);
            this.showMessage(`Bulk operation failed: ${error.message}`, 'error');
            this.updateStatus('Bulk operation failed', 'error');
        }
    }

    // UI Helper Functions
    updateStatus(message, type) {
        const indicator = document.getElementById('adminStatusIndicator');
        if (indicator) {
            indicator.textContent = message;
            indicator.className = `status-indicator status-${type}`;
        }
    }

    showMessage(message, type) {
        const container = document.getElementById('adminMessageContainer');
        if (container) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `admin-${type}`;
            messageDiv.textContent = message;
            
            container.appendChild(messageDiv);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 5000);
        }
    }

    clearMessages() {
        const container = document.getElementById('adminMessageContainer');
        if (container) {
            container.innerHTML = '';
        }
    }
}

// Global admin functions for button onclick handlers
function loadAdminStageData() {
    if (adminManager) {
        adminManager.loadStageData();
    }
}

function adminBulkOperation(action, stages = null) {
    if (adminManager) {
        adminManager.bulkOperation(action, stages);
    }
}

// --- Password reset modal helpers ---
function showPasswordResetModal(onSubmit) {
    const modal = document.getElementById('password-reset-modal');
    const form = document.getElementById('password-reset-form');
    const input = document.getElementById('password-reset-input');
    const toggle = document.getElementById('password-reset-toggle');
    const cancelBtn = document.getElementById('password-reset-cancel');
    const submitBtn = document.getElementById('password-reset-submit');
    const errorEl = document.getElementById('password-reset-error');
    const successEl = document.getElementById('password-reset-success');

    if (!modal || !form || !input) {
        console.error('[RESET] Modal elements missing');
        return;
    }

    console.log('[RESET] Opening password reset modal');
    modal.classList.remove('hidden');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');
    errorEl.textContent = '';
    successEl.textContent = '';
    input.value = '';
    input.focus();

    toggle.onclick = () => {
        input.type = input.type === 'password' ? 'text' : 'password';
    };

    cancelBtn.onclick = () => {
        console.log('[RESET] User cancelled password reset');
        modal.classList.add('hidden');
        if (window.location.hash.includes('type=recovery')) {
            window.location.hash = '';
        }
    };

    form.onsubmit = async (evt) => {
        evt.preventDefault();
        const newPassword = input.value.trim();

        errorEl.classList.add('hidden');
        successEl.classList.add('hidden');
        errorEl.textContent = '';
        successEl.textContent = '';

        if (!newPassword || newPassword.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters.';
            errorEl.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            console.log('[RESET] Submitting new password to Supabase...');
            const { data, error } = await supabase.auth.updateUser({ password: newPassword });

            if (error) {
                console.error('[RESET] Error updating password:', error);
                errorEl.textContent = error.message || 'Something went wrong. Please try again.';
                errorEl.classList.remove('hidden');
                return;
            }

            console.log('[RESET] Password updated successfully:', data);
            successEl.textContent = 'Password updated. Redirecting you back to the game...';
            successEl.classList.remove('hidden');

            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);

            setTimeout(() => {
                modal.classList.add('hidden');
                window.location.reload();
            }, 1000);
        } catch (err) {
            console.error('[RESET] Unexpected error updating password:', err);
            errorEl.textContent = 'Unexpected error. Please try again.';
            errorEl.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save & Continue';
        }
    };
}

async function handlePasswordResetFromAuthState(session) {
    try {
        const hash = window.location.hash || '';
        if (!hash.startsWith('#')) return;

        const params = new URLSearchParams(hash.substring(1));
        const type = params.get('type');

        if (type !== 'recovery') {
            return;
        }

        console.log('[RESET] Supabase PASSWORD_RECOVERY link detected:', hash);
        showPasswordResetModal();
    } catch (error) {
        console.error('[RESET] Failed to handle password recovery URL:', error);
    }
}

function initializeSupabase() {
    // Defensive checks
    if (!window.supabase) {
        console.error("[SUPABASE] Supabase library not loaded");
        return null;
    }

    if (!SUPABASE_URL) {
        console.error("[SUPABASE] SUPABASE_URL is not defined");
        return null;
    }

    if (!SUPABASE_ANON_KEY) {
        console.error("[SUPABASE] SUPABASE_ANON_KEY is not defined");
        return null;
    }

    if (window.supabase) {
        console.log('[SUPABASE] Initializing with URL:', SUPABASE_URL);
        console.log('[SUPABASE] Using key ending in:', SUPABASE_ANON_KEY.slice(-10));
        
        // Use idempotent singleton to prevent redeclaration crash if script loads twice
        window.__supabaseClient = window.__supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabase = window.__supabaseClient;

        // --- Make legacy globals available (script.js is now a module) ---
        window.supabase = supabase;
        window.supabaseClient = supabase;
        window.supabaseAuth = supabase.auth;

        // --- Marketing tracker ---
        window.marketing = createMarketingTracker(supabase);
        window.marketing.logLpViewOnce();

        // Track CTA click(s) on landing page
        (function wireCtaTracking() {
          const selectors = [
            "#playGameBtn",
            "#play-game",
            "#cta",
            ".cta",
            'a[href*="signup"]',
            'button[data-cta="play"]',
            'button[data-cta="signup"]'
          ];

          const ctaEl = selectors
            .map((s) => document.querySelector(s))
            .find(Boolean);

          if (!ctaEl) {
            // Don't fail the app if we can't find it
            console.warn("[marketing] CTA element not found (add an id like #playGameBtn to your button)");
            return;
          }

          ctaEl.addEventListener("click", () => {
            window.marketing?.log("cta_click", {
              selector: ctaEl.id ? `#${ctaEl.id}` : (ctaEl.className ? `.${ctaEl.className}` : "unknown"),
              text: (ctaEl.innerText || "").trim().slice(0, 80),
            });
          });
        })();

        // Initialize auth system
        supabaseAuth = {
            user: null,
            isAuthenticated: () => !!supabaseAuth.user,

            async signInWithEmail(email, password) {
                console.log('[AUTH] signIn starting for:', email);
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    console.error('[AUTH] signIn API error:', error.message);
                    throw error;
                }
                console.log('[AUTH] signIn API call success, user:', data.user?.email);
                // Record login via RPC (best-effort, do not block login flow)
                try {
                    const user = data.user || data.session?.user;
                    if (user && user.id && typeof supabase.rpc === 'function') {
                        await supabase.rpc('record_login', { p_user_id: user.id });
                    }
                } catch (err) {
                    console.error('record_login failed', err);
                }

                return data;
            },

            async signUpWithEmail(email, password, metadata = {}) {
                console.log('[AUTH] Attempting sign up for:', email);
                
                try {
                    window.marketing?.log("signup_started", {
                      method: "email",
                    });

                    const { data, error } = await supabase.auth.signUp({
                        email,
                        password,
                        options: { 
                            data: metadata,
                            emailRedirectTo: window.location.origin
                        }
                    });
                    
                    if (error) {
                        console.error('[AUTH] Sign up error:', error);
                        throw error;
                    }

                    window.marketing?.log("signup_success", {
                      user_id: data?.user?.id || null,
                    });
                    
                    console.log('[AUTH] Sign up response:', data);
                    
                    // Check if user needs email confirmation
                    if (data.user && !data.session) {
                        console.log('[AUTH] User created but needs email confirmation');
                        return {
                            ...data,
                            needsConfirmation: true
                        };
                    }
                    
                    console.log('[AUTH] Sign up successful:', data.user?.email);
                    return data;
                } catch (error) {
                    console.error('[AUTH] Sign up exception:', error);
                    throw error;
                }
            },

            async resetPassword(email) {
                const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin
                });
                if (error) throw error;
                return data;
            },

            // New: explicit handler that hard-codes the reset redirect to the live site
            async handlePasswordResetRequest(email) {
                const redirectTo = 'https://theaccidentalretiree.app/reset.html';
                console.log('[PasswordReset] Sending reset email for:', email, 'redirectTo:', redirectTo);
                try {
                    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo,
                    });
                    if (error) {
                        console.error('[PasswordReset] Error sending reset email:', error);
                        showToast(error.message || 'Something went wrong sending the reset email.', 'error');
                        throw error;
                    }
                    console.log('[PasswordReset] Reset email sent');
                    // Old: alert('If an account exists for that email, a password reset link has been sent.');
                    showToast('We\'ve emailed you a secure link to reset your password. Check your inbox (and spam folder).', 'success');
                    return data;
                } catch (err) {
                    console.error('[PasswordReset] Exception while sending reset email:', err);
                    showToast(err?.message || 'Failed to send password reset email. Please contact support.', 'error');
                    throw err;
                }
            },

            async signOut() {
                console.log('[AUTH] Sign out initiated...');
                try {
                    const { error } = await supabase.auth.signOut();
                    if (error) {
                        console.error('[AUTH] Sign out error:', error);
                        throw error;
                    }
                    console.log('[AUTH] Sign out successful');
                    
                    // Clear user state immediately
                    supabaseAuth.user = null;
                    
                    // Clear local storage
                    localStorage.removeItem("contest_solved_stages");
                    localStorage.removeItem("contest_first_riddle_solved");
                    
                    // Navigation to landing is centralized in signOutHard();
                    // Avoid calling showLanding() here to prevent duplicate navigation/logs.
                    // showLanding();
                    
                    return true;
                } catch (error) {
                    console.error('[AUTH] Sign out failed:', error);
                    // Even if sign out fails, clear local state
                    supabaseAuth.user = null;
                    // showLanding(); // handled by signOutHard()
                    throw error;
                }
            }
        };

        // GOOGLE OAUTH WIRING START

        function getOAuthRedirectTo() {
          return `${window.location.origin}/`;
        }

        async function startGoogleOAuth() {
          try {
            if (!window.supabaseClient) {
              console.error('[AUTH] supabaseClient missing');
              return;
            }

            const auth = window.supabaseClient.auth;
            const redirectTo = getOAuthRedirectTo();

            console.log('[AUTH] Starting Google OAuth', {
              redirectTo,
              methods: {
                signInWithOAuth: typeof auth.signInWithOAuth,
                signIn: typeof auth.signIn,
              },
            });

            let result;

            if (typeof auth.signInWithOAuth === 'function') {
              // Supabase v2
              result = await auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo },
              });
            } else if (typeof auth.signIn === 'function') {
              // Supabase v1
              result = await auth.signIn(
                { provider: 'google' },
                { redirectTo }
              );
            } else {
              console.error('[AUTH] Unknown Supabase Auth version');
              return;
            }

            if (result?.error) {
              console.error('[AUTH] Google OAuth failed', result.error);
              alert(result.error.message || 'Google OAuth failed');
            }
          } catch (err) {
            console.error('[AUTH] Google OAuth exception', err);
            alert(err.message || err);
          }
        }

        // GOOGLE OAUTH DELEGATION START
        function wireGoogleOAuthDelegation() {
          if (window.__googleOAuthDelegationWired) return;
          window.__googleOAuthDelegationWired = true;

          document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-oauth="google"]');
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            console.log('[AUTH] Google button clicked (delegated)');
            startGoogleOAuth();
          });

          console.log('[AUTH] Google OAuth delegation wired');
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', wireGoogleOAuthDelegation);
        } else {
          wireGoogleOAuthDelegation();
        }
        // GOOGLE OAUTH DELEGATION END

        // CRITICAL FIX: Auth state listener (replaced with modal-driven recovery flow)
        supabase.auth.onAuthStateChange((event, session) => {
  console.log('[AUTH] State changed:', event, session?.user?.email || null);

  // Handle SIGNED_IN event: immediately clear timeout and mark resolved
  if (event === 'SIGNED_IN') {
    clearSignInTimeout('auth_state_signed_in');
    signInResolved = true;
    loadMyProfileAndHydrateUI();
    promptProfileCompletionIfNeeded();
  }

  // Special case: password recovery flow
  if (event === 'PASSWORD_RECOVERY') {
    console.log('[AUTH] PASSWORD_RECOVERY detected; showing password reset modal');
    // Do NOT call onUserSignedIn here; user must set a new password first
    showPasswordResetModal();
    return;
  }

  // Normal signed-in / initial session flow
  if (session?.user) {
    console.log('[AUTH] Regular user detected, delegating to startContestForSignedInUser');
    supabaseAuth.user = session.user;
    startContestForSignedInUser();
    return;
  }

  // Signed out / no session
  console.log('[AUTH] No active user; showing landing screen');
  showLanding();
});

        // Progress manager
        progressManager = {
            async syncWithSupabase() {
                if (!supabaseAuth.isAuthenticated()) {
                    console.log('[progressManager] User not authenticated, using local storage only');
                    return null;
                }

                try {
                    console.log('[progressManager] Syncing progress from cloud...');

                    const { data: solves, error } = await supabase
                        .from('solves')
                        .select('stage')
                        .eq('user_id', supabaseAuth.user.id)
                        .order('stage', { ascending: true });

                    if (error) {
                        console.warn('[progressManager] Failed to sync from cloud:', error);
                        return null;
                    }

                    if (solves && solves.length > 0) {
                        const cloudStages = solves.map(solve => solve.stage);
                        console.log('[progressManager] Found cloud progress:', cloudStages);

                        const localStages = window.contestApp ? window.contestApp.getSolvedStagesFromLocal() : [];
                        const mergedStages = [...new Set([...cloudStages, ...localStages])].sort((a, b) => a - b);

                        if (window.contestApp) {
                            console.log('[progressManager] Updating contest app with merged progress:', mergedStages);
                            window.contestApp.setSolvedStagesLocal(mergedStages);
                            
                            window.contestApp.renderStagesGrid();
                            window.contestApp.updateProgress();
                            window.contestApp.renderCurrentStage();
                            
                            console.log('[progressManager] UI updated with synced progress');
                        }

                        console.log('[progressManager] Progress synced successfully:', mergedStages);
                        return mergedStages;
                    } else {
                        console.log('[progressManager] No cloud progress found, using local storage');
                        return null;
                    }

                } catch (error) {
                    console.warn('[progressManager] Cloud sync failed:', error);
                    return null;
                }
            },

            async logStageCompletion(stage, answer, additionalData = {}) {
                console.log('[progressManager] Local logging only:', { stage, answer });
            }
        };

                // Leaderboard manager
                                                                leaderboardManager = {
                                                                                                                                                                                                async logSolve(stage) {
    console.groupCollapsed('[logSolve] Starting solve log');
    console.log('[logSolve] Stage:', stage);

    try {
        // Fetch authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        console.log('[logSolve] getUser() result:', { user, userError });

        if (userError || !user) {
            console.error('[logSolve] No authenticated user or error:', userError);
            return { success: false, reason: 'no_user', isStageWinner: false };
        }

        // Check if this stage already has a winner
        const { data: existingWinners, error: checkError } = await supabase
            .from('stage_winners')
            .select('user_id')
            .eq('stage', Number(stage))
            .limit(1);

        const hasExistingWinner = existingWinners && existingWinners.length > 0;
        console.log('[logSolve] Stage winner check:', { stage, hasExistingWinner });

        // Construct payload matching the solves table schema
        const now = new Date().toISOString();
        const payload = {
            stage: Number(stage),
            user_id: user.id,
            username: user.email,
            email: user.email,
            solved_at: now,
            won_at: now,
            step: 1
        };

        console.log('[logSolve] Inserting payload:', payload);

        const { data, error } = await supabase
            .from('solves')
            .insert(payload)
            .select();

        if (error) {
            console.error('[logSolve] Supabase insert FAILED:', error);
            return { success: false, reason: 'supabase_error', error, isStageWinner: false };
        }

        console.log('[logSolve] Successfully saved:', data);
        
        // Return winner status (true if this user is the first winner)
        const isStageWinner = !hasExistingWinner;
        return { success: true, reason: 'saved', isStageWinner };

    } catch (err) {
        console.error('[logSolve] Unexpected exception:', err);
        return { success: false, reason: 'exception', error: err, isStageWinner: false };
    } finally {
        console.groupEnd();
    }
}
};

// Reusable post-login handler: centralizes what to do when a user is signed in
async function onUserSignedIn(user) {
    try {
        // --- LP variant redirect: if user signs in on landing page, go to index.html ---
        if (IS_LP_VARIANT) {
            console.log("[LP] Auth success on LP variant — redirecting to index.html");
            window.location.href = "./index.html";
            return;
        }

        console.log('[AUTH] onUserSignedIn for', user?.email || user?.id || '<unknown>');

        // Ensure global auth user is set
        if (supabaseAuth) supabaseAuth.user = user;

        // Load and apply user profile to UI
        try {
            console.log('[AUTH] Loading user profile...');
            const profile = await loadUserProfile();
            if (profile) {
                applyProfileToUI(profile);
            }
        } catch (err) {
            console.warn('[AUTH] Failed to load profile (non-fatal):', err);
        }

        // Sync progress from Supabase if available
        if (progressManager) {
            try {
                console.log('[AUTH] Syncing progress for signed-in user...');
                await progressManager.syncWithSupabase();
            } catch (err) {
                console.warn('[AUTH] progressManager.syncWithSupabase failed (non-fatal):', err);
            }
        }

                // --- Force-sync local progress to cloud if needed ---
                try {
                    const local = JSON.parse(localStorage.getItem('progress')) || [];
                    const cloud = window.contestApp?.currentProgress || [];

                    console.log('[SYNC] Local progress:', local);
                    console.log('[SYNC] Cloud progress:', cloud);

                    // Find stages solved locally that the cloud does NOT have
                    const missing = local.filter(stage => !cloud.includes(stage));

                    if (missing.length > 0) {
                        console.log('[SYNC] Found missing progress to sync:', missing);

                        if (!window.leaderboardManager || typeof leaderboardManager.logSolve !== 'function') {
                            console.warn('[SYNC] leaderboardManager.logSolve not available; skipping forced sync.');
                        } else {
                            for (const stage of missing) {
                                console.log(`[SYNC] Pushing stage ${stage} to Supabase...`);
                                await leaderboardManager.logSolve(stage);
                            }

                            console.log('[SYNC] Sync complete. Refreshing cloud state...');
                            await progressManager.syncWithSupabase();
                        }
                    } else {
                        console.log('[SYNC] No missing progress. Cloud is already up to date.');
                    }
                } catch (err) {
                    console.error('[SYNC] Error during forced progress sync:', err);
                }

        // Start the contest UI AFTER progress sync
        try {
            if (!hasAutoStartedGame) {
                hasAutoStartedGame = true;
                window.hasAutoStartedGame = true;
                console.log('[UI] Auto-starting contest for signed-in user...');
                if (typeof startContestForSignedInUser === 'function') {
                    startContestForSignedInUser();
                } else {
                    console.warn('[AUTH] startContestForSignedInUser not available; falling back to showGame only');
                    if (typeof showGame === 'function') {
                        showGame();
                    }
                }
            } else {
                console.log('[UI] Auto-start already performed; skipping UI start.');
            }
        } catch (e) {
            console.warn('[UI] Auto-start failed (non-fatal):', e);
        }

        // Refresh leaderboard on sign-in
        try {
            console.log('[LEADERBOARD] Refresh on sign-in');
            if (typeof renderLeaderboard === 'function') {
                renderLeaderboard();
            }
            if (typeof queueLeaderboardRefresh === 'function') {
                queueLeaderboardRefresh('signed_in');
            }
        } catch (e) {
            console.warn('[LEADERBOARD] Refresh on sign-in failed (non-fatal):', e);
        }

        // Welcome toast (anchored) and helper bar visibility
        try {
            // Determine if this is a new or returning player
            const solvedCount = (window.contestApp?.solvedStages || []).length;
            const currentStage = window.contestApp?.currentStage || 1;
            const isNewPlayer = solvedCount === 0 && currentStage === 1;
            
            // Update Stage 1 helper bar visibility with animation
            const helperBar = document.getElementById('stage1HelperBar');
            if (helperBar) {
                if (isNewPlayer) {
                    // New player on Stage 1 - show helper bar with fade/slide animation
                    helperBar.classList.remove('stage-helper-hidden');
                    // Trigger animation after a short delay for smooth entrance
                    setTimeout(() => {
                        helperBar.classList.add('stage-helper-visible');
                    }, 50);
                } else {
                    // Not a new player or Stage 1 already solved - hide helper bar
                    helperBar.classList.remove('stage-helper-visible');
                    helperBar.classList.add('stage-helper-hidden');
                }
            }
            
            if (!isNewPlayer) {
                // Returning player - show welcome back message
                showAnchoredToast('👋 Welcome back, continuing your journey...', { delay: 1000, duration: 3000, offsetPx: 64 });
            }
        } catch (err) { /* noop */ }

        // Initialize My Profile UI
        try {
            initProfileUI();
        } catch (err) {
            console.warn('[PROFILE] Failed to initialize UI:', err);
        }

        // Wire header auth UI (buttons and email display)
        try {
            wireHeaderAuthUI(user);
        } catch (err) {
            console.warn('[HEADER] Failed to wire header auth UI:', err);
        }

        // Queue leaderboard refresh if available
        try { typeof queueLeaderboardRefresh === 'function' && queueLeaderboardRefresh('signed_in'); } catch (e) { /* noop */ }

        // Post-login success marker with diagnostics
        console.log('[AUTH] post-login init complete | email=' + user.email + ' | stage_env=' + (window.STAGE_ENV || 'undefined'));

    } catch (err) {
        console.error('[AUTH] onUserSignedIn error:', err);
    }
}

// --- Local fallback helper ---
function localLogSolveFallback(payload) {
    try {
        console.warn('[logSolve] Local logging only (fallback). Payload:', payload);
        const key = 'local_solves';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(payload);
        localStorage.setItem(key, JSON.stringify(existing));
    } catch (err) {
        console.error('[logSolve] Failed to write local fallback:', err);
    }
}

        // Stage Control Manager - Admin stage control integration
        stageControlManager = {
            stageControlData: {},
            
            async loadStageControl() {
                try {
                    console.log('[STAGE_CONTROL] Loading stage control data...');
                    
                    // Use window.STAGE_ENV set by index.html (set before script.js loads)
                    const STAGE_ENV = window.STAGE_ENV || 'dev';
                    console.log('[STAGE_CONTROL] Using STAGE_ENV =', STAGE_ENV);
                    
                    const { data, error } = await supabase
                        .from('stage_control')
                        .select('stage, is_enabled')
                        .eq('environment', STAGE_ENV)
                        .order('stage', { ascending: true });

                    if (error) {
                        console.warn('[STAGE_CONTROL] Failed to load stage control:', error);
                        // Default to all stages enabled if we can't load control data
                        this.stageControlData = {};
                        for (let i = 1; i <= 16; i++) {
                            this.stageControlData[i] = { is_enabled: true };
                        }
                        return;
                    }

                    // Convert array to object for easier lookup
                    this.stageControlData = {};
                    data.forEach(stage => {
                        this.stageControlData[stage.stage] = { is_enabled: stage.is_enabled };
                    });

                    console.log('[STAGE_CONTROL] Stage control data loaded:', this.stageControlData);
                    
                    // Refresh UI if contest app is ready
                    if (window.contestApp) {
                        window.contestApp.renderStagesGrid();
                        window.contestApp.renderCurrentStage();
                        updateStage16();
                    }
                    
                } catch (error) {
                    console.warn('[STAGE_CONTROL] Error loading stage control:', error);
                    // Default to all stages enabled on error
                    this.stageControlData = {};
                    for (let i = 1; i <= 16; i++) {
                        this.stageControlData[i] = { is_enabled: true };
                    }
                }
            },
            
            isStageEnabled(stage) {
                const control = this.stageControlData[stage];
                return control ? control.is_enabled : true; // Default to enabled if no data
            }
        };

        // Initialize Admin Manager
        adminManager = new AdminManager();

        window.supabaseAuth = supabaseAuth;
        window.progressManager = progressManager;
        window.leaderboardManager = leaderboardManager;
        window.stageControlManager = stageControlManager;
        window.adminManager = adminManager;
        
        // Load stage control data
        stageControlManager.loadStageControl();
        
        console.log('[SUPABASE] Initialization complete');
    } else {
        console.error('[SUPABASE] Supabase library not loaded');
    }
}

// FIXED: Leaderboard functionality - Ensure proper rendering
function renderLbCard(stage, winner) {
    const hasWinner = !!winner;
    
    let prizeText;
    if (stage === 16) {
        prizeText = '100K Miles';
    } else if (stage === 15) {
        prizeText = '50K Miles';
    } else {
        prizeText = '$50 + $100 GC';
    }

    const card = document.createElement('li');
    card.className = 'lb-card';
    card.setAttribute('role', 'listitem');

    if (hasWinner) {
        const formattedDate = winner.won_at ? new Date(winner.won_at).toLocaleDateString() : '';
        
        card.innerHTML = `
            <div class="lb-left">
                <div class="lb-winner-pill">Winner: ${winner.username || '—'}</div>
                <div class="lb-congrats">🎉 Congratulations!</div>
                <div class="lb-stage-label">Stage ${stage}${stage === 16 ? ' · Master' : ''}</div>
                <div class="lb-prize">${prizeText}</div>
                <div class="lb-date">Won ${formattedDate}</div>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div class="lb-left">
                <div class="lb-winner-pill" style="background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.6);">No Winner Yet</div>
                <div class="lb-stage-label">Stage ${stage}${stage === 16 ? ' · Master' : ''}</div>
                <div class="lb-prize">${prizeText}</div>
                <div class="lb-date">Prize Still Available</div>
            </div>
        `;
    }

    return card;
}

// FIXED: Ensure leaderboard renders properly
async function renderLeaderboard() {
    console.log('[LEADERBOARD] Starting leaderboard render...');

    const grid = document.querySelector('.leaderboard-grid');
    if (!grid) {
        console.warn('[LEADERBOARD] Grid element not found');
        return;
    }

    // Clear existing content first
    grid.innerHTML = '';

    let winnersMap = {};

    // Try to fetch winners data
    try {
        if (supabase) {
            console.log('[LEADERBOARD] Fetching winners from stage_winners table...');
            const { data, error } = await supabase
                .from('stage_winners')
                .select('stage, username, won_at')
                .order('stage', { ascending: true });

            if (error) {
                console.warn('[LEADERBOARD] Error fetching winners:', error);
            } else if (data && data.length > 0) {
                console.log('[LEADERBOARD] Winners data received:', data);
                data.forEach(winner => {
                    winnersMap[winner.stage] = winner;
                });
            } else {
                console.log('[LEADERBOARD] No winners found in database');
            }
        } else {
            console.warn('[LEADERBOARD] Supabase not initialized');
        }
    } catch (error) {
        console.warn('[LEADERBOARD] Failed to fetch winners:', error);
    }

    console.log('[LEADERBOARD] Winners map:', winnersMap);

    // Render cards for stages 1-15 only (Stage 16 has its own Master Stage section)
    for (let stage = 1; stage <= 15; stage++) {
        const winner = winnersMap[stage];
        const card = renderLbCard(stage, winner);
        grid.appendChild(card);
    }

    console.log('[LEADERBOARD] Successfully rendered 15 leaderboard cards');
}

// Stage 16 Leaderboard Card - Grand Prize Special Card
// Stage 16 is now rendered as part of the main leaderboard grid (stages 1-16)
// No separate rendering needed

// Modal Management System
const howToPlayModal = {
    element: null,
    
    init() {
        this.element = document.getElementById('howToPlayModal');
    },
    
    open() {
        if (this.element) {
            this.element.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },
    
    close() {
        if (this.element) {
            this.element.classList.remove('show');
            document.body.style.overflow = '';
        }
    }
};

const termsModal = {
    element: null,
    
    init() {
        this.element = document.getElementById('termsModal');
    },
    
    open() {
        if (this.element) {
            this.element.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },
    
    close() {
        if (this.element) {
            this.element.classList.remove('show');
            document.body.style.overflow = '';
        }
    }
};

// ===== AUTH MODAL TAB HELPERS =====
/**
 * Get the default tab to show in auth modal, consuming the one-shot flag
 * @returns {string} - "signin" or "signup"
 */
function getAuthModalDefaultTab() {
  try {
    const v = localStorage.getItem(AUTH_MODAL_DEFAULT_TAB_KEY);
    if (v === "signin" || v === "signup") {
      localStorage.removeItem(AUTH_MODAL_DEFAULT_TAB_KEY); // one-shot
      return v;
    }
  } catch (e) {}
  return "signup"; // default for new visitors
}

/**
 * Switch the auth modal to a specific tab (signin or signup)
 * @param {string} tab - "signin" or "signup"
 */
function switchAuthTab(tab) {
  const isSignIn = tab === "signin";

  // Toggle active classes on tab buttons
  document.querySelectorAll('.auth-tab').forEach((btn, idx) => {
    btn.classList.toggle('active', (idx === 0 && !isSignIn) || (idx === 1 && isSignIn));
  });

  // Toggle active class on forms
  document.getElementById('auth-signup')?.classList.toggle('active', !isSignIn);
  document.getElementById('auth-signin')?.classList.toggle('active', isSignIn);

  // Update title
  document.getElementById('auth-title').textContent = isSignIn ? 'Welcome Back!' : 'Join the Game!';
}

// FIXED: Auth UI with better error handling and timeout management
class AuthUI {
    constructor() {
        this.isProcessing = false;
    }

    showModal() {
        const modal = document.getElementById('auth-modal');
        modal.classList.add('show');
        
        // Check for default tab preference from previous signout
        const defaultTab = getAuthModalDefaultTab();
        this.showTab(defaultTab);
    }

    closeModal() {
        const modal = document.getElementById('auth-modal');
        modal.classList.remove('show');
        this.clearMessage();
        this.isProcessing = false;
    }

    showTab(tab) {
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });

        document.querySelectorAll('.auth-tab').forEach(tabBtn => {
            tabBtn.classList.remove('active');
        });

        if (tab === 'signup') {
            document.getElementById('auth-signup').classList.add('active');
            document.querySelector('.auth-tab:first-child').classList.add('active');
            document.getElementById('auth-title').textContent = 'Join the Game!';
        } else if (tab === 'signin') {
            document.getElementById('auth-signin').classList.add('active');
            document.querySelector('.auth-tab:last-child').classList.add('active');
            document.getElementById('auth-title').textContent = 'Welcome Back!';
        }

        this.clearMessage();
    }

    showForgotPassword() {
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        document.getElementById('auth-forgot').classList.add('active');
        document.getElementById('auth-title').textContent = 'Reset Password';
        this.clearMessage();
    }

    showMessage(message, type = 'info') {
        const messageEl = document.getElementById('auth-message');
        messageEl.textContent = message;
        messageEl.className = `auth-message ${type}`;
        messageEl.style.display = 'block';
    }

    clearMessage() {
        const messageEl = document.getElementById('auth-message');
        messageEl.style.display = 'none';
    }

    async handleSignIn(event) {
        event.preventDefault();
        
        if (this.isProcessing) {
            console.log('[AUTH] Sign in already in progress, ignoring');
            return;
        }
        
        this.isProcessing = true;
        console.log('[AUTH] signIn started for:', document.getElementById('signin-email').value);
        
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;

        try {
            this.showMessage('Signing in...', 'info');
            
            // Initialize timeout tracking
            signInResolved = false;
            
            const timeoutPromise = new Promise((_, reject) => {
                signInTimeoutId = setTimeout(async () => {
                    console.log('[AUTH] timeout fired (10s)');
                    
                    // Before failing, check if session actually exists
                    try {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (session) {
                            console.log('[AUTH] timeout fired but session exists; ignoring error');
                            return;  // Don't reject; session is valid
                        }
                    } catch (err) {
                        console.warn('[AUTH] getSession error in timeout handler:', err);
                    }
                    
                    // Only reject if we haven't already resolved and no session exists
                    if (!signInResolved) {
                        reject(new Error('Sign in timeout'));
                    }
                }, 10000);
            });
            
            const result = await Promise.race([
                supabaseAuth.signInWithEmail(email, password),
                timeoutPromise
            ]);
            
            // Clear timeout on success
            clearSignInTimeout('api_success');
            
            this.showMessage('Welcome back!', 'success');
            localStorage.setItem(SC_AUTO_ENTER_GAME_KEY, "1");
            setTimeout(() => {
                this.closeModal();
                // Auth state change will handle showing appropriate interface
            }, 1500);
        } catch (error) {
            // Clear timeout on failure
            clearSignInTimeout('api_failure');
            
            console.error('[AUTH] signIn failed:', error);
            this.showMessage(error.message || 'Failed to sign in. Please try again.', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    async handleSignUp(event) {
        event.preventDefault();
        
        if (this.isProcessing) {
            console.log('[AUTH] Sign up already in progress, ignoring');
            return;
        }
        
        this.isProcessing = true;
        
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const passwordConfirm = document.getElementById('signup-password-confirm').value;

        // Validate passwords match
        if (password !== passwordConfirm) {
            this.showMessage('Passwords do not match', 'error');
            this.isProcessing = false;
            return;
        }

        try {
            this.showMessage('Creating your account...', 'info');
            
            const result = await Promise.race([
                supabaseAuth.signUpWithEmail(email, password),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Sign up timeout')), 15000)
                )
            ]);
            
            if (result.needsConfirmation) {
                this.showMessage('Account created! Please check your email to confirm your account, then sign in.', 'success');
                setTimeout(() => {
                    this.showTab('signin');
                }, 3000);
            } else {
                this.showMessage('Account created! Let\'s start your journey!', 'success');
                localStorage.setItem(SC_AUTO_ENTER_GAME_KEY, "1");
                setTimeout(() => {
                    this.closeModal();
                    // Auth state change will handle showing appropriate interface
                }, 2000);
            }
        } catch (error) {
            console.error('Sign up error:', error);
            let errorMessage = 'Failed to create account. Please try again.';
            
            if (error.message.includes('already registered')) {
                errorMessage = 'This email is already registered. Please sign in instead.';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Sign up is taking too long. Please try again.';
            } else if (error.message.includes('Password')) {
                errorMessage = 'Password must be at least 6 characters long.';
            }
            
            this.showMessage(errorMessage, 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    async handleForgotPassword(event) {
        event.preventDefault();
        
        if (this.isProcessing) {
            return;
        }
        
        this.isProcessing = true;
        
        const email = document.getElementById('forgot-email').value;

        try {
                        this.showMessage('Sending reset link...', 'info');

                        // Send reset link
                        const redirectTo = window.location.origin + '/';

                        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
                            redirectTo,
                        });

                        if (error) {
                            console.error('[RESET] Error sending reset email:', error);
                            alert('Error sending reset email: ' + error.message);
                            return;
                        }

                        alert('Password reset email sent. Check your inbox.');

                        this.showMessage('Password reset link sent! Check your email.', 'success');
                        setTimeout(() => this.showTab('signin'), 3000);
        } catch (error) {
            console.error('Password reset error:', error);
            this.showMessage(error.message || 'Failed to send reset link', 'error');
        } finally {
            this.isProcessing = false;
        }
    }
}

// Show/Hide functions
function showLanding() {
    console.log('[UI] Showing landing page');
    window.__gameShown = false;
    window.__adminShown = false;
    document.getElementById('landingPage').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('adminContainer').style.display = 'none';
}

// ===== PROFILE BUTTON WIRING (Re-attach after DOM re-renders) =====
function wireProfileButton() {
  const btn = document.getElementById("btnMyProfile");
  
  if (!btn) {
    console.warn("[PROFILE] btnMyProfile not found");
    return;
  }
  
  btn.onclick = () => {
    console.log("[PROFILE] My Profile clicked");
    if (typeof openProfileModal === "function") {
      openProfileModal();
    } else {
      console.warn("[PROFILE] openProfileModal function not found");
    }
  };
  
  console.log("[PROFILE] Button wired successfully");
}

function showGame() {
  console.log('[UI] Showing game');
  window.__gameShown = true;
  window.__adminShown = false;

  const landing = document.getElementById('landingPage');
  const game = document.getElementById('gameContainer');
  const admin = document.getElementById('adminContainer');

  if (landing) landing.style.display = 'none';
  if (game) game.style.display = 'block';
  if (admin) admin.style.display = 'none';

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Update user label in header (gracefully handle missing elements)
  if (supabaseAuth && supabaseAuth.user) {
    const userNameEl = document.getElementById('userName');
    const journeyEmailEl = document.getElementById('journeyUserEmail');

    // NEVER fail showGame just because a label element is missing
    if (!userNameEl && !journeyEmailEl) {
      console.warn("[UI] showGame: missing user label elements (#userName / #journeyUserEmail)");
    } else {
      const label = (currentProfile?.display_name || supabaseAuth.user.user_metadata?.username || supabaseAuth.user.email || "").trim();

      if (userNameEl) {
        userNameEl.textContent = label;
        userNameEl.style.display = "";
      }

      if (journeyEmailEl) {
        journeyEmailEl.textContent = label;
      }
    }
  }

  setTimeout(() => {
    try {
      console.log('[UI] Forcing leaderboard render...');
      if (typeof renderLeaderboard === 'function') {
        renderLeaderboard();
      }
    } catch (err) {
      console.warn('[UI] Leaderboard render on showGame failed:', err);
    }
  }, 500);

  // Re-attach profile button handler after DOM is stable
  wireProfileButton();
}

// Centralized function to start the contest UI for a signed-in user
async function startContestForSignedInUser() {
    try {
        // --- LP variant guard: prevent game UI init on landing pages ---
        if (IS_LP_VARIANT) {
            console.log("[LP] startContestForSignedInUser called on LP — redirecting");
            window.location.href = "./index.html";
            return;
        }

        console.log('[UI] startContestForSignedInUser called');

        if (!(supabaseAuth && supabaseAuth.isAuthenticated())) {
            console.log('[UI] No authenticated user, showing auth modal');
            if (authUI && typeof authUI.showModal === 'function') {
                authUI.showModal();
            }
            return;
        }

        // Check if profile is complete; prompt if needed
        await loadMyProfileAndHydrateUI();
        promptProfileCompletionIfNeeded();

        // --- Restore user's current stage from database (MUST happen before app init) ---
        const userId = supabaseAuth?.user?.id;
        if (userId && window.supabaseClient) {
            try {
                const restoredStage = await restoreStageFromSolves(userId);
                window.currentStage = restoredStage;
                if (window.contestApp) {
                    window.contestApp.currentStage = restoredStage;
                }
                console.log(`[UI] currentStage set to ${restoredStage} (source: DB)`);
            } catch (err) {
                console.warn("[PROGRESS] Failed to restore stage from solves:", err);
                window.currentStage = 1;
                console.log(`[UI] currentStage set to 1 (source: default/error)`);
            }
        } else {
            window.currentStage = 1;
            console.log(`[UI] currentStage set to 1 (source: no userId/client)`);
        }

        // Ensure ContestApp exists (idempotent - create only once)
        if (!window.__appInitialized) {
            console.log('[UI] Creating ContestApp (will init after stage is confirmed)');
            window.contestApp = new ContestApp();
            try { window.app = window.contestApp; } catch (e) { /* noop */ }
            window.__appInitialized = true;
        }

        // Set stage on app from DB-restored value
        if (window.contestApp) {
            window.contestApp.currentStage = window.currentStage;
            console.log(`[UI] Set app currentStage to: ${window.currentStage}`);
        }

        // Compute correct next unsolved stage from DB BEFORE rendering
        // CRITICAL: Await solvesLoadedPromise to ensure DB loads before journey renders
        try {
            if (window.contestApp && typeof window.contestApp.ensureAtNextUnsolved === 'function') {
                console.log('[UI] Computing next unsolved stage from DB...');
                await window.contestApp.ensureAtNextUnsolved('start');
            }
            
            // ✅ GATE: Wait for DB solves to fully load before rendering
            console.log('[UI] Waiting for DB solves to load...');
            await Promise.race([
              solvesLoadedPromise,
              new Promise(resolve => setTimeout(resolve, 3000)) // 3s timeout fallback
            ]);
            console.log('[UI] DB solves loaded, proceeding with render');
        } catch (err) {
            console.warn('[UI] ensureAtNextUnsolved error (non-fatal):', err);
        }

        // ✅ Ensure Journey Progress uses DB solves (not localStorage)
        try {
            const solvedArr = window.__dbSolvedArray || [];
            window.solvedStages = solvedArr;

            if (window.contestApp) {
                window.contestApp.solvedStages = solvedArr;
                window.contestApp.solvedSet = window.__dbSolvedSet;
            }

            console.log("[JOURNEY] Applied DB solves to UI:", solvedArr);

            // Force refresh of journey UI now that DB solves are known
            if (typeof renderJourneyProgress === "function") {
                renderJourneyProgress(solvedArr);
            }
            if (window.contestApp && typeof window.contestApp.renderJourneyProgress === "function") {
                window.contestApp.renderJourneyProgress();
            }
            if (window.contestApp && typeof window.contestApp.renderJourneyCards === "function") {
                window.contestApp.renderJourneyCards();
            }
            // ✅ CRITICAL: Force journey cards re-render with DB data
            if (window.contestApp && typeof window.contestApp.renderStagesGrid === "function") {
                console.log("[JOURNEY] Re-rendering journey stages grid with DB data");
                window.contestApp.renderStagesGrid();
            }
            
            // ✅ DEFENSIVE RE-RENDER: Force all journey UI to refresh after DB load
            console.log("[JOURNEY] Running defensive re-render of all journey components");
            setTimeout(() => {
              try {
                if (window.contestApp && typeof window.contestApp.renderStagesGrid === "function") {
                  window.contestApp.renderStagesGrid();
                }
                if (window.contestApp && typeof window.contestApp.applySolvedStatesToCards === "function") {
                  console.log("[JOURNEY] Defensive: applying solved states to cards with globals:", window.__SOLVED_STAGES);
                  window.contestApp.applySolvedStatesToCards();
                }
                if (window.contestApp && typeof window.contestApp.renderJourneyProgress === "function") {
                  window.contestApp.renderJourneyProgress();
                }
                if (window.contestApp && typeof window.contestApp.updateStageProgressUI === "function") {
                  console.log("[JOURNEY] Defensive: calling updateStageProgressUI with globals:", window.__SOLVED_STAGES);
                  window.contestApp.updateStageProgressUI();
                }
                if (window.contestApp && typeof window.contestApp.updateProgress === "function") {
                  window.contestApp.updateProgress();
                }
                console.log("[JOURNEY] Defensive re-render complete");
              } catch (e) {
                console.warn("[JOURNEY] Defensive re-render warning:", e);
              }
            }, 100);
        } catch (e) {
            console.warn("[JOURNEY] Failed to apply solvedSet to UI", e);
        }

        // NOW init() the app - this renders UI with correct stage
        try {
            if (window.contestApp && typeof window.contestApp.init === 'function' && !window.__contestAppInitCalled) {
                console.log('[UI] Calling ContestApp.init() after stage confirmation');
                window.contestApp.init();
                window.__contestAppInitCalled = true;
            }
        } catch (err) {
            console.warn('[UI] ContestApp.init() error (non-fatal):', err);
        }

        // Show the game container (this hides landing) - AFTER stage and UI are correct
        if (typeof showGame === 'function') {
            console.log('[UI] Showing game UI');
            showGame();
        }

        // Update progress display
        try {
            if (window.contestApp && typeof window.contestApp.updateProgress === 'function') {
                window.contestApp.updateProgress();
            }
        } catch (err) {
            console.warn('[UI] updateProgress error (non-fatal):', err);
        }

        // Re-attach profile button handler after game initialization
        wireProfileButton();
    } catch (err) {
        console.error('[UI] startContestForSignedInUser error:', err);
    }
}

// LEGACY ADMIN UI - DISABLED
// Admin access has been moved to /admin.html for better security and management.
// This function is kept for reference only and should never be called.
// If triggered, it logs a warning and does nothing.
function showAdmin() {
    console.warn('[ADMIN] showAdmin() called but legacy admin UI is disabled. Use /admin.html');
    // Do NOT show admin container - exit silently
    return;
}

// Contest App Configuration
const CONFIG = {
    total: 16,
    stages: {
        1: { title: "Stage 1", yt: "bGI0u0RlW34" },
        2: { title: "Stage 2", yt: "mQgZMa8sjYY" },
        3: { title: "Stage 3", yt: "KUN90a2ZHiw" },
        4: { title: "Stage 4", yt: "YIIR8guq-No" },
        5: { title: "Stage 5", yt: "sGqsQ7YyGPw" },
        6: { title: "Stage 6", yt: "Kv9js6bb35c" },
        7: { title: "Stage 7", yt: "LEZIW9LXwNA" },
        8: { title: "Stage 8", yt: "i81uGvAqi5c" },
        9: { title: "Stage 9", yt: "y7eWLrz-Lyk" },
        10: { title: "Stage 10", yt: "5qkIptxr_4Y" },
        11: { title: "Stage 11", yt: "oCFz8i2d6hM" },
        12: { title: "Stage 12", yt: "xxAU10mE0ik" },
        13: { title: "Stage 13", yt: "xxAU10mE0ik" },
        14: { title: "Stage 14", yt: "xxAU10mE0ik" },
        15: { title: "Stage 15", yt: "xxAU10mE0ik" },
        16: { title: "Stage 16", yt: "xxAU10mE0ik" }
    }
};

// Stage 16 Update Function - UPDATED: Now checks admin control
function updateStage16() {
    const stage16Card = document.getElementById('stage16Card');
    if (!stage16Card) return;

    // Get solved stages from contestApp if available, otherwise from localStorage
    let solvedStages = [];
    if (window.contestApp && window.contestApp.getSolvedStagesFromLocal) {
        solvedStages = window.contestApp.getSolvedStagesFromLocal();
    } else {
        try {
            solvedStages = JSON.parse(localStorage.getItem("contest_solved_stages") || "[]");
        } catch (e) {
            solvedStages = [];
        }
    }

    const solved = new Set(solvedStages.filter(n => n >= 1 && n <= 15));
    const progressUnlocked = solved.size === 15; // gate condition
    
    // NEW: Check admin control for Stage 16
    const adminEnabled = stageControlManager ? stageControlManager.isStageEnabled(16) : true;
    const unlocked = progressUnlocked && adminEnabled;

    // Update the card classes and content
    if (!adminEnabled) {
        // Admin disabled - takes priority
        stage16Card.classList.remove('locked');
        stage16Card.classList.add('stage-status-locked');
        stage16Card.innerHTML = `
            <div class="stage16-master-icon stage-status-locked">⏸️</div>
            <div class="stage16-master-header">
                <div class="master-stage-title">Stage 16 — Master Stage</div>
                <div class="master-stage-subtitle">Grand Finale — 100K Miles</div>
            </div>
            <div class="stage16-master-description">
                Complete all 15 stages to unlock the Grand Finale.<br>
                The first correct solver wins 100,000 Turkish Airlines Miles.<br>
                Once claimed, Stage 16 closes for everyone else.
            </div>
            <div class="stage16-master-status">Opens as your journey unfolds</div>
        `;
        stage16Card.style.cursor = 'not-allowed';
        stage16Card.onclick = null;
    } else if (unlocked) {
        // Fully unlocked and enabled
        stage16Card.classList.remove('locked', 'stage-status-locked');
        stage16Card.innerHTML = `
            <div class="stage16-master-icon open">✔</div>
            <div class="stage16-master-header">
                <div class="master-stage-title">Stage 16 — Master Stage</div>
                <div class="master-stage-subtitle">Grand Finale — 100K Miles</div>
            </div>
            <div class="stage16-master-description">
                Complete all 15 stages to unlock the Grand Finale.<br>
                The first correct solver wins 100,000 Turkish Airlines Miles.<br>
                Once claimed, Stage 16 closes for everyone else.
            </div>
            <div class="stage16-master-status">Open — Click to Play</div>
        `;
        
        // Add click handler for open Stage 16
        stage16Card.style.cursor = 'pointer';
        stage16Card.onclick = () => {
            if (window.contestApp && window.contestApp.openStageModal) {
                window.contestApp.openStageModal(16);
            }
        };
    } else {
        // Locked due to progress
        stage16Card.classList.add('stage-status-locked');
        stage16Card.classList.remove('locked');
        stage16Card.innerHTML = `
            <div class="stage16-master-icon stage-status-locked">🔒</div>
            <div class="stage16-master-header">
                <div class="master-stage-title">Stage 16 — Master Stage</div>
                <div class="master-stage-subtitle">Grand Finale — 100K Miles</div>
            </div>
            <div class="stage16-master-description">
                Complete all 15 stages to unlock the Grand Finale.<br>
                The first correct solver wins 100,000 Turkish Airlines Miles.<br>
                Once claimed, Stage 16 closes for everyone else.
            </div>
            <div class="stage16-master-status">Opens as your journey unfolds</div>
        `;
        stage16Card.style.cursor = 'not-allowed';
        stage16Card.onclick = null;
    }
}

// Initialize everything when DOM is ready
// NOTE: URL-hash based recovery handler removed. Password recovery is
// handled via the Supabase auth state change listener (PASSWORD_RECOVERY).

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[INIT] Page loaded...');

    // Initialize Supabase first so recovery handlers can use the client
    await initializeSupabase();

    // Password recovery via URL-hash has been removed. Recovery is handled
    // in the Supabase auth state listener (PASSWORD_RECOVERY) so we don't
    // interfere with normal app initialization order.
    
    // Wire avatar option clicks (event delegation, global)
    wireAvatarOptions();
    
    // Wire profile modal controls (close buttons and backdrop)
    wireProfileModalControls();
    
    // Initialize password change functionality
    initProfilePasswordChange();
    
    // Initialize modals
    howToPlayModal.init();
    termsModal.init();
    
    // Initialize auth UI
    authUI = new AuthUI();
    
    // Expose authUI for any legacy onclick handlers in HTML
    window.authUI = authUI;

    // Wire Google OAuth button
    const googleBtn = document.getElementById('googleSignInBtn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            try {
                if (!window.supabaseAuth) throw new Error('supabaseAuth not initialized');

                // optional: marketing event
                if (window.logMarketingEvent) {
                    window.logMarketingEvent('google_oauth_clicked', { variant: window.MARKETING_VARIANT || 'default' });
                }

                const redirectTo = window.location.origin + window.location.pathname; // stays on same page

                const { data, error } = await window.supabaseAuth.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo }
                });

                if (error) throw error;

                console.log('[AUTH] Google OAuth started', data);
            } catch (err) {
                console.error('[AUTH] Google OAuth failed to start:', err);
                alert('Google sign-in failed to start. Check console + Supabase provider settings.');
            }
        });
        console.log('[AUTH] Google OAuth button wired in script.js');
    } else {
        console.warn('[AUTH] googleSignInBtn not found in DOM');
    }
    
    // Initialize marketing event logger
    marketingEventLogger = new MarketingEventLogger(supabase);
    await marketingEventLogger.onPageLoad();
    
    // Bind landing page events
    const playGameBtn = document.getElementById('playGameBtn');
    if (playGameBtn) {
        playGameBtn.onclick = (e) => {
            e?.preventDefault?.();
            
            // Log CTA click event
            if (marketingEventLogger) {
                marketingEventLogger.onCtaClick();
            }
            
            if (supabaseAuth && supabaseAuth.isAuthenticated()) {
                // LEGACY ADMIN UI DISABLED
                // The main site no longer provides admin access.
                // Admins must use /admin.html for stage control.
                // All users (including admin email) proceed to normal game flow.
                console.warn('[ADMIN] Legacy admin UI disabled. Use /admin.html instead');
                startContestForSignedInUser();
            } else {
                // Log signup started when opening auth modal
                if (marketingEventLogger) {
                    marketingEventLogger.onSignupStarted();
                }
                authUI.showModal();
            }
        };
    }
    
    // Bind footer links
    const howToPlayLink = document.getElementById('howToPlayLink');
    if (howToPlayLink) {
        howToPlayLink.onclick = () => howToPlayModal.open();
    }

    const termsLink = document.getElementById('termsLink');
    if (termsLink) {
        termsLink.onclick = () => termsModal.open();
    }

    const howToPlayLinkGame = document.getElementById('howToPlayLinkGame');
    if (howToPlayLinkGame) {
        howToPlayLinkGame.onclick = () => howToPlayModal.open();
    }

    // Bind the real sign-out button to the class handler
    const btn = document.querySelector("[data-action='signout']") || document.getElementById("btnSignOut");
    if (btn) {
      if (typeof app?.handleSignOut === "function") {
        btn.onclick = (e) => app.handleSignOut(e);
      } else {
        btn.onclick = (e) => hardGameSignOut();
      }
      console.log("[SIGNOUT] Button bound");
    }
    document.getElementById('termsLinkGame').onclick = () => termsModal.open();
    
    // Initialize contest app after a short delay to ensure Supabase is ready
    setTimeout(() => {
        if (!window.__appInitialized) {
            window.contestApp = new ContestApp();
            // Expose the same instance as `app` for older code paths that expect a global `app`
            try { window.app = window.contestApp; console.log("[INIT] App instance exposed globally"); } catch (e) { /* noop */ }
            window.__appInitialized = true;
            console.log('[INIT] Contest app initialized');
                    // Check if this load came from a Supabase password recovery link
                    // (No-op) recovery handler already run after Supabase init above
        }
    }, 1000);
    
    console.log('[INIT] Initialization complete');
});

// Handle auth state changes
window.addEventListener('load', async function () {
  if (!supabase) {
    console.warn('[LOAD] Supabase not initialized yet');
    return;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const autoEnter = localStorage.getItem(SC_AUTO_ENTER_GAME_KEY) === "1";

    if (session?.user || autoEnter) {
      localStorage.removeItem(SC_AUTO_ENTER_GAME_KEY);
      console.log('[LOAD] Session/autoEnter found — skipping landing, entering game');
      if (session?.user) {
        supabaseAuth.user = session.user;
      }
      startContestForSignedInUser();
      return;
    } else {
      console.log('[LOAD] No existing session found on load; showing landing');
      showLanding();
    }
  } catch (err) {
    console.error('[LOAD] Error while restoring session:', err);
    showLanding();
  }
});

// Global error handler
window.addEventListener('error', function(event) {
    console.error('[GLOBAL ERROR]', event.error);
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', function(event) {
    console.error('[UNHANDLED PROMISE REJECTION]', event.reason);
});

console.log('[SCRIPT] Contest app script loaded successfully');
