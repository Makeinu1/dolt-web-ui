# Track B1: OperationOutcome Contract

Date: 2026-03-11

## Goal

Track B のうち `OperationOutcome` 契約だけを固定し、write endpoint の完了条件と partial success の扱いを backend / frontend 間で揃える。

## Scope

対象:

- `/request/submit`
- `/request/approve`
- `/request/reject`
- `/cross-copy/rows`
- `/cross-copy/table`
- `/csv/apply`
- approval history の degraded response
- search の degraded response

対象外:

- `/cross-copy/preview`
- `/csv/preview`
- validation / precondition / conflict の `ErrorEnvelope`

preview は durable side effect を持たないため、既存どおり `warnings` / row-level errors を使う。`OperationOutcome` は `2xx` の終端 response body にだけ付ける。

## Outcome Definitions

- `completed`
  - endpoint が約束する durable postcondition がすべて成立している
  - frontend は success toast を出してよい
- `failed`
  - endpoint は未完了
  - backend は follow-up を要求する残留副作用が無いことを保証できる
  - frontend は success toast を出してはならない
- `retry_required`
  - endpoint は未完了
  - durable side effect の残留、または完了可否の曖昧さが残る
  - frontend は success toast を出してはならず、`retry_actions` を優先表示する

`failed` と `retry_required` の境界は、backend が「未完了だが後始末不要」と言い切れるかどうかで切る。

## Common Rules

- `warnings` は `outcome=completed` のときだけ返してよい
- `warnings` に integrity / cleanup / audit / branch readiness / protected ref side effect を載せてはならない
- primary effect の不成立を `warnings` に落として success 扱いしてはならない
- 既存の構造化 payload
  - `overwritten_tables`
  - `archive_tag`
  - `active_branch`
  - `active_branch_advanced`
  - `source_only_columns`
  - `dest_only_columns`
  は `warnings` の代わりに残してよい
- frontend の表示文言は hard-coded success string ではなく backend `message` を優先する

## Endpoint Decision Table

| Endpoint | Primary effect | `completed` 条件 | `retry_required` 条件 | `failed` 条件 | `warnings` 許容 |
| --- | --- | --- | --- | --- | --- |
| `/request/submit` | pending request を final work HEAD に固定する | `req/*` が final work HEAD を指し、`submitted_main_hash` / `submitted_work_hash` がその request metadata と一致し、Inbox から pending として再観測できる | work branch 側の durable 変更は起きたが、request 保存 or 置換の完了を確定できない | request 保存前に中断し、pending request が残らないことを backend が保証できる | なし。`overwritten_tables` は warning ではなく domain payload |
| `/request/approve` | approve lifecycle を完了させる | `main` merge commit が存在し、primary audit record が確定し、`req/*` が pending から外れ、stable name の work branch を再開可能 | `main` merge は成立したが、request cleanup / resume branch readiness / 完了確認が欠ける | merge commit を作っていない、または merge 完了を確認できない | secondary index / legacy adapter だけ。rebuild が必要な場合は warning ではなく `retry_required` |
| `/request/reject` | pending request を解除する | `req/*` が削除され、Inbox から消えている | delete 成否を確定できないが、既に削除された可能性がある | request が残っていることを backend が確認できる | なし |
| `/cross-copy/rows` | destination work branch に copy commit を作る | destination branch 上の copy commit が存在し、返却 `hash` がその commit を指し、normal user flow で protected ref への未整理副作用が残らない | protected ref 側の durable 変更が残った、または destination commit / branch readiness の完了確認が欠ける | destination branch への durable 変更が無い、または rollback 済み | なし |
| `/cross-copy/table` | import work branch を作り table copy commit を載せる | import branch が queryable で、返却 `branch_name` / `hash` が copy 完了状態を指し、normal user flow で protected ref への未整理副作用が残らない | branch 作成や protected ref 側の durable 変更は起きたが、copy 完了 or branch readiness の確認が欠ける | import branch を利用者フローに見せずに中断できた | なし |
| `/csv/apply` | target work branch に CSV apply commit を作る | commit が存在し、返却 `hash` がその commit を指す | commit 作成後の確認が曖昧で、refresh/retry guidance が必要 | rollback 済み、または durable commit が存在しない | なし |
| approval history | approval history を完全に返す | primary audit truth から page を完全に再構成できる | partial result しか返せない、または rebuild / refresh が必要 | 信頼できる result set を返せない | `completed` のときの補助 notice のみ |
| search | 検索 result を完全に返す | limit / pagination 契約の範囲で完全な result set を返せる | skipped table / fallback により partial result しか返せない | 信頼できる result set を返せない | `completed` のときの補助 notice のみ |

## Completion Fields

`completion` は endpoint ごとに使う key を閉じた語彙で固定する。未使用 key は省略してよい。

- request submit
  - `request_recorded`
  - `lock_observable`
  - `work_head_synced`
- request approve
  - `main_merged`
  - `audit_recorded`
  - `request_cleared`
  - `resume_branch_ready`
  - `audit_indexed`
