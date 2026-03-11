# Dolt Web UI API Reference

Base URL: `/api/v1`

This document covers the endpoints currently registered by the server router.
Removed legacy routes such as `/sync`, `/versions`, `/comments/*`, and `/conflicts/*`
are intentionally omitted.

## Common Conventions

### Error Envelope

All errors use the envelope format below.

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

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_ARGUMENT` | 400 | Missing or invalid request parameters |
| `PK_COLLISION` | 400 | Insert would duplicate an existing primary key |
| `FORBIDDEN` | 403 | Operation is not allowed on the target ref |
| `NOT_FOUND` | 404 | Resource not found |
| `STALE_HEAD` | 409 | `expected_head` did not match current HEAD |
| `MERGE_CONFLICTS_PRESENT` | 409 | Merge produced same-cell conflicts |
| `SCHEMA_CONFLICTS_PRESENT` | 409 | Schema conflicts detected during merge preview |
| `CONSTRAINT_VIOLATIONS_PRESENT` | 409 | Constraint violations detected during merge |
| `PRECONDITION_FAILED` | 412 | Precondition check failed |
| `BRANCH_EXISTS` | 409 | Destination work branch already exists |
| `BRANCH_NOT_READY` | 409 | Branch exists but is not queryable yet |
| `BRANCH_LOCKED` | 423 | Work branch is locked by a pending request |
| `COPY_DATA_ERROR` | 400 | Cross-copy / CSV write failed because of data shape |
| `COPY_FK_ERROR` | 400 | Cross-copy / CSV write failed because of FK constraints |
| `INTERNAL` | 500 | Internal server error |

### Protected Branches

`main` and `audit` are protected. Public write endpoints reject them with `403 FORBIDDEN`.

Example:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "write operations on protected branch are forbidden",
    "details": {
      "reason": "protected_branch_guard",
      "branch": "main"
    }
  }
}
```

### Operation Result Fields

Write endpoints that complete an application-level action return a structured result:

```json
{
  "outcome": "completed",
  "message": "操作が完了しました",
  "completion": {
    "some_step": true
  },
  "warnings": [],
  "retry_reason": "",
  "retry_actions": [
    { "action": "refresh", "label": "更新する" }
  ]
}
```

Field meaning:

| Field | Meaning |
|------|---------|
| `outcome` | `completed`, `failed`, or `retry_required` |
| `message` | User-facing summary string |
| `completion` | Machine-readable completion truth for important side effects |
| `warnings` | Advisory-only warnings. Current backend emits them only on `completed`. |
| `retry_reason` | Stable retry classifier when `outcome=retry_required` |
| `retry_actions` | UI hints for the retry lane |

### Read Result Fields

Read endpoints that need integrity signaling return:

```json
{
  "read_integrity": "complete",
  "message": "optional",
  "retry_actions": []
}
```

Current backend behavior:

- Successful reads emit `read_integrity="complete"`.
- Integrity failures do not return partial data. They fail loud with `500 INTERNAL`.
- `read_integrity="failed"` is reserved for future compatibility and is not emitted today.

---

## Metadata

### GET /targets

List configured Dolt targets.

**Response**

```json
[
  { "id": "production" }
]
```

### GET /databases

List allowed databases for a target.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |

**Response**

```json
[
  { "name": "psx_data" }
]
```

### GET /branches

List branches for a database.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |

**Response**

```json
[
  { "name": "main", "hash": "abc123..." },
  { "name": "wi/work-1", "hash": "def456..." }
]
```

### GET /branches/ready

Check whether a branch is queryable from a new session.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |

**Response**

```json
{ "ready": true }
```

### POST /branches/create

Create a writable work branch from `main`.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/task-001"
}
```

**Response**

```json
{ "branch_name": "wi/task-001" }
```

### POST /branches/delete

Delete a work branch.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/task-001"
}
```

**Response**

```json
{ "status": "ok" }
```

### GET /head

Get the HEAD hash of a branch or revision.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |

**Response**

```json
{ "hash": "abc123..." }
```

---

## Tables

### GET /tables

List user tables visible on the current revision. Hidden `_memo_*`, `_cell_*`, and `dolt_*`
tables are excluded.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |

**Response**

```json
[
  { "name": "items" },
  { "name": "users" }
]
```

### GET /table/schema

Get the schema for one table.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |
| `table` | Yes |

**Response**

```json
{
  "table": "items",
  "columns": [
    { "name": "id", "type": "bigint", "nullable": false, "primary_key": true },
    { "name": "status", "type": "varchar(32)", "nullable": true, "primary_key": false }
  ]
}
```

