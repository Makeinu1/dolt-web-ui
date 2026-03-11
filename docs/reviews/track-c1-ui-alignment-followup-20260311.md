# Track C1: UI Alignment Follow-up

Date: 2026-03-11

## Goal

Track C の follow-up として、frontend の UI truth を Track B1 / B2 に合わせて固定する。production code は触らず、次の実装判断だけを文書で閉じる。

- `contextEpoch` と reset 範囲
- write `outcome` の UI mapping
- history / search の single fail-loud policy
- `/sync` / `Syncing` / 未到達 recovery state の削除方針
- submit / approve の light-first 読み込み

## Contract Delta From Track C

Track C 本文からの補足 /修正は次に固定する。

- write success の truth は `outcome=completed` だけ
- warning-success は禁止
- history / search は write の `OperationOutcome` と意味を混ぜない
- history / search は `read_integrity` を持ってよいが、UI policy は fail-loud に固定する
- `warnings` は advisory であり、success / retry / failure 判定に使わない

## Code Anchors

- `frontend/src/App.tsx`
- `frontend/src/store/ui.ts`
- `frontend/src/store/context.ts`
- `frontend/src/components/RequestDialog/RequestDialog.tsx`
- `frontend/src/components/MergeLog/MergeLog.tsx`
- `frontend/src/components/SearchModal/SearchModal.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types/api.ts`

## Locked Decisions

### 1. `contextEpoch`

`contextEpoch` は `(targetId, dbName, branchName)` の組が変わるたびに 1 つ進める。

進めないもの:

- `branchRefreshKey`
- `refreshKey`
- HEAD refresh
- request badge の再取得
- modal open / close
- preview の open / close

意図:

- target / DB / branch をまたいで stale UI を持ち越さない
- branch 内 refresh は別扱いにして、通常 flow を壊さない

### 2. Reset Matrix

| UI slice | `contextEpoch++` | `branchRefreshKey++` | table list reload success | Notes |
| --- | --- | --- | --- | --- |
| draft ops | clear | keep | n/a | 既存の safety invariant を維持する |
| `tables` | clear -> loading | reload | replace | context 依存データなので毎回再読込 |
| `selectedTable` | provisional clear | keep | 同名維持、無ければ先頭、空なら `""` | 唯一の remap 対象 |
| `previewCommit` | clear | keep | keep | 過去 commit 閲覧を別 context に持ち越さない |
| `selectedCell` | clear | keep | selected table 不整合なら clear | comment / row-history の根 |
| `showCommentPanel` | close | keep | keep | cell 選択と同 epoch に束縛 |
| `rowHistoryInfo` | clear | keep | keep | row-history filter を跨がせない |
| `showCommit` / `showSubmit` / `showApprover` / `showHistory` / `showMergeLog` / `showDeleteConfirm` / `showCrossCopyRows` / `showCrossCopyTable` / `showCSVImport` / `showSearch` | close | keep | keep | modal の中身が旧 context のまま残るのを防ぐ |
| `showOverflow` | close | keep | keep | context 変更直後の誤操作防止 |
| `crossCopyPKs` | clear | keep | keep | selection を跨がせない |
| `overwrittenTables` | clear | keep | keep | old branch の conflict overlay を残さない |
| request badge state | `unknown` に戻して refetch | `unknown` に戻して refetch | keep | stale count を出さない |
| global `error` | clear | keep | keep | old context の failure を残さない |
| global `success` | clear | keep | keep | branch switch を伴う write は branch 変更後に success を立てる |

補足:

- request badge は `number` のままでは stale / loading / unknown を区別できないので、`unknown/loading/ready/error` のどれかを持つ形に寄せる
- `contextEpoch` は `ModalManager` や history/search surface に `key` として渡してもよいが、`selectedTable` だけは remap rule を明示実装する

### 3. Write Outcome UI Mapping

write 系 endpoint は Track B1 に合わせ、UI は `outcome` だけで成功可否を決める。

対象:

- `/request/submit`
- `/request/approve`
- `/request/reject`
- `/cross-copy/rows`
- `/cross-copy/table`
- `/csv/apply`

| `outcome` | Toast | Inline / modal UI | Modal close | Refresh / navigation | Forbidden |
| --- | --- | --- | --- | --- | --- |
| `completed` | backend `message` で success toast を出してよい | domain payload だけ表示可 | 現行 happy path どおり close してよい | request badge / head / list を refresh。approve は branch switch 後に success | warning banner を success と同時表示しない |
| `failed` | success toast を出さない | red error banner を表示 | close しない | branch switch しない | `hash` / `branch_name` / `warnings` だけで success 判定しない |
| `retry_required` | success toast を出さない | blocking retry / recovery banner or dialog を表示 | close しない | backend `retry_actions` が示す回復導線だけ許可 | yellow success, silent fallback, auto branch switch |

追加規則:

- `warnings` は `completed` の advisory only
- `warnings` を `setError(...)` に流して success と同時表示する現在の approve UI は廃止対象
- `message` がある場合、hard-coded success string より優先する
- `overwritten_tables` は success / failure truth ではなく domain payload
- `hash` 単独、`branch_name` 単独、`archive_tag` 単独では success とみなさない

