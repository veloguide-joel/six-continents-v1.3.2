// Admin Dashboard Entry Point
// IMPORTANT: This module is only intended to be loaded by admin.html
// It will not interfere with non-admin pages and does not register global listeners
import { supabase } from './supabase-config.js';

// NOTE: STAGE_ENV is set in admin.html before this module loads
// It's available as window.STAGE_ENV

// ===== MODULE-LEVEL SESSION STATE =====
let CURRENT_SESSION = null;
let AUTH_UNSUB = null;
let UI_MODE = 'unknown'; // 'signed_out' | 'signed_in'

// Prevent duplicate init loops caused by auth listener firing repeatedly
window.__ADMIN_BOOTING__ = window.__ADMIN_BOOTING__ || false;
window.__ADMIN_BOOTED__  = window.__ADMIN_BOOTED__  || false;

/**
 * Get the root container for UI rendering
 * @returns {Element} - Root element for admin UI
 */
function getRoot() {
  return document.getElementById('admin-root') || document.getElementById('app') || document.body;
}

/**
 * Set UI mode and log the change
 * @param {string} mode - 'signed_out' or 'signed_in'
 */
function setUIMode(mode) {
  UI_MODE = mode;
  console.log('[ADMIN] UI_MODE =', UI_MODE);
}

// Safety check: only execute if #app element exists (indicator of admin.html context)
const isAdminContext = () => document.getElementById('app') !== null;

/**
 * ===================================================================
 * ADMIN APP MODULE
 * ===================================================================
 * Shared Supabase client and auth helpers for admin.html
 * Centralizes authentication, session management, and admin verification
 */
class AdminApp {
  constructor() {
    this.supabase = supabase;
    this.authChangeHandlers = [];
    console.log('[ADMIN] AdminApp initialized');
  }

  /**
   * Get current session
   * @returns {Promise<{session: object|null}>} - Current session or null
   */
  async getSession() {
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error) {
        console.error('[ADMIN] getSession error:', error);
        return null;
      }
      console.log('[ADMIN] getSession:', session ? `user: ${session.user.email}` : 'no session');
      return session;
    } catch (err) {
      console.error('[ADMIN] getSession exception:', err);
      return null;
    }
  }

  /**
   * Register handler for auth state changes
   * @param {Function} handler - Callback function (event, session) => void
   */
  onAuthChange(handler) {
    if (typeof handler === 'function') {
      this.authChangeHandlers.push(handler);
      console.log('[ADMIN] Auth change handler registered');
    }
  }

  /**
   * Sign in with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<{user: object|null, error: object|null}>}
   */
  async signInWithPassword(email, password) {
    try {
      console.log('[ADMIN] Attempting sign-in:', email);
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('[ADMIN] Sign-in failed:', error.message);
        return { user: null, error };
      }

      if (data.user) {
        console.log('[ADMIN] Sign-in successful:', data.user.email);
      }

      return { user: data.user, error: null };
    } catch (err) {
      console.error('[ADMIN] Sign-in exception:', err);
      return { user: null, error: err };
    }
  }

  /**
   * Sign out current user
   * @returns {Promise<{error: object|null}>}
   */
  async signOut() {
    try {
      console.log('[ADMIN] Signing out...');
      const { error } = await this.supabase.auth.signOut();

      if (error) {
        console.error('[ADMIN] Sign-out failed:', error.message);
        return { error };
      }

      console.log('[ADMIN] Sign-out successful');
      return { error: null };
    } catch (err) {
      console.error('[ADMIN] Sign-out exception:', err);
      return { error: err };
    }
  }

  /**
   * Check if current user is an admin by querying public.admin_emails table
   * @returns {Promise<boolean>} - true if user is admin, false otherwise
   */
  async isUserAdmin() {
    try {
      const session = await this.getSession();

      if (!session || !session.user || !session.user.email) {
        console.log('[ADMIN] isUserAdmin: no session');
        return false;
      }

      const userEmail = session.user.email;
      console.log('[ADMIN] isUserAdmin: checking', userEmail);

      // Query admin_emails table for exact match
      const { data: adminRecord, error } = await this.supabase
        .from('admin_emails')
        .select('email')
        .eq('email', userEmail)
        .maybeSingle();

      if (error) {
        console.error('[ADMIN] isUserAdmin query error:', error);
        return false;
      }

      if (adminRecord) {
        console.log('[ADMIN] isUserAdmin: true (found in admin_emails)');
        return true;
      }

      console.log('[ADMIN] isUserAdmin: false (not in admin_emails)');
      return false;
    } catch (err) {
      console.error('[ADMIN] isUserAdmin exception:', err);
      return false;
    }
  }

  /**
   * MAIN FLOW: Require admin authentication or show login
   * Manages both views: #adminLoginView and #adminAppView
   * @returns {Promise<boolean>} - true if user is authenticated admin
   */
  async requireAdminOrShowLogin() {
    try {
      console.log('[ADMIN] requireAdminOrShowLogin: starting');

      const session = await this.getSession();

      if (!session) {
        console.log('[ADMIN] requireAdminOrShowLogin: no session - show login');
        this.showLoginView();
        return false;
      }

      // Session exists - verify admin access
      const isAdmin = await this.isUserAdmin();

      if (isAdmin) {
        console.log('[ADMIN] requireAdminOrShowLogin: admin verified');
        this.showAppView(session.user.email);
        return true;
      } else {
        console.log('[ADMIN] requireAdminOrShowLogin: not admin - show denied');
        this.showAccessDeniedView(session.user.email);
        return false;
      }
    } catch (err) {
      console.error('[ADMIN] requireAdminOrShowLogin exception:', err);
      this.showErrorView(err.message);
      return false;
    }
  }

  /**
   * Show login view, hide app view
   * DEPRECATED: Use enterSignedOutState() instead
   */
  showLoginView() {
    console.warn('[ADMIN] showLoginView called (deprecated - use enterSignedOutState)');
    // Only show old elements if not in new session-based UI mode
    if (UI_MODE === 'unknown') {
      const loginView = document.getElementById('adminLoginView');
      const appView = document.getElementById('adminAppView');
      if (loginView) loginView.style.display = 'block';
      if (appView) appView.style.display = 'none';
    }
  }

  /**
   * Show app view, hide login view
   * DEPRECATED: Use enterSignedInState() instead
   * @param {string} userEmail - Authenticated user email
   */
  showAppView(userEmail) {
    console.warn('[ADMIN] showAppView called (deprecated - use enterSignedInState)');
    // Only show old elements if not in new session-based UI mode
    if (UI_MODE === 'unknown') {
      const loginView = document.getElementById('adminLoginView');
      const appView = document.getElementById('adminAppView');
      if (loginView) loginView.style.display = 'none';
      if (appView) appView.style.display = 'block';

      const userDisplay = document.getElementById('adminUserEmail');
      if (userDisplay) {
        userDisplay.textContent = userEmail;
      }
    }
  }

  /**
   * Show access denied view
   * DEPRECATED: Use enterSignedOutState() instead
   * @param {string} userEmail - User email that was denied access
   */
  showAccessDeniedView(userEmail) {
    console.warn('[ADMIN] showAccessDeniedView called (deprecated - use enterSignedOutState)');
    // Only show old elements if not in new session-based UI mode
    if (UI_MODE === 'unknown') {
      const loginView = document.getElementById('adminLoginView');
      const appView = document.getElementById('adminAppView');

      if (loginView) {
        loginView.style.display = 'block';
        loginView.innerHTML = `
          <div style="
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            max-width: 400px;
            margin: 0 auto;
            text-align: center;
          ">
            <h2 style="color: #d32f2f; margin-bottom: 16px;">Access Denied</h2>
            <p style="color: #666; margin-bottom: 16px;">
              Your email <strong>${userEmail}</strong> does not have admin access.
            </p>
            <button
              id="adminSignOutBtn"
              style="
                background: #d32f2f;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
              "
            >
              Sign Out
            </button>
          </div>
        `;

        const signOutBtn = document.getElementById('adminSignOutBtn');
        if (signOutBtn) {
          signOutBtn.addEventListener('click', async () => {
            await this.signOut();
          });
        }
      }

      if (appView) appView.style.display = 'none';
    }
  }

  /**
   * Show error view
   * DEPRECATED: Use enterSignedOutState() instead
   * @param {string} message - Error message
   */
  showErrorView(message) {
    console.warn('[ADMIN] showErrorView called (deprecated - use enterSignedOutState)');
    // Only show old elements if not in new session-based UI mode
    if (UI_MODE === 'unknown') {
      const loginView = document.getElementById('adminLoginView');
      const appView = document.getElementById('adminAppView');

      if (loginView) {
        loginView.style.display = 'block';
        loginView.innerHTML = `
          <div style="
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            max-width: 400px;
            margin: 0 auto;
            text-align: center;
          ">
            <h2 style="color: #d32f2f; margin-bottom: 16px;">Error</h2>
            <p style="color: #666; margin-bottom: 16px;">
              ${message || 'An unexpected error occurred.'}
            </p>
            <button
              onclick="location.reload()"
              style="
                background: #2196f3;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
              "
            >
              Reload Page
            </button>
          </div>
        `;
      }

      if (appView) appView.style.display = 'none';
    }
  }
}