### GET /table/rows

Get paginated table rows.

**Query**

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `target_id` | Yes | | |
| `db_name` | Yes | | |
| `branch_name` | Yes | | |
| `table` | Yes | | |
| `page` | No | `1` | |
| `page_size` | No | `50` | Max `1000` |
| `all` | No | `false` | If `true`, forces page `1`, size `1000` |
| `filter` | No | | JSON array of filter conditions |
| `sort` | No | | Comma-separated columns, prefix `-` for DESC |

`filter` example:

```json
[
  { "column": "status", "op": "eq", "value": "active" },
  { "column": "name", "op": "contains", "value": "foo" }
]
```

Supported filter ops: `eq`, `neq`, `contains`, `startsWith`, `endsWith`, `blank`,
`notBlank`, `in`.

**Response**

```json
{
  "rows": [
    { "id": 1, "status": "active" }
  ],
  "page": 1,
  "page_size": 50,
  "total_count": 1
}
```

### GET /table/row

Get a single row by primary key. `pk` is a JSON object so composite PKs are supported.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |
| `table` | Yes |
| `pk` | Yes |

Example:

`pk=%7B%22id%22%3A42%7D`

**Response**

```json
{ "id": 42, "status": "active" }
```

---

## Preview

### POST /preview/clone

Preview row clone operations without writing.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "template_pk": { "id": 100 },
  "vary_column": "id",
  "new_values": [101, 102]
}
```

**Response**

```json
{
  "ops": [
    {
      "type": "insert",
      "table": "items",
      "values": { "id": 101, "status": "draft" }
    }
  ],
  "warnings": [],
  "errors": []
}
```

---

## Write Operations

### POST /commit

Commit inserts, updates, and deletes to a work branch.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "commit_message": "Update item status",
  "ops": [
    {
      "type": "update",
      "table": "items",
      "values": { "status": "active" },
      "pk": { "id": 100 }
    }
  ]
}
```

**Response**

```json
{ "hash": "newcommithash123..." }
```

### POST /merge/abort

