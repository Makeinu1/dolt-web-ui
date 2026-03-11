# `dolt-web-ui` `master` Review

Date: 2026-03-11

## Summary

- Scope: `dolt-web-ui` の現行 Git `master` 全体
- Lens: `docs/product-principles.md` の 4 原則を最優先
- Deliverable: 優先度付き findings + リファクタリング方針 + 実施順ロードマップ
- Pre-refactor package: [pre-refactor-package-20260311.md](pre-refactor-package-20260311.md)
- Refactor strategy: [backend-led-refactor-strategy-20260311.md](backend-led-refactor-strategy-20260311.md)

## Evidence

- Static review:
  `backend/internal/service`, `backend/internal/repository`, `backend/internal/validation`,
  `frontend/src/App.tsx`, `frontend/src/components/**`, `frontend/src/store/**`,
  `frontend/src/utils/**`, `docs/product-principles.md`
- Commands run:
  `GOCACHE=/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/backend/.gocache go test ./...`
  `npx vitest run`
  `CI=1 npx playwright test tests/e2e/branch-sensitive.spec.ts tests/e2e/error-recovery.spec.ts --reporter=line`
- Current result:
  backend tests passed
  frontend Vitest passed
  targeted Playwright mock suites passed

## Findings

### P0. Cross-copy が通常フローの中で `main` を直接変更しており、失敗時に戻らない

- 壊す原則:
  1. 普通の業務ユーザが永続的に詰まらない
  2. `main` / `audit` を常に信頼できる
  4. 成功・失敗・要再試行が UI で明確に分かる
- 実ユーザー影響:
  cross-copy table / rows は、コピー対象の branch を作る前または work branch に書く前に `main` のカラム型拡張を commit する。後続の branch readiness, FK, copy failure, retry failure が起きても `main` の DDL は残るため、通常のコピー操作が source-of-truth を静かに汚染する。
- 再現経路:
  1. `audit` または `main` をコピー元に、型拡張が必要な cross-copy を実行する
  2. 後続で `BRANCH_NOT_READY`、制約違反、コピー失敗を起こす
  3. API は失敗を返すが `main` には DDL commit が残る
- 根拠:
  `backend/internal/service/crosscopy_table.go:95-115`
  `backend/internal/service/crosscopy_table.go:149-206`
  `backend/internal/service/crosscopy.go:529-569`
  `backend/internal/service/crosscopy.go:633-679`
  `backend/internal/service/crosscopy_table.go:17-23`
- 既存テスト:
  happy path のみあり。`backend/internal/service/branch_lifecycle_integration_test.go:409-465`
  `audit` をコピー元として許可するテストあり。`backend/internal/service/branch_lifecycle_integration_test.go:467-494`
  failure 後に `main` が汚染されないことを保証するテストはない
- 修正方向:
  cross-copy は visible のまま残してよいが、`main` への schema expansion 自体を通常操作の副作用にしてはいけない。DDL を dedicated admin/import flow に分離するか、work branch 内で完結する diff に落とし直すべき。

### P1. Approve が partial success を success 扱いしており、stable な再開と完了の明確さを壊している

- 壊す原則:
  2. `main` / `audit` を常に信頼できる
  3. work item は stable な名前で再発見できる
  4. 成功・失敗・要再試行が UI で明確に分かる
- 実ユーザー影響:
  `main` への merge が成功した後で archive tag 作成、request tag 削除、work branch 前進のいずれかが失敗しても API は success を返し、UI は「main へのマージが完了しました」と表示する。結果として Inbox に request が残る、work branch が再開できない、stable name の継続が壊れる、という partial success が正常完了っぽく見える。
- 再現経路:
  1. Approve 中に `DOLT_TAG('-d')` または `DOLT_BRANCH('-f')` を失敗させる
  2. backend は warning を積んだ success response を返す
  3. frontend は success toast を出し、warning は副次的な error banner に混ぜる
- 根拠:
  `backend/internal/service/request.go:328-367`
  `backend/internal/service/request.go:336-356`
  `frontend/src/components/RequestDialog/RequestDialog.tsx:476-487`
