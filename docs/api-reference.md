# Dolt Web UI API Reference

Base URL: `/api/v1`

## Common Conventions

### Error Response Format

All errors use the envelope format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_ARGUMENT` | 400 | Missing or invalid request parameters |
| `FORBIDDEN` | 403 | Operation not allowed (e.g., write to main) |
| `NOT_FOUND` | 404 | Resource not found |
| `STALE_HEAD` | 409 | expected_head does not match current HEAD |
| `MERGE_CONFLICTS_PRESENT` | 409 | Merge produced data conflicts |
| `SCHEMA_CONFLICTS_PRESENT` | 409 | Merge produced schema conflicts |
| `CONSTRAINT_VIOLATIONS_PRESENT` | 409 | Merge produced constraint violations |
| `PRECONDITION_FAILED` | 412 | Precondition check failed |
| `INTERNAL` | 500 | Internal server error |

### MainGuard

Write operations on the `main` branch are forbidden. Affected endpoints return:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "write operations on main branch are forbidden",
    "details": { "reason": "main_guard", "branch": "main" }
  }
}
```

---

## Metadata

### GET /targets

List configured Dolt targets.

**Response:**

```json
[
  { "id": "production" }
]
```

---

### GET /databases

List allowed databases for a target.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |

**Response:**

```json
[
  { "name": "psx_data" }
]
```

---

### GET /branches

List branches for a database.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |

**Response:**

```json
[
  { "name": "main", "hash": "abc123..." },
  { "name": "wi/work-1", "hash": "def456..." }
]
```

---

### POST /branches/create

