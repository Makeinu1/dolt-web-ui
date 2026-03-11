# Track B: Audit / Completion Model

Date: 2026-03-11

## Goal

`何を成功と呼ぶか` と `何を audit truth とするか` を backend の契約として固定する。

## Current State

- submit は `req/*` tag に申請 metadata を載せる
- approve は `main` merge 後に archive tag 作成、request tag 削除、work branch 前進を best-effort で行う
- history / merge log は `merged/*` tag を source of truth として読む
- API response は `warnings` を success に混ぜる
- frontend は `main へのマージが完了しました` を success として出しやすい

## Code Anchors

- `backend/internal/service/request.go`
- `backend/internal/service/diff_history.go`
- `backend/internal/service/workitem.go`
- `backend/internal/model/api.go`
- `frontend/src/components/RequestDialog/RequestDialog.tsx`
- `frontend/src/components/MergeLog/MergeLog.tsx`
- `frontend/src/types/api.ts`

## Decisions

### 1. Primary Audit Truth

primary audit truth は **`main` の merge commit** とする。

各 approve merge commit には機械可読 footer を必ず付ける。

例:

```text
承認マージ: ProjectA

approval-schema: v1
request-id: req/ProjectA
work-item: ProjectA
work-branch: wi/ProjectA
submitted-main-hash: <hash>
submitted-work-hash: <hash>
```

この footer を parse して MergeLog / History の一次情報を作る。

### 2. Secondary Audit Index

`merged/*` tag は secondary index に格下げする。

- 検索高速化や legacy 互換に使ってよい
- 欠損しても audit truth は壊れない
- 作成失敗は user-facing completed 条件に含めない
- ただし index rebuild が必要なら `retry_required` として返す

### 3. Request Identity

request lifecycle の source of truth は次に固定する。

- pending:
  `req/*` tag
- approved:
  `main` merge commit footer
- rejected:
  `req/*` tag deletion

`merged/*` は request lifecycle の source of truth ではない。

### 4. OperationOutcome Contract

submit / approve / cross-copy / CSV / degraded history/search は次の outcome を返す。

- `completed`
- `failed`
- `retry_required`

response には次を持たせる。

- `outcome`
- `message`
- `completion`
  - `main_merged`
  - `audit_recorded`
  - `request_cleared`
  - `resume_branch_ready`
- `retry_reason`
- `retry_actions`

現行の `warnings` は advisory 情報に限定する。integrity step の失敗を warning で表してはならない。

### 5. Approve Completion Rule

approve が `completed` になる条件は次の全てを満たすこと。

1. `main` merge commit 作成済み
2. audit primary record が確定
3. request が pending から外れている
4. same work item を stable name で再開可能

このどれかが欠けたら `retry_required` または `failed`。

`main merged but cleanup failed` は completed ではない。

### 6. Submit Completion Rule

submit が `completed` になる条件は次の全てを満たすこと。

1. expected head が一致
2. auto-sync が完了
3. request metadata が保存された
4. branch lock が pending request として一意に観測できる

request 保存に失敗した submit は rollback する。未完了なのに lock だけ残す状態を許さない。

### 7. History / MergeLog Query Policy

MergeLog / history list は `main` の commit history から approval footer を読む。

- footer を持つ merge commit だけを approval history とみなす
- `merged/*` tag は secondary lookup や legacy migration にのみ使う
- footer parse 失敗は data corruption とみなし、silent skip しない

### 8. Compatibility Adapter

移行期間中、既存 response field は残してよい。

- `archive_tag`
- `active_branch`
- `active_branch_advanced`
- `warnings`

ただし UI は新しい `outcome` と `completion` を優先して判定する。

## Acceptance Criteria

- archive tag 欠損だけで MergeLog が壊れない
- approve cleanup failure を success として表示しない
- stable work item resume 条件が response contract で判定できる
- `main` merge commit だけで approval history を復元できる

## First Implementation Notes

1. approve merge message に footer を追加
2. history read path を `main` commit footer ベースへ切替
3. response に `outcome` / `completion` を追加
4. frontend success 判定を `outcome=completed` のみに寄せる
