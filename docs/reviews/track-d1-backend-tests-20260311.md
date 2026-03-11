r# Track D1: Backend Tests Plan

Date: 2026-03-11

## Goal

Track A の safety boundary、Track B1 の write outcome、Track B2 の footer-first audit truth を前提に、backend の invariant test を PR 単位で固定する。

この文書では production code は変更しない。決めるのは次だけ。

- unit / service / integration で固定する invariant
- failure injection が必要なポイントと方法
- Track A / Track B / A+B cross-copy の PR 単位テスト分割
- footer write/parse, request cleanup, `merged/*` missing, disallowed refs, search fail-loud の検証方法

## Code Anchors

- `backend/internal/service/request.go`
- `backend/internal/service/diff_history.go`
- `backend/internal/service/crosscopy.go`
- `backend/internal/service/crosscopy_table.go`
- `backend/internal/service/search.go`
- `backend/internal/repository/dolt.go`
- `backend/internal/service/branch_lifecycle_integration_test.go`

## Layer Contract

### Unit

純粋関数または parser / classifier / outcome 判定だけをテストする。

- DB 接続を使わない
- footer build/parse
- request / work item naming
- allowed ref classification
- outcome classification helper

### Service

1 回の service call に対して、cleanup / indexing / branch readiness の部分失敗を注入して response と completion truth を検証する。

- 実 DB の merge/copy 全体を再現しない
- coarse-grained な hook で失敗点を固定する
- `warnings` ではなく `outcome` / `completion` を truth にする

### Integration

実際の Dolt testenv 上で observable state を検証する。

- HEAD
- request tag / archive tag
- branch queryability
- history response
- search response
- allowed branch filtering

既存の `branch_lifecycle_integration_test.go` は happy path と一部の disallowed ref を既に持っているので、置き換えではなく拡張でよい。

## Failure Injection Policy

service failure injection は SQL 文字列単位の brittle mock ではなく、次の coarse-grained seam を同じ PR に同梱して行う。

1. `Service` が依存する repository を小さい interface に切り出し、`spyRepo` / `faultRepo` を使えるようにする
2. approve/history/cross-copy の postcondition step は unexported hook に寄せる
3. integration で再現できるものは実 DB 操作で検証する

推奨 seam:

- approve
  - `writeApprovalFooter`
  - `createSecondaryIndex` (`merged/*`)
  - `deleteRequestTag`
  - `advanceWorkBranch`
  - `verifyBranchQueryable`
- history
  - `listApprovalCommits`
  - `legacyMergedAdapter`
  - `parseApprovalFooter`
- search
  - `listSearchTables`
  - `searchTable`
  - `searchMemoTable`
- cross-copy
  - `checkSchemaCompatibility`
  - `createImportBranch`
  - `cleanupImportBranch`
  - `verifyBranchQueryable`

これは test 用の内部 seam でよく、公開 API にはしない。

## PR Split

### Track A

#### A-PR1: Repository session boundary

- `ConnDB()` read path 依存を除去する
- metadata / requests / history が writable `main` session を取らないことを固定する

#### A-PR2: AllowedRefPolicy / FeatureRefPolicy

- allowed branch allowlist を API 境界で強制する
- history と cross-copy の許可 ref 種別を固定する

### Track B

#### B-PR1: Footer writer + approve outcome

- approve が footer を書いて round-trip verify する
- request cleanup / resume branch readiness を `completed` 条件に含める

#### B-PR2: Footer-first history read

- `HistoryCommits` が `main` footer を primary truth として読む
- `merged/*` は legacy adapter / secondary index に格下げする

### Track A+B Cross-Copy

`docs/reviews/track-ab1-crosscopy-contract-20260311.md` に合わせる。

#### AB-PR2: Normal-flow safety cut

- normal flow apply は schema-compatible case に限定する
- `expand_columns != []` は pre-write stop にする
- apply endpoint は `ConnProtectedMaintenance` を取得しない
- `main` / `audit` に durable residue を残さないことを固定する

#### AB-PR3: Import-lane cleanup and retry contract

- table cleanup success は `failed`、cleanup failure は `retry_required` に固定する
- rows/table とも failure classification は destination lane residue だけで決める
- import branch cleanup / queryability failure の outcome を固定する

#### AB-PR4: Admin lane

- placeholder
- A+B joint design 確定までは invariant だけ先に固定し、実装テストは保留でよい

## Test Case Matrix

### Track A

