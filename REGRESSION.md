# Regression Checklist

**Run this before finalizing any code changes.**

Test these flows on **both `lp-a.html` and `lp-b.html`** where applicable.

---

## Auth Flows

- [ ] **Sign Up New User**
  1. Navigate to `/lp-a.html` or `/lp-b.html`
  2. Click "PLAY THE GAME!"
  3. Auth modal opens
  4. Fill sign-up form (email, password, username)
  5. Submit → Success message appears
  6. Modal closes → Redirects to `index.html`
  7. Game UI loads (NOT landing page)
  8. Console: No "undefined" or "Cannot read properties of null" errors

- [ ] **Sign In Returning User**
  1. Navigate to `/lp-a.html` or `/lp-b.html`
  2. Click "PLAY THE GAME!"
  3. Auth modal opens → "Sign In" tab
  4. Enter existing credentials
  5. Submit → Success message
  6. Modal closes → Redirects to `index.html`
  7. Game UI loads with user progress intact
  8. Console: No auth-related errors

- [ ] **Auto-Enter After Auth**
  1. Sign in/up on landing page
  2. Redirected to `index.html`
  3. Game UI **starts immediately** (no extra click needed)
  4. `SC_AUTO_ENTER_GAME` flag is cleared from localStorage

---

## Profile Flows

- [ ] **Open Profile Modal**
  1. Sign in on main game (`index.html`)
  2. Click "My Profile" button in header
  3. Profile modal appears
  4. Modal shows current display name
  5. Console: No "Missing profile DOM elements" warnings
  6. Modal backdrop is visible

- [ ] **Save Profile Changes**
  1. Open profile modal (see above)
  2. Change display name
  3. Select or upload avatar
  4. Click "Save changes"
  5. Modal closes
  6. Header avatar updates
  7. Refresh page → Changes persist
  8. Console: No profile save errors

---

## Sign Out Flow

- [ ] **Full Clear-Cache Logout**
  1. While signed in, click "Sign Out" button
  2. Console logs: "[AUTH] Starting full sign out..."
  3. All localStorage keys cleared:
     - `SC_AUTO_ENTER_GAME`, `sc_lp_variant`, `sc_session_id`, `progress`, `current_stage`, etc.
  4. Redirected to `index.html`
  5. Landing page shows (no cached game state)
  6. Click "PLAY THE GAME!" → Fresh auth modal appears
  7. No "already signed in" cache artifacts

---

## Marketing Event Tracking

- [ ] **Events Logged to Supabase**
  1. Open DevTools → Network tab
  2. Load `/lp-a.html` or `/lp-b.html`
  3. Network requests include POST to Supabase `marketing_events` table
  4. Event payload includes: `session_id`, `variant` (A or B), `event` ("lp_view", etc.), `meta` (json object)
  5. Click "PLAY THE GAME!" → `cta_click` event logged
  6. Click Sign Up → `signup_started` event logged
  7. After successful signup → `signup_success` event logged with `user_id`
  8. Console: No Supabase insert errors

- [ ] **Variant Assignment Persists**
  1. Load `/?lp=auto` → Redirects to `/lp-a.html` OR `/lp-b.html`
  2. Variant stored in `localStorage['sc_lp_variant']`
  3. Refresh page → Same variant loads
  4. Different browser/session → Gets new variant (50/50 split)

---

## UI Wiring (No Silent Failures)

- [ ] **No Undefined Errors**
  - Open DevTools → Console
  - No "Cannot read properties of null" messages
  - No "is not defined" or "is not a function" errors
  - No "Missing profile/modal DOM elements" warnings

- [ ] **All Buttons Functional**
  - Play button opens auth modal ✓
  - Sign Up/Sign In tabs switch ✓
  - Profile button opens modal ✓
  - Save button saves changes ✓
  - Sign Out button clears everything ✓

---

## Quick Test (5 min)

If you're in a hurry, test these only:
1. Sign up on LP → Game loads
2. Click Profile → Modal opens
3. Sign Out → Back to clean landing page
4. Open DevTools → Check for console errors (should be 0)

---

**Status:** Use before submitting changes.  
**Last Updated:** January 2, 2026