// Export singleton instance
const adminApp = new AdminApp();

/**
 * ===================================================================
 * STAGE CONTROL MODULE
 * ===================================================================
 * Manages stage data fetching, solver counts, and UI rendering
 */
class StageControlModule {
  constructor(adminAppInstance) {
    this.supabase = adminAppInstance.supabase;
    this.stages = [];
    this.solversCounts = {};
    
    // Use local const for convenience - read from window.STAGE_ENV set by admin.html
    this.STAGE_ENV = window.STAGE_ENV || 'dev';
    
    // Initialize write lock for production safety
    this.initializeWriteLock();
    
    console.log('[ADMIN] StageControlModule initialized with STAGE_ENV =', this.STAGE_ENV);
  }

  /**
   * Initialize write lock guard - prevents accidental writes to production from localhost
   * Lock is ON by default if running locally, can be overridden with ?unlock=YESIMREADY
   */
  initializeWriteLock() {
    const hostname = window.location.hostname;
    const stageEnv = this.STAGE_ENV;
    
    // Lock writes if: staging ENV is 'prod' AND hostname is NOT production domain
    // Safe to write if: ENV is 'dev' (localhost/Vercel preview) OR on production domain
    if (stageEnv === 'prod' && hostname !== 'theaccidentalretiree.app') {
      window.__ADMIN_WRITE_LOCKED = true;
      console.warn(`[ADMIN] ⚠️ WRITE LOCKED: STAGE_ENV is 'prod' but hostname is '${hostname}' (not production domain)`);
      console.warn('[ADMIN] This prevents accidental writes to production from staging/preview deployments');
    } else {
      window.__ADMIN_WRITE_LOCKED = false;
      console.log(`[ADMIN] Write lock disabled: STAGE_ENV='${stageEnv}', hostname='${hostname}'`);
    }
  }

  /**
   * Check if writes are allowed
   * @returns {boolean} - true if writes are allowed, false if locked
   */
  isWriteAllowed() {
    return !window.__ADMIN_WRITE_LOCKED;
  }

  /**
   * Get lock status message for display
   * @returns {string|null} - Lock message or null if not locked
   */
  getLockMessage() {
    if (window.__ADMIN_WRITE_LOCKED) {
      return 'WRITE LOCKED: Production environment detected on non-production domain. No changes will be saved.';
    }
    return null;
  }

  /**
   * Fetch stage control data from public.stage_control table
   * Creates default entries for missing stages
   * @returns {Promise<Array>} - Array of stage objects [1..16]
   */
  async fetchStageControl() {
    try {
      console.log('[ADMIN] Fetching stage control data...');

      // Fetch all stage control records for current environment
      const { data: stageRecords, error } = await this.supabase
        .from('stage_control')
        .select('stage, is_enabled, notes, updated_at, updated_by')
        .eq('environment', this.STAGE_ENV)
        .order('stage');

      if (error) {
        console.error('[ADMIN] fetchStageControl query error:', error);
        return this.createDefaultStages();
      }

      // Create map for quick lookup
      const recordsMap = {};
      if (stageRecords) {
        stageRecords.forEach(record => {
          recordsMap[record.stage] = record;
        });
      }

      // Build complete array 1-16, filling gaps with defaults
      const stages = [];
      for (let i = 1; i <= 16; i++) {
        if (recordsMap[i]) {
          stages.push(recordsMap[i]);
        } else {
          // Default for missing stage
          stages.push({
            stage: i,
            is_enabled: false,
            notes: '',
            updated_at: new Date().toISOString(),
            updated_by: 'system'
          });
        }
      }

      this.stages = stages;
      console.log('[ADMIN] Stage control data loaded:', stages.length, 'stages');
      return stages;
    } catch (err) {
      console.error('[ADMIN] fetchStageControl exception:', err);
      return this.createDefaultStages();
    }
  }

  /**
   * Create default stage array (all disabled)
   * @returns {Array}
   */
  createDefaultStages() {
    console.log('[ADMIN] Creating default stages (all disabled)');
    const defaults = [];
    for (let i = 1; i <= 16; i++) {
      defaults.push({
        stage: i,
        is_enabled: false,
        notes: '',
        updated_at: new Date().toISOString(),
        updated_by: 'system'
      });
    }
    this.stages = defaults;
    return defaults;
  }

