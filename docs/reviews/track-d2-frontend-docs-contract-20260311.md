# Track D2: Frontend / Docs Contract

Date: 2026-03-11

## Goal

Track C 完了後に frontend / docs / tests が守る契約を固定する。production code はこの track の対象外とし、public contract の更新順と追加テストを先に確定する。

## Locked Premises

- README は overview only
- `docs/api-reference.md` が public contract
- approved history の primary truth は `main` approval footer、`merged/*` は secondary
- `/sync` は dead contract として除去する
- success toast は `outcome=completed` のときだけ許す
- history / search の silent degrade は許さない

## History/Search Single Policy

history / search の single policy は fail-loud に固定する。

- UI が result list を描画してよいのは `read_integrity=complete` のときだけ
- `read_integrity=degraded` は partial success を意味しない
- backend が `degraded` を返しても、frontend adapter は fail-loud error / retry surface に正規化する
- partial `commits` / `results` / `total` は truth として描画しない
- empty state は `read_integrity=complete` かつ count=0 のときだけ許可する

### UI Rendering Rule

| Read state | Rendering |
| --- | --- |
| `read_integrity=complete` and count > 0 | result list を表示してよい |
| `read_integrity=complete` and count = 0 | empty state を表示してよい |
| `read_integrity=degraded` | result list を表示しない。error / retry surface を出す |
| `read_integrity=failed` | result list を表示しない。error / retry surface を出す |
| non-2xx `ErrorEnvelope` | result list を表示しない。error / retry surface を出す |

### Adapter Contract

- backend の read contract は `read_integrity`, `message`, `retry_actions` を持ってよい
- `read_integrity=degraded` は移行互換の adapter input としてだけ許す
- frontend adapter は `degraded` を `display_state="integrity_error"` に写像する
- `display_state="integrity_error"` では `commits` / `results` / `total` を描画に使わない
- `message` と `retry_actions` だけを user-facing recovery surface に使う

## API/doc どちらを正とするかの判定

### 判定

public contract の正は `docs/api-reference.md` とする。`README.md` は overview だけを持ち、API shape・完了条件・履歴 truth を約束してはならない。

ただし、現在の `docs/api-reference.md` には stale text が残っている。次の衝突では「古い doc を実装に合わせて延命する」のではなく、Track B1 / B2 / C の locked decision と実 router を根拠に `docs/api-reference.md` を先に修正する。

- `/sync` を resurrect しない
- `merged/*` primary を resurrect しない
- `archive_tag` / `warnings` / `active_branch_advanced` を success truth にしない
- `history/commits` / `/search` の partial success を doc で許さない

### Canonical Source Matrix

| Scope | Canonical source |
| --- | --- |
| Public API / UI contract | `docs/api-reference.md` |
| Overview /導入説明 | `README.md` |
| Refactor intent / migration decision | `docs/reviews/track-b1-outcome-contract-20260311.md`, `docs/reviews/track-b2-audit-truth-20260311.md`, `docs/reviews/track-c-ui-contract-alignment-20260311.md`, `docs/reviews/track-d-contract-tests-20260311.md` |
| Current implementation evidence | `frontend/src/*`, `frontend/tests/*`, `backend/internal/handler/handler.go` |

## Current Coverage Baseline

既存 E2E がすでに持っている coverage:

- `frontend/tests/e2e/context.spec.ts`
  - branch create / reopen / readiness recovery
- `frontend/tests/e2e/branch-sensitive.spec.ts`
  - current branch search
  - explicit from/to compare
  - MergeLog light-first shell
  - protected branch からの cross-copy 導線
- `frontend/tests/e2e-real/branch-lifecycle.spec.ts`
  - submit -> reject -> resubmit -> approve の happy path

不足しているのは次の 4 系統:

- `completed` / `failed` / `retry_required` の UI mapping
- context epoch reset と stale badge 防止
- history / search の fail-loud contract
- docs 側の stale contract 除去

## Test Case 一覧

### 1. Frontend unit で足す invariant