| Test case | 対象レイヤ | 固定する invariant | Failure injection 方法 | 同梱すべきPR | 未確定の A+B 依存 |
| --- | --- | --- | --- | --- | --- |
| MetadataRead_UsesConnRevision_NotProtectedMaintenance | service | `connMetadataRevision` 系 read path が `ConnProtectedMaintenance` / `ConnDB` を使わない | `spyRepo` で取得セッション種別を記録し、writable main 取得時に fail | A-PR1 | なし |
| RequestRead_UsesConnRevision_NotProtectedMaintenance | service | `ListRequests` / `GetRequest` が metadata revision read に固定される | `spyRepo` で `ConnRevision(main)` のみ許可 | A-PR1 | なし |
| HistoryRead_UsesConnRevision_ForAllowedHistoryRef | service | `HistoryCommits` が history read でも writable session を取らない | `spyRepo` で `ConnRevision(ref)` 以外を fail | A-PR1 | なし |
| ListBranches_FiltersDisallowedBranch | integration | `allowed_branches` 外の branch は UI/API 両方に露出しない | `main` maintenance conn で hidden branch を作成して `ListBranches` を呼ぶ | A-PR2 | なし |
| GetHead_And_GetBranchReady_RejectDisallowedBranch | integration | disallowed named branch は service で拒否される | hidden branch を作り、`GetHead` / `GetBranchReady` が `FORBIDDEN` を返すことを確認 | A-PR2 | なし |
| HistoryCommits_RejectsDisallowedNamedBranch_ButAllowsTagOrHash | integration | named hidden branch は拒否、tag / commit hash / history expression は read-only path なら許可 | hidden branch, visible tag, main commit hash を実 DB で用意して各 path を叩く | A-PR2 | なし |
| Search_RejectsDisallowedBranch | integration | search は allowed branch allowlist を超えて読まない | hidden branch を作り `Search` が `FORBIDDEN` を返すことを確認 | A-PR2 | なし |
| CrossCopy_SourceRestrictedToMainOrAudit | integration | cross-copy source は `main|audit` のみ | 既存の `wi/not-allowed` source 拒否ケースを維持し rows/table/preview 全部で確認 | A-PR2 | AB 実装前でも固定可 |
| CrossCopy_DestinationRestrictedToWorkBranch | integration | cross-copy destination は `wi/*` のみ | 既存の `scratch-not-allowed` 拒否ケースを維持し preview/rows で確認 | A-PR2 | AB 実装前でも固定可 |

### Track B

| Test case | 対象レイヤ | 固定する invariant | Failure injection 方法 | 同梱すべきPR | 未確定の A+B 依存 |
| --- | --- | --- | --- | --- | --- |
| ApprovalFooter_RoundTrip_Valid | unit | valid footer は required field を欠落なく round-trip できる | parser/writer に直接文字列を渡す | B-PR1 | なし |
| ApprovalFooter_RejectsMissingRequiredOrInconsistentFields | unit | required 欠損、`Request-Id` / `Work-Item` / `Work-Branch` 不整合、invalid hash は parse failure | parser に malformed footer を与える | B-PR1 | なし |
| ApprovalFooter_IgnoresUnknownFields_And_HumanBody | unit | unknown field は無視、本文は parse truth に使わない | parser に body + unknown trailer を与える | B-PR1 | なし |
| SubmitAndRequestReads_DegradedReqJSON_StillUseTagTruth | service | `req/*` JSON 破損でも pending truth は tag existence + target hash で読める | `req/*` message を壊した fixture か hook で `ListRequests` / `GetRequest` を呼ぶ | B-PR1 | なし |
| RejectRequest_DoesNotDependOnReqMessageJSON | integration | reject は tag delete だけで成立し、message JSON 破損では失敗しない | 実 DB で request tag message を不正 JSON に書き換えてから reject | B-PR1 | なし |
| ApproveRequest_ContinuesWithDegradedReqMessageJSON | integration | approve は `req/*` message JSON が壊れていても tag target hash と request id から続行でき、footer required field を満たす | 実 DB で request tag message を不正 JSON に書き換えてから approve し、footer required field と request cleanup を確認 | B-PR1 | なし |
| ApproveRequest_CompletedRequiresFooter_RequestCleared_ResumeReady | integration | `completed` は footer recorded + request cleared + resume branch ready を満たすときだけ | happy path approve 後に footer, request tag deletion, work branch queryability を確認 | B-PR1 | なし |
| ApproveRequest_RequestCleanupFailure_IsRetryRequired | service | `main` merge / footer 成功後に request cleanup が失敗したら success ではなく `retry_required` | `deleteRequestTag` hook を fail させる | B-PR1 | なし |
| ApproveRequest_AdvanceFailure_IsRetryRequired | service | request cleanup 後でも work branch advance failure は `completed` にならない | `advanceWorkBranch` hook を fail させる | B-PR1 | なし |
| ApproveRequest_QueryabilityFailure_IsRetryRequired | service | branch advance 後の queryability 未確認は `completed` にならない | `verifyBranchQueryable` hook を not ready にする | B-PR1 | Track A で readiness predicate を first-class にする必要あり |
| Search_PartialTableFailure_FailsLoud | service | skipped table / fallback failure は silent complete にしない | `searchTable` hook を 1 テーブルだけ fail させ、integrity contract が degraded/failed に倒れることを確認 | B-PR1 | なし |
| Search_Timeout_FailsLoud_NotEmptySuccess | service | timeout は empty success や silent partial に化けない | `searchTable` または `searchMemoTable` hook で `context.DeadlineExceeded` を返す | B-PR1 | なし |
| ApproveRequest_SecondaryIndexFailure_DoesNotEraseAuditTruth | service | `merged/*` 作成失敗だけでは audit truth は壊れず、secondary index missing として扱う | `createSecondaryIndex` hook を fail させる | B-PR2 | なし |
| HistoryCommits_FooterFirst_ReadsPostCutoverWithoutMergedTag | integration | post-cutover approval は `merged/*` 欠損でも footer だけで history を復元できる | approve 後に `merged/*` を手動削除して `HistoryCommits` を確認 | B-PR2 | なし |
| HistoryCommits_InvalidFooter_ReturnsIntegrityError | service | footer present but invalid は silent skip しない | `listApprovalCommits` fixture に invalid footer commit を含める | B-PR2 | なし |
| HistoryCommits_FooterMergedMismatch_PrefersFooter | service | footer と `merged/*` が矛盾したら footer を正とし、index corruption とみなす | footer fixture と conflicting legacy adapter fixture を与える | B-PR2 | なし |
| HistoryCommits_LegacyMergedAdapter_OnlyPreCutover | service | footer absent record への `merged/*` fallback は pre-cutover legacy に限る | cutover 前後の fixture を分ける | B-PR2 | cutover boundary の表現方法は未確定 |