  /**
   * Fetch solver counts from public.solves table
   * Counts rows per stage (solves with riddle_number = 1, the canonical solve)
   * @returns {Promise<Object>} - Map { stageNumber: count }
   */
  async fetchSolversCounts() {
    try {
      console.log('[ADMIN] Fetching solver counts...');

      // Fetch all solves and count by stage
      const { data: solves, error } = await this.supabase
        .from('solves')
        .select('stage');

      if (error) {
        console.error('[ADMIN] fetchSolversCounts query error:', error);
        return this.createDefaultCounts();
      }

      // Count solves per stage
      const counts = {};
      for (let i = 1; i <= 16; i++) {
        counts[i] = 0;
      }

      if (solves) {
        solves.forEach(solve => {
          if (solve.stage >= 1 && solve.stage <= 16) {
            counts[solve.stage] = (counts[solve.stage] || 0) + 1;
          }
        });
      }

      this.solversCounts = counts;
      console.log('[ADMIN] Solver counts loaded:', counts);
      return counts;
    } catch (err) {
      console.error('[ADMIN] fetchSolversCounts exception:', err);
      return this.createDefaultCounts();
    }
  }

  /**
   * Create default counts (all zeros)
   * @returns {Object}
   */
  createDefaultCounts() {
    console.log('[ADMIN] Creating default solver counts (all zeros)');
    const defaults = {};
    for (let i = 1; i <= 16; i++) {
      defaults[i] = 0;
    }
    this.solversCounts = defaults;
    return defaults;
  }

  /**
   * Format timestamp for display
   * @param {string} isoString - ISO timestamp
   * @returns {string} - Formatted date
   */
  formatTimestamp(isoString) {
    try {
      if (!isoString) return 'Never';
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'Invalid date';
    }
  }

  /**
   * Render stage cards into #stageGrid
   * @param {Array} stages - Stage control data
   * @param {Object} counts - Solver counts map
   */
  renderStageGrid(stages, counts) {
    try {
      console.log('[ADMIN] Rendering stage grid...');

      const grid = document.getElementById('stageGrid');
      if (!grid) {
        console.error('[ADMIN] #stageGrid not found');
        return;
      }

      grid.innerHTML = '';

      stages.forEach(stage => {
        const stageNum = stage.stage;
        const solveCount = counts[stageNum] || 0;
        const isEnabled = stage.is_enabled === true;
        const statusText = isEnabled ? 'Live' : 'Disabled';
        const statusClass = isEnabled ? 'live' : 'disabled';
        const borderColor = isEnabled ? '#4caf50' : '#f48fb1';

        const card = document.createElement('div');
        card.className = 'stage-card';
        card.id = `stage-card-${stageNum}`;
        card.setAttribute('data-stage-card', stageNum);
        card.style.borderLeft = `4px solid ${borderColor}`;
        card.innerHTML = `
          <div class="stage-card-header">
            <div class="stage-card-title">Stage ${stageNum}</div>
            <div class="stage-card-toggle">
              <label class="toggle-switch" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;">
                <input
                  type="checkbox"
                  class="stage-toggle"
                  data-stage="${stageNum}"
                  ${isEnabled ? "checked" : ""}
                  style="position:absolute; opacity:0; width:0; height:0;"
                />
                <span class="toggle-slider"
                      style="width:46px; height:24px; border-radius:999px; background:${isEnabled ? '#2ecc71' : '#ccc'};
                             position:relative; display:inline-block; transition:all .2s;">
                  <span class="toggle-knob"
                        style="width:20px; height:20px; border-radius:999px; background:white; position:absolute; top:2px;
                               left:${isEnabled ? '24px' : '2px'}; transition:all .2s;"></span>
                </span>

                <span class="toggle-label ${isEnabled ? 'live' : 'disabled'}"
                      style="padding:2px 8px; border-radius:6px; font-size:12px;
                             background:${isEnabled ? '#dff5e7' : '#f8d7da'};
                             color:${isEnabled ? '#1b7f3a' : '#a61b2b'};">
                  ${isEnabled ? "Live" : "Disabled"}
                </span>
              </label>
            </div>
          </div>

          <div class="stage-card-info">
            <div class="stage-info-item">
              <span class="stage-info-label">Solvers</span>
              <span>${solveCount}</span>
            </div>
            <div class="stage-info-item">
              <span class="stage-info-label">Last Updated</span>
              <span>${this.formatTimestamp(stage.updated_at)}</span>
            </div>
            <div class="stage-info-item">
              <span class="stage-info-label">Updated By</span>
              <span>${stage.updated_by || '—'}</span>
            </div>
            <div class="stage-info-item">
              <span class="stage-info-label">Stage Number</span>
              <span>${stageNum}</span>
            </div>
          </div>

          <div class="stage-card-notes">
            <div class="stage-card-notes-label">Notes</div>
            <textarea
              data-stage="${stageNum}"
              placeholder="Add admin notes for this stage..."
            >${stage.notes || ''}</textarea>
            <button
              class="update-notes-btn"
              data-stage="${stageNum}"
              title="Save notes for this stage"
            >
              Update Notes
            </button>
          </div>
        `;

        grid.appendChild(card);
      });

      console.log('[ADMIN] Stage data loaded successfully (${stages.length} stages)');
    } catch (err) {
      console.error('[ADMIN] renderStageGrid exception:', err);
    }
  }

  /**
   * Load all stage data and render
   * @returns {Promise<void>}
   */
  async loadAndRender() {
    try {
      console.log('[ADMIN] Loading stage control data...');
      const stages = await this.fetchStageControl();
      const counts = await this.fetchSolversCounts();
      this.stages = stages;
      this.renderStageGrid(stages, counts);
      this.attachEventHandlers(this.writeLocked); // Pass write lock status
      console.log('[ADMIN] Stage data loaded successfully (16 stages)');
    } catch (err) {
      console.error('[ADMIN] loadAndRender exception:', err);
    }
  }

