# Event Handlers & Bulk Operations Documentation

## Overview

This document describes the event handler wiring implemented in `admin.js` for Stage Control functionality. All database updates use Supabase `upsert()` with `onConflict: 'stage_number'` to handle both new and existing records.

---

## Per-Card Event Handlers

### Toggle Switch Handler

**Trigger:** Click on `.toggle-switch` button in a stage card

**Flow:**
1. User clicks toggle (`.toggle-switch`)
2. Handler reads `data-stage` (stage number) and `data-enabled` (current state)
3. Flips the enabled state: `!currentEnabled`
4. Calls `stageControl.updateStageEnabled(stageNum, newEnabled)`
5. Shows status message: `"Updating stage {N}..."`
6. On success: Shows `"✓ Stage {N} enabled/disabled"`, then re-renders grid
7. On error: Shows `"✗ Error updating stage {N}: {error message}"`

**Database Operation:**
```javascript
// Upsert to public.stage_control
{
  stage_number: stageNum,
  is_enabled: newState,
  updated_at: ISO_TIMESTAMP,
  updated_by: 'admin_panel'
}
```

**Method Signature:**
```javascript
async updateStageEnabled(stageNum, enabled)
// Returns: { success: boolean, error: string|null }
```

---

### Notes Update Button Handler

**Trigger:** Click on `.update-notes-btn` in a stage card

**Flow:**
1. User clicks "Update Notes" button (`.update-notes-btn`)
2. Handler reads `data-stage` and finds corresponding textarea
3. Extracts textarea value and trims whitespace
4. Calls `stageControl.updateStageNotes(stageNum, notes)`
5. Shows status message: `"Saving notes for stage {N}..."`
6. On success: Shows `"✓ Notes saved for stage {N}"`, then re-renders grid
7. On error: Shows `"✗ Error saving notes: {error message}"`

**Database Operation:**
```javascript
// Upsert to public.stage_control
{
  stage_number: stageNum,
  notes: notesText,
  updated_at: ISO_TIMESTAMP,
  updated_by: 'admin_panel'
}
```

**Method Signature:**
```javascript
async updateStageNotes(stageNum, notes)
// Returns: { success: boolean, error: string|null }
```

---

## Bulk Operation Buttons

All bulk operations are wired in the Stage Control tab (`renderTabContent`). They all follow the same pattern: batch update → show status → re-render.

### Enable All Stages

**Button:** `#btnEnableAll`

**Action:** Set `is_enabled=true` for all 16 stages

**Database Operation:**
```javascript
// Upsert 16 records in batch
stageControl.bulkUpdateStages([1,2,3,...,16], true)
```

**Status Messages:**
- During: `"Enabling all stages..."`
- Success: `"✓ All stages enabled"`
- Error: `"✗ Error: {error message}"`

---

### Disable All Stages

**Button:** `#btnDisableAll`

**Action:** Set `is_enabled=false` for all 16 stages

**Database Operation:**
```javascript
stageControl.bulkUpdateStages([1,2,3,...,16], false)
```

**Status Messages:**
- During: `"Disabling all stages..."`
- Success: `"✓ All stages disabled"`
- Error: `"✗ Error: {error message}"`

---

### Enable Stages 1–5

**Button:** `#btnEnable1to5`

**Action:** Set `is_enabled=true` for stages 1-5 only

**Database Operation:**
```javascript
stageControl.bulkUpdateStages([1,2,3,4,5], true)
```

**Status Messages:**
- During: `"Enabling stages 1–5..."`
- Success: `"✓ Stages 1–5 enabled"`
- Error: `"✗ Error: {error message}"`

---

### Disable Stages 6–16

**Button:** `#btnDisable6to16`

**Action:** Set `is_enabled=false` for stages 6-16

**Database Operation:**
```javascript
stageControl.bulkUpdateStages([6,7,8,9,10,11,12,13,14,15,16], false)
```

**Status Messages:**
- During: `"Disabling stages 6–16..."`
- Success: `"✓ Stages 6–16 disabled"`
- Error: `"✗ Error: {error message}"`

---

### Refresh Data

**Button:** `#btnRefreshStages`

**Action:** Re-fetch data from database and re-render grid (no updates to DB)

**Process:**
1. Show: `"Refreshing stage data..."`
2. Call `stageControl.loadAndRender()` (fetches + renders)
3. Call `stageControl.attachEventHandlers()` (re-wire all handlers)
4. Show: `"✓ Refresh complete"`

---

## Bulk Update Method

### `bulkUpdateStages(stageNumbers, enabled)`

**Parameters:**
- `stageNumbers: Array<number>` - Array of stage numbers to update (e.g., `[1,2,3,4,5]`)
- `enabled: boolean` - New enabled state for all stages

