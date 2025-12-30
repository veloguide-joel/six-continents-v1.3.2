// Admin Dashboard Entry Point
// IMPORTANT: This module is only intended to be loaded by admin.html
// It will not interfere with non-admin pages and does not register global listeners
import { supabase } from './supabase-config.js';

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
   */
  showLoginView() {
    console.log('[ADMIN] showLoginView');
    const loginView = document.getElementById('adminLoginView');
    const appView = document.getElementById('adminAppView');

    if (loginView) loginView.style.display = 'block';
    if (appView) appView.style.display = 'none';
  }

  /**
   * Show app view, hide login view
   * @param {string} userEmail - Authenticated user email
   */
  showAppView(userEmail) {
    console.log('[ADMIN] showAppView:', userEmail);
    const loginView = document.getElementById('adminLoginView');
    const appView = document.getElementById('adminAppView');

    if (loginView) loginView.style.display = 'none';
    if (appView) appView.style.display = 'block';

    // Optional: Update UI with user email
    const userDisplay = document.getElementById('adminUserEmail');
    if (userDisplay) {
      userDisplay.textContent = userEmail;
    }
  }

  /**
   * Show access denied view
   * @param {string} userEmail - User email that was denied access
   */
  showAccessDeniedView(userEmail) {
    console.log('[ADMIN] showAccessDeniedView:', userEmail);
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
          // Auth state change will trigger re-render
        });
      }
    }

    if (appView) appView.style.display = 'none';
  }

  /**
   * Show error view
   * @param {string} message - Error message
   */
  showErrorView(message) {
    console.log('[ADMIN] showErrorView:', message);
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
    console.log('[ADMIN] StageControlModule initialized');
  }

  /**
   * Fetch stage control data from public.stage_control table
   * Creates default entries for missing stages
   * @returns {Promise<Array>} - Array of stage objects [1..16]
   */
  async fetchStageControl() {
    try {
      console.log('[ADMIN] Fetching stage control data...');

      // Fetch all stage control records
      const { data: stageRecords, error } = await this.supabase
        .from('stage_control')
        .select('stage, is_enabled, notes, updated_at, updated_by')
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

      // Fetch all solves for riddle 1 (canonical solve indicator)
      const { data: solves, error } = await this.supabase
        .from('solves')
        .select('stage, riddle_number')
        .eq('riddle_number', 1);

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
        card.style.borderLeft = `4px solid ${borderColor}`;
        card.innerHTML = `
          <div class="stage-card-header">
            <div class="stage-card-title">Stage ${stageNum}</div>
            <div class="stage-card-toggle">
              <button
                class="toggle-switch ${isEnabled ? 'enabled' : ''}"
                data-stage="${stageNum}"
                data-enabled="${isEnabled}"
                title="Toggle stage enabled/disabled"
              ></button>
              <span class="stage-status ${statusClass}">${statusText}</span>
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
      this.renderStageGrid(stages, counts);
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
      console.log(`[ADMIN] Updating stage ${stageNum} enabled to ${enabled}...`);

      const now = new Date().toISOString();
      const payload = {
        is_enabled: enabled,
        enabled_at: enabled ? now : null,
        disabled_at: !enabled ? now : null,
        updated_at: now,
        updated_by: 'admin_panel'
      };

      const { data, error } = await this.supabase
        .from('stage_control')
        .update(payload)
        .eq('stage', stageNum);

      if (error) {
        console.error(`[ADMIN] updateStageEnabled error:`, error);
        return { success: false, error: error.message };
      }

      console.log(`[ADMIN] Stage ${stageNum} updated successfully`);
      return { success: true, error: null };
    } catch (err) {
      console.error(`[ADMIN] updateStageEnabled exception:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Update a single stage's notes
   * @param {number} stageNum - Stage number (1-16)
   * @param {string} notes - New notes text
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async updateStageNotes(stageNum, notes) {
    try {
      console.log(`[ADMIN] Updating notes for stage ${stageNum}...`);

      const now = new Date().toISOString();
      const payload = {
        stage: stageNum,
        notes: notes,
        updated_at: now,
        updated_by: 'admin_panel'
      };

      const { data, error } = await this.supabase
        .from('stage_control')
        .upsert([payload], { onConflict: 'stage' });

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
      console.log(`[ADMIN] Bulk updating ${stageNumbers.length} stages to enabled=${enabled}...`);

      const now = new Date().toISOString();
      const payload = stageNumbers.map(stageNum => ({
        stage: stageNum,
        is_enabled: enabled,
        enabled_at: enabled ? now : null,
        disabled_at: !enabled ? now : null,
        updated_at: now,
        updated_by: 'admin_panel'
      }));

      const { data, error } = await this.supabase
        .from('stage_control')
        .upsert(payload, { onConflict: 'stage' });

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
   */
  attachEventHandlers() {
    try {
      console.log('[ADMIN] Attaching stage card event handlers...');

      // Toggle switches
      const toggles = document.querySelectorAll('.toggle-switch');
      toggles.forEach(toggle => {
        toggle.addEventListener('click', async (e) => {
          e.preventDefault();
          const stageNum = parseInt(toggle.dataset.stage);
          const currentEnabled = toggle.dataset.enabled === 'true';
          const newEnabled = !currentEnabled;

          // Find the card and UI elements
          const card = document.getElementById(`stage-card-${stageNum}`);
          if (!card) {
            console.warn(`[ADMIN] Card not found for stage ${stageNum}`);
            return;
          }

          const badge = card.querySelector('.stage-status');
          const previousEnabled = currentEnabled;

          try {
            // Step 1: Optimistic UI update - immediately show new state
            console.log(`[ADMIN] Optimistic update: stage ${stageNum} to ${newEnabled}`);
            toggle.disabled = true;
            toggle.dataset.enabled = newEnabled;
            toggle.classList.toggle('enabled', newEnabled);

            if (badge) {
              const newStatusText = newEnabled ? 'Live' : 'Disabled';
              const newStatusClass = newEnabled ? 'live' : 'disabled';
              badge.textContent = newStatusText;
              badge.className = `stage-status ${newStatusClass}`;
            }

            // Update card border color
            const newBorderColor = newEnabled ? '#4caf50' : '#f48fb1';
            card.style.borderLeft = `4px solid ${newBorderColor}`;

            showStatusMessage(`Updating stage ${stageNum}...`);

            // Step 2: Perform database update
            const result = await this.updateStageEnabled(stageNum, newEnabled);

            // Step 3: Handle result
            if (result.success) {
              console.log(`[ADMIN] Stage ${stageNum} update successful`);
              showStatusMessage(`✓ Stage ${stageNum} ${newEnabled ? 'enabled' : 'disabled'}`);
              toggle.disabled = false;
            } else {
              // Revert on failure
              console.error(`[ADMIN] Update failed, reverting stage ${stageNum}`);
              toggle.disabled = false;
              toggle.dataset.enabled = previousEnabled;
              toggle.classList.toggle('enabled', previousEnabled);

              if (badge) {
                const revertStatusText = previousEnabled ? 'Live' : 'Disabled';
                const revertStatusClass = previousEnabled ? 'live' : 'disabled';
                badge.textContent = revertStatusText;
                badge.className = `stage-status ${revertStatusClass}`;
              }

              const revertBorderColor = previousEnabled ? '#4caf50' : '#f48fb1';
              card.style.borderLeft = `4px solid ${revertBorderColor}`;

              showStatusMessage(`✗ Error: ${result.error}`);
            }
          } catch (handlerErr) {
            console.error(`[ADMIN] Toggle handler exception:`, handlerErr);
            // Revert on exception
            toggle.disabled = false;
            toggle.dataset.enabled = previousEnabled;
            toggle.classList.toggle('enabled', previousEnabled);
            if (badge) {
              const revertStatusText = previousEnabled ? 'Live' : 'Disabled';
              const revertStatusClass = previousEnabled ? 'live' : 'disabled';
              badge.textContent = revertStatusText;
              badge.className = `stage-status ${revertStatusClass}`;
            }
            const revertBorderColor = previousEnabled ? '#4caf50' : '#f48fb1';
            card.style.borderLeft = `4px solid ${revertBorderColor}`;
            showStatusMessage(`✗ Error: ${handlerErr.message}`);
          }
        });
      });

      // Notes update buttons
      const notesButtons = document.querySelectorAll('.update-notes-btn');
      notesButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
          e.preventDefault();
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
 * Sets up auth state change listener
 * Automatically re-renders UI based on auth events
 */
function setupAuthStateListener() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state changed:', event);

    if (event === 'SIGNED_IN' && session) {
      // User just signed in - verify admin access and render dashboard
      const adminAccess = await checkAdminAccess();
      
      if (adminAccess) {
        setStatus('Access granted.');
        const userEmail = session.user?.email || 'Unknown';
        renderAdminShell(userEmail);
      } else {
        // Not admin - deny access and sign out immediately
        setStatus('Not authorized. You do not have admin access.');
        console.log('[ADMIN] Access denied - signing out');
        
        setTimeout(async () => {
          await supabase.auth.signOut();
          // SIGNED_OUT event will be triggered and handled below
        }, 2000);
      }
    } else if (event === 'SIGNED_OUT') {
      // User signed out - render login form
      setStatus('');
      renderLoginForm();
    }
  });
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
 * Renders the login form and attaches event handlers
 */
function renderLoginForm() {
  setStatus('');
  
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  // The HTML form is already in admin.html, just attach handlers
  const form = document.getElementById('admin-login-form');
  if (!form) {
    console.warn('renderLoginForm: #admin-login-form not found in DOM');
    return;
  }

  // Clear any previous handlers by cloning
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  // Attach submit handler
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = newForm.querySelector('#admin-email').value;
    const password = newForm.querySelector('#admin-password').value;

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
          renderLoginForm();
        }, 2000);
        
        return;
      }

      setStatus('Access granted. Loading dashboard…');

      // Render dashboard
      renderAdminShell(data.user.email);
    } catch (error) {
      console.error('Unexpected login error:', error);
      setStatus(`Unexpected error: ${error.message}`);
    }
  });
}