### Track A+B Cross-Copy

| Test case | 対象レイヤ | 固定する invariant | Failure injection 方法 | 同梱すべきPR | 未確定の A+B 依存 |
| --- | --- | --- | --- | --- | --- |
| CrossCopyRows_DoesNotAcquireProtectedMaintenance_InNormalFlow | service | normal flow rows apply は `ConnProtectedMaintenance` を取らない | `spyRepo` で protected maintenance acquisition を fail | AB-PR2 | なし |
| CrossCopyTable_DoesNotAcquireProtectedMaintenance_InNormalFlow | service | normal flow table apply は `ConnProtectedMaintenance` を取らない | `spyRepo` で protected maintenance acquisition を fail | AB-PR2 | なし |
| CrossCopyRows_SchemaMismatch_StopsBeforeDurableWrite | integration | schema mismatch は precondition stop で、`main` HEAD / schema と destination HEAD を変えない | 実 DB で narrow schema を作って rows apply を叩く | AB-PR2 | なし |
| CrossCopyTable_SchemaMismatch_StopsBeforeMainWrite_And_BranchCreate | integration | table apply は schema mismatch で import branch を作らず、`main` も変えない | 実 DB で mismatch schema を作って table apply を叩く | AB-PR2 | なし |
| CrossCopyTable_QueryabilityFailure_CleansUpImportBranch | service | branch 作成後に queryability 失敗しても cleanup 完了なら `failed` で stale branch を残さない | `verifyBranchQueryable` hook を not ready、`cleanupImportBranch` hook は success | AB-PR3 | なし |
| CrossCopyTable_CleanupFailure_IsRetryRequired | service | import branch cleanup 失敗で stale branch が残るなら `retry_required` | `verifyBranchQueryable` hook を not ready、`cleanupImportBranch` hook を fail | AB-PR3 | なし |
| CrossCopyRows_FailureClassification_DependsOnlyOnDestinationResidue | service | rows failure の classification は destination `wi/*` residue だけで決まり、protected residue を含まない | destination commit confirmation / readiness hook を fail | AB-PR3 | なし |
| CrossCopy_AdminLane_ProtectedSchemaMaintenance | placeholder | protected schema expansion は normal flow test から分離し admin lane でのみ検証する | placeholder | AB-PR4 | A+B joint design 待ち |

## Verification Notes

### Footer write / parse

- unit で grammar を固定する
- integration で approve 後の `main` commit message から footer を再読し、response の request/work branch/hash と一致することを確認する
- `req/*` message JSON 破損時は optional field を落としても footer required field を満たせることを確認する

### Request cleanup

