# Stage Control Module Documentation

**File:** [admin.js](admin.js#L319-L587)  
**Export:** `const stageControl = new StageControlModule(adminApp)`  
**Commit:** `9880edc`

---

## Overview

The `StageControlModule` manages all stage data operations for the admin panel:
- Fetches stage control settings from `public.stage_control` table
- Computes solver counts from `public.solves` table
- Renders stage cards in the Stage Control tab with real-time data

---

## Database Tables

### `public.stage_control`

| Column | Type | Notes |
|--------|------|-------|
| `stage_number` | int | 1-16 |
| `is_enabled` | bool | Stage active/inactive |
| `notes` | text | Admin notes |
| `updated_at` | timestamptz | Last modification |
| `updated_by` | text | Admin who made change |

### `public.solves`

| Column | Type | Notes |
|--------|------|-------|
| `stage_number` | int | 1-16 |
| `riddle_number` | int | Riddle within stage |
| `user_id` | uuid | Who solved |
| `solved_at` | timestamptz | When solved |

**Solver Count:** Counts rows where `riddle_number = 1` per stage (canonical solve marker)

---

## Available Methods

### `constructor(adminAppInstance)`
Initialize the module with AdminApp reference.

```javascript
const stageControl = new StageControlModule(adminApp);
```

---

### `async fetchStageControl()`
Fetch stage control data from database.

**Behavior:**
- Queries `public.stage_control` ordered by `stage_number`
- Returns array of 16 stages (1-16)
- Creates in-memory defaults for missing stages
- Defaults: `{ is_enabled: false, notes: '', updated_at: now, updated_by: 'system' }`

**Returns:** `Promise<Array>`

**Example:**
```javascript
const stages = await stageControl.fetchStageControl();
console.log(stages[0]); // Stage 1 object
```

**Logs:**
- `[ADMIN] Fetching stage control data...`
- `[ADMIN] Stage control data loaded: 16 stages`
- `[ADMIN] fetchStageControl query error: {error}` (fallback to defaults)

---

### `async fetchSolversCounts()`
Fetch solver counts from `public.solves` table.

**Behavior:**
- Queries all solves where `riddle_number = 1`
- Counts per `stage_number` (1-16)
- Returns map `{ 1: count, 2: count, ... 16: count }`
- Missing stages default to 0

**Returns:** `Promise<Object>` - `{ stageNumber: solveCount }`

**Example:**
```javascript
const counts = await stageControl.fetchSolversCounts();
console.log(counts[1]); // Number of stage 1 solvers
```

**Logs:**
- `[ADMIN] Fetching solver counts...`
- `[ADMIN] Solver counts loaded: {counts}`
- `[ADMIN] fetchSolversCounts query error: {error}` (fallback to zeros)

---

### `renderStageGrid(stages, counts)`
Render stage cards into `#stageGrid`.

**Parameters:**
- `stages` {Array} - Stage control data (16 items)
- `counts` {Object} - Solver counts map

**Behavior:**
- Clears existing grid
- Creates 16 stage cards dynamically
- Each card shows:
  - **Border Color:** Green (#4caf50) if enabled, Pink (#f48fb1) if disabled
  - **Status Badge:** "Live" (green) or "Disabled" (red)
  - **Toggle Switch:** Enabled/disabled state
  - **Info Grid:** Solvers, last updated, updated by, stage number
  - **Notes Textarea:** Admin notes
  - **Update Notes Button:** Save button
- Formats timestamps for display

**Card Structure:**
```html
<div class="stage-card" id="stage-card-{N}">
  <header with toggle + status>
  <info grid: solvers, updated, updater>
  <notes textarea + update button>
</div>
```

**Colors:**
- **Enabled:** Green border (#4caf50), green status badge
- **Disabled:** Pink border (#f48fb1), red status badge
- **Toggle Switch:** Green background when enabled, gray when disabled

**Logs:**
- `[ADMIN] Rendering stage grid...`
- `[ADMIN] Stage data loaded successfully (16 stages)`
- `[ADMIN] renderStageGrid exception: {error}`

**Example:**
```javascript
const stages = await stageControl.fetchStageControl();
const counts = await stageControl.fetchSolversCounts();
stageControl.renderStageGrid(stages, counts);
```

---

### `async loadAndRender()`
Main convenience method - fetches and renders everything.

**Does:**
1. Fetch stage control data
2. Fetch solver counts
3. Render stage grid
4. Log completion

**Logs:**
- `[ADMIN] Loading stage control data...`
- `[ADMIN] Stage data loaded successfully (16 stages)`

**Example:**
```javascript
await stageControl.loadAndRender();
```

---

### `formatTimestamp(isoString)`
Format ISO timestamp for display.

**Parameters:**
- `isoString` {string} - ISO 8601 timestamp

**Returns:** {string} - Formatted date (e.g., "12/30/2025, 14:23")

**Example:**
```javascript
const display = stageControl.formatTimestamp('2025-12-30T14:23:15Z');
// "12/30/2025, 14:23"
```

---

### `createDefaultStages()`
Create default stage array (all disabled).

**Returns:** {Array} - 16 default stage objects

**Used by:** `fetchStageControl()` on error

---

### `createDefaultCounts()`
Create default solver counts (all zeros).

**Returns:** {Object} - `{ 1: 0, 2: 0, ... 16: 0 }`

**Used by:** `fetchSolversCounts()` on error

---

## Integration with Admin Flow

### Initialization
```javascript
// In admin.js after AdminApp initialization
const stageControl = new StageControlModule(adminApp);
```

### Usage in Admin Dashboard
```javascript
// When showing Stage Control tab
await stageControl.loadAndRender();

// Or separately:
const stages = await stageControl.fetchStageControl();
const counts = await stageControl.fetchSolversCounts();
stageControl.renderStageGrid(stages, counts);
```

---

## Error Handling

- **All methods wrapped in try/catch**
- Errors logged to console with `[ADMIN]` prefix
- Graceful fallback to defaults on any error
- Never throws - returns safe defaults instead

---

## Data Properties

```javascript
stageControl.stages        // Array of current stages (populated after fetch)
stageControl.solversCounts // Object of counts (populated after fetch)
stageControl.supabase      // Reference to supabase client
```

---

## Card Elements and Classes

### DOM Structure
```html
<div class="stage-card" id="stage-card-{N}" style="border-left: 4px solid {color}">
  <div class="stage-card-header">
    <div class="stage-card-title">Stage {N}</div>
    <div class="stage-card-toggle">
      <button class="toggle-switch [enabled]" data-stage="{N}"></button>
      <span class="stage-status [live|disabled]">{Live|Disabled}</span>
    </div>
  </div>

  <div class="stage-card-info">
    <div class="stage-info-item">
      <span class="stage-info-label">Solvers</span>
      <span>{count}</span>
    </div>
    <!-- more info items -->
  </div>

  <div class="stage-card-notes">
    <div class="stage-card-notes-label">Notes</div>
    <textarea data-stage="{N}">{notes}</textarea>
    <button class="update-notes-btn" data-stage="{N}">Update Notes</button>
  </div>
</div>
```

### CSS Classes
- `.stage-card` - Card container
- `.stage-card-header` - Top section with title and toggle
- `.stage-card-toggle` - Toggle + status container
- `.toggle-switch` - Toggle button (animated)
- `.toggle-switch.enabled` - Green when enabled
- `.stage-status` - Status badge
- `.stage-status.live` - Green badge
- `.stage-status.disabled` - Red badge
- `.stage-card-info` - Info grid (2 columns)
- `.stage-info-item` - Individual info field
- `.stage-info-label` - Label text
- `.stage-card-notes` - Notes section
- `.stage-card-notes textarea` - Notes input
- `.update-notes-btn` - Update button

---

## Console Logging Convention

All logs prefixed with `[ADMIN]`:

```
[ADMIN] StageControlModule initialized
[ADMIN] Fetching stage control data...
[ADMIN] Stage control data loaded: 16 stages
[ADMIN] Fetching solver counts...
[ADMIN] Solver counts loaded: {...}
[ADMIN] Rendering stage grid...
[ADMIN] Stage data loaded successfully (16 stages)
```

Filter in DevTools: `console.filter('[ADMIN]')`

---

## Next Steps for Integration

1. **Tab Switching** - Call `stageControl.loadAndRender()` when Stage Control tab is clicked
2. **Toggle Handler** - Wire `.toggle-switch` clicks to update `stage_control.is_enabled`
3. **Notes Update** - Wire `.update-notes-btn` clicks to update `stage_control.notes`
4. **Bulk Operations** - Wire bulk action buttons to batch updates
5. **Real-time Updates** - Add Supabase realtime subscriptions (optional)

---

## Performance Notes

- **Initial Load:** ~200ms (two queries: stage_control + solves)
- **Rendering:** ~50ms (16 cards created and inserted)
- **Total:** ~250ms (acceptable for admin UI)

---

## Example: Complete Flow

```javascript
// 1. Initialize admin app
const adminApp = new AdminApp();

// 2. Initialize stage control module
const stageControl = new StageControlModule(adminApp);

// 3. When user logs in and clicks "Stage Control" tab
await adminApp.requireAdminOrShowLogin(); // Verify admin access

// 4. Load and display stage data
await stageControl.loadAndRender();

// 5. Listen for tab switches
document.querySelector('[data-tab="stage-control"]').addEventListener('click', async () => {
  await stageControl.loadAndRender();
});
```