- 既存テスト:
  cleanup が全て成功する happy path のみあり。`backend/internal/service/branch_lifecycle_integration_test.go:255-277`
  `backend/internal/service/branch_lifecycle_integration_test.go:441-455`
  partial success の contract test はない
- 修正方向:
  Approve の結果を `complete` と `merged_but_cleanup_failed` に分離し、request tag cleared / archive saved / active branch advanced / branch ready を UI 上の完了条件として明示する。`main` 反映だけ完了した場合は「要再試行」扱いにすべき。

### P1. Schema conflict / constraint violation 用の escape hatch が state machine 上は存在するのに、実際には到達できない

- 壊す原則:
  1. 普通の業務ユーザが永続的に詰まらない
  4. 成功・失敗・要再試行が UI で明確に分かる
- 実ユーザー影響:
  README と UI state には `SchemaConflictDetected` / `ConstraintViolationDetected` と CLI runbook があるが、frontend 側にその state へ遷移させる処理がない。実際に schema conflict や constraint violation が起きても generic error に落ち、escape hatch が出ない。
- 再現経路:
  1. backend が `SCHEMA_CONFLICTS_PRESENT` や constraint violation 系エラーを返す
  2. frontend は `STALE_HEAD` 以外を generic error に落とす
  3. `CLIRunbook` は表示条件に入らない
- 根拠:
  `frontend/src/store/ui.ts:4-12`
  `frontend/src/components/CLIRunbook/CLIRunbook.tsx:13-26`
  `frontend/src/components/common/CommitDialog.tsx:64-75`
  `frontend/src/components/CSVImportModal/CSVImportModal.tsx:151-159`
  `frontend/src/components/RequestDialog/RequestDialog.tsx:220-228`
  `backend/internal/service/sync.go:122-131`
  `backend/internal/service/commit.go:131-147`
  `backend/internal/service/csvimport.go:379-380`
- 既存テスト:
  stale head / branch locked の recovery test はある。`frontend/tests/e2e/error-recovery.spec.ts:12-133`
  schema conflict / constraint violation の UI recovery test はない
- 修正方向:
  この導線を本当に残すなら、backend code を `BaseState` に正しくマップして blocking UI を出す。そこまでやらないなら dead state と docs を一旦削って、存在しない自己復旧を約束しないほうがよい。

### P2. Submit / Approve の critical path で、ユーザー操作前に heavy diff summary を走らせている

- 壊す原則:
  1. 普通の業務ユーザが永続的に詰まらない
  4. 成功・失敗・要再試行が UI で明確に分かる
  5. 強い機能を残しても通常導線を汚さない
- 実ユーザー影響:
  submit dialog / approve dialog を開くだけで `diff/summary` の heavy path が即時実行される。重い DB では critical path 自体が遅くなり、timeout 時は通常操作の画面が degraded state から始まる。
- 再現経路:
  1. 承認申請または承認ダイアログを開く
  2. `ExpandableDiffSummary` が mount 時に light と heavy を同時に叩く
  3. タイムアウト時は「変更テーブル一覧のみ」を表示してそのまま通常導線が続く
- 根拠:
  `frontend/src/components/RequestDialog/RequestDialog.tsx:25-46`
  `frontend/src/components/RequestDialog/RequestDialog.tsx:83-88`
  `frontend/src/components/RequestDialog/RequestDialog.tsx:243-260`
  `frontend/src/components/RequestDialog/RequestDialog.tsx:341-360`
- 既存テスト:
  merge log だけは light-first / heavy-on-demand を守っている。`frontend/tests/e2e/branch-sensitive.spec.ts:142-205`
  request dialog に同等の guard はない
- 修正方向:
  merge log と同じ方針に揃え、初期表示は light summary のみ、heavy count と cell-level diff は明示操作時だけ取得する。

### P2. CSV preview が失敗を隠して「全部 insert」と見せるため、完了判断の前提が壊れる

