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
    button.addEventListener('click', () => {
      const tabId = button.dataset.tabId;
      renderTabContent(tabId);
      
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
function renderTabContent(tabId) {
  const contentContainer = document.getElementById('admin-content');
  if (!contentContainer) return;

  const tabLabels = {
    'stage-control': 'Stage Control',
    'stage-answers': 'Stage Answers',
    'users': 'Users',
    'test-users': 'Test Users'
  };

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