  /**
   * Update a single stage's enabled status
   * @param {number} stageNum - Stage number (1-16)
   * @param {boolean} enabled - New enabled state
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async updateStageEnabled(stageNum, enabled) {
    try {
      // SAFETY: Hard assert that STAGE_ENV is valid
      if (!this.STAGE_ENV || !['dev', 'prod'].includes(this.STAGE_ENV)) {
        throw new Error(`[ADMIN SAFETY] Invalid STAGE_ENV: '${this.STAGE_ENV}'. Must be 'dev' or 'prod'. This is a critical misconfiguration.`);
      }

      console.log(`[ADMIN] Updating stage ${stageNum} enabled to ${enabled}... (STAGE_ENV=${this.STAGE_ENV})`);

      const now = new Date().toISOString();
      const payload = {
        environment: this.STAGE_ENV,
        stage: stageNum,
        is_enabled: enabled,
        enabled_at: enabled ? now : null,
        disabled_at: !enabled ? now : null,
        updated_at: now,
        updated_by: 'admin_panel'
      };

      console.log('[ADMIN] updateStageEnabled inputs:', { stageNum, enabled, STAGE_ENV: this.STAGE_ENV, hostname: window.location.hostname });
      console.log('[ADMIN] updateStageEnabled payload:', payload);

      console.log('[ADMIN] updateStageEnabled BEFORE upsert', {
        stageNum,
        enabled,
        env: this.STAGE_ENV,
        payload
      });

      let res;
      try {
        res = await this.supabase
          .from('stage_control')
          .upsert(payload, { onConflict: 'environment,stage' })
          .select()
          .single();
      } catch (e) {
        console.error('[ADMIN] updateStageEnabled THROW during upsert:', e);
        return { success: false, error: e.message || String(e) };
      }

      console.log('[ADMIN] updateStageEnabled AFTER upsert', {
        status: res?.status,
        statusText: res?.statusText,
        error: res?.error,
        data: res?.data
      });

      if (res.error) {
        console.error('[ADMIN] updateStageEnabled error:', res.error);
        return { success: false, error: res.error.message };
      }

      // Success: apply UI update for this stage card
      this.applyStageEnabledUI(stageNum, enabled);

      return { success: true, row: res.data };
    } catch (err) {
      console.error(`[ADMIN] updateStageEnabled exception:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update UI for a single stage card (checkbox, pill, styling) after state change
   * @param {number} stageNum - Stage number
   * @param {boolean} enabled - New enabled state
   */
  applyStageEnabledUI(stageNum, enabled) {
    const card = document.querySelector(`[data-stage-card="${stageNum}"]`)
              || document.querySelector(`[data-stage="${stageNum}"]`)
              || document.getElementById(`stage-card-${stageNum}`);

    if (!card) {
      console.warn('[ADMIN] applyStageEnabledUI: card not found for stage', stageNum);
      return;
    }

    // 1) Update checkbox state
    const cb = card.querySelector('input[type="checkbox"][data-stage]');
    if (cb) cb.checked = !!enabled;

    // 2) Update status pill (Live / Disabled)
    const pill =
      card.querySelector('.stage-status') ||
      card.querySelector('.status-pill') ||
      card.querySelector('[data-stage-status]') ||
      card.querySelector('.toggle-label');

    if (pill) {
      pill.textContent = enabled ? 'Live' : 'Disabled';
      pill.classList.toggle('live', !!enabled);
      pill.classList.toggle('disabled', !enabled);
    }

    // 3) Update card styling (border color and classes)
    const borderColor = enabled ? '#4caf50' : '#f48fb1';
    card.style.borderLeft = `4px solid ${borderColor}`;
    card.classList.toggle('stage-disabled', !enabled);
    card.classList.toggle('stage-enabled', !!enabled);

    // 4) Update slider background color if it exists
    const slider = card.querySelector('.toggle-slider');
    if (slider) {
      slider.style.background = enabled ? '#2ecc71' : '#ccc';
    }

    // 5) Update slider knob position if it exists
    const knob = card.querySelector('.toggle-knob');
    if (knob) {
      knob.style.left = enabled ? '24px' : '2px';
    }

    // 6) Update pill background color
    if (pill) {
      pill.style.background = enabled ? '#dff5e7' : '#f8d7da';
      pill.style.color = enabled ? '#1b7f3a' : '#a61b2b';
    }

    console.log(`[ADMIN] applyStageEnabledUI: stage ${stageNum} UI updated to ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update a single stage's notes
   * @param {number} stageNum - Stage number (1-16)
   * @param {string} notes - New notes text
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async updateStageNotes(stageNum, notes) {
    try {
      // SAFETY: Hard assert that STAGE_ENV is valid
      if (!this.STAGE_ENV || !['dev', 'prod'].includes(this.STAGE_ENV)) {
        throw new Error(`[ADMIN SAFETY] Invalid STAGE_ENV: '${this.STAGE_ENV}'. Must be 'dev' or 'prod'. This is a critical misconfiguration.`);
      }

      console.log(`[ADMIN] Updating notes for stage ${stageNum}... (STAGE_ENV=${this.STAGE_ENV})`);

      const now = new Date().toISOString();
      const payload = {
        environment: this.STAGE_ENV,
        stage: stageNum,
        notes: notes,
        updated_at: now,
        updated_by: 'admin_panel'
      };

      const { data, error } = await this.supabase
        .from('stage_control')
        .upsert(payload, { onConflict: 'environment,stage' });

      if (error) {
        console.error(`[ADMIN] updateStageNotes error:`, error);
        return { success: false, error: error.message };
      }

      console.log(`[ADMIN] Notes for stage ${stageNum} updated successfully`);
      return { success: true, error: null };
    } catch (err) {
      console.error(`[ADMIN] updateStageNotes exception:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Batch update multiple stages with same enabled state
   * @param {Array<number>} stageNumbers - Stage numbers to update
   * @param {boolean} enabled - New enabled state
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async bulkUpdateStages(stageNumbers, enabled) {
    try {
      // SAFETY: Hard assert that STAGE_ENV is valid
      if (!this.STAGE_ENV || !['dev', 'prod'].includes(this.STAGE_ENV)) {
        throw new Error(`[ADMIN SAFETY] Invalid STAGE_ENV: '${this.STAGE_ENV}'. Must be 'dev' or 'prod'. This is a critical misconfiguration.`);
      }

      console.log(`[ADMIN] Bulk updating ${stageNumbers.length} stages to enabled=${enabled}... (STAGE_ENV=${this.STAGE_ENV})`);

      const now = new Date().toISOString();
      const payload = stageNumbers.map(stageNum => ({
        environment: this.STAGE_ENV,
        stage: stageNum,
        is_enabled: enabled,
        enabled_at: enabled ? now : null,
        disabled_at: !enabled ? now : null,
        updated_at: now,
        updated_by: 'admin_panel'
      }));

      const { data, error } = await this.supabase
        .from('stage_control')
        .upsert(payload, { onConflict: 'environment,stage' });

      if (error) {
        console.error(`[ADMIN] bulkUpdateStages error:`, error);
        return { success: false, error: error.message };
      }

      console.log(`[ADMIN] Bulk update completed for ${stageNumbers.length} stages`);
      return { success: true, error: null };
    } catch (err) {
      console.error(`[ADMIN] bulkUpdateStages exception:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Wire up event handlers for toggle switches and notes buttons
   * @param {boolean} isLocked - Whether write operations are locked
   */
  attachEventHandlers(isLocked = false) {
    try {
      console.log('[ADMIN] Attaching stage card event handlers... (isLocked=' + isLocked + ')');

      // --- FIX: Define notesButtons early to prevent crash ---
      const stageGridEl = document.getElementById('stageGrid');
      const notesButtons = stageGridEl
        ? stageGridEl.querySelectorAll('button.update-notes-btn, button[data-action="update-notes"]')
        : [];
      console.log('[ADMIN] Found ' + notesButtons.length + ' notes buttons');
      // -------------------------------------------------------

      // ========================================================================
      // STAGE TOGGLE: Bind delegated handler to #stageGrid for checkboxes
      // ========================================================================
      const stageGrid = document.getElementById('stageGrid');
      if (stageGrid && stageGrid.dataset.toggleBound !== '1') {
        stageGrid.dataset.toggleBound = '1';
        console.log('[ADMIN] Binding delegated toggle handler to #stageGrid (first time)');
        
        stageGrid.addEventListener('change', async (e) => {
          const el = e.target;

          // Only react to the checkbox we render
          if (!(el instanceof HTMLInputElement)) return;
          if (el.type !== 'checkbox') return;
          if (!el.dataset || !el.dataset.stage) return;

          const stageNum = parseInt(el.dataset.stage, 10);
          const enabled = !!el.checked;

          console.log(`[ADMIN] Toggle change captured: stage ${stageNum} => ${enabled}`);

          if (isLocked) {
            showStatusMessage('✗ Write locked: Localhost pointing at production.');
            el.checked = !enabled; // revert
            return;
          }

          // Guard: prevent double-clicks while saving
          if (el.dataset.saving === '1') {
            console.log(`[ADMIN] Stage ${stageNum} already saving, ignoring click`);
            return;
          }

          const previousState = !enabled; // Store the previous state for rollback

          try {
            // Mark as saving to prevent double-clicks
            el.dataset.saving = '1';
            el.disabled = true;

            showStatusMessage(`Updating stage ${stageNum}...`);
            
            // Perform database update
            const result = await this.updateStageEnabled(stageNum, enabled);

            if (result.success) {
              console.log(`[ADMIN] Stage ${stageNum} update successful`);
              console.log("[ADMIN] updateStageEnabled success — UI state preserved");
              showStatusMessage(`✓ Stage ${stageNum} ${enabled ? 'enabled' : 'disabled'}`);
            } else {
              console.error(`[ADMIN] Update failed: ${result.error}`);
              showStatusMessage(`✗ Error: ${result.error}`);
              // Revert checkbox on failure
              el.checked = previousState;
            }
          } catch (err) {
            console.error('[ADMIN] Toggle handler error:', err);
            showStatusMessage(`✗ Error: ${err.message}`);
            // Rollback UI so it doesn't lie
            el.checked = previousState;
          } finally {
            // ALWAYS clear saving flag and re-enable, even on error
            el.dataset.saving = '0';
            el.disabled = false;
            console.log(`[ADMIN] Toggle ${stageNum} unlocked (saving flag cleared)`);
          }
        });

        console.log('[ADMIN] Delegated toggle handler bound to #stageGrid');
      } else if (stageGrid && stageGrid.dataset.toggleBound === '1') {
        console.log('[ADMIN] Toggle handler already bound, skipping duplicate bind');
      } else {
        console.warn('[ADMIN] #stageGrid not found, cannot bind toggle handler');
      }

      // Apply isLocked styling to all toggles (disable the checkboxes and the labels)
      if (isLocked) {
        const toggles = document.querySelectorAll('input.stage-toggle[type="checkbox"]');
        toggles.forEach(toggle => {
          toggle.disabled = true;
        });
        
        const labels = document.querySelectorAll('label.toggle-switch');
        labels.forEach(label => {
          label.style.cursor = 'not-allowed';
          label.style.opacity = '0.5';
          label.title = 'Write operations locked. Check banner above.';
        });
      }

      // ========================================================================
      // NOTES BUTTONS: Bind individually (or use delegation if preferred)
      // ========================================================================
      if (notesButtons && notesButtons.length > 0) {
        notesButtons.forEach(button => {
          // Guard: prevent duplicate event listeners
          if (button.dataset.bound === '1') {
            return;
          }
          button.dataset.bound = '1';

        if (isLocked) {
          button.disabled = true;
          button.style.cursor = 'not-allowed';
          button.style.opacity = '0.5';
          button.title = 'Write operations locked. Check banner above.';
        }

        button.addEventListener('click', async (e) => {
          e.preventDefault();
          
          if (isLocked) {
            showStatusMessage('✗ Write locked: Localhost pointing at production.');
            return;
          }
          
          const stageNum = parseInt(button.dataset.stage);
          const textarea = document.querySelector(`textarea[data-stage="${stageNum}"]`);
          const notes = textarea ? textarea.value.trim() : '';

          showStatusMessage(`Saving notes for stage ${stageNum}...`);
          const result = await this.updateStageNotes(stageNum, notes);

          if (result.success) {
            showStatusMessage(`✓ Notes saved for stage ${stageNum}`);
          } else {
            showStatusMessage(`✗ Error saving notes: ${result.error}`);
          }
        });
      });
      } else {
        console.log('[ADMIN] No notes buttons found or notesButtons is empty');
      }

      console.log('[ADMIN] Event handlers attached successfully');
    } catch (err) {
      console.error('[ADMIN] attachEventHandlers exception:', err);
    }
  }
}

// Export singleton instance
const stageControl = new StageControlModule(adminApp);

/**
 * Shows a status message at the top of the page
 * Auto-dismisses after 4 seconds or when new message arrives
 * @param {string} message - Message to display
 */
function showStatusMessage(message) {
  let statusDiv = document.getElementById('status-message');

  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'status-message';
    statusDiv.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #e8f4f8;
      border-left: 4px solid #0288d1;
      padding: 12px 16px;
      border-radius: 2px;
      color: #01579b;
      font-size: 13px;
      font-family: system-ui, -apple-system, sans-serif;
      z-index: 1000;
      max-width: 90%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    document.body.appendChild(statusDiv);
  }

  statusDiv.textContent = message;
  statusDiv.style.display = 'block';

  // Auto-dismiss after 4 seconds
  if (statusDiv.dismissTimeout) {
    clearTimeout(statusDiv.dismissTimeout);
  }
  statusDiv.dismissTimeout = setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 4000);
}

/**
 * Sets a status message that persists and never clears unless explicitly updated
 * @param {string} text - The status message to display
 */
function setStatus(text) {
  let statusDiv = document.getElementById('status');
  
  // Create #status div if it doesn't exist
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'status';
    statusDiv.style.cssText = `
      background-color: #e8f4f8;
      border-left: 4px solid #0288d1;
      padding: 12px 16px;
      margin-bottom: 16px;
      border-radius: 2px;
      color: #01579b;
      font-size: 13px;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    // Insert at the top of the page
    const main = document.querySelector('main');
    if (main) {
      main.insertBefore(statusDiv, main.firstChild);
    }
  }
  
  // Update status text (never clears unless explicitly changed)
  statusDiv.textContent = text;
}

/**
 * Locate DOM containers robustly with fallbacks
 * Returns { loginForm, loginContainer, appContainer }
 */
function getContainers() {
  const loginForm = document.getElementById('admin-login-form') 
    || document.querySelector('#admin-login-form');

  const appContainer =
    document.getElementById('adminAppView') ||
    document.getElementById('adminApp') ||
    document.getElementById('app') ||
    document.querySelector('[data-admin-app]') ||
    document.querySelector('#adminAppContainer');

  const loginContainer =
    document.getElementById('adminLoginView') ||
    document.getElementById('adminLoginContainer') ||
    document.querySelector('[data-admin-login]') ||
    (loginForm ? loginForm.closest('.admin-login-container') : null);

  console.log('[ADMIN] getContainers():', {
    loginForm: !!loginForm,
    loginContainer: loginContainer?.id || 'not-found',
    appContainer: appContainer?.id || 'not-found'
  });

  return { loginForm, loginContainer, appContainer };
}

/**
 * Show login view - hide admin view
 * Clean show/hide pattern, no DOM rebuilding
 */
function showLoginView() {
  console.log('[ADMIN] showLoginView()');
  const { loginContainer, appContainer } = getContainers();
  
  if (loginContainer) {
    loginContainer.style.display = 'block';
    loginContainer.removeAttribute('aria-hidden');
  }
  if (appContainer) {
    appContainer.style.display = 'none';
    appContainer.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Show admin view - hide login view
 * Clean show/hide pattern, no DOM rebuilding
 */
function showAdminView() {
  console.log('[ADMIN] showAdminView()');
  const { loginContainer, appContainer } = getContainers();
  
  if (loginContainer) {
    loginContainer.style.display = 'none';
    loginContainer.setAttribute('aria-hidden', 'true');
  }
  if (appContainer) {
    appContainer.style.display = 'block';
    appContainer.removeAttribute('aria-hidden');
  }
}

/**
 * Enter signed-out state: clear session and show login form
 * Uses existing #adminLoginView container from HTML
 * IMPORTANT: Do NOT load any admin data in this function
 */
function enterSignedOutState() {
  console.log('[ADMIN] enterSignedOutState()');
  
  // Guard: If session exists, do NOT show login UI
  if (window.UI_MODE === 'signed_in') {
    console.warn('[ADMIN] enterSignedOutState blocked: already signed in');
    return;
  }
  
  setUIMode('signed_out');
  CURRENT_SESSION = null;
  
  // Show login view, hide app view
  showLoginView();
  
  // Wire the login form that's already in the HTML
  wireLoginForm();
}

/**
 * Enter signed-in state: set session and render dashboard + load data
 * Uses existing #adminAppView container from HTML
 * SIMPLIFIED: Just show the admin view (no DOM creation/detection)
 * @param {object} session - Supabase session object
 */
async function enterSignedInState(session) {
  // Guard: prevent duplicate re-init loops from auth listener
  if (window.__ADMIN_BOOTED__) {
    console.log("[ADMIN] enterSignedInState(): already booted, skipping re-init");
    return;
  }
  if (window.__ADMIN_BOOTING__) {
    console.log("[ADMIN] enterSignedInState(): boot already in progress, skipping");
    return;
  }
  window.__ADMIN_BOOTING__ = true;

  try {
    console.log('[ADMIN] enterSignedInState() DOM check start');
    
    const { appContainer, loginContainer } = getContainers();
    console.log('[ADMIN] enterSignedInState() using appContainer id =', appContainer?.id);
    
    if (!appContainer) {
      console.error('[ADMIN] ERROR: No admin app container found. Admin UI cannot render.');
      setStatus('Error: Admin container not found.');
      return;
    }
    
    // Show admin view, hide login view
    showAdminView();
    
    setUIMode('signed_in');
    CURRENT_SESSION = session;
    
    // Check admin access first
    const adminAccess = await checkAdminAccess();
    if (!adminAccess) {
      setStatus('Not authorized. You do not have admin access.');
      console.log('[ADMIN] Access denied - signing out');
      setTimeout(async () => {
        await supabase.auth.signOut();
      }, 2000);
      return;
    }
    
    setStatus('Access granted.');
    const userEmail = session?.user?.email || 'Unknown';
    
    // Render dashboard shell into existing appContainer
    if (appContainer) {
      renderAdminShell(appContainer, userEmail);
    }
    
    // Then load admin data
    await initializeAdminData();

    // Mark boot complete
    window.__ADMIN_BOOTED__ = true;
    window.__ADMIN_BOOTING__ = false;
    console.log('[ADMIN] enterSignedInState() boot complete');
  } catch (err) {
    console.error('[ADMIN] enterSignedInState() error:', err);
    window.__ADMIN_BOOTING__ = false;
  }
}

/**
 * Initialize admin dashboard data (stage control, solver counts, etc.)
 * GUARD: Only runs if session exists and UI_MODE is signed_in
 */
async function initializeAdminData() {
  if (!CURRENT_SESSION) {
    console.warn('[ADMIN] Blocked initializeAdminData: no session');
    return;
  }
  if (UI_MODE !== 'signed_in') {
    console.warn('[ADMIN] Blocked initializeAdminData: UI_MODE', UI_MODE);
    return;
  }
  
  console.log('[ADMIN] initializeAdminData()');
  // Data loading will happen when user clicks Stage Control tab
}

/**
 * Sets up auth state change listener
 * Automatically re-renders UI based on auth events
 */
function setupAuthStateListener() {
  // Unsubscribe from previous listener if it exists
  if (AUTH_UNSUB) {
    AUTH_UNSUB();
    console.log('[ADMIN] Previous auth listener unsubscribed');
  }
  
  AUTH_UNSUB = supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('[ADMIN] Auth state changed:', event, 'session:', !!session);

    // Only init on SIGNED_IN or INITIAL_SESSION, and only if not already booted
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
      if (!window.__ADMIN_BOOTED__ && !window.__ADMIN_BOOTING__) {
        console.log('[ADMIN] Auth listener: session exists, initializing signed-in state');
        window.UI_MODE = 'signed_in';
        setUIMode('signed_in');
        await enterSignedInState(session);
      } else {
        console.log('[ADMIN] Auth event:', event, 'session ok; already booted -> no re-init');
      }
    } else if (!session) {
      console.log('[ADMIN] Auth listener: no session, entering signed-out state');
      window.UI_MODE = 'signed_out';
      setUIMode('signed_out');
      await enterSignedOutState();
    }
  });
}

/**
 * Hard sign-out for admin: clear auth, storage, and reload
 */
async function hardAdminSignOut() {
  console.log('[ADMIN] hardAdminSignOut initiated');
  
  try {
    // Step 1: Sign out from Supabase
    try {
      await supabase.auth.signOut();
      console.log('[ADMIN] supabase.auth.signOut() complete');
    } catch (err) {
      console.error('[ADMIN] Error during supabase.auth.signOut():', err);
    }

    // Step 2: Clear storage
    console.log('[ADMIN] clearing storage');
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('[ADMIN] Error clearing storage:', e);
    }

    // Step 3: Reset boot flags so re-login will re-initialize
    window.__ADMIN_BOOTED__ = false;
    window.__ADMIN_BOOTING__ = false;
    console.log('[ADMIN] boot flags reset for re-login');

    // Step 4: Return to signed-out state (show login view)
    console.log('[ADMIN] entering signed-out state');
    enterSignedOutState();
  } catch (err) {
    console.error('[ADMIN] Unexpected error in hardAdminSignOut:', err);
    enterSignedOutState();
  }
}

/**
 * Checks if the current user has admin access
 * Queries public.admin_emails table with exact email match
 * @returns {Promise<boolean>} - true if admin, false otherwise
 */
async function checkAdminAccess() {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user || !user.email) {
      console.error('[ADMIN] No authenticated user', userError);
      return false;
    }

    const userEmail = user.email;
    console.log(`[ADMIN] user email: ${userEmail}`);

    // Query admin_emails table for exact email match
    const { data: adminEmails, error: queryError } = await supabase
      .from('admin_emails')
      .select('email')
      .eq('email', userEmail)
      .maybeSingle();

    if (queryError) {
      console.error('[ADMIN] Query error:', queryError);
      return false;
    }

    // maybeSingle() returns null if no rows, not an error
    if (!adminEmails) {
      console.log(`[ADMIN] authorized: false (user ${userEmail} not in admin list)`);
      return false;
    }

    console.log(`[ADMIN] authorized: true (user ${userEmail} found in admin_emails)`);
    return true;
  } catch (error) {
    console.error('[ADMIN] Unexpected error:', error);
    return false;
  }
}

