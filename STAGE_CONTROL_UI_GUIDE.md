# Stage Control UI Skeleton
**File:** [admin.html](admin.html)  
**Commit:** `7addf57`

## Layout Overview

```
┌─ Admin Dashboard ────────────────────────────────────────┐
│  [Header with Sign Out button]                           │
│                                                           │
│  [Tab Navigation]                                        │
│  Stage Control | Stage Answers | Users | Test Users      │
│                                                           │
│  ┌─ Stage Control Tab ──────────────────────────────────┐│
│  │                                                      ││
│  │ [Bulk Operations Bar]                              ││
│  │ [Enable All] [Disable All] [Enable 1-5]...         ││
│  │                                                      ││
│  │ [Responsive Stage Grid (auto-fill minmax 350px)]   ││
│  │ ┌─ Card 1 ──┐ ┌─ Card 2 ──┐ ┌─ Card 3 ──┐         ││
│  │ │ Stage 1   │ │ Stage 2   │ │ Stage 3   │         ││
│  │ │ [Toggle]  │ │ [Toggle]  │ │ [Toggle]  │         ││
│  │ │ ...info   │ │ ...info   │ │ ...info   │         ││
│  │ └───────────┘ └───────────┘ └───────────┘         ││
│  │                                                      ││
│  │ [Remaining cards continue...]                      ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

---

## HTML Structure

### A) Two Main Views

```html
<div id="adminLoginView">
  <!-- Login form -->
</div>

<div id="adminAppView">
  <!-- Admin dashboard (Stage Control, tabs, etc.) -->
</div>
```

### B) Admin Header

```html
<div class="admin-header">
  <h1>Admin Dashboard</h1>
  <div class="admin-header-right">
    <span id="adminUserEmail"></span>
    <button id="btnAdminSignOut">Sign Out</button>
  </div>
</div>
```

### C) Tab Navigation

```html
<div class="admin-tabs">
  <button class="admin-tab-btn active" data-tab="stage-control">Stage Control</button>
  <button class="admin-tab-btn" data-tab="stage-answers">Stage Answers</button>
  <button class="admin-tab-btn" data-tab="users">Users</button>
  <button class="admin-tab-btn" data-tab="test-users">Test Users</button>
</div>
```

### D) Stage Control Tab Content

```html
<div id="tab-stage-control" class="admin-tab-content active">
  <!-- Bulk Operations Bar -->
  <div class="bulk-operations">
    <button id="btnEnableAll">Enable All Stages</button>
    <button id="btnDisableAll">Disable All Stages</button>
    <button id="btnEnable1to5">Enable Stages 1–5</button>
    <button id="btnDisable6to16">Disable Stages 6–16</button>
    <button id="btnRefreshStages">Refresh Data</button>
  </div>

  <!-- Stage Grid -->
  <div id="stageGrid">
    <!-- Stage cards rendered here by admin.js -->
  </div>
</div>
```

---

## Button IDs

### Bulk Operations

| ID | Label | Purpose |
|----|-------|---------|
| `#btnEnableAll` | Enable All Stages | Enable all 16 stages |
| `#btnDisableAll` | Disable All Stages | Disable all 16 stages |
| `#btnEnable1to5` | Enable Stages 1–5 | Enable stages 1-5 only |
| `#btnDisable6to16` | Disable Stages 6–16 | Disable stages 6-16 only |
| `#btnRefreshStages` | Refresh Data | Reload stage data from DB |

### Other Controls

| ID | Element | Purpose |
|----|---------|---------|
| `#adminUserEmail` | Span | Display logged-in user email |
| `#btnAdminSignOut` | Button | Sign out user |
| `#stageGrid` | Div | Container for 16 stage cards |
| `#tab-stage-control` | Div | Stage Control tab content |

---

## Stage Card Structure (Template)

Each card will display:

```
┌─────────────────────────────────┐
│ Stage 1         [Toggle]        │ ← Header with toggle
│                 [Live/Disabled]  │ ← Status badge
├─────────────────────────────────┤
│ Solvers: 42      Last Updated: … │ ← Info grid
│ Updated By: Joel 2025-12-30      │
├─────────────────────────────────┤
│ Notes:                           │ ← Notes section
│ ┌──────────────────────────────┐ │
│ │ [textarea for notes]         │ │
│ └──────────────────────────────┘ │
│ [Update Notes Button]            │
└─────────────────────────────────┘
```

### Card Fields
- **Stage Number** - "Stage 1", "Stage 2", etc.
- **Toggle** - Enable/disable with animated switch
- **Status** - "Live" (green) or "Disabled" (red)
- **Solvers Count** - Number of users who solved
- **Last Updated** - Timestamp (e.g., "2025-12-30 14:23:15")
- **Updated By** - Admin name who last modified
- **Notes** - Textarea for admin notes
- **Update Notes Button** - Save notes to database

---

## CSS Classes

### Layout Classes
- `.admin-header` - Top header with title and controls
- `.admin-header-right` - Right side of header (email + sign out)
- `.admin-tabs` - Tab navigation bar
- `.admin-tab-btn` - Individual tab button
- `.admin-tab-btn.active` - Active tab state
- `.admin-tab-content` - Tab content panel
- `.admin-tab-content.active` - Active content panel

### Bulk Operations
- `.bulk-operations` - Container for bulk action buttons
- `.bulk-operations button` - Blue button styling

### Stage Grid & Cards
- `#stageGrid` - Responsive grid (auto-fill minmax 350px)
- `.stage-card` - Individual stage card
- `.stage-card:hover` - Card hover effect
- `.stage-card-header` - Card header (title + toggle)
- `.stage-card-title` - Stage title
- `.stage-card-toggle` - Toggle container
- `.toggle-switch` - Toggle button element
- `.toggle-switch.enabled` - Enabled state (green)
- `.toggle-switch::after` - Toggle indicator dot
- `.stage-status` - Status badge
- `.stage-status.live` - Live status (green)
- `.stage-status.disabled` - Disabled status (red)
- `.stage-card-info` - Info grid (2-column)
- `.stage-info-item` - Individual info field
- `.stage-info-label` - Label text
- `.stage-card-notes` - Notes section
- `.stage-card-notes-label` - Notes label
- `.stage-card-notes textarea` - Notes input
- `.stage-card-notes button` - Update button

### Utility Classes
- `.btn-primary` - Blue button
- `.btn-danger` - Red button

---

## Responsive Design

- **Grid Layout:** `grid-template-columns: repeat(auto-fill, minmax(350px, 1fr))`
  - Automatically arranges cards in columns
  - Each card minimum width: 350px
  - Fills available space with equal-width columns
  - Wraps to new row when needed

- **Mobile Friendly:**
  - Cards stack vertically on small screens
  - Touch-friendly button sizes
  - Flexible header layout

---

## Next Steps for Implementation

1. **Tab Switching Logic** - Wire `.admin-tab-btn` click handlers to show/hide `.admin-tab-content`
2. **Stage Card Rendering** - Populate `#stageGrid` with 16 stage cards from database
3. **Toggle Handler** - Wire `.toggle-switch` clicks to update stage enabled status
4. **Bulk Operations** - Wire bulk button clicks to database updates
5. **Notes Saving** - Wire "Update Notes" buttons to database
6. **Sign Out Handler** - Wire `#btnAdminSignOut` to logout

---

## CSS Breakdown

**Total CSS:**
- Flexbox for headers and layouts
- CSS Grid for stage cards (responsive auto-fill)
- Toggle switch custom styling (no frameworks)
- Color scheme: Blue (#0288d1) primary, Green (#4caf50) enabled, Red (#f44336) error
- All fonts: system-ui (no external dependencies)
- Shadows and transitions for polish