**Process:**
1. Build array of upsert payloads (one per stage number)
2. Call `supabase.from('stage_control').upsert(payloads, { onConflict: 'stage_number' })`
3. Return `{ success: true }` or `{ success: false, error: errorMsg }`

**Database Payload Format:**
```javascript
// For each stage number
{
  stage_number: num,
  is_enabled: enabled,
  updated_at: ISO_TIMESTAMP,
  updated_by: 'admin_panel'
}
```

---

## Status Message Function

### `showStatusMessage(message)`

**Behavior:**
- Creates or updates fixed-position div at top center of page (`#status-message`)
- Displays message with blue styling
- Auto-dismisses after 4 seconds (or when new message arrives)
- Uses `z-index: 1000` to appear above all content

**Example Usage:**
```javascript
showStatusMessage('Updating stage 5...');
showStatusMessage('✓ Stage 5 enabled');
showStatusMessage('✗ Error: Database connection failed');
```

**CSS:**
```css
#status-message {
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
  z-index: 1000;
}
```

---

## Event Handler Attachment

### `attachEventHandlers()`

**Purpose:** Wire up all per-card event handlers after rendering grid

**Attached Handlers:**
1. **Toggle switches** (`.toggle-switch`) - Click to flip enabled state
2. **Notes buttons** (`.update-notes-btn`) - Click to save notes

**Called From:**
- `renderTabContent()` after `stageControl.loadAndRender()`
- Refresh button handler after `stageControl.loadAndRender()`
- All bulk operation handlers after `stageControl.loadAndRender()` (with 500ms delay)

**Why Needed:** Event handlers must be re-attached after DOM re-renders because old elements are destroyed.

---

## Tab Switching Integration

### Stage Control Tab Click Handler

**Location:** `renderAdminShell()` - Tab navigation event listeners

**When User Clicks "Stage Control" Tab:**
1. Call `await renderTabContent('stage-control')`
2. `renderTabContent()` builds bulk operations bar HTML
3. Creates empty `#stageGrid` container
4. Shows: `"Loading stages…"`
5. Calls `stageControl.loadAndRender()` (fetches from DB + renders)
6. Calls `stageControl.attachEventHandlers()` (wires up all handlers)
7. Grid is now interactive and connected to database

---

## Data Flow Diagram

```
User clicks toggle
       ↓
Handler reads stage number & current state
       ↓
showStatusMessage("Updating...")
       ↓
updateStageEnabled(stageNum, !currentState)
       ↓
Build upsert payload { stage_number, is_enabled, updated_at, updated_by }
       ↓
supabase.from('stage_control').upsert([payload], { onConflict })
       ↓
Check result
       ├→ Success: showStatusMessage("✓ Stage X enabled/disabled")
       │           setTimeout(() => loadAndRender() + attachEventHandlers(), 500)
       │
       └→ Error: showStatusMessage("✗ Error: {message}")
```

---

## Key Implementation Details

### Conflict Resolution
- All upserts use `onConflict: 'stage_number'`
- If stage exists: updates columns (is_enabled, notes, updated_at, updated_by)
- If stage doesn't exist: creates new row with provided data

### Timestamp Management
- `updated_at` set to `new Date().toISOString()` for every update
- Provides audit trail of when changes were made
- Used in UI to display "Last Updated" timestamp

### Attribution
- All updates from admin panel set `updated_by: 'admin_panel'`
- Distinguishes admin actions from system actions
- Useful for audit logs and debugging

### Re-render Pattern
- All per-card handlers re-fetch and re-render after successful update
- Ensures UI always matches database state
- 500ms delay on bulk operations to avoid rapid re-renders
- Maintains grid consistency and refreshes all derived data (solver counts, timestamps)

### Error Handling
- All methods wrapped in try/catch
- Errors logged to console with `[ADMIN]` prefix
- User-friendly error messages shown in status bar
- No partial success: if any stage fails, entire operation marked as failed

---

## Testing Checklist

- [ ] Toggle a stage on/off → database updates, UI reflects change
- [ ] Update stage notes → notes saved to DB
- [ ] Enable All → all 16 stages set to enabled
- [ ] Disable All → all 16 stages set to disabled
- [ ] Enable 1–5 → stages 1-5 enabled, 6-16 unchanged
- [ ] Disable 6–16 → stages 6-16 disabled, 1-5 unchanged
- [ ] Refresh → data re-fetched from DB
- [ ] Status messages appear and dismiss correctly
- [ ] Console shows `[ADMIN]` logs for all operations
- [ ] Database reflects changes (updated_at and updated_by columns)

---

## Related Files

- **admin.js** - Event handler implementation and bulk operations
- **admin.html** - HTML structure with bulk operation buttons
- **supabase-config.js** - Supabase client initialization
- **public.stage_control** - Database table being updated
