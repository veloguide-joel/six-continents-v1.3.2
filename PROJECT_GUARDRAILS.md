# Project Guardrails & Rules

**Last Updated:** January 2, 2026  
**For:** Six Continents Challenge A/B Testing & Event Tracking  
**Scope:** Applies to all future changes to this codebase

---

## Core Rules (DO NOT BREAK)

### 1. Feature Preservation
- **Never remove existing features** unless explicitly asked by user.
- **Keep all working functionality intact:** profile modal, profile save, full clear-cache logout.
- When adding new code, keep old behavior alongside—do not replace working code with minimal versions.

### 2. ES6 Module Safety
- **If converting a script to `type="module"`**, you must:
  - Re-expose any previously used globals on `window` (e.g., `window.supabaseAuth`, `window.authUI`)
  - OR refactor all callers to use imports
  - **Do NOT leave half-converted code** with some globals missing and some onclick handlers still using them.

### 3. Selector & ID Changes
- **Before changing any ID or selector:**
  - Search all files for references in both HTML and JavaScript
  - Update all `document.getElementById()`, `querySelector()`, and onclick handlers
  - If you change an ID in HTML, update corresponding JS code immediately
  - Verify no orphaned selectors are left behind

### 4. UI Event Wiring (Null Safety)
- **All DOM element access must be null-safe:**
  ```javascript
  const btn = document.getElementById("myButton");
  if (!btn) {
    console.warn("[MODULE] Button not found");
    return;
  }
  btn.addEventListener("click", handler);
  ```
- Never call `.onclick`, `.classList.add()`, or `.style.property` on a potentially null element.
- Wrap all DOM manipulations in existence checks.

### 5. Code Replacement Policy
- **Do not replace working code with "minimal" versions** unless explicitly asked.
- Example: Do NOT replace `hardSignOut()` (full cache clear) with `signOutHard()` (minimal).
- Always keep the complete version active and document why if a minimal fallback is needed.

---

## Pre-Deployment Checklist

Before marking work complete, verify these scenarios work end-to-end:

- [ ] **Play Button:** Click "PLAY THE GAME!" → Auth modal opens
- [ ] **Sign Up Success:** Fill form → Submit → Modal closes → Game UI loads (no blank page)
- [ ] **Sign In Success:** Enter credentials → Submit → Modal closes → Game UI loads
- [ ] **Profile Opens:** Click "My Profile" header button → Modal appears with profile form
- [ ] **Profile Saves:** Edit name/avatar → Click Save → Changes persist
- [ ] **Sign Out:** Click Sign Out button → All cache cleared → Redirects to clean landing page
- [ ] **Landing Page Variant A:** `/lp-a.html` loads with "Ready to Win 150,000 Miles?" copy
- [ ] **Landing Page Variant B:** `/lp-b.html` loads with "The Global Travel Game You Can Actually Win!" copy
- [ ] **Auto-Enter Game:** Sign in on LP → Redirects to index.html → Game starts (not landing page)
- [ ] **Console Clean:** No "undefined function" or "Cannot read properties of null" errors

---

## Known Architecture

### File Locations
- **Landing Pages:** `lp-a.html`, `lp-b.html` (variants A & B with identical auth modals)
- **Main Game:** `index.html` (includes router for `?lp=auto`)
- **Core Scripts:** `script.js` (ES6 module), `marketing.js`, `auth-ui.js`
- **Tracking:** `marketing.js` (creates `MarketingEventLogger`), logs to Supabase `marketing_events` table
- **Config:** `config.js` (Supabase credentials)

### Global Exports (Must Stay on `window`)
- `window.supabase` — Supabase client
- `window.supabaseClient` — Alias for supabase
- `window.supabaseAuth` — supabase.auth object
- `window.marketing` — MarketingEventLogger instance
- `window.authUI` — AuthUI modal controller

### Storage Keys (Clear on Sign Out)
```javascript
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
```

### Critical Functions
- `openProfileModal()` — Opens profile edit modal (line ~407 in script.js)
- `hardSignOut()` — Full sign out + cache clear (line ~720 in script.js)
- `startContestForSignedInUser()` — Enters game UI (with LP variant guard)
- `showLanding()` — Shows landing page

---

## Commit & Review Policy

- **No auto-commit.** All changes require explicit user review.
- **No auto-merge.** PRs / changes must be validated manually.
- **Provide diffs or exact snippets** for all changes—make them easy to review.
- **Test on both lp-a.html and lp-b.html** before marking complete (they share the same code paths).

---

## Event Tracking (FYI)

Events logged to Supabase `marketing_events` table:
- `lp_view` — Page load (deduplicated per session)
- `cta_click` — "Play" button clicked
- `signup_started` — Auth modal opened
- `signup_success` — User created (includes user_id)

Schema: `session_id`, `variant` (A/B), `event`, `meta` (jsonb), `created_at`

SQL schema file: `marketing_events_schema.sql` (must be run in Supabase SQL editor to create table)

---

## Questions?

If adding new features or refactoring, refer back to these rules. When in doubt, ask the user before making breaking changes.