- 壊す原則:
  1. 普通の業務ユーザが永続的に詰まらない
  4. 成功・失敗・要再試行が UI で明確に分かる
- 実ユーザー影響:
  DB 存在確認の batch query が失敗すると、preview はそれをエラーにせず `dbIndex` 空のまま継続し、全行を insert と数える。ユーザーは preview を信じて apply するため、更新件数・追加件数の認識が破綻する。
- 再現経路:
  1. composite PK や SQL 差異で batch query を失敗させる
  2. preview は fallback で継続する
  3. frontend は counts を通常の preview として表示する
- 根拠:
  `backend/internal/service/csvimport.go:144-176`
  `backend/internal/service/csvimport.go:193-235`
  `frontend/src/components/CSVImportModal/CSVImportModal.tsx:219-235`
- 既存テスト:
  stale head apply はある。`frontend/tests/e2e/error-recovery.spec.ts:92-133`
  preview degradation の contract test はない
- 修正方向:
  preview が正確に作れない場合は error か degraded banner を返し、通常 preview と同列に見せない。少なくとも apply 前に「推定値」であることを明示すべき。

### P2. 承認待ちバッジが silent failure で stale になりうる

- 壊す原則:
  3. work item は stable な名前で再発見できる
  4. 成功・失敗・要再試行が UI で明確に分かる
- 実ユーザー影響:
  request badge は re-entry point だが、context change 時の refresh が失敗しても `requestCount` を reset せず無言で握りつぶす。そのため前 DB の件数が残る、あるいは本当は失敗しているのに badge が更新されたように見える。
- 再現経路:
  1. request がある DB を開いて `requestCount > 0` にする
  2. 別 DB へ切り替え、`listRequests` を失敗させる
  3. `requestCount` は前値のまま残る
- 根拠:
  `frontend/src/App.tsx:149-158`
  `frontend/src/App.tsx:193-203`
  `frontend/src/store/ui.ts:28-39`
- 既存テスト:
  なし
- 修正方向:
  context change で `requestCount` を先に reset し、refresh failure は silent ignore せず non-blocking な再試行導線を出すべき。

## Refactoring Summary

### Keep

- work branch lifecycle (`wi/*`, `req/*`, `merged/*`) 自体
- optimistic locking / `expected_head`
- branch-ready wait と existing branch reopen UX
- recovery reload の one-shot reset
- merge log の light-first / heavy-on-demand 方針

### Constrain

- cross-copy rows / table
- CSV preview / apply
- Approve 完了判定
- request badge refresh
- submit / approve 時の diff loading

### Move To Admin

- `main` への schema expansion を伴う cross-copy 事前処理
- CLI 必須の schema / constraint 復旧
- 「main 反映は済んだが cleanup が壊れた」状態の後始末

### Remove

- 現時点で即削除すべき通常機能はない
- ただし dead state / dead docs / dead escape hatch は、実装を入れないなら削除して約束を減らすべき

## Roadmap

1. `main` / `audit` 信頼性を先に修正する
   `main` を通常操作の副作用で書き換える例外経路を止める
2. partial success を first-class にする
   Approve / branch maintenance / tag cleanup の完了条件を API で分離する
3. 復旧 state を実装か削除のどちらかに揃える
   dead state machine と dead docs を残さない
4. heavy query を通常導線から外す
   submit / approve / inbox は light summary で始める
5. テストを追加する
   cross-copy failure rollback
   approve partial success contract
   schema/constraint recovery UI
   request badge stale count
   request dialog lazy loading

## Test Gaps To Add Before Refactor

- backend:
  cross-copy failure 後に `main` HEAD / schema が変わらないこと
  approve で archive tag / request tag / branch advance の各失敗を individually 検証すること
- frontend:
  `SCHEMA_CONFLICTS_PRESENT` と constraint violation が blocking recovery UI に遷移すること
  request badge refresh failure で count を持ち越さないこと
  submit / approve dialog が heavy diff を mount 時に叩かないこと
- e2e:
  partial success を success toast だけで終わらせないこと
  audit source を使った cross-copy が `main` を汚染しないこと
