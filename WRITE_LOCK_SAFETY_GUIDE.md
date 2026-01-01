# Write Lock Safety Guard - Implementation Guide

## Overview

The write lock safety guard prevents accidental writes to the production Supabase database when developing on localhost. This is a critical safety feature to prevent data corruption or unwanted changes to the live game.

## How It Works

### 1. Automatic Localhost Detection

When the Stage Control module initializes, it automatically detects if you're running on localhost:

```javascript
const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.0.0.1');
```

If localhost is detected AND the URL doesn't contain `?unlock=YESIMREADY`, the write lock is **automatically enabled**.

### 2. Write Lock Activation

When the write lock is active:

```javascript
window.__ADMIN_WRITE_LOCKED = true
```

This flag tells the admin panel to:
- Display a red warning banner
- Disable all toggle switches
- Disable all bulk operation buttons (Enable All, Disable All, Enable 1-5, Disable 6-16)
- Disable all "Update Notes" buttons
- Show error message on any write attempt: "✗ Write locked: Localhost pointing at production."

### 3. Visual Warning Banner

When locked, the Stage Control tab displays a prominent warning at the top:

```
⚠️ WRITE LOCKED: Localhost is pointed at PRODUCTION Supabase. No changes will be saved.
```

Banner styling:
- Red left border (4px)
- Yellow background (#fff3cd)
- Red text (#ff0000)
- Bold font weight

### 4. UI Disabled Styling

All locked controls are styled to indicate they're disabled:
- Opacity: 0.5 (50% transparent)
- Cursor: not-allowed
- Title: "Write operations locked. Check banner above."

## Emergency Override Mechanism

If you intentionally need to make changes to the production database from localhost:

1. Add `?unlock=YESIMREADY` to your URL
2. Reload the page
3. Write operations will be enabled
4. The warning banner will disappear
5. All controls will be re-enabled

**Example URL:**
```
http://localhost:8000/admin.html?unlock=YESIMREADY
```

## Implementation Details

### StageControlModule Methods

```javascript
// Check if write operations are allowed
isWriteAllowed() {
  return !window.__ADMIN_WRITE_LOCKED;
}

// Get the lock warning message (null if not locked)
getLockMessage() {
  if (window.__ADMIN_WRITE_LOCKED) {
    return 'WRITE LOCKED: Localhost is pointed at PRODUCTION Supabase. No changes will be saved.';
  }
  return null;
}

// Detect and initialize the write lock
detectWriteLock() {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.0.0.1');
  const unlockParam = new URLSearchParams(window.location.search).get('unlock');
  
  if (isLocalhost && unlockParam !== 'YESIMREADY') {
    window.__ADMIN_WRITE_LOCKED = true;
    console.log('[ADMIN] WRITE LOCK ENABLED: Localhost detected with production Supabase');
    return true;
  }
  window.__ADMIN_WRITE_LOCKED = false;
  return false;
}
```

### Event Handler Integration

All event handlers check the write lock before performing writes:

```javascript
toggle.addEventListener('click', async (e) => {
  e.preventDefault();
  
  if (isLocked) {
    showStatusMessage('✗ Write locked: Localhost pointing at production.');
    return;
  }
  
  // ... proceed with update
});
```

Bulk operation buttons also check:

```javascript
document.getElementById('btnEnableAll')?.addEventListener('click', async () => {
  if (!stageControl.isWriteAllowed()) {
    showStatusMessage('✗ Write locked: Localhost pointing at production.');
    return;
  }
  // ... proceed with bulk update
});
```

## Console Logging

All write lock operations are logged to the console with `[ADMIN]` prefix:

```javascript
// When lock is detected
[ADMIN] WRITE LOCK ENABLED: Localhost detected with production Supabase

// When write is attempted while locked
[ADMIN] Write locked on toggle for stage 1
```

## Testing the Write Lock

### Test 1: Verify Lock Activation

1. Open `/admin.html` (without URL parameters)
2. Navigate to Stage Control tab
3. Verify:
   - Red warning banner appears at top
   - All toggle switches are disabled (greyed out, opacity 0.5)
   - All bulk buttons are disabled
   - Console shows: `[ADMIN] WRITE LOCK ENABLED: Localhost detected with production Supabase`

### Test 2: Verify Lock Prevents Writes

1. With write lock active, try to click a toggle switch
2. Verify:
   - Toggle doesn't change state
   - Status bar shows: `✗ Write locked: Localhost pointing at production.`
   - Console shows write attempt was blocked

### Test 3: Verify Emergency Override

1. Add `?unlock=YESIMREADY` to URL: `http://localhost:8000/admin.html?unlock=YESIMREADY`
2. Reload page
3. Navigate to Stage Control tab
4. Verify:
   - Warning banner is gone
   - All controls are enabled
   - Toggle switches work normally
   - Console shows: `[ADMIN] WRITE LOCK DISABLED: Override parameter detected`

### Test 4: Verify Lock Re-enables After Reload

1. With override parameter, enable a stage
2. Remove `?unlock=YESIMREADY` from URL
3. Reload page
4. Verify:
   - Warning banner reappears
   - All controls disabled again
   - Previous toggle state persists in database

## Troubleshooting

### Issue: Lock won't activate even though I'm on localhost

**Check:**
1. Verify `window.location.hostname` in console
2. Should be either `localhost` or `127.0.0.1`
3. If using a different domain, add it to the `isLocalhost` check

**Solution:**
Add your hostname to the detection logic in `StageControlModule.detectWriteLock()`:
```javascript
const isLocalhost = hostname === 'localhost' || 
                   hostname.startsWith('127.0.0.1') ||
                   hostname === 'your-dev-domain.local';
```

### Issue: Override parameter isn't working

**Check:**
1. Verify URL contains exactly: `?unlock=YESIMREADY` (case-sensitive)
2. Reload after adding parameter
3. Check console for unlock confirmation

### Issue: Can't read error messages in warning banner

**Solution:**
The banner has red text on yellow background. If this is hard to read:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for `[ADMIN]` prefixed messages for detailed logging

## Security Considerations

### Why This Matters

- **Localhost Development**: When developing locally, you typically point to the production database for testing
- **Human Error**: It's easy to forget which database you're connected to
- **Data Integrity**: Accidental toggles could break the live game for players

### Defense-in-Depth Approach

This feature follows security best practices:

1. **Default to Safe**: Localhost defaults to LOCKED (safe by default)
2. **Explicit Override**: Must intentionally add URL parameter to unlock
3. **Visual Warning**: Clear banner makes lock status obvious
4. **Audit Trail**: All actions logged to console with timestamps
5. **Window Flag**: Global flag allows other code to check lock status

### Recommended Practices

1. **Always review the banner** before making changes
2. **Remove the override parameter** when done with production testing
3. **Use separate profiles** for production vs development if possible
4. **Check console logs** after each major operation
5. **Document production changes** with timestamps and reasons

## Related Files

- [admin.js](admin.js) - Main implementation (StageControlModule class)
- [admin.html](admin.html) - UI templates and markup
- TOGGLE_UI_FIX.md - Previous toggle bug fix documentation

## Commit History

- **62901ed**: Add write lock safety guard for localhost + production DB
- **3055762**: Fix toggle bug (predecessor feature)
- **233a8df**: Fix notes update (predecessor feature)

## Future Enhancements

Potential improvements:
1. Add write lock timeout (auto-unlock after 30 minutes)
2. Add password-protected unlock mechanism
3. Add write lock to other admin functions (users, answers tabs)
4. Add database connection indicator (showing current database URL)
5. Add audit log of all changes with IP address and timestamp