Create a new work branch from main. **MainGuard applies.**

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/my-branch"
}
```

**Response:**

```json
{ "branch_name": "wi/my-branch" }
```

---

### GET /head

Get the current HEAD hash for a branch.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |

**Response:**

```json
{ "hash": "abc123def456..." }
```

---

## Tables

### GET /tables

List user tables (excludes `dolt_*` system tables).

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |

**Response:**

```json
[
  { "name": "items" },
  { "name": "categories" }
]
```

---

### GET /table/schema

Get column definitions for a table.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |

**Response:**

```json
{
  "table": "items",
  "columns": [
    { "name": "id", "type": "int", "nullable": false, "primary_key": true },
    { "name": "name", "type": "varchar(255)", "nullable": true, "primary_key": false }
  ]
}
```

---

### GET /table/rows

Get paginated rows with optional filtering and sorting.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name |
| `table` | Yes | | Table name |
| `page` | No | `1` | Page number (must be > 0) |
| `page_size` | No | `50` | Rows per page (1-500) |
| `filter` | No | | Filter expression (JSON array of conditions) |
| `sort` | No | | Sort expression |

**Filter Format:**

```json
[
  { "column": "status", "op": "eq", "value": "active" },
  { "column": "name", "op": "contains", "value": "test" }
]
```

Supported operators: `eq`, `contains`, `in`. Multiple conditions are combined with AND.

**Response:**

```json
{
  "rows": [
    { "id": 1, "name": "Item A", "status": "active" }
  ],
  "page": 1,
  "page_size": 50,
  "total_count": 128
}
```

---

### GET /table/row

Get a single row by primary key.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `pk` | Yes | Primary key value |

**Response:**

```json
{ "id": 1, "name": "Item A", "status": "active" }
```

---

## Preview Operations

All preview endpoints generate `CommitOp` arrays that can be applied to a draft without writing to the database. **MainGuard does not apply** (preview is read-only).

### POST /preview/clone

Clone a template row with new primary keys.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "template_pk": { "id": 100 },
  "new_pks": [201, 202, 203],
  "change_column": "status",
  "change_value": "draft"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `template_pk` | Yes | Single PK to clone from (e.g., `{"id": 100}`) |
| `new_pks` | Yes | Array of new PK values |
| `change_column` | No | Column to override in all cloned rows |
| `change_value` | No | Value for the change_column (required if change_column is set) |

**Validation:**
- `template_pk` must contain exactly one key-value pair
- `new_pks` must not be empty
- All `new_pks` must not already exist in the table
- `change_column` must exist in the table and must not be the PK column

**Response:**

```json
{
  "ops": [
    {
      "type": "insert",
      "table": "items",
      "values": { "id": 201, "name": "Item A", "status": "draft" }
    }
  ],
  "warnings": [],
  "errors": []
}
```

**Errors:**
- `400 INVALID_ARGUMENT` - Invalid parameters, PK collisions, change_column not found
- `404 NOT_FOUND` - Template row not found

---

### POST /preview/batch_generate

Similar to clone but with per-row change values.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "template_pk": { "id": 100 },
  "new_pks": [201, 202, 203],
  "change_column": "status",
  "change_values": ["draft", "active", "pending"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `template_pk` | Yes | Single PK to clone from |
| `new_pks` | Yes | Array of new PK values |
| `change_column` | No | Column to vary per row |
| `change_values` | No | Per-row values (length must match `new_pks`) |

**Response:** Same as `/preview/clone`.

---

### POST /preview/bulk_update

Generate update ops from TSV data.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "tsv_data": "id\tstatus\tname\n100\tactive\tUpdated Item\n101\tdraft\tAnother Item"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `tsv_data` | Yes | Tab-separated values (first column = PK, first row = header) |

**TSV Format:**
- First row: column headers (tab-separated)
- First column: must be the table's PK column
- Subsequent rows: data values

**Validation:**
- TSV must have header and at least one data row
- Must have PK column and at least one update column
- First column must match the table's PK column name
- All column names must exist in the table schema
- Duplicate PKs are not allowed
- All PKs must exist in the table (updates only, not inserts)

**Response:**

```json
{
  "ops": [
    {
      "type": "update",
      "table": "items",
      "values": { "status": "active", "name": "Updated Item" },
      "pk": { "id": "100" }
    }
  ],
  "warnings": [],
  "errors": []
}
```

### PreviewError Format

When the `errors` array is non-empty, individual row errors are returned:

```json
{
  "ops": [],
  "warnings": ["Some PKs may have stale data"],
  "errors": [
    {
      "row_index": 2,
      "code": "INVALID_ARGUMENT",
      "message": "Column 'xyz' does not exist",
      "details": null
    }
  ]
}
```

---

## Write Operations

### POST /commit

Apply draft operations to a branch. **MainGuard applies.**

Uses optimistic locking: `expected_head` must match the branch's current HEAD hash, otherwise `STALE_HEAD` is returned.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "commit_message": "Add new items",
  "ops": [
    {
      "type": "insert",
      "table": "items",
      "values": { "id": 201, "name": "New Item", "status": "draft" }
    },
    {
      "type": "update",
      "table": "items",
      "values": { "status": "active" },
      "pk": { "id": 100 }
    }
  ]
}
```

**CommitOp Types:**

| Type | Description | Fields |
|------|-------------|--------|
| `insert` | Insert a new row | `table`, `values` (must include PK) |
| `update` | Update an existing row | `table`, `values` (changed columns only), `pk` |

**Response:**

```json
{ "hash": "newcommithash123..." }
```

**Errors:**
- `403 FORBIDDEN` - MainGuard (write to main)
- `409 STALE_HEAD` - expected_head mismatch

---

### POST /sync