Abort a stuck merge state on a work branch.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1"
}
```

**Response**

```json
{ "status": "ok" }
```

---

## Diff & History

### GET /diff/table

Get row-level diff for one table.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `table` | Yes | |
| `from_ref` | Yes | |
| `to_ref` | Yes | |
| `mode` | No | `two_dot` |
| `skinny` | No | `false` |
| `diff_type` | No | |
| `page` | No | `1` |
| `page_size` | No | `50` |

**Response**

```json
{
  "rows": [
    {
      "diff_type": "modified",
      "from": { "id": 100, "status": "draft" },
      "to": { "id": 100, "status": "active" }
    }
  ],
  "total_count": 1,
  "page": 1,
  "page_size": 50
}
```

### GET /diff/summary/light

Get a lightweight changed-table summary.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `from_ref` | No | `main` |
| `to_ref` | No | `branch_name` |
| `mode` | No | `three_dot` |

**Response**

```json
{
  "changed_table_count": 1,
  "tables": [
    {
      "table": "items",
      "has_data_change": true,
      "has_schema_change": false
    }
  ]
}
```

### GET /diff/summary

Get per-table row-count diff summary.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `from_ref` | No | `main` |
| `to_ref` | No | `branch_name` |
| `mode` | No | `three_dot` |

**Response**

```json
{
  "entries": [
    { "table": "items", "added": 1, "modified": 2, "removed": 0 }
  ]
}
```

### GET /diff/export-zip

Export all table diffs as ZIP files split by table and diff type.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `from_ref` | Yes | |
| `to_ref` | Yes | |
| `mode` | No | `three_dot` |

**Response**

Binary ZIP with `Content-Type: application/zip`.

### GET /history/commits

Get approval history commits for the selected revision.

Primary truth is the footer-bearing merge commit on `main`. `merged/*` tags are used
only as a legacy adapter for pre-cutover history that has no footer.

**Query**

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `target_id` | Yes | | |
| `db_name` | Yes | | |
| `branch_name` | Yes | | Can be `main`, a tag, or a commit hash used as revision context |
| `page` | No | `1` | |
| `page_size` | No | `20` | Max `100` |
| `keyword` | No | | |
| `from_date` | No | | `YYYY-MM-DD` inclusive |
| `to_date` | No | | `YYYY-MM-DD` inclusive |
| `search_field` | No | `message` | `message` or `branch` |
| `filter_table` | No | | Record-level filter |
| `filter_pk` | No | | JSON PK object for `filter_table` |

**Response**

```json
{
  "commits": [
    {
      "hash": "abc123...",
      "author": "user",
      "message": "承認マージ: アイテム更新",
      "timestamp": "2026-03-11T10:30:00Z",
      "merge_branch": "wi/work-1"
    }
  ],
  "read_integrity": "complete"
}
```

**Integrity behavior**

- Invalid approval footers do not get skipped. The endpoint fails loud with `500 INTERNAL`.
- Missing `merged/*` tags do not break post-cutover history if the main merge footer exists.

### GET /history/row

Get historical snapshots for a specific record.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `table` | Yes | |
| `pk` | Yes | |
| `limit` | No | `30` |

**Response**

```json
{
  "snapshots": [
    {
      "commit_hash": "abc123...",
      "commit_date": "2026-03-11T10:30:00Z",
      "committer": "user",
      "row": { "id": 42, "status": "active" }
    }
  ]
}
```

---

## Request / Approval

### POST /request/submit

Submit a work branch for approval.

Before recording the request tag, the backend performs the existing auto-sync flow
from `main` into the work branch. If merge preview or merge execution fails, no request
is recorded.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "expected_head": "abc123...",
  "summary_ja": "アイテムのステータスを更新しました"
}
```

**Response**

```json
{
  "request_id": "req/work-1",
  "submitted_main_hash": "mainhead123...",
  "submitted_work_hash": "workhead123...",
  "outcome": "completed",
  "message": "承認を申請しました",
  "completion": {
    "request_recorded": true,
    "lock_observable": true,
    "work_head_synced": true
  }
}
```

### GET /requests

List pending requests.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |

**Response**

```json
[
  {
    "request_id": "req/work-1",
    "work_branch": "wi/work-1",
    "submitted_main_hash": "mainhead123...",
    "submitted_work_hash": "workhead123...",
    "summary_ja": "アイテムのステータスを更新しました",
    "submitted_at": "2026-03-11T10:30:00Z"
  }
]
```

If a legacy `req/*` message JSON is unreadable, the backend still lists the request
using recoverable fields from the tag name and hash.

### GET /request

Get one request summary.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `request_id` | Yes |

**Response**

Same shape as one item from `GET /requests`.

### POST /request/approve

Approve a request and merge the work branch into `main`.

Current contract:

- The canonical audit truth is the merge commit on `main` with an approval footer.
- `merged/*` archive tags are a secondary index only.
- `outcome=completed` means main merge succeeded and postconditions were confirmed.
- `outcome=retry_required` means main merge succeeded, but request cleanup or work-branch
  re-open readiness could not be confirmed.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "request_id": "req/work-1",
  "merge_message_ja": "承認マージ: アイテム更新"
}
```

**Response**

```json
{
  "hash": "mergecommithash123...",
  "active_branch": "wi/work-1",
  "active_branch_advanced": true,
  "archive_tag": "merged/work-1/01",
  "outcome": "completed",
  "message": "main へのマージが完了しました",
  "completion": {
    "main_merged": true,
    "audit_recorded": true,
    "request_cleared": true,
    "resume_branch_ready": true,
    "audit_indexed": true
  }
}
```

Retry example fields:

```json
{
  "outcome": "retry_required",
  "retry_reason": "request_cleanup_failed",
  "retry_actions": [
    { "action": "refresh_requests", "label": "Inbox を更新する" }
  ]
}
```

### POST /request/reject

Reject a request and delete the `req/*` tag. The work branch is preserved.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "request_id": "req/work-1"
}
```

**Response**

```json
{
  "status": "rejected",
  "outcome": "completed",
  "message": "申請を却下しました",
  "completion": {
    "request_cleared": true
  }
}
```

---

## Memo

### GET /memo/map

Return the set of `pk:column` cells that have memo text for a table.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |
| `table` | Yes |

**Response**

```json
{ "cells": ["42:price", "55:name"] }
```

If the hidden memo table does not exist, the response is `{"cells": []}`.

### GET /memo

Get the memo for one cell.

**Query**

| Name | Required |
|------|----------|
| `target_id` | Yes |
| `db_name` | Yes |
| `branch_name` | Yes |
| `table` | Yes |
| `pk` | Yes |
| `column` | Yes |

**Response**

```json
{
  "pk_value": "42",
  "column_name": "price",
  "memo_text": "REQ-123",
  "updated_at": "2026-03-11T10:30:00"
}
```

If no memo exists, the endpoint still returns `200 OK` with `memo_text: ""`.

---

## Cross-DB Copy

### Source Ref Policy

Cross-copy source refs are fixed to protected truth only.

- `source_branch` is required on the wire.
- Allowed values are only `main` and `audit`.
- Any `wi/*` or other ref returns `400 INVALID_ARGUMENT`.

### POST /cross-copy/preview

Preview row copy from `source_db/source_branch` into `dest_db/dest_branch`.

**Request**

```json
{
  "target_id": "production",
  "source_db": "source_db",
  "source_branch": "main",
  "source_table": "users",
  "source_pks": ["{\"id\":1}"],
  "dest_db": "dest_db",
  "dest_branch": "wi/import-users"
}
```

**Response**

```json
{
  "shared_columns": ["id", "name"],
  "source_only_columns": [],
  "dest_only_columns": ["updated_at"],
  "warnings": [],
  "rows": [
    {
      "source_row": { "id": 1, "name": "Alice" },
      "dest_row": { "id": 1, "name": "Alicia" },
      "action": "update"
    }
  ],
  "expand_columns": []
}
```

If `expand_columns` is non-empty, normal flow must stop and schema prep is required.
Use the admin lane below to widen destination `main` before retrying copy.

### POST /cross-copy/rows

Copy selected rows into an existing destination work branch.

**Request**

Same shape as `POST /cross-copy/preview`.

**Response**

```json
{
  "hash": "abc123...",
  "inserted": 3,
  "updated": 1,
  "total": 4,
  "outcome": "completed",
  "message": "他DBへ行をコピーしました",
  "completion": {
    "destination_committed": true,
    "destination_branch_ready": true,
    "protected_refs_clean": true
  }
}
```

Behavior:

- If preview would require schema widening, the endpoint fails before writes with
  `412 PRECONDITION_FAILED` and `details.expand_columns`.
- Schema prep for this case is handled by `POST /cross-copy/admin/prepare-rows`.
- `retry_required` is used when the destination commit may exist but branch readiness
  could not be confirmed.
- Normal flow does not mutate `main` or other protected refs.

### POST /cross-copy/table

Copy a full table into a destination import branch.

**Request**

```json
{
  "target_id": "production",
  "source_db": "source_db",
  "source_branch": "main",
  "source_table": "users",
  "dest_db": "dest_db"
}
```

**Response**

```json
{
  "hash": "abc123...",
  "branch_name": "wi/import-source_db-users",
  "row_count": 123,
  "shared_columns": ["id", "name"],
  "source_only_columns": [],
  "dest_only_columns": [],
  "outcome": "completed",
  "message": "他DBへテーブルをコピーしました",
  "completion": {
    "destination_committed": true,
    "destination_branch_ready": true,
    "protected_refs_clean": true
  }
}
```

Behavior:

- Import branch name is `wi/import-<source_db>-<table>`.
- If the branch already exists, the endpoint returns `409 BRANCH_EXISTS`.
- If schema widening is required, the endpoint returns `412 PRECONDITION_FAILED`.
- Schema prep for this case is handled by `POST /cross-copy/admin/prepare-table`.
- Stale deterministic import branches can be cleared by
  `POST /cross-copy/admin/cleanup-import`.
- If import-lane setup fails and cleanup succeeds, the response is `outcome=failed`.
- If cleanup fails, or commit/readiness is uncertain, the response is `outcome=retry_required`.

### POST /cross-copy/admin/prepare-rows

Prepare destination `main` for a row copy, then sync `main` into the destination
`wi/*` branch so the next normal copy can proceed.

**Request**

```json
{
  "target_id": "production",
  "source_db": "source_db",
  "source_branch": "main",
  "source_table": "users",
  "dest_db": "dest_db",
  "dest_branch": "wi/work-1"
}
```

**Response**

```json
{
  "main_hash": "abc123...",
  "branch_hash": "def456...",
  "prepared_columns": [
    {
      "name": "name",
      "src_type": "varchar(255)",
      "dst_type": "varchar(50)"
    }
  ],
  "overwritten_tables": ["users"],
  "outcome": "completed",
  "message": "cross-copy 用の schema prep を完了しました",
  "completion": {
    "protected_schema_prepared": true,
    "destination_branch_synced": true,
    "destination_branch_ready": true,
    "protected_refs_clean": true
  }
}
```

Behavior:

- Schema comparison is against destination `main`, not destination `dest_branch`.
- If destination `main` was already wide enough, the endpoint may return an empty
  `prepared_columns` list and still sync `main -> dest_branch`.
- If protected schema prep committed but branch sync or readiness is uncertain, the
  endpoint returns `outcome=retry_required` instead of a raw blocking error.
- Maintenance commits are operational only. They do not write approval footers and do
  not affect MergeLog / approval history truth.

### POST /cross-copy/admin/prepare-table

Prepare destination `main` for a full-table copy. This endpoint does not create the
import branch.

**Request**

```json
{
  "target_id": "production",
  "source_db": "source_db",
  "source_branch": "main",
  "source_table": "users",
  "dest_db": "dest_db"
}
```

**Response**

```json
{
  "main_hash": "abc123...",
  "prepared_columns": [
    {
      "name": "name",
      "src_type": "varchar(255)",
      "dst_type": "varchar(50)"
    }
  ],
  "outcome": "completed",
  "message": "table copy 用の schema prep を完了しました",
  "completion": {
    "protected_schema_prepared": true,
    "protected_refs_clean": true
  }
}
```

Behavior:

- This endpoint only widens destination `main`. Users must retry
  `POST /cross-copy/table` explicitly after it succeeds.
- `prepared_columns` reports the widening work applied to destination `main`.
- If the protected maintenance commit becomes ambiguous, the endpoint returns
  `outcome=retry_required`.

### POST /cross-copy/admin/cleanup-import

Delete a deterministic stale import branch before retrying a full-table copy.

**Request**

```json
{
  "target_id": "production",
  "dest_db": "dest_db",
  "branch_name": "wi/import-source_db-users"
}
```

**Response**

```json
{
  "branch_name": "wi/import-source_db-users",
  "outcome": "completed",
  "message": "stale import branch を掃除しました",
  "completion": {
    "destination_branch_removed": true,
    "protected_refs_clean": true
  }
}
```

Behavior:

- Only system-owned deterministic import branches matching `wi/import-*` are accepted.
- Missing branches are treated as `outcome=completed` no-op.
- If delete verification is ambiguous, the endpoint returns `outcome=retry_required`
  with `retry_reason=destination_branch_cleanup_failed`.

### Cross-Copy Admin Result Keys

Stable completion keys used by the admin lane:

- `protected_schema_prepared`
- `destination_branch_synced`
- `destination_branch_ready`
- `destination_branch_removed`
- `protected_refs_clean`

Stable retry reasons currently used by the admin lane:

- `destination_branch_sync_requires_manual_recovery`
- `destination_branch_not_ready`
- `destination_branch_sync_uncertain`
- `protected_schema_commit_uncertain`
- `destination_branch_cleanup_failed`

---

## CSV

### POST /csv/preview

Preview CSV-style bulk apply against a work branch.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "rows": [
    { "id": 1, "status": "active" }
  ]
}
```

**Response**

```json
{
  "inserts": 1,
  "updates": 0,
  "skips": 0,
  "errors": 0,
  "sample_diffs": [
    {
      "action": "insert",
      "row": { "id": 1, "status": "active" }
    }
  ]
}
```

### POST /csv/apply

Apply CSV rows to a work branch and create one commit.

**Request**

```json
{
  "target_id": "production",
  "db_name": "psx_data",
  "branch_name": "wi/work-1",
  "table": "items",
  "expected_head": "abc123...",
  "commit_message": "[CSV] items: 一括更新",
  "rows": [
    { "id": 1, "status": "active" }
  ]
}
```

**Response**

```json
{
  "hash": "abc123...",
  "outcome": "completed",
  "message": "CSV を適用しました",
  "completion": {
    "destination_committed": true
  }
}
```

---

## Search

### GET /search

Search across table values and, optionally, memo text.

**Query**

| Name | Required | Default |
|------|----------|---------|
| `target_id` | Yes | |
| `db_name` | Yes | |
| `branch_name` | Yes | |
| `keyword` | Yes | |
| `include_memo` | No | `false` |
| `limit` | No | `100` |

**Response**

```json
{
  "results": [
    {
      "table": "items",
      "pk": "42",
      "column": "status",
      "value": "active",
      "match_type": "value"
    }
  ],
  "total": 1,
  "read_integrity": "complete"
}
```

Behavior:

- Empty `keyword` returns `200 OK` with `results: []`, `total: 0`, and `read_integrity: "complete"`.
- Partial reads are not silently dropped. Table discovery, column discovery, row scans,
  memo scans, and iterator errors all fail loud with `500 INTERNAL`.
- Search timeout returns `408 PRECONDITION_FAILED` with a retry hint in `details.timeout`.

---

## Health

### GET /health

This endpoint is outside `/api/v1`.

**Response**

```json
{ "status": "ok" }
```
