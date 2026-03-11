# Track C: UI Contract Alignment

Date: 2026-03-11

## Goal

UI flow を維持したまま、backend の新契約を正しく表示する最小変更だけを定義する。

## Current State

- context change 時の reset は浅い
- `requestCount` は refresh failure で stale になりうる
- `previewCommit`、`selectedTable`、modal state などが branch/db 切替をまたいで残る
- `Syncing`、`SchemaConflictDetected`、`ConstraintViolationDetected` は state 定義にあるが導線が不整合
- submit / approve で heavy diff が初期表示時に走る

## Code Anchors

- `frontend/src/App.tsx`
- `frontend/src/store/ui.ts`
- `frontend/src/store/context.ts`
- `frontend/src/components/RequestDialog/RequestDialog.tsx`
- `frontend/src/components/CLIRunbook/CLIRunbook.tsx`
- `frontend/src/components/TableGrid/TableGrid.tsx`
- `frontend/src/api/client.ts`

## Decisions

### 1. Flow Freeze, Implementation Not Frozen

維持するのは flow であり、React 内部状態や toast 文言の実装ではない。

許可する UI 変更:

- state reset
- success/error/retry 表示
- dead 導線の削除
- heavy read の lazy 化

### 2. Context Epoch

`targetId` / `dbName` / `branchName` の変更で `contextEpoch` を 1 つ進める。

epoch change 時に必ず reset する state:

- `previewCommit`
- `selectedCell`
- `showCommentPanel`
- `showMergeLog`
- `showHistory`
- `showCrossCopyRows`
- `showCrossCopyTable`
- `showCSVImport`
- `showSearch`
- `showSubmit`
- `showApprover`
- `showCommit`
- `showDeleteConfirm`
- `rowHistoryInfo`
- `overwrittenTables`
- `requestCount`
- global `success`
- global `error`

`selectedTable` は次のルールにする。

- 新しい table list に同名が存在すれば維持
- 存在しなければ先頭 table
- table が空なら空文字

### 3. Outcome Mapping

frontend は backend response を次の表示規則で扱う。

- `outcome=completed`
  - success toast を出してよい
- `outcome=failed`
  - success toast を出さない
  - error banner を出す
- `outcome=retry_required`
  - success toast を出さない
  - retry action を UI で明示する

### 4. Recovery UI

dead state を整理し、blocking recovery を backend reason に寄せる。

- `StaleHeadDetected`
  - 継続
- `cli_required`
  - CLIRunbook を出す
- `retry_required`
  - 専用 banner / dialog で再試行導線を出す

`Syncing` は dead route `/sync` と一緒に削除する。

`SchemaConflictDetected` / `ConstraintViolationDetected` は backend が明示的な recovery reason を返す場合だけ残す。返さないなら削除する。

### 5. Heavy Read Policy

通常 flow の modal open では heavy diff を自動実行しない。

- submit / approve:
  light summary だけ初期表示
- heavy count / cell diff:
  明示操作で初めて取得

MergeLog の light-first 方針に揃える。

### 6. Dead Contract Cleanup

UI から整理する対象:

- `/sync` client
- `Syncing` state
- 到達しない recovery state
- docs にだけ存在する UI 約束

## Acceptance Criteria

- branch/context 切替で古い `previewCommit` / `selectedTable` / modal state を持ち越さない
- request badge が stale count を表示しない
- `completed` / `failed` / `retry_required` が UI 上で見分けられる
- submit / approve open だけで heavy diff を叩かない
- dead `/sync` 導線が UI に残らない

## First Implementation Notes

1. `contextEpoch` と reset matrix を導入
2. `requestCount` を `0` ではなく `loading -> value` で扱うか、少なくとも context change で即 reset
3. `RequestDialog` の diff loading を light-first へ変更
4. `/sync` と `Syncing` を削除