- happy path integration で `req/*` が Inbox から消えることを確認する
- cleanup failure は service hook でのみ注入し、`completed` ではなく `retry_required` になることを確認する
- cleanup failure ケースでは audit truth が既に存在していても success toast 根拠にしない

### `merged/*` missing

- integration で approve 後に `merged/*` を削除し、history が footer から復元できることを確認する
- service fixture で footer/legacy index mismatch を作り、footer 優先を固定する

### Search fail-loud / partial handling

- per-table query failure や fallback failure が起きたときに、plain success / empty success へ silently degrade しないことを確認する
- timeout は explicit failure or retry guidance に倒し、partial result や empty result に見せない
- disallowed branch は search でも allowlist 境界で拒否する

### Disallowed refs

- integration の実 branch で hidden named ref を作り、metadata / readiness / history が拒否することを確認する
- history だけは tag / commit hash / `^` `~` expression を read-only 例外として許可する
- search は allowed branch allowlist の read feature として扱い、hidden branch を許可しない
- cross-copy は source `main|audit`、destination `wi/*` のみを維持する

## Minimum Shipping Set Per PR

### A-PR1

- MetadataRead_UsesConnRevision_NotProtectedMaintenance
- RequestRead_UsesConnRevision_NotProtectedMaintenance
- HistoryRead_UsesConnRevision_ForAllowedHistoryRef

### A-PR2

- ListBranches_FiltersDisallowedBranch
- GetHead_And_GetBranchReady_RejectDisallowedBranch
- HistoryCommits_RejectsDisallowedNamedBranch_ButAllowsTagOrHash
- Search_RejectsDisallowedBranch
- CrossCopy_SourceRestrictedToMainOrAudit
- CrossCopy_DestinationRestrictedToWorkBranch

### B-PR1

- ApprovalFooter_RoundTrip_Valid
- ApprovalFooter_RejectsMissingRequiredOrInconsistentFields
- ApprovalFooter_IgnoresUnknownFields_And_HumanBody
- SubmitAndRequestReads_DegradedReqJSON_StillUseTagTruth
- RejectRequest_DoesNotDependOnReqMessageJSON
- ApproveRequest_ContinuesWithDegradedReqMessageJSON
- ApproveRequest_CompletedRequiresFooter_RequestCleared_ResumeReady
- ApproveRequest_RequestCleanupFailure_IsRetryRequired
- ApproveRequest_AdvanceFailure_IsRetryRequired
- ApproveRequest_QueryabilityFailure_IsRetryRequired
- Search_PartialTableFailure_FailsLoud
- Search_Timeout_FailsLoud_NotEmptySuccess

### B-PR2

- ApproveRequest_SecondaryIndexFailure_DoesNotEraseAuditTruth
- HistoryCommits_FooterFirst_ReadsPostCutoverWithoutMergedTag
- HistoryCommits_InvalidFooter_ReturnsIntegrityError
- HistoryCommits_FooterMergedMismatch_PrefersFooter
- HistoryCommits_LegacyMergedAdapter_OnlyPreCutover

### AB-PR2

- CrossCopyRows_DoesNotAcquireProtectedMaintenance_InNormalFlow
- CrossCopyTable_DoesNotAcquireProtectedMaintenance_InNormalFlow
- CrossCopyRows_SchemaMismatch_StopsBeforeDurableWrite
- CrossCopyTable_SchemaMismatch_StopsBeforeMainWrite_And_BranchCreate

### AB-PR3

- CrossCopyTable_QueryabilityFailure_CleansUpImportBranch
- CrossCopyTable_CleanupFailure_IsRetryRequired
- CrossCopyRows_FailureClassification_DependsOnlyOnDestinationResidue

### AB-PR4

- placeholder のみ
- admin lane design が固まるまで backend test は contract note に留める

## Remaining A+B Dependencies

AB1 で lock 済みの normal-flow cross-copy decision は unresolved に残さない。残件は admin lane と readiness predicate の具体化だけに絞る。

1. destination branch readiness を Track A で first-class predicate にするか
   `resume_branch_ready` / `destination_branch_ready` を service test の stable key にする前提。

2. admin lane の責務範囲
   protected schema expansion だけか、stale import branch repair まで含むかで AB-PR4 の test scope が変わる。

## Decision Summary

- Track A は session boundary と allowed ref enforcement を integration/service で固定する
- Track B は footer parser、degraded `req/*` approve、search fail-loud を unit/service/integration で分離して固定する
- `merged/*` missing は B-PR2 integration に必ず入れる
- request cleanup failure は B-PR1 service failure injection で必ず入れる
- cross-copy は AB1 lock 済み前提で AB-PR2/PR3 の normal flow safety と import-lane cleanup classification を固定し、admin lane は placeholder を許容する