/**
 * Renders the admin shell with tab navigation and sign out button
 * @param {string} userEmail - The logged-in user's email
 */
function renderAdminShell(userEmail) {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const tabs = [
    { id: 'stage-control', label: 'Stage Control' },
    { id: 'stage-answers', label: 'Stage Answers' },
    { id: 'users', label: 'Users' },
    { id: 'test-users', label: 'Test Users' }
  ];

  // Render shell with tabs and sign out button
  appContainer.innerHTML = `
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
  const signoutBtn = appContainer.querySelector('#admin-signout-btn');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      setStatus('Signing out…');
      await supabase.auth.signOut();
      renderLoginForm();
    });
  }

  // Add tab click handlers
  const tabButtons = appContainer.querySelectorAll('.admin-tab');
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
    const content = `
      <div style="margin-bottom: 20px;">
        <h2 style="margin: 0 0 16px 0;">Stage Control</h2>
        
        <!-- Bulk Operations Bar -->
        <div style="display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;">
          <button id="btnEnableAll" style="
            background: #4caf50;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
          " onmouseover="this.style.background='#45a049'" onmouseout="this.style.background='#4caf50'">
            Enable All Stages
          </button>
          <button id="btnDisableAll" style="
            background: #f44336;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
          " onmouseover="this.style.background='#d32f2f'" onmouseout="this.style.background='#f44336'">
            Disable All Stages
          </button>
          <button id="btnEnable1to5" style="
            background: #2196f3;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
          " onmouseover="this.style.background='#0b7dda'" onmouseout="this.style.background='#2196f3'">
            Enable 1–5
          </button>
          <button id="btnDisable6to16" style="
            background: #ff9800;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.2s;
          " onmouseover="this.style.background='#e68900'" onmouseout="this.style.background='#ff9800'">
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
    stageControl.attachEventHandlers();

    // Wire up bulk operation buttons
    document.getElementById('btnEnableAll')?.addEventListener('click', async () => {
      showStatusMessage('Enabling all stages...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], true);
      if (result.success) {
        showStatusMessage('✓ All stages enabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers()), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnDisableAll')?.addEventListener('click', async () => {
      showStatusMessage('Disabling all stages...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], false);
      if (result.success) {
        showStatusMessage('✓ All stages disabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers()), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnEnable1to5')?.addEventListener('click', async () => {
      showStatusMessage('Enabling stages 1–5...');
      const result = await stageControl.bulkUpdateStages([1,2,3,4,5], true);
      if (result.success) {
        showStatusMessage('✓ Stages 1–5 enabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers()), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnDisable6to16')?.addEventListener('click', async () => {
      showStatusMessage('Disabling stages 6–16...');
      const result = await stageControl.bulkUpdateStages([6,7,8,9,10,11,12,13,14,15,16], false);
      if (result.success) {
        showStatusMessage('✓ Stages 6–16 disabled');
        setTimeout(() => stageControl.loadAndRender().then(() => stageControl.attachEventHandlers()), 500);
      } else {
        showStatusMessage(`✗ Error: ${result.error}`);
      }
    });

    document.getElementById('btnRefreshStages')?.addEventListener('click', async () => {
      showStatusMessage('Refreshing stage data...');
      await stageControl.loadAndRender();
      stageControl.attachEventHandlers();
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
  try {
    // Set up auth state listener once at startup
    setupAuthStateListener();

    setStatus('Checking session…');

    // Check for active session first
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // No active session - show login form
      setStatus('');
      renderLoginForm();
      return;
    }

    setStatus('Checking admin privileges…');

    // User is logged in - check if they are an admin
    const adminStatus = await checkAdminAccess();

    if (!adminStatus) {
      // Logged in but not admin - sign out and show login form
      setStatus('Not authorized. You do not have admin access.');
      console.log('[ADMIN] Access denied at init - signing out');
      
      setTimeout(async () => {
        await supabase.auth.signOut();
        // SIGNED_OUT event will be triggered and handled by listener
      }, 2000);
      
      return;
    }

    setStatus('Access granted.');

    // User is authenticated and is admin - render admin shell
    const userEmail = user?.email || 'Unknown';
    renderAdminShell(userEmail);
  } catch (error) {
    console.error('Admin init error:', error);
    setStatus('Error initializing admin panel.');
    renderLoginForm();
  }
}

// Initialize when DOM is ready
// GUARD: Only initialize if in admin.html context
if (isAdminContext()) {
  document.addEventListener('DOMContentLoaded', initAdmin);
}