Merge main branch into work branch (two-stage merge). **MainGuard applies.**

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123..."
}
```

**Response (success):**

```json
{ "hash": "newmergehash123..." }
```

**Errors:**
- `403 FORBIDDEN` - MainGuard
- `409 STALE_HEAD` - expected_head mismatch
- `409 MERGE_CONFLICTS_PRESENT` - Data conflicts detected
- `409 SCHEMA_CONFLICTS_PRESENT` - Schema conflicts detected (requires CLI intervention)
- `409 CONSTRAINT_VIOLATIONS_PRESENT` - Constraint violations detected (requires CLI intervention)

---

## Diff & History

### GET /diff/table

Get row-level diff between two refs for a table.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name (connection context) |
| `table` | Yes | | Table name |
| `from_ref` | Yes | | Source ref (e.g., `main`) |
| `to_ref` | Yes | | Target ref (e.g., `wi/work-1`) |
| `mode` | No | `two_dot` | `two_dot` or `three_dot` |
| `skinny` | No | `false` | If `true`, return PK-only diffs |

**Response:**

```json
{
  "rows": [
    {
      "diff_type": "added",
      "to": { "id": 201, "name": "New Item" }
    },
    {
      "diff_type": "modified",
      "from": { "id": 100, "status": "draft" },
      "to": { "id": 100, "status": "active" }
    },
    {
      "diff_type": "removed",
      "from": { "id": 50, "name": "Deleted Item" }
    }
  ]
}
```

---

### GET /history/commits

Get commit history for a branch.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name |
| `page` | No | `1` | Page number (must be > 0) |
| `page_size` | No | `20` | Commits per page (1-100) |

**Response:**

```json
[
  {
    "hash": "abc123...",
    "author": "user",
    "message": "Add new items",
    "timestamp": "2026-02-12T10:30:00Z"
  }
]
```

---

### GET /history/row

Get change history for a specific row.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name |
| `table` | Yes | | Table name |
| `pk` | Yes | | Primary key value |
| `limit` | No | `20` | Max entries (1-100) |

**Response:**

Array of historical row states with commit metadata.

---

## Conflict Resolution

### GET /conflicts

Get conflict summary for a branch.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |

**Response:**

```json
[
  {
    "table": "items",
    "schema_conflicts": 0,
    "data_conflicts": 3,
    "constraint_violations": 0
  }
]
```

---

### GET /conflicts/table

Get detailed conflicts for a specific table.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |

**Response:**

```json
[
  {
    "base": { "id": 100, "status": "original" },
    "ours": { "id": 100, "status": "our-change" },
    "theirs": { "id": 100, "status": "their-change" }
  }
]
```

---

### POST /conflicts/resolve

Resolve all conflicts in a table using a strategy. **MainGuard applies.**

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "table": "items",
  "strategy": "ours"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `strategy` | Yes | `ours` (keep work branch changes) or `theirs` (accept main changes) |

**Response:**

```json
{ "hash": "newcommithash123..." }
```

---

## Request / Approval Workflow

### POST /request/submit

Submit a work branch for review. **MainGuard applies.**

Creates a Dolt tag with prefix `req/` containing the submission metadata.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "summary_ja": "アイテムのステータスを更新しました"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `expected_head` | Yes | Expected HEAD hash for optimistic locking |
| `summary_ja` | Yes | Change summary in Japanese |

**Response:**

```json
{
  "request_id": "req/wi-work-1/1707744000",
  "submitted_main_hash": "mainhead123...",
  "submitted_work_hash": "workhead123..."
}
```

---

### GET /requests

List pending approval requests.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |

**Response:**

```json
[
  {
    "request_id": "req/wi-work-1/1707744000",
    "work_branch": "wi/work-1",
    "submitted_main_hash": "mainhead123...",
    "submitted_work_hash": "workhead123...",
    "summary_ja": "アイテムのステータスを更新しました",
    "submitted_at": "2026-02-12T10:30:00Z"
  }
]
```

---

### GET /request

Get a specific request's details.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `request_id` | Yes | Request ID |

**Response:** Same structure as individual item in `/requests`.

---

### POST /request/approve

Approve a request and merge into main via **3-way merge** (Dolt cell-level merge).

On success:
- Creates `merged/{item}/{round}` audit tag
- Deletes the work branch (`wi/{item}/{round}`)
- Creates the next-round branch (`wi/{item}/{round+1}`) from the new main HEAD
- Returns the new main HEAD hash and the next-round branch name

**No freeze gate**: multiple branches can be approved concurrently. Dolt's cell-level 3-way merge automatically resolves non-overlapping changes. Only same-cell conflicts cause an abort.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "request_id": "req/wi-work-1/1707744000",
  "merge_message_ja": "承認マージ: アイテム更新"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `request_id` | Yes | Request ID to approve |
| `merge_message_ja` | Yes | Merge commit message |

**Response:**

```json
{
  "hash": "mergecommithash123...",
  "next_branch": "wi/wi-work-1/2"
}
```

| Field | Description |
|-------|-------------|
| `hash` | New main HEAD hash after merge |
| `next_branch` | Auto-created next-round branch name (e.g., `wi/foo/02`) |

**Errors:**

| Code | HTTP | Condition |
|------|------|-----------|
| `PRECONDITION_FAILED` | 412 | Work branch HEAD has changed since submission |
| `MERGE_CONFLICTS_PRESENT` | 409 | Same-cell conflict detected; merge was aborted, branch is intact |
| `NOT_FOUND` | 404 | Request ID not found |

---

### POST /request/reject

Reject a request. Removes the `req/` tag. **The work branch is preserved** so the assignee can make corrections and re-submit.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "request_id": "req/wi-work-1/1707744000"
}
```