- request reject
  - `request_cleared`
- cross-copy rows
  - `destination_committed`
  - `destination_branch_ready`
  - `protected_refs_clean`
- cross-copy table
  - `destination_committed`
  - `destination_branch_ready`
  - `protected_refs_clean`
- csv apply
  - `destination_committed`
- history / search
  - `result_complete`

`audit_indexed` は legacy / secondary index 用の adapter key であり、`completed` 判定には含めない。

## Response Field Proposal

```ts
type OperationOutcome = "completed" | "failed" | "retry_required";

type OperationResultFields = {
  outcome: OperationOutcome;
  message: string;
  completion: Record<string, boolean>;
  warnings?: string[];
  retry_reason?: string;
  retry_actions?: Array<{
    action: string;
    label: string;
  }>;
};
```

既存 response には追加合成する。

- `SubmitRequestResponse & OperationResultFields`
- `ApproveResponse & OperationResultFields`
- `CrossCopyRowsResponse & OperationResultFields`
- `CrossCopyTableResponse & OperationResultFields`
- `CommitResponse & OperationResultFields`
- reject は新設 `RejectResponse` を基本とするが、移行中は `{ status, ...OperationResultFields }` でもよい

最低限必要な `retry_reason`:

- `request_record_uncertain`
- `request_cleanup_failed`
- `resume_branch_not_ready`
- `protected_ref_side_effect_remaining`
- `destination_branch_not_ready`
- `result_partial`

## Warning Policy

`warnings` を許すのは次だけに限定する。

- `outcome=completed`
- user-facing completion を崩さない補助情報
- secondary index / legacy adapter / visibility 上の notice

`warnings` で表してはならないもの:

- request 保存失敗
- request cleanup 失敗
- resume branch 未準備
- protected ref への未整理副作用
- copy / CSV commit 未確認
- history / search の partial result

具体化すると次のとおり。

- `approve` の archive tag / `merged/*` 補助 index 欠損は warning に落としてよい
- ただし rebuild を要求する状態なら `retry_required`
- `submit` の `overwritten_tables` は warning ではなく domain payload
- `cross-copy` / `csv apply` は apply endpoint では warning を返さない
- degraded read は `warning` ではなく `retry_required` で表す

## Backward Compatibility

互換優先順位は次に固定する。

1. `outcome` による completion truth
2. 既存 flow の維持
3. field-level backward compatibility

移行方針:

- 既存 response shape は維持する
- 既存 field は adapter として残す
- 既存 field だけで success 判定してはならない

adapter 方針:

- `ApproveResponse.active_branch_advanced`
  - `completion.resume_branch_ready` の互換 field
- `ApproveResponse.archive_tag`
  - `completion.audit_indexed` の互換 field
  - 空でも `outcome=completed` を許す
- `ApproveResponse.warnings`
  - advisory only
  - `retry_required` の代替に使わない
- `SubmitRequestResponse.overwritten_tables`
  - success / failure 判定には使わない
- `CrossCopy*Response.hash`
  - commit pointer として残す
  - `hash` 単独では success を意味しない
- `RejectResponse.status`
  - 互換 field として残してよいが、frontend は `outcome` を優先する

frontend fallback:

- `outcome` が存在すればそれを最優先する
- `outcome` が無い旧 backend との接続時だけ既存 heuristic を使う
- 新 backend に対して旧 heuristic を残して success を上書きしてはならない

## Frontend Success Toast Rule

success toast を出してよい条件は 1 つだけに固定する。

- response body に `outcome=completed` がある

補足:

- `warnings` の有無は success toast の可否を変えない
- `retry_required` では success toast を出さない
- `failed` では success toast を出さない
- `ErrorEnvelope` でも success toast を出さない
- toast 文言は backend `message` を使う

Track C の置換対象:

- submit の hard-coded success toast
- approve の hard-coded success toast
- reject の hard-coded success toast
- cross-copy / csv の hard-coded success toast

## Open Questions

Track A 依存の open question だけを残す。

1. cross-copy normal flow で protected ref への schema 変更を許すか
   許さないなら `protected_refs_clean=true` を `completed` の必須条件に固定できる。許すなら admin path への分離条件を Track A で決める必要がある。

2. `AllowedRefPolicy` が cross-copy source / destination にどこまで適用されるか
   source に `main` / `audit` / `wi/*` のどこを許すか、destination を `wi/*` に固定するかで `retry_actions` の選択肢が変わる。

3. branch readiness の backend predicate を Track A で first-class にするか
   `resume_branch_ready` / `destination_branch_ready` を completion key に使うには、queryability を durable postcondition として定義する必要がある。

## Decision Summary

- `completed` は durable postcondition 完了
- `failed` は durable residue なし
- `retry_required` は durable residue あり
- `warnings` は `completed` の advisory に限定
- frontend success toast は `outcome=completed` のみ
- `archive_tag` / `active_branch_advanced` / `warnings` は adapter に格下げする