endpoint 別の UI rule:

- submit
  - `completed` のときだけ success toast と `overwritten_tables` overlay を許可
- approve
  - `completed` のときだけ success toast
  - auto branch switch は `completion.resume_branch_ready=true` かつ `active_branch` があるときだけ
  - `active_branch_advanced` は adapter であり truth ではない
- reject
  - `completed` のときだけ success toast
  - `status` は adapter
- cross-copy rows / table / csv apply
  - `hash` や `branch_name` は completed path の payload であり、truth ではない

### 4. History / Search は Fail-Loud

history / search は durable write completion を表していないので、write と同じ `outcome` を使わない。read 専用の integrity field は持ってよいが、UI は partial result を表示しない。

提案 shape:

```ts
type ReadIntegrity = "complete" | "degraded" | "failed";

type ReadResultFields = {
  read_integrity: ReadIntegrity;
  message?: string;
  retry_actions?: Array<{
    action: string;
    label: string;
  }>;
};
```

response 合成先:

- history: `{ commits, ...ReadResultFields }`
- search: `{ results, total, ...ReadResultFields }`

single policy は次に固定する。

- UI が result を描画してよいのは `read_integrity=complete` のときだけ
- `read_integrity=degraded` は adapter 上の遷移状態として受けても、UI では `failed` 相当の fail-loud surface に正規化する
- partial result が payload に含まれていても描画しない
- empty state は `read_integrity=complete` かつ count=0 のときだけ許可する
- retry / refresh を必須表示する
- silent degrade は禁止する

| `read_integrity` | Result rendering | Banner | Retry | Empty state |
| --- | --- | --- | --- | --- |
| `complete` and count > 0 | 結果をそのまま表示 | なし | 任意の manual refresh だけ | 出さない |
| `complete` and count = 0 | empty state を表示 | なし | なし | 出してよい |
| `degraded` | partial result を表示しない | red または blocking retry 表示 | 必須 | 出さない |
| `failed` | stale result を表示しない | red error 表示 | 必須 | 出さない |
| non-2xx `ErrorEnvelope` | stale result を表示しない | red error 表示 | 必須 | 出さない |

追加規則:

- silent degrade 禁止
- empty state は `read_integrity=complete` のときだけ許可
- new query / new epoch 開始時に旧結果を clear して、stale result が成功に見えないようにする
- MergeLog の footer parse failure / index corruption は B2 に従い `failed` 側で出す。skip して empty にしない
- search の skipped table / fallback は backend が `degraded` を返しても、frontend adapter で fail-loud に正規化する

adapter contract:

- backend が `read_integrity=degraded` を返すこと自体は移行期間の互換として許す
- frontend adapter は `degraded` を `display_state="integrity_error"` に写像する
- `display_state="integrity_error"` では `results` / `commits` / `total` を truth として使わない
- `message` と `retry_actions` だけを user-facing recovery surface に使う

mock / real test expectation:

- mock:
  - `read_integrity=degraded` + partial payload を返しても result list は描画されない
  - error / retry surface が出る
- real:
  - invalid footer / partial history / partial search injection 時に result list が残らない
  - empty state には落ちず、error / retry になる

### 5. `/sync`, `Syncing`, 未到達 Recovery State

削除方針は次に固定する。

1. `/sync`
   submit が sync を内包した前提に揃ったので、frontend から `/sync` client を消す

2. `Syncing`
   到達しない global base state として残さない。write 中表示は modal / button の local loading に寄せる

3. `SchemaConflictDetected` / `ConstraintViolationDetected`
   現状の listed file 群から到達経路が無い dormant enum なので、global state machine から削除対象にする

4. CLI recovery
   backend が本当に CLI 介入を要求する場合だけ、将来は `retry_reason=cli_required` または同等の explicit field から recovery surface を出す

5. 原則
   到達しない state を先に置いておく設計はしない。必要になった時点で backend field と一緒に追加する

### 6. Submit / Approve は Light-First

submit / approve dialog の diff preview は MergeLog と同じ light-first に揃える。

固定方針:

- modal open 時は `getDiffSummaryLight(...)` だけ呼ぶ
- `getDiffSummary(...)` は auto-start しない
- changed table list / schema marker / changed table count だけを初期表示する
- heavy count / cell diff は明示操作で初めて取得する
- heavy read 失敗は local inline error + retry。write の success / failure には混ぜない
- light read 失敗も preview pane 内で扱い、submit / approve の primary action 自体は既存 flow を壊さない

## State Transition Table

