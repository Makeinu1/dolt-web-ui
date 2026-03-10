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
| `PK_COLLISION` | 400 | Insert would duplicate an existing primary key |
| `FORBIDDEN` | 403 | Operation not allowed (e.g., write to main) |
| `NOT_FOUND` | 404 | Resource not found |
| `STALE_HEAD` | 409 | expected_head does not match current HEAD |
| `MERGE_CONFLICTS_PRESENT` | 409 | Merge produced data conflicts |
| `SCHEMA_CONFLICTS_PRESENT` | 409 | Merge produced schema conflicts |
| `CONSTRAINT_VIOLATIONS_PRESENT` | 409 | Merge produced constraint violations |
| `BRANCH_EXISTS` | 409 | Work branch already exists; open the existing branch instead of creating a new one |
| `BRANCH_NOT_READY` | 409 | Branch was created but is not queryable yet; retry after a short delay |
| `BRANCH_LOCKED` | 423 | Branch is locked (pending approval request exists) |
| `PRECONDITION_FAILED` | 412 | Precondition check failed |
| `INTERNAL` | 500 | Internal server error |

### ProtectedBranchGuard

Write operations on protected branches (`main` and `audit`) are forbidden. Affected endpoints return:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "write operations on main branch are forbidden",
    "details": { "reason": "main_guard", "branch": "main" }
  }
}
```

### BranchLock

Work branches with a pending approval request (`req/*` tag) are locked. Commit, Sync, and Revert operations are blocked until the request is approved or rejected.

```json
{
  "error": {
    "code": "BRANCH_LOCKED",
    "message": "承認申請中のブランチは編集できません。却下されるとロックが解除されます。",
    "details": { "request_tag": "req/work-1" }
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

Create a new work branch from main. **ProtectedBranchGuard applies.**

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

**Recoverable errors:**

- `409 BRANCH_EXISTS`

```json
{
  "error": {
    "code": "BRANCH_EXISTS",
    "message": "ブランチ wi/my-branch は既に存在します。既存の作業ブランチを開いて続行してください。",
    "details": {
      "branch_name": "wi/my-branch",
      "open_existing": true
    }
  }
}
```

- `409 BRANCH_NOT_READY`

```json
{
  "error": {
    "code": "BRANCH_NOT_READY",
    "message": "ブランチ wi/my-branch は作成されましたが、まだ接続準備が完了していません。少し待ってから開いてください。",
    "details": {
      "branch_name": "wi/my-branch",
      "retry_after_ms": 2000
    }
  }
}
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

List user tables (excludes `dolt_*` system tables and `_cell_*` internal tables).

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

Get paginated rows with optional filtering and sorting. Response is streamed row-by-row to prevent OOM on large tables.

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

All preview endpoints generate `CommitOp` arrays that can be applied to a draft without writing to the database. **ProtectedBranchGuard does not apply** (preview is read-only).

### POST /preview/clone

Clone a template row with new primary key values. Supports single and composite PKs.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "template_pk": { "region": "JP", "circuit_id": 100 },
  "vary_column": "circuit_id",
  "new_values": [201, 202, 203],
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
| `template_pk` | Yes | PK map of the row to clone from. All PK columns required for composite PK. |
| `vary_column` | Conditional | PK column whose value differs in each cloned row. Required for composite PK; auto-detected for single PK. |
| `new_values` | Yes | Array of new values for `vary_column` in each cloned row. |
| `new_pks` | No | Deprecated alias for `new_values` (single-PK backward compat). |
| `change_column` | No | Non-PK column to override uniformly in all cloned rows. |
| `change_value` | No | Value for `change_column` (required if `change_column` is set). |

**Validation:**
- `template_pk` must not be empty
- `new_values` (or `new_pks`) must not be empty
- `vary_column` must be present in `template_pk`
- For composite PK tables, `vary_column` is required
- Collisions are detected at commit time via `PK_COLLISION` (not at preview time)
- `change_column` must exist in the table

**Response:**

```json
{
  "ops": [
    {
      "type": "insert",
      "table": "items",
      "values": { "region": "JP", "circuit_id": 201, "name": "...", "status": "draft" }
    }
  ],
  "warnings": [],
  "errors": []
}
```

**Errors:**
- `400 INVALID_ARGUMENT` - Invalid parameters, vary_column not in template_pk, change_column not found
- `404 NOT_FOUND` - Template row not found

---

### POST /preview/batch_generate

Similar to `/preview/clone` but supports per-row `change_column` values.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "template_pk": { "region": "JP", "circuit_id": 100 },
  "vary_column": "circuit_id",
  "new_values": [201, 202, 203],
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
| `template_pk` | Yes | PK map of the row to clone from |
| `vary_column` | Conditional | PK column to vary (required for composite PK) |
| `new_values` | Yes | Array of new values for `vary_column` |
| `new_pks` | No | Deprecated alias for `new_values` |
| `change_column` | No | Column to vary per row |
| `change_values` | No | Per-row values for `change_column` (length must match `new_values`) |

**Response:** Same format as `/preview/clone`.

**Errors:**
- `400 INVALID_ARGUMENT` - change_values length mismatch, invalid column names, vary_column not in template_pk

---

### POST /preview/bulk_update

Generate update ops from TSV data. Supports composite PK tables.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "circuits",
  "tsv_data": "region\tcircuit_id\tstatus\nJP\t100\tactive\nEU\t200\tdraft"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `tsv_data` | Yes | Tab-separated values. Header row required. |

**TSV Format:**
- First row: column headers (tab-separated)
- First N columns: must match the table's PK columns **in schema order** (N ≥ 1)
- Remaining columns: update target columns (must not include PK columns)
- PK columns are determined from the table schema at request time

**Example (composite PK: region + circuit_id):**
```
region\tcircuit_id\tstatus\tname
JP\t100\tactive\tSuzuka
EU\t200\tdraft\tMonza
```

**Validation:**
- TSV must have header and at least one data row
- First N headers must match schema PK column names in order
- Update columns must exist in the table and must not be PK columns
- Duplicate PK combinations are not allowed within the TSV
- All PK combinations must exist in the table (bulk_update is update-only)

**Response:**

```json
{
  "ops": [
    {
      "type": "update",
      "table": "circuits",
      "values": { "status": "active", "name": "Suzuka" },
      "pk": { "region": "JP", "circuit_id": "100" }
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

Apply draft operations to a branch. **ProtectedBranchGuard applies.** **BranchLock applies.**

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
| `delete` | Delete an existing row | `table`, `pk` |

**Validation:**
- `ops` must not be empty (`400 INVALID_ARGUMENT` if empty array is sent)
- For `update` and `delete`: `pk` must contain exactly one key-value pair
- For `delete`: `values` field is ignored

**Response:**

```json
{ "hash": "newcommithash123..." }
```

**Errors:**
- `400 INVALID_ARGUMENT` - Empty ops array, invalid table/column name, or empty pk
- `403 FORBIDDEN` - ProtectedBranchGuard (write to main/audit)
- `404 NOT_FOUND` - Row not found (update/delete with non-existent pk)
- `409 STALE_HEAD` - expected_head mismatch
- `423 BRANCH_LOCKED` - Branch has pending approval request

---

### POST /sync

Merge main branch into work branch (two-stage merge). **ProtectedBranchGuard applies.** **BranchLock applies.**

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
- `403 FORBIDDEN` - ProtectedBranchGuard
- `409 STALE_HEAD` - expected_head mismatch
- `409 MERGE_CONFLICTS_PRESENT` - Data conflicts detected
- `423 BRANCH_LOCKED` - Branch has pending approval request
- `409 SCHEMA_CONFLICTS_PRESENT` - Schema conflicts detected (requires CLI intervention)
- `409 CONSTRAINT_VIOLATIONS_PRESENT` - Constraint violations detected (requires CLI intervention)

---

### POST /revert

Revert a specific commit on a work branch. Creates a new revert commit. **ProtectedBranchGuard applies.** **BranchLock applies.**

Uses optimistic locking: `expected_head` must match the branch's current HEAD hash.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "revert_hash": "def456..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `expected_head` | Yes | Expected HEAD hash for optimistic locking |
| `revert_hash` | Yes | Hash of the commit to revert |

**Response:**

```json
{ "hash": "newheadhash123..." }
```

**Errors:**
- `400 INVALID_ARGUMENT` - Empty `revert_hash`
- `403 FORBIDDEN` - ProtectedBranchGuard (write to main/audit)
- `409 STALE_HEAD` - expected_head mismatch
- `423 BRANCH_LOCKED` - Branch has pending approval request

---

## Diff & History

### GET /diff/table

Get row-level diff between two refs for a table. Supports pagination.

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
| `diff_type` | No | | Filter by type: `added`, `modified`, or `removed` |
| `page` | No | `1` | Page number (must be > 0) |
| `page_size` | No | `50` | Rows per page (1-200) |

**Response:**

```json
{
  "rows": [
    {
      "diff_type": "added",
      "from": {},
      "to": { "id": 201, "name": "New Item" }
    },
    {
      "diff_type": "modified",
      "from": { "id": 100, "status": "draft" },
      "to": { "id": 100, "status": "active" }
    },
    {
      "diff_type": "removed",
      "from": { "id": 50, "name": "Deleted Item" },
      "to": {}
    }
  ],
  "total_count": 42,
  "page": 1,
  "page_size": 50
}
```

---

### GET /diff/export-zip

Export all diff rows across all tables as a ZIP archive containing per-table, per-diff-type CSV files.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name (connection context) |
| `from_ref` | Yes | | Source ref |
| `to_ref` | Yes | | Target ref |
| `mode` | No | `three_dot` | `two_dot` or `three_dot` |

**Response:**

Binary ZIP file with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="diff-{from}-{to}.zip"`.

**ZIP contents:**

| File | Contents |
|------|----------|
| `{table}_insert.csv` | Added rows (new values only) |
| `{table}_update.csv` | Modified rows (new values only; old values not included) |
| `{table}_delete.csv` | Removed rows (old values) |

Files for unchanged tables or empty diff types are omitted.

**Errors:**
- `400 INVALID_ARGUMENT` - Missing required parameters or invalid ref format

---

### GET /history/commits

Get commit history for a branch. Supports filtering by commit type.

**Query Parameters:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name |
| `page` | No | `1` | Page number (must be > 0) |
| `page_size` | No | `20` | Commits per page (1-100) |
| `filter` | No | `all` | See filter values below |
| `keyword` | No | | Substring match on commit message (e.g., `TR-9999`) |
| `from_date` | No | | Start date inclusive (`YYYY-MM-DD`) |
| `to_date` | No | | End date inclusive (`YYYY-MM-DD`) |

**Filter Values:**

| Value | Description |
|-------|-------------|
| `all` | All commits (default) |
| `merges_only` | Merge commits only (useful for main branch) |
| `exclude_auto_merge` | Exclude auto-sync merge commits (useful for work branches) |
| `exclude_comments` | Exclude `[comment]`-prefixed commits created by the cell comment feature |
| `exclude_auto_merge_and_comments` | Combine `exclude_auto_merge` + `exclude_comments` (default filter in the HistoryTab UI) |

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
    "data_conflicts": 3,
    "schema_conflicts": 0
  }
]
```

> **Note:** `data_conflicts` and `schema_conflicts` correspond to Dolt v1.x `DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY` columns `num_data_conflicts` and `num_schema_conflicts`. There is no `constraint_violations` field.

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

Resolve all conflicts in a table using a strategy. **ProtectedBranchGuard applies.**

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

Submit a work branch for review. **ProtectedBranchGuard applies.**

**Auto-sync behavior**: Before creating the `req/` tag, this endpoint automatically merges `main` into the work branch (`DOLT_MERGE('main')`). If the merge produces conflicts, `409 MERGE_CONFLICTS_PRESENT` is returned and no tag is created. The caller must resolve conflicts and retry.

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
  "request_id": "req/work-1",
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
    "request_id": "req/work-1",
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
- Deletes the pending request tag (`req/{item}`)
- Advances the existing work branch (`wi/{item}`) to the new main HEAD
- Returns the new main HEAD hash, the active work branch, archive tag, and any warnings

**No freeze gate**: multiple branches can be approved concurrently. Dolt's cell-level 3-way merge automatically resolves non-overlapping changes. Only same-cell conflicts cause an abort.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "request_id": "req/work-1",
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
  "active_branch": "wi/work-1",
  "active_branch_advanced": true,
  "archive_tag": "merged/work-1/01",
  "warnings": []
}
```

| Field | Description |
|-------|-------------|
| `hash` | New main HEAD hash after merge |
| `active_branch` | Existing work branch name retained for subsequent work |
| `active_branch_advanced` | Whether the work branch was successfully advanced to the new main HEAD |
| `archive_tag` | Audit tag created for this approved merge (e.g., `merged/foo/01`) |
| `warnings` | Non-fatal follow-up issues, such as branch realignment failure |

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
  "request_id": "req/work-1"
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

**Query Parameters (full list):**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `target_id` | Yes | | Target ID |
| `db_name` | Yes | | Database name |
| `branch_name` | Yes | | Branch name (connection context) |
| `from_ref` | No | `main` | Source ref |
| `to_ref` | No | `branch_name` | Target ref |
| `mode` | No | `three_dot` | `two_dot` or `three_dot` |

**Response:**

```json
{
  "entries": [
    { "table": "Test1", "added": 3, "modified": 5, "removed": 1 },
    { "table": "Test2", "added": 0, "modified": 2, "removed": 0 }
  ]
}
```

Returns an `entries` array with one entry per table. Tables with zero changes are included if they appear in the diff. Returns `{"entries": []}` if no changes.

---

## Cell Comments

Stores per-cell notes (table + PK + column) in a `_cell_comments` Dolt table on the branch. Each add/delete operation creates an immediate Dolt commit with the `[comment]` prefix. UUID primary keys prevent merge conflicts between parallel branches.

**Comment object:**

```json
{
  "comment_id": "550e8400-e29b-41d4-a716-446655440000",
  "table_name": "items",
  "pk_value": "42",
  "column_name": "price",
  "comment_text": "REQ-123: 帯域制限を200Mbpsに変更",
  "created_at": "2026-02-20T14:30:00Z"
}
```

---

### GET /comments

Get all comments for a specific cell (table + PK + column combination), sorted oldest-first.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `pk` | Yes | Primary key value |
| `column` | Yes | Column name |

**Response:**

```json
[
  {
    "comment_id": "550e8400-...",
    "table_name": "items",
    "pk_value": "42",
    "column_name": "price",
    "comment_text": "初期設定値",
    "created_at": "2026-02-15T09:15:00Z"
  }
]
```

Returns `[]` if no comments exist or if the `_cell_comments` table does not exist yet.

---

### GET /comments/map

Get the set of cells that have at least one comment for a given table. Used by the frontend to render amber triangle markers on commented cells.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |

**Response:**

```json
{ "cells": ["42:price", "55:name"] }
```

Each entry is formatted as `"{pk_value}:{column_name}"`. Returns `{"cells": []}` if no comments exist.

---

### POST /comments

Add a new comment to a cell. **ProtectedBranchGuard applies.**

Creates an immediate Dolt commit with the message `[comment] {table}/{pk}/{column}`.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table_name": "items",
  "pk_value": "42",
  "column_name": "price",
  "comment_text": "REQ-123: 帯域制限を200Mbpsに変更"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table_name` | Yes | Table name (validated identifier) |
| `pk_value` | Yes | Primary key value as string |
| `column_name` | Yes | Column name (validated identifier) |
| `comment_text` | Yes | Comment content (1–5000 characters) |

**Response:**

```json
{ "comment_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**Errors:**
- `400 INVALID_ARGUMENT` - Empty or oversized `comment_text`, invalid table/column name
- `403 FORBIDDEN` - ProtectedBranchGuard (write to main)

**Note:** Row existence is not validated. Comments can be written to any table/PK/column combination. If the referenced row is later deleted, the comment is automatically cascade-deleted.

---

### POST /comments/delete

Delete a comment by ID. **ProtectedBranchGuard applies.**

Creates an immediate Dolt commit with message `[comment] deleted`. Deletion is idempotent — if the comment ID does not exist, the operation succeeds with 0 rows deleted.

**Request Body:**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "comment_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**

```json
{ "status": "deleted" }
```

**Errors:**
- `403 FORBIDDEN` - ProtectedBranchGuard (write to main)

---

### GET /comments/search

Search comments by keyword within a branch (partial match, case-sensitive `LIKE`). Returns results sorted newest-first.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `q` | Yes | Search keyword (non-empty) |

**Response:**

Array of comment objects sorted by `created_at DESC`.

```json
[
  {
    "comment_id": "...",
    "table_name": "items",
    "pk_value": "42",
    "column_name": "price",
    "comment_text": "REQ-123: 帯域制限を200Mbpsに変更",
    "created_at": "2026-02-20T14:30:00Z"
  }
]
```

Returns `[]` if no matches or if `_cell_comments` does not exist.

**Errors:**
- `400 INVALID_ARGUMENT` - Empty `q` parameter

---

### GET /comments/for-pks

Batch-fetch all comments for a set of primary key values in a single table. Used by `DiffCommentsPanel` to display comments for changed rows in a diff view.

**Query Parameters:**

| Name | Required | Description |
|------|----------|-------------|
| `target_id` | Yes | Target ID |
| `db_name` | Yes | Database name |
| `branch_name` | Yes | Branch name |
| `table` | Yes | Table name |
| `pks` | Yes | Comma-separated PK values (e.g., `42,55,99`). Empty string returns `[]`. |

**Response:**

Array of comment objects for the given PKs (all columns), sorted by `pk_value`, then `column_name`, then `created_at`.

Returns `[]` if no comments exist or `pks` is empty.

---

## Health Check

### GET /health

> **Note:** This endpoint is at the root path `/health`, **not** under `/api/v1/health`.

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

**Orthogonal Counter:** `requestCount` (number) - count of pending approval requests. Auto-fetched on app load and context switch. `0` means none pending.

### UI Guards

- **ProtectedBranchGuard**: All editing, clone, bulk update, commit, sync, and submit operations are disabled on protected branches (`main` and `audit`).
- **BranchLockGuard**: Commit, Sync, and Revert operations are blocked while a pending approval request (`req/*` tag) exists for the branch.
- **DraftGuard**: Sync and Submit Request are disabled while draft operations exist.
- **ConflictGuard**: All editing, clone, bulk update, commit, sync, and submit are disabled while in any conflict state (`MergeConflictsPresent`, `SchemaConflictDetected`, `ConstraintViolationDetected`).
- **StaleHeadGuard**: Commit is disabled when HEAD is stale. User must refresh HEAD first.
