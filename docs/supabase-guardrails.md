# Supabase Guardrails — Schema Management Policy

This document defines the canonical Supabase schema for the Six Continents Challenge and establishes guardrails for all schema modifications.

## Core Principles

### 1. Source-of-Truth Documentation
- The Supabase schema documentation is the authoritative reference.
- Any discrepancies between documentation and actual schema must be reconciled.
- Changes to schema must be documented here before implementation.

### 2. No Conflicting Changes
- Do NOT suggest schema changes that conflict with this documented schema.
- Do NOT propose modifications without first consulting this guardrails document.

### 3. Dependency Verification
- Before proposing any schema changes, verify all dependencies:
  - **Code dependencies**: Search all application code for table/function references
  - **pg_views**: Check all PostgreSQL views that depend on the table/function
  - **Triggers**: Verify all triggers that reference the table/function
  - **RLS Policies**: Ensure Row Level Security policies remain valid
  - **Function calls**: Identify all `rpc()` calls and their dependent functions

### 4. Archiving Over Deletion
- Prefer archiving (schema move) over permanent deletion.
- Archive deprecated tables by moving them to an `_archived` schema or similar structure.
- Maintain historical records and audit trails.

## Implementation Checklist

Before making any schema change:

- [ ] Read this document completely
- [ ] Verify the change aligns with documented guardrails
- [ ] Search code for all table/function references
- [ ] Check pg_views for dependent views
- [ ] Identify and document all triggers
- [ ] Verify RLS policies will continue to work
- [ ] Consider archiving as an alternative to deletion
- [ ] Document the change rationale
- [ ] Update this file if guardrails need revision

## For AI Tools

⚠️ **IMPORTANT**: Do not suggest direct table changes without checking this document first.

When proposing schema modifications:
1. Reference this guardrails document explicitly
2. Perform the dependency verification checklist above
3. Prefer archiving over deletion
4. Explain how the change aligns with these guardrails
5. Identify any risks or edge cases
