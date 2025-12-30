# AdminApp Module Documentation

## Overview
The `AdminApp` class provides a centralized Supabase client and authentication helpers for the admin.html interface. It manages sessions, sign-in/sign-out, admin verification, and UI state management.

## Location
[admin.js](admin.js) - Lines 9-312

## Exported Instance
```javascript
const adminApp = new AdminApp();
```

## Available Methods

### `getSession()`
Returns the current Supabase auth session.

**Returns:** `Promise<Session|null>`

**Example:**
```javascript
const session = await adminApp.getSession();
if (session) {
  console.log('User:', session.user.email);
}
```

**Logs:**
- `[ADMIN] getSession: user: {email}` - session found
- `[ADMIN] getSession: no session` - no active session
- `[ADMIN] getSession error: {error}` - error occurred

---

### `onAuthChange(handler)`
Registers a callback function to be notified of auth state changes.

**Parameters:**
- `handler` {Function} - Callback `(event, session) => void`

**Example:**
```javascript
adminApp.onAuthChange((event, session) => {
  console.log('Auth event:', event);
});
```

**Logs:**
- `[ADMIN] Auth change handler registered`

---

### `signInWithPassword(email, password)`
Authenticate user with email and password.

**Parameters:**
- `email` {string} - User email
- `password` {string} - User password

**Returns:** `Promise<{user: User|null, error: Error|null}>`

**Example:**
```javascript
const { user, error } = await adminApp.signInWithPassword(email, password);
if (error) {
  console.error('Login failed:', error.message);
}
```

**Logs:**
- `[ADMIN] Attempting sign-in: {email}`
- `[ADMIN] Sign-in successful: {email}`
- `[ADMIN] Sign-in failed: {error message}`

---

### `signOut()`
Sign out the current user.

**Returns:** `Promise<{error: Error|null}>`

**Example:**
```javascript
const { error } = await adminApp.signOut();
if (error) {
  console.error('Sign-out failed:', error.message);
}
```

**Logs:**
- `[ADMIN] Signing out...`
- `[ADMIN] Sign-out successful`
- `[ADMIN] Sign-out failed: {error message}`

---

### `isUserAdmin()`
Check if the current session user is in the `public.admin_emails` table.

**Returns:** `Promise<boolean>`

**Example:**
```javascript
const isAdmin = await adminApp.isUserAdmin();
if (isAdmin) {
  console.log('User has admin access');
}
```

**Database Query:**
```sql
SELECT email FROM public.admin_emails 
WHERE email = $1
LIMIT 1
```

**Logs:**
- `[ADMIN] isUserAdmin: checking {email}`
- `[ADMIN] isUserAdmin: true (found in admin_emails)`
- `[ADMIN] isUserAdmin: false (not in admin_emails)`
- `[ADMIN] isUserAdmin: no session`

---

### `requireAdminOrShowLogin()`
**PRIMARY FLOW** - Main authentication and authorization method.

**Behavior:**
1. Check if user has an active session
2. If no session → show login view (`#adminLoginView`)
3. If session exists → verify admin status via `isUserAdmin()`
4. If admin → show app view (`#adminAppView`)
5. If not admin → show access denied view with sign-out button

**Returns:** `Promise<boolean>` - `true` if admin authenticated, `false` otherwise

**Example:**
```javascript
const isAdminAuth = await adminApp.requireAdminOrShowLogin();
if (isAdminAuth) {
  // Initialize admin dashboard
  initializeDashboard();
}
```

**Logs:**
- `[ADMIN] requireAdminOrShowLogin: starting`
- `[ADMIN] requireAdminOrShowLogin: no session - show login`
- `[ADMIN] requireAdminOrShowLogin: admin verified`
- `[ADMIN] requireAdminOrShowLogin: not admin - show denied`

---

### `showLoginView()`
Display the login form, hide the app.

**HTML Requirements:**
- `#adminLoginView` - Login form container
- `#adminAppView` - App container

**Logs:**
- `[ADMIN] showLoginView`

---

### `showAppView(userEmail)`
Display the app, hide the login form. Updates user email display if element exists.

**HTML Requirements:**
- `#adminUserEmail` - (optional) Display current user email

**Logs:**
- `[ADMIN] showAppView: {userEmail}`

---

### `showAccessDeniedView(userEmail)`
Display "Access Denied" message with sign-out button.

**Behavior:**
- Renders styled access denied card
- Shows user's email
- Provides "Sign Out" button that triggers `signOut()`

**Logs:**
- `[ADMIN] showAccessDeniedView: {userEmail}`

---

### `showErrorView(message)`
Display error message with reload button.

**Logs:**
- `[ADMIN] showErrorView: {message}`

---

## Console Logging Convention
All logs are prefixed with `[ADMIN]` for easy filtering:

```bash
# Filter admin logs in DevTools console
console.filter('[ADMIN]')
```

**Common Patterns:**
- `[ADMIN] {action}: {details}` - Normal operation
- `[ADMIN] {action} error: {error}` - Error occurred
- `[ADMIN] {action} exception: {exception}` - Uncaught exception

---

## Error Handling
- All methods wrapped in try/catch blocks
- Errors logged to console but don't throw
- Methods return safe default values on error
- User sees friendly error messages

---

## HTML Structure Required
```html
<div id="adminLoginView">
  <!-- Login form rendered here -->
</div>

<div id="adminAppView">
  <!-- Admin dashboard rendered here -->
  <span id="adminUserEmail"></span> <!-- optional user display -->
</div>
```

---

## Usage Example
```javascript
// Initialize admin flow
await adminApp.requireAdminOrShowLogin();

// Handle sign-in from form
const { user, error } = await adminApp.signInWithPassword(email, password);
if (error) {
  showErrorMessage(error.message);
} else {
  // Trigger auth state change check
  await adminApp.requireAdminOrShowLogin();
}

// Handle sign-out
await adminApp.signOut();
```
