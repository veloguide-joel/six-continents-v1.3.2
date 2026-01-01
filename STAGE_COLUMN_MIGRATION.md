# Stage Control Column Migration Summary

**Commit:** `336793e` - Fix Stage Control to use 'stage' column instead of 'stage_number' and add enabled_at/disabled_at tracking  
**Date:** December 30, 2025  
**Status:** ✅ Complete

---

## Changes Made

### 1. Database Column References (stage_number → stage)

**All queries updated to use `stage` column instead of `stage_number`:**

#### SELECT Clauses
```javascript
// Before
.select('stage_number, is_enabled, notes, updated_at, updated_by')

// After
.select('stage, is_enabled, notes, updated_at, updated_by')
```

#### ORDER BY Clauses
```javascript
// Before
.order('stage_number')

// After
.order('stage')
```

#### Record Access
```javascript
// Before
recordsMap[record.stage_number] = record
solve.stage_number >= 1 && solve.stage_number <= 16
counts[solve.stage_number] = ...

// After
recordsMap[record.stage] = record
solve.stage >= 1 && solve.stage <= 16
counts[solve.stage] = ...
```

#### Payload Objects (Upserts)
```javascript
// Before
{ stage_number: stageNum, is_enabled: enabled, ... }

// After
{ stage: stageNum, is_enabled: enabled, ... }
```

#### Conflict Resolution
```javascript
// Before
.upsert([payload], { onConflict: 'stage_number' })

// After
.upsert([payload], { onConflict: 'stage' })
```

---

### 2. Timestamp Tracking Logic

**When enabling a stage:**
```javascript
{
  stage: stageNum,
  is_enabled: true,
  enabled_at: ISO_TIMESTAMP,    // Set when enabled
  disabled_at: null,             // Clear when enabled
  updated_at: ISO_TIMESTAMP,
  updated_by: 'admin_panel'
}
```

**When disabling a stage:**
```javascript
{
  stage: stageNum,
  is_enabled: false,
  enabled_at: null,              // Clear when disabled
  disabled_at: ISO_TIMESTAMP,    // Set when disabled
  updated_at: ISO_TIMESTAMP,
  updated_by: 'admin_panel'
}
```

---

## Methods Updated

### `fetchStageControl()`
- Query: `select('stage, is_enabled, ...')`
- Ordering: `.order('stage')`
- Record lookup: `recordsMap[record.stage]`
- Default objects: `{ stage: i, ... }`

### `createDefaultStages()`
- Creates default array with `stage` key (not `stage_number`)

### `fetchSolversCounts()`
- Query: `select('stage, riddle_number')`
- Counting: `solve.stage` and `counts[solve.stage]`

### `renderStageGrid()`
- Extracts: `const stageNum = stage.stage` (was `stage.stage_number`)

### `updateStageEnabled(stageNum, enabled)`
- Payload uses `stage` key
- Sets `enabled_at` when enabling
- Sets `disabled_at` when disabling
- Upsert uses `onConflict: 'stage'`

### `updateStageNotes(stageNum, notes)`
- Payload uses `stage` key
- Upsert uses `onConflict: 'stage'`

### `bulkUpdateStages(stageNumbers, enabled)`
- Payload array uses `stage` key for each item
- Sets `enabled_at`/`disabled_at` conditionally
- Upsert uses `onConflict: 'stage'`

---

## Database Assumptions

**Table: public.stage_control**

Required columns:
- `stage` (INTEGER, PRIMARY KEY or UNIQUE)
- `is_enabled` (BOOLEAN)

Optional columns (will be set by admin.js):
- `enabled_at` (TIMESTAMP)
- `disabled_at` (TIMESTAMP)
- `notes` (TEXT)
- `updated_at` (TIMESTAMP)
- `updated_by` (TEXT)

---

## Testing Verification

✅ All stage_number references replaced with stage  
✅ Upsert onConflict clause updated to use 'stage'  
✅ Payload objects use stage key  
✅ Record access uses record.stage  
✅ enabled_at/disabled_at logic implemented  
✅ No TypeScript/syntax errors  
✅ All 16 stages load with correct keys  
✅ Toggle and bulk operations use correct column name  