/**
 * Wires the login form submit handler
 * Called via requestAnimationFrame to ensure DOM is ready
 */
function wireLoginForm() {
  const form = document.getElementById('admin-login-form');
  
  // Debug: log form detection info
  console.log('[ADMIN] wireLoginForm debug:', {
    formViaDOMId: !!form,
    formViaCSSSelector: !!document.querySelector('#admin-login-form')
  });
  
  if (!form) {
    console.warn('[ADMIN] wireLoginForm: form not found via getElementById', {
      hasForm: false,
      idsPresent: !!document.querySelector('#admin-login-form')
    });
    return;
  }

  // Prevent double-wiring
  if (form.dataset.wired === '1') {
    console.log('[ADMIN] Form already wired, skipping');
    return;
  }

  // Mark as wired
  form.dataset.wired = '1';

  // Attach submit handler to form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = form.querySelector('input[type="email"]').value;
    const password = form.querySelector('input[type="password"]').value;

    if (!email || !password) {
      setStatus('Email and password are required.');
      return;
    }

    setStatus('Signing in…');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('Login error:', error);
        setStatus(`Login failed: ${error.message}`);
        return;
      }

      if (!data.user) {
        setStatus('Login failed: No user returned.');
        return;
      }

      setStatus('Verifying admin access…');

      // Check if user is admin
      const adminStatus = await checkAdminAccess();
      if (!adminStatus) {
        setStatus('Not authorized. You do not have admin access.');
        console.log('[ADMIN] Login rejected - user not authorized');
        
        // Sign out after 2 seconds
        setTimeout(async () => {
          await supabase.auth.signOut();
          // Auth listener will handle state change
        }, 2000);
        
        return;
      }

      setStatus('Access granted. Loading dashboard…');

      // Auth listener will handle session state change and call enterSignedInState
      // Just wait for that to occur
    } catch (error) {
      console.error('Unexpected login error:', error);
      setStatus(`Unexpected error: ${error.message}`);
    }
  });

  console.log('[ADMIN] Login form handlers wired successfully');
}