| ID | Invariant | メモ |
| --- | --- | --- |
| U-01 | `outcome=completed` だけが success toast を返す | submit / approve / reject / cross-copy / csv に共通化する helper を前提に unit 化する |
| U-02 | `outcome=failed` は error、`outcome=retry_required` は retry UI model を返し、どちらも success toast を返さない | hard-coded success string を禁止する |
| U-03 | backend `message` があれば toast / banner 文言はそれを優先する | Track B1 の message priority を固定する |
| U-04 | context epoch change で `previewCommit`, `selectedCell`, modal state, `rowHistoryInfo`, `overwrittenTables`, global `error/success`, `requestCount` が全部 reset される | `App.tsx` の reset matrix を pure helper に切り出して unit で固定する |
| U-05 | `selectedTable` は「同名があれば維持、無ければ先頭、空なら空文字」に正規化される | branch/db 切替時の stale table を防ぐ |
| U-06 | request badge refresh failure は stale positive count を残さない | `loading/unknown -> 0/hidden` の扱いを helper で固定する |
| U-07 | submit / approve dialog の initial load は light summary plan だけを作り、heavy diff plan を自動生成しない | RequestDialog の lazy heavy policy を pure 化して unit 固定する |
| U-08 | `history/commits` と `/search` の degraded / partial response は partial view model に変換されず、error / retry model に落ちる | fail-loud contract を adapter 層で固定する |
| U-09 | `read_integrity=degraded` は `display_state="integrity_error"` に正規化され、list payload を破棄する | adapter contract を pure helper で固定する |

### 2. Playwright mock で足す invariant

| ID | Invariant | 期待結果 |
| --- | --- | --- |
| M-01 | submit modal を開いただけでは `/diff/summary/light` だけが呼ばれ、`/diff/summary` は explicit action まで呼ばれない | heavy diff lazy |
| M-02 | approve modal も同じ light-first 挙動を守る | heavy diff lazy |
| M-03 | branch/context 切替で `previewCommit` banner, MergeLog, Search, CrossCopy, CSV, submit/approver modal, comment panel が閉じる | stale UI 持ち越し禁止 |
| M-04 | branch 切替後に旧 `selectedTable` が存在しない場合、先頭 table に落ちる | invalid table 持ち越し禁止 |
| M-05 | request badge refresh が失敗したら `📋 N` は消えるか unknown に戻り、旧 N を出し続けない | silent stale badge 禁止 |
| M-06 | submit が `retry_required` を返したとき、success toast を出さず、backend `message` と `retry_actions` を表示する | `completed` only success |
| M-07 | approve が `retry_required` を返したとき、success toast を出さず、`active_branch_advanced` や `warnings` だけで success 扱いしない | adapter field を truth にしない |
| M-08 | reject が `failed` / `retry_required` を返したとき、success toast を出さず、request list を optimistic に消さない | reject も outcome 基準 |
| M-09 | cross-copy rows / table と CSV apply が `failed` / `retry_required` を返したとき、success toast を出さない | write endpoint 共通 contract |
| M-10 | `history/commits` が integrity error または `read_integrity=degraded` を返したら、partial row を描画せず error / retry を出す | history fail-loud |
| M-11 | `/search` が partial / degraded error を返したら、result count や navigation を出さず error / retry を出す | search fail-loud |
| M-12 | `merged/*` が欠損しても `history/commits` が valid record を返す限り MergeLog は表示できる | `main` footer primary を UI 側でも固定する |

### 3. Playwright real で足す invariant

| ID | Invariant | 期待結果 |
| --- | --- | --- |
| R-01 | 既存 `branch-lifecycle` smoke を outcome contract に拡張する | approve / reject / submit で `completed` のときだけ success UI、request cleared、work branch が main HEAD に揃う |
| R-02 | approve 後に `merged/*` secondary index を消しても MergeLog が approval record を表示できる | `main` footer primary の実証 |
| R-03 | real UI で branch/context を切り替えたとき、past-version preview と modal state が残らない | Track C reset matrix の end-to-end 確認 |
| R-04 | real UI で submit / approve modal を開いても heavy diff request は飛ばず、explicit action 後にだけ飛ぶ | lazy heavy policy の end-to-end 確認 |
| R-05 | real search は current branch を使い、branch 切替後に旧 branch / 旧 table を再利用しない | stale branch context 禁止 |
| R-06 | test harness で invalid footer / `read_integrity=degraded` history / `read_integrity=degraded` search injection を追加したら、UI は fail-loud になる | result list は描画されず、error / retry に落ちる |

## Docs mismatch 一覧