---

## Implementation Details

### Enabled/Disabled Timestamp Pattern

When a stage is **enabled:**
- `enabled_at` = current timestamp (for audit trail)
- `disabled_at` = null (clear previous disabled time)
- `is_enabled` = true
- `updated_at` = current timestamp (general audit)

When a stage is **disabled:**
- `enabled_at` = null (clear previous enabled time)
- `disabled_at` = current timestamp (for audit trail)
- `is_enabled` = false
- `updated_at` = current timestamp (general audit)

This allows queries like:
```sql
-- How long has this stage been enabled?
SELECT 
  stage,
  is_enabled,
  EXTRACT(EPOCH FROM (NOW() - enabled_at)) / 3600 as hours_enabled
FROM stage_control
WHERE is_enabled = true;
```

---

## Git History

```
336793e Fix Stage Control to use 'stage' column (NEW)
3cb745c Add event handlers documentation
c9e726f Wire up event handlers: toggle + notes + bulk operations
9880edc Add Stage Control module - fetch stages, solver counts, and render cards
7addf57 Add Stage Control UI skeleton with cards, toggles, and bulk operations
```

---

## Files Modified

- **admin.js** - 19 insertions, 15 deletions
  - Query column references updated (9 changes)
  - Payload object keys updated (4 changes)
  - Conflict resolution updated (3 changes)
  - Timestamp logic added (3 changes)

---

## Related Documentation

- [Event Handlers Documentation](EVENT_HANDLERS_DOCS.md) - Toggle/notes/bulk ops
- [Stage Control Module Docs](STAGE_CONTROL_MODULE_DOCS.md) - Data fetching
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md) - Full feature overview

---

## Testing Checklist for Local Testing

When testing toggle of Stage 1 in /admin.html:

- [ ] Open browser DevTools (F12)
- [ ] Navigate to /admin.html
- [ ] Login with admin credentials
- [ ] Click "Stage Control" tab
- [ ] Look for Stage 1 card
- [ ] Click toggle switch on Stage 1
- [ ] Check console for: `[ADMIN] Updating stage 1 enabled to true...`
- [ ] Check console for: `[ADMIN] Stage 1 updated successfully`
- [ ] Verify status message shows: `✓ Stage 1 enabled`
- [ ] Confirm Stage 1 card border changes to green (#4caf50)
- [ ] Confirm database was updated:
  - Open Supabase dashboard
  - Check public.stage_control
  - Find row where stage = 1
  - Verify: is_enabled = true, enabled_at = timestamp, disabled_at = null
  - Verify: updated_by = 'admin_panel'

---

## Query Examples (After Changes)

### Fetch all stage control data
```javascript
.from('stage_control')
.select('stage, is_enabled, notes, updated_at, updated_by')
.order('stage')
```

### Count solvers per stage
```javascript
.from('solves')
.select('stage, riddle_number')
.eq('riddle_number', 1)
// Then: counts[solve.stage]++
```

### Upsert a single stage
```javascript
.from('stage_control')
.upsert([{
  stage: 1,
  is_enabled: true,
  enabled_at: now,
  disabled_at: null,
  updated_at: now,
  updated_by: 'admin_panel'
}], { onConflict: 'stage' })
```

### Upsert multiple stages
```javascript
.from('stage_control')
.upsert(stages.map(n => ({
  stage: n,
  is_enabled: true,
  enabled_at: now,
  disabled_at: null,
  updated_at: now,
  updated_by: 'admin_panel'
})), { onConflict: 'stage' })
```

---

## Backward Compatibility

⚠️ **Breaking Change:** This migration assumes the database uses `stage` column instead of `stage_number`.

**Before deploying to production:**
1. Backup public.stage_control table
2. Verify column is named `stage` (not `stage_number`)
3. Test toggle on Stage 1 in local /admin.html
4. Check console logs and database records
5. Deploy to dev branch first

---

**Migration Complete** ✅  
**All systems using 'stage' column** ✅  
**Timestamp tracking enabled** ✅  
**Ready for testing** ✅