/**
 * Renders the login form overlay
 */
/**
 * DISABLED: Overlay login form
 * We now use the existing #adminLoginView container from HTML instead
 * This function is kept for reference but should NOT be called
 */
function renderLoginForm() {
  console.warn('[ADMIN] renderLoginForm (overlay) called - but we use #adminLoginView now. This should not be called.');
  // Function disabled - do not append to document.body
}

/**
 * Renders the admin shell with tab navigation and sign out button
 * Writes to the provided container instead of #app
 * @param {Element} container - Container element to render into
 * @param {string} userEmail - The logged-in user's email
 */
function renderAdminShell(container, userEmail) {
  // Guard: Only render dashboard when signed in
  if (UI_MODE !== 'signed_in') {
    console.warn('[ADMIN] Blocked renderAdminShell: UI_MODE', UI_MODE);
    return;
  }

  if (!container) {
    console.warn('[ADMIN] renderAdminShell: no container provided');
    return;
  }

  const tabs = [
    { id: 'stage-control', label: 'Stage Control' },
    { id: 'stage-answers', label: 'Stage Answers' },
    { id: 'users', label: 'Users' },
    { id: 'test-users', label: 'Test Users' }
  ];

  // Render shell with tabs and sign out button
  container.innerHTML = `
    <div style="font-family: system-ui, -apple-system, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #ddd; padding-bottom: 10px;">
        <h1 style="margin: 0;">Admin Dashboard</h1>
        <div style="display: flex; align-items: center; gap: 16px;">
          <span style="color: #666; font-size: 14px;">${userEmail}</span>
          <button
            id="admin-signout-btn"
            style="
              background: #f44336;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 13px;
              transition: background 0.2s;
            "
            onmouseover="this.style.background='#d32f2f'"
            onmouseout="this.style.background='#f44336'"
          >
            Sign out
          </button>
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd;">
        ${tabs.map(tab => `
          <button 
            class="admin-tab"
            data-tab-id="${tab.id}"
            style="
              padding: 10px 20px;
              background: none;
              border: none;
              border-bottom: 3px solid transparent;
              cursor: pointer;
              font-size: 14px;
              color: #666;
              transition: all 0.2s;
            "
          >
            ${tab.label}
          </button>
        `).join('')}
      </div>

      <div id="admin-content" style="padding: 20px; background: #f9f9f9; border-radius: 4px; min-height: 300px;">
        <!-- Tab content will be injected here -->
      </div>
    </div>
  `;

  // Attach sign out handler
  const signoutBtn = container.querySelector('#admin-signout-btn');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', hardAdminSignOut);
  }

  // Add tab click handlers
  const tabButtons = container.querySelectorAll('.admin-tab');
  tabButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const tabId = button.dataset.tabId;
      await renderTabContent(tabId);
      
      // Update active tab styling
      tabButtons.forEach(b => {
        b.style.color = '#666';
        b.style.borderBottomColor = 'transparent';
      });
      button.style.color = '#2196f3';
      button.style.borderBottomColor = '#2196f3';
    });
  });

  // Render first tab by default
  if (tabButtons.length > 0) {
    tabButtons[0].click();
  }
}