**Response:**

```json
{ "status": "rejected" }
```

---

## Version History

### GET /versions

List all approved merge versions, derived from `merged/*` Dolt tags. Used by the History tab to populate the version selector for comparing two points in time.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `project` | No | Filter by project name (e.g., `ProjectA`) |

**Response:**

```json
[
  {
    "tag_name": "merged/ProjectA/01",
    "tag_hash": "abc123...",
    "message": "承認マージ: ProjectA round 1"
  },
  {
    "tag_name": "merged/ProjectB/01",
    "tag_hash": "def456...",
    "message": "承認マージ: ProjectB round 1"
  }
]
```

Returns an empty array `[]` if no merged versions exist.

---

### GET /diff/summary

Get a DB-wide change summary across all tables between two refs. Used by the History tab and approver inbox to show high-level impact before drilling into row-level diffs.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `from_ref` | Yes | Source ref (commit hash, tag name, or branch name) |
| `to_ref` | Yes | Target ref |

**Response:**

```json
{
  "tables": [
    { "name": "Test1", "added": 3, "modified": 5, "removed": 1 },
    { "name": "Test2", "added": 0, "modified": 2, "removed": 0 }
  ],
  "total": { "added": 3, "modified": 7, "removed": 1 }
}
```

Returns counts per table and an aggregated `total`. Tables with zero changes are omitted.

---

## Health Check

### GET /health

**Response:**

```json
{ "status": "ok" }
```

---

## UI State Machine

The frontend manages a state machine with the following states:

| State | Description | Allowed Actions |
|-------|-------------|-----------------|
| `Idle` | Ready, no pending changes | Edit, Sync, Submit Request |
| `DraftEditing` | Unsaved draft operations in sessionStorage | Edit, Commit |
| `Previewing` | Preview modal active | Apply/Cancel preview |
| `Committing` | Commit in progress | Wait |
| `Syncing` | Sync in progress | Wait |
| `MergeConflictsPresent` | Data conflicts after sync | Resolve conflicts |
| `SchemaConflictDetected` | Schema conflicts after sync | CLI intervention required |
| `ConstraintViolationDetected` | Constraint violations after sync | CLI intervention required |
| `StaleHeadDetected` | HEAD hash mismatch | Refresh HEAD |

**Orthogonal Flag:** `requestPending` (boolean) - indicates a pending approval request exists.

### UI Guards

- **MainGuard**: All editing, clone, bulk update, commit, sync, and submit operations are disabled on the `main` branch.
- **DraftGuard**: Sync and Submit Request are disabled while draft operations exist.
- **ConflictGuard**: All editing, clone, bulk update, commit, sync, and submit are disabled while in any conflict state (`MergeConflictsPresent`, `SchemaConflictDetected`, `ConstraintViolationDetected`).
- **StaleHeadGuard**: Commit is disabled when HEAD is stale. User must refresh HEAD first.