| Priority | File | Current text / assumption | Correct contract |
| --- | --- | --- | --- |
| P0 | `docs/api-reference.md` | `POST /sync` を public endpoint として残している | `/sync` は dead contract。endpoint, error table, UI guard, state machine から除去する |
| P0 | `README.md` | API 一覧に `/api/v1/sync` を載せている | README は overview only。endpoint inventory から `/sync` を消し、できれば API 一覧自体を縮小する |
| P0 | `docs/api-reference.md` | approve success を `active_branch_advanced` / `archive_tag` / `warnings` で説明している | public completion truth は `outcome` + `message` + `completion` + `retry_actions` |
| P0 | `README.md` | approve を「`merged/*` アーカイブ作成 + branch advance」で説明している | canonical audit truth は `main` approval footer。`merged/*` は secondary に格下げする |
| P0 | `docs/api-reference.md` | `GET /versions` を `merged/*` primary の version source として記述している | `merged/*` primary は廃止。`/versions` は削除するか legacy/secondary に再定義する。現 router にも route が無い |
| P0 | `README.md` | `/api/v1/versions` を public API 一覧に載せている | README から削除する。overview only に戻す |
| P0 | `docs/api-reference.md` | `/search` が未記載 | `GET /search` を public contract に昇格し、branch-bound query と fail-loud policy を明記する |
| P1 | `docs/api-reference.md` | `GET /history/commits` を generic branch commit history として説明している | MergeLog / approval history は `main` approval footer primary。invalid footer / partial result は error にする |
| P1 | `docs/api-reference.md` | UI state machine に `Syncing`, `SchemaConflictDetected`, `ConstraintViolationDetected` を常設 state として残している | `/sync` と一緒に `Syncing` を除去。残り 2 state は explicit backend recovery reason がある場合にだけ public contract に残す |
| P1 | `README.md` | workflow 図が `merged/*` tag を監査 truth として扱っている | workflow 図は `main` approval footer primary / `merged/*` secondary に更新するか、詳細を README から落とす |
| P1 | `README.md` | README が state machine / endpoint inventory / detailed workflow まで抱えている | README は overview に限定し、詳細 contract は `docs/api-reference.md` に一本化する |

## 更新順序

1. `docs/api-reference.md`
   - `/sync` 削除
   - `OperationOutcome` 契約導入
   - approve / reject / submit / history / search を Track B1/B2 に揃える
   - `main` footer primary / `merged/*` secondary を明記
   - `/search` を追加
2. `README.md`
   - API 一覧・state machine・detailed workflow を縮小
   - overview only に戻す
   - `merged/* primary`, `/versions`, `/sync` を落とす
3. frontend unit tests
   - outcome mapping
   - context epoch reset
   - selected table reconciliation
   - stale badge policy
4. Playwright mock tests
   - light-first modal
   - fail-loud history/search
   - retry_required / failed UI
   - branch switch reset
5. Playwright real smoke
   - completed-only success
   - footer-primary history
   - stale UI non-persistence
6. `docs/COLLAB_PLAN.md` と review docs の要約同期
   - public contract 更新後にだけ反映する
   - handoff doc を public contract の代用品にしない

## Track C 完了後に確認すべき UI invariants

### Track C 単体で必須

- branch/context 切替で古い `previewCommit` が残らない
- branch/context 切替で open modal / comment panel / row history context が残らない
- `selectedTable` は invalid value を保持しない
- request badge は refresh failure で stale count を残さない
- success toast は `completed` のみ
- `failed` / `retry_required` は success に見えない
- submit / approve open では heavy diff を叩かない
- `/sync` ボタン、`Syncing` state、`/sync` 前提の文言が UI に残らない
- `read_integrity=degraded` は partial list ではなく error / retry として表示される

### Track B 連携込みで必須

- MergeLog / history は `main` approval footer を primary source として読める
- `merged/*` secondary index 欠損だけで approved history が消えない
- invalid footer / partial history は warning 付き partial list ではなく error / retry になる
- `/search` partial result は warning 付き partial result ではなく error / retry になる

## Decision Summary

- Public contract の正は `docs/api-reference.md`
- README は overview only
- `/sync` は dead contract として削除
- `main` footer primary / `merged/*` secondary を docs と tests に固定
- success toast は `completed` のみ
- history / search は `read_integrity` を持ってよいが、UI policy は fail-loud に固定
- 追加テストは unit -> mock -> real の順で積む