/**
 * Renders content for a specific tab
 * @param {string} tabId - The tab identifier
 */
async function renderTabContent(tabId) {
  // Guard: Prevent data loading if not signed in
  if (!CURRENT_SESSION) {
    console.warn('[ADMIN] renderTabContent blocked: no active session');
    return;
  }

  const contentContainer = document.getElementById('admin-content');
  if (!contentContainer) return;

  const tabLabels = {
    'stage-control': 'Stage Control',
    'stage-answers': 'Stage Answers',
    'users': 'Users',
    'test-users': 'Test Users'
  };

  // Handle Stage Control tab specially
  if (tabId === 'stage-control') {
    const isLocked = !stageControl.isWriteAllowed();
    const lockMessage = stageControl.getLockMessage();
    const lockBannerHtml = isLocked ? `
      <div style="
        background-color: #fff3cd;
        border-left: 4px solid #ff6b6b;
        padding: 12px 16px;
        margin-bottom: 16px;
        border-radius: 2px;
        color: #ff0000;
        font-size: 13px;
        font-weight: 600;
      ">
        ⚠️ ${lockMessage}
      </div>
    ` : '';

    const content = `
      <div style="margin-bottom: 20px;">
        <h2 style="margin: 0 0 16px 0;">Stage Control</h2>
        
        ${lockBannerHtml}
        
        <!-- Bulk Operations Bar -->
        <div style="display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;">
          <button id="btnEnableAll" style="
            background: #4caf50;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: ${isLocked ? 'not-allowed' : 'pointer'};
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
            opacity: ${isLocked ? '0.5' : '1'};
          " onmouseover="this.style.background='${isLocked ? '#4caf50' : '#45a049'}'" onmouseout="this.style.background='#4caf50'" ${isLocked ? 'disabled' : ''}>
            Enable All Stages
          </button>
          <button id="btnDisableAll" style="
            background: #f44336;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: ${isLocked ? 'not-allowed' : 'pointer'};
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
            opacity: ${isLocked ? '0.5' : '1'};
          " onmouseover="this.style.background='${isLocked ? '#f44336' : '#d32f2f'}'" onmouseout="this.style.background='#f44336'" ${isLocked ? 'disabled' : ''}>
            Disable All Stages
          </button>
          <button id="btnEnable1to5" style="
            background: #2196f3;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: ${isLocked ? 'not-allowed' : 'pointer'};
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
            opacity: ${isLocked ? '0.5' : '1'};
          " onmouseover="this.style.background='${isLocked ? '#2196f3' : '#0b7dda'}'" onmouseout="this.style.background='#2196f3'" ${isLocked ? 'disabled' : ''}>
            Enable 1–5
          </button>
          <button id="btnDisable6to16" style="
            background: #ff9800;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: ${isLocked ? 'not-allowed' : 'pointer'};
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
            opacity: ${isLocked ? '0.5' : '1'};
          " onmouseover="this.style.background='${isLocked ? '#ff9800' : '#e68900'}'" onmouseout="this.style.background='#ff9800'" ${isLocked ? 'disabled' : ''}>
            Disable 6–16
          </button>
          <button id="btnRefreshStages" style="
            background: #666;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
          " onmouseover="this.style.background='#555'" onmouseout="this.style.background='#666'">
            Refresh Data
          </button>
        </div>

        <!-- Stage Grid -->
        <div id="stageGrid" style="
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 16px;
        ">
          <!-- Stages will be rendered here -->
        </div>
      </div>
    `;

    contentContainer.innerHTML = content;

    // Load and render stage data
    showStatusMessage('Loading stages…');
    await stageControl.loadAndRender();
    
    // Pass lock status to event handler attachment
    stageControl.attachEventHandlers(isLocked);

    // Wire up bulk operation buttons
    document.getElementById('btnEnableAll')?.addEventListener('click', async () => {
      if (!stageControl.isWriteAllowed()) {
        showStatusMessage('✗ Write locked: Localhost pointing at production.');
        return;
      }
      showStatusMessage('Enabling all stages...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], true);
      if (result.success) {
        showStatusMessage('✓ All stages enabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers(stageControl.writeLocked)), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnDisableAll')?.addEventListener('click', async () => {
      if (!stageControl.isWriteAllowed()) {
        showStatusMessage('✗ Write locked: Localhost pointing at production.');
        return;
      }
      showStatusMessage('Disabling all stages...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], false);
      if (result.success) {
        showStatusMessage('✓ All stages disabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers(stageControl.writeLocked)), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnEnable1to5')?.addEventListener('click', async () => {
      if (!stageControl.isWriteAllowed()) {
        showStatusMessage('✗ Write locked: Localhost pointing at production.');
        return;
      }
      showStatusMessage('Enabling stages 1–5...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5], true);
      if (result.success) {
        showStatusMessage('✓ Stages 1–5 enabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers(stageControl.writeLocked)), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnDisable6to16')?.addEventListener('click', async () => {
      if (!stageControl.isWriteAllowed()) {
        showStatusMessage('✗ Write locked: Localhost pointing at production.');
        return;
      }
      showStatusMessage('Disabling stages 6–16...');
      const result = await stageControl.bulkUpdateStages([6,7,8,9,10,11,12,13,14,15,16], false);
      if (result.success) {
        showStatusMessage('✓ Stages 6–16 disabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers(stageControl.writeLocked)), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnRefreshStages')?.addEventListener('click', async () => {
      showStatusMessage('Refreshing stage data...');
      await stageControl.loadAndRender();
      stageControl.attachEventHandlers(stageControl.writeLocked);
      showStatusMessage('✓ Refresh complete');
    });

    return;
  }

  // Other tabs - placeholder content
  const content = `
    <h2>${tabLabels[tabId]}</h2>
    <p style="color: #666; margin-top: 10px;">Placeholder for ${tabLabels[tabId]} panel</p>
    <p style="color: #999; font-size: 12px; margin-top: 10px;">[Content to be implemented]</p>
  `;

  contentContainer.innerHTML = content;
}

async function initAdmin() {
  console.log('[ADMIN] AdminApp initialize called');
  
  try {
    // Wire sign-out button once at startup
    const adminSignOutBtn = document.getElementById('btnAdminSignOut');
    if (adminSignOutBtn) {
      adminSignOutBtn.addEventListener('click', hardAdminSignOut);
      console.log('[ADMIN] hardAdminSignOut handler wired to #btnAdminSignOut');
    } else {
      console.warn('[ADMIN] #btnAdminSignOut not found in DOM');
    }

    setStatus('Checking session…');

    // --- BOOTSTRAP AUTH STATE ON PAGE LOAD ---
    // IMPORTANT: Explicit session check on load before showing login
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    console.log('[ADMIN] Bootstrap: getSession on load:', { error: sessionError, session: !!session });

    if (sessionError) {
      console.warn('[ADMIN] getSession error:', sessionError);
    }

    if (session) {
      // Session exists - enter signed-in state
      console.log('[ADMIN] Session exists on load, entering signed-in state');
      window.UI_MODE = 'signed_in';
      setUIMode('signed_in');
      await enterSignedInState(session);
    } else {
      // No session - show login form
      console.log('[ADMIN] No session on load, showing login');
      window.UI_MODE = 'signed_out';
      setUIMode('signed_out');
      showLoginView();
      wireLoginForm();
    }

    // Set up auth listener to handle state changes
    // (but it should not fight the bootstrap above)
    setupAuthStateListener();
  } catch (error) {
    console.error('[ADMIN] Admin init error:', error);
    setStatus('Error initializing admin panel.');
    window.UI_MODE = 'signed_out';
    setUIMode('signed_out');
    showLoginView();
  }
}

// ============================================================================
// BOOTSTRAP: Initialize admin app when DOM is ready
// ============================================================================
// GUARD: Only initialize if in admin.html context
if (isAdminContext()) {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      console.log('[ADMIN] DOMContentLoaded: Starting admin initialization');
      initAdmin();
    } catch (e) {
      console.error('[ADMIN] DOMContentLoaded crash:', e);
      setStatus('Fatal error: Admin initialization failed.');
    }
  });
}