| Event | Current state | Next state | Required UI |
| --- | --- | --- | --- |
| `(targetId, dbName, branchName)` change | any | `contextEpoch++` 後の fresh UI | reset matrix を適用 |
| commit start | `Idle` / `DraftEditing` | `Committing` | global commit UI だけ loading |
| commit success | `Committing` | `Idle` | success toast、head refresh |
| stale head on write | any | `StaleHeadDetected` | refresh CTA を見せる |
| stale-head refresh success | `StaleHeadDetected` | `Idle` or `DraftEditing` | error clear、grid refresh |
| submit / approve / reject / cross-copy / csv start | any non-stale | base state は維持、local loading 開始 | `Syncing` は使わない |
| write `outcome=completed` | local loading | idle-equivalent | success toast、必要な refresh、必要なら branch switch |
| write `outcome=failed` | local loading | modal stay | red error、no success toast |
| write `outcome=retry_required` | local loading | recovery visible | retry banner / dialog、no success toast |
| submit / approve modal open | `Idle` | modal open + light summary loading | heavy diff は開始しない |
| user explicitly asks heavy diff | light summary rendered | heavy loading | pane 内だけ loading / retry |
| history / search fetch start | any | read loading | 旧 result を clear |
| history / search `read_integrity=complete` | read loading | result or empty | result または empty を表示 |
| history / search `read_integrity=degraded` | read loading | read integrity error | no result rendering, error / retry |
| history / search `read_integrity=failed` or non-2xx | read loading | read error | red error + retry、empty にしない |
| backend says `cli_required` | any write recovery path | explicit recovery surface | base state enum ではなく response-driven overlay |

## Deletion Targets

| File | Delete / replace |
| --- | --- |
| `frontend/src/api/client.ts` | `sync()` export |
| `frontend/src/types/api.ts` | `SyncRequest`, `SyncResponse` |
| `frontend/src/store/ui.ts` | `BaseState.Syncing`, `BaseState.SchemaConflictDetected`, `BaseState.ConstraintViolationDetected` |
| `frontend/src/App.tsx` | `stateLabel` の removed state 分岐、commit disable 条件の removed state 参照 |
| `frontend/src/components/TableGrid/TableGrid.tsx` | `editingBlocked` の removed state 参照 |
| `frontend/src/components/CLIRunbook/CLIRunbook.tsx` | state-machine 駆動の overlay。残すなら `cli_required` 駆動へ置換 |
| `frontend/src/components/RequestDialog/RequestDialog.tsx` | approve の success + warnings 混在処理、submit/approve の eager heavy load |
| docs / review notes | `/sync` 前提、warning-success 前提、dead recovery state 前提 |

## Backend Field Dependencies

| UI surface | Required fields | Adapter-only fields | Truth に使わない fields |
| --- | --- | --- | --- |
| request badge | `GET /requests` の current `(targetId, dbName)` に対する件数 | none | write response の副次 field |
| submit | `outcome`, `message`, `completion.request_recorded`, `completion.lock_observable`, `completion.work_head_synced`, `retry_reason`, `retry_actions`, `overwritten_tables`, `request_id`, `submitted_main_hash`, `submitted_work_hash` | none | `overwritten_tables` 単独 |
| approve | `outcome`, `message`, `completion.main_merged`, `completion.audit_recorded`, `completion.request_cleared`, `completion.resume_branch_ready`, `retry_reason`, `retry_actions`, `active_branch` | `active_branch_advanced`, `archive_tag` | `warnings`, `archive_tag`, `active_branch_advanced` 単独 |
| reject | `outcome`, `message`, `completion.request_cleared`, `retry_reason`, `retry_actions` | `status` | `status` 単独 |
| cross-copy rows | `outcome`, `message`, `completion.destination_committed`, `completion.destination_branch_ready`, `completion.protected_refs_clean`, `retry_reason`, `retry_actions`, `hash`, `inserted`, `updated`, `total` | none | `hash` 単独 |
| cross-copy table | `outcome`, `message`, `completion.destination_committed`, `completion.destination_branch_ready`, `completion.protected_refs_clean`, `retry_reason`, `retry_actions`, `hash`, `branch_name`, `row_count`, `shared_columns`, `source_only_columns`, `dest_only_columns` | none | `branch_name` 単独 |
| csv apply | `outcome`, `message`, `completion.destination_committed`, `retry_reason`, `retry_actions`, `hash` | none | `hash` 単独 |
| history | `read_integrity`, `message`, `retry_actions`, `commits` または同等の list payload | legacy `merged/*` adapter, `degraded` -> fail-loud adapter | empty array 単独, partial `commits` |
| search | `read_integrity`, `message`, `retry_actions`, `results`, `total` | `degraded` -> fail-loud adapter | empty array 単独, partial `results` |

補足:

- `message` は user-facing copy の第一 source
- `warnings` は advisory only であり、frontend の success / retry / error 分岐には使わない
- read 側が `retry_actions` という field 名を共有してもよいが、分岐軸は必ず `read_integrity`
- `degraded` は UI rendering mode ではなく adapter input としてだけ扱う

## Why This Does Not Break Flow Freeze

- entry point は増やさない。既存のボタン、modal、一覧、badge の配置はそのまま
- `contextEpoch` reset は context を跨いだ stale UI の掃除だけで、新しい操作手順は増やさない
- write 成功判定は stricter になるが、happy path 自体は今の submit / approve / copy / csv flow をそのまま使う
- history / search は modal 内に integrity banner と retry を足すだけで、別画面や別作業を要求しない
- `/sync` と dead state の削除は未到達導線の整理であり、live flow を削る変更ではない
- light-first は modal open の重い自動 read を減らすだけで、submit / approve の順序や責務を変えない
