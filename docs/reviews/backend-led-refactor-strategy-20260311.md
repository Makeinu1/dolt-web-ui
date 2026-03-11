# UI Flow固定で進める Backend主導リファクタリング方針

Date: 2026-03-11

## Summary

- この文書は、`docs/reviews/master-review-20260311.md` の findings を「個別バグ修正」ではなく「backend 主導の構造リファクタリング」へ変換するための実装前提文書である。
- ゴールは、現行 UI flow を大きく変えずに、プロダクト原則を backend の真実源、API 契約、状態機械、tests、docs に埋め込むこと。
- 結論として、`backend を主戦場にする` のは正しいが、`UIをそのままに backend だけ` は不十分である。
- 採用方針は **UI flow freeze + backend truth rebuild + minimal UI alignment** とする。
- 入口文書は `docs/reviews/pre-refactor-package-20260311.md` とする。

## Why This Direction

- 深い問題の中心は backend 側にある。
  - branch/ref の境界が UI/handler レイヤに寄っている
  - `main` / `audit` の信頼が first-class ではなく best-effort metadata に依存している
  - 操作完了が `success with warnings` に崩れている
- ただし backend だけでは解消しない問題もある。
  - context 切替後の stale UI state
  - 到達しない recovery state
  - backend outcome と UI 表示の不一致
- したがって、固定する対象は `現行 React 実装` ではなく `利用者がたどる flow` とする。

## Scope

- 維持する flow:
  `branch 作成/再開 -> 編集 -> commit -> submit -> approve/reject -> history/search/cross-copy/CSV`
- 許容する UI 変更:
  - 状態表示の正規化
  - success / failed / retry_required の表示分離
  - context reset
  - dead recovery / dead sync 導線の整理
- この段階でやらないこと:
  - 新機能追加
  - 画面構成の大幅変更
  - 現行の主要操作順序の変更

## Refactor Principles

1. 普通の業務ユーザが永続的に詰まらない
2. `main` / `audit` は常に信頼できる
3. work item は stable な名前で再発見できる
4. 成功・失敗・要再試行が UI で明確に分かる

この 4 原則を backend の契約として強制し、UI はその結果を忠実に表示するだけに寄せる。

## New Backend Contract

### 1. Domain Concepts

backend の中核概念を次に固定する。

- `ProtectedRefPolicy`
  - `main` / `audit` の保護境界
  - write だけでなく、`main` を暗黙に writable checkout する helper も禁止対象
- `AllowedRefPolicy`
  - `allowed_branches` と API が受け付ける ref/branch の実効境界
  - regex allow ではなく、設定と feature ごとの許可範囲で判定
- `WorkItemIdentity`
  - `wi/*`、`req/*`、`merged/*` の関係
  - stable name での再開、approve/reject 後の継続、再発見性
- `ApprovalLifecycle`
  - submit / approve / reject の状態遷移
  - cleanup 完了を含めて初めて completed と呼ぶ
- `AuditRecord`
  - `main` への merge 事実を一次情報として扱う
  - `merged/*` は補助インデックスであり、source of truth にしない
- `OperationOutcome`
  - `completed`
  - `failed`
  - `retry_required`
  - warning を success に混ぜない

### 2. Repository Separation

接続責務を明確に分離する。

- `read-only metadata`
  - branch/table/head/history/search 取得用
  - writable checkout を伴ってはならない
- `branch write session`
  - work branch への write 専用
  - expected head / branch lock / branch policy を強制
- `main maintenance`
  - 管理操作だけが明示的に取得可能
  - 通常の業務フローからは直接到達させない

`ConnDB()` のような `DB操作 = main writable checkout` という設計は廃止対象とする。

### 3. Operation Outcome Semantics

対象操作:

- approve
- submit
- cross-copy
- CSV
- history/search の degraded response

契約:

- `completed`
  - UI 上で完了表示してよい
  - work item の継続条件、audit 保存条件、cleanup 条件を満たす
- `failed`
  - 副作用は rollback 済み、またはユーザーに未完了として示される
- `retry_required`
  - 一次的な副作用の一部は存在しうるが、UI は完了表示してはならない
  - 次の具体的アクションが返る

`main` に副作用を出す操作は、`completed` 条件を満たせないなら rollback するか、少なくとも `retry_required` として返す。

## Parallel Workstreams

### Track A: Safety Boundary

目的:
branch/ref allowlist、protected branch、repository 接続責務を backend の強制境界に変える。

対象:

- config の `allowed_branches`
- repository connection helpers
- branch/ref validation
- cross-copy の `main` 直接変更経路
- `ConnDB` 依存の metadata APIs

方針:

- policy 判定を handler から service/repository 手前へ移す
- metadata API は read-only connection のみで成立させる
- `main` を通常フローの副作用で書き換える実装は禁止する
- ref/branch を受ける API は feature ごとに許可集合を持つ

受け入れ条件:

- UI を経由しなくても禁止 branch/ref は拒否される
- metadata API で `main` writable session が開かれない
- cross-copy failure 後に `main` が変化しない

### Track B: Audit / Completion Model

目的:
`何を成功と呼ぶか` と `何を audit truth とするか` を backend で再定義する。

対象:

- request submit / approve / reject
- merge log / history
- `merged/*` tag
- archive tag / request tag cleanup

方針:

- `main` の merge commit と branch state を一次事実にする
- `merged/*` は表示・検索最適化用の補助物に格下げする
- approve の completed 条件を `merge + audit保存 + request cleanup + work item 再開可能` まで含めて再定義する
- partial success は `retry_required` に分離する

受け入れ条件:

- archive tag 欠損でも audit truth が壊れない、または operation 自体が未完了になる
- request cleanup failure を success 扱いしない
- work item の再開条件が response contract で明示される

### Track C: UI Contract Alignment

目的:
UI flow は維持したまま、backend の新契約を正しく反映する最小変更だけを入れる。

対象:

- context change reset
- `BaseState` / success / error / retry mapping
- dead `/sync` / dead recovery / dead state
- request badge / preview mode / selected table 持ち越し

方針:

- `context epoch reset` を導入し、branch/db/target の切替で残してよい state と消す state を固定する
- UI state は backend outcome の表示レイヤに寄せる
- 未配線の sync/recovery 導線は wire するか削除するかのどちらかに揃える

受け入れ条件:

- branch/context 切替で古い `previewCommit` / `selectedTable` / modal state を持ち越さない
- `completed` / `failed` / `retry_required` が UI 上で見分けられる
- 存在しない recovery/sync を docs/UI/code に残さない

### Track D: Docs / Tests Contract

目的:
README、API docs、test strategy、Playwright、Go integration test を 1 つの canonical contract に揃える。

対象:

- `docs/api-reference.md`
- README
- `docs/test-strategy.md`
- Playwright mock/real
- backend integration test

方針:

- docs を feature inventory ではなく contract inventory として再編する
- spec と code がずれた項目は「後で更新」ではなく refactor scope に含める
- tests は happy path ではなく invariant を守るものへ寄せる

受け入れ条件:

- `/sync` のような dead spec が残らない
- docs と code が同じ公開 API / state machine を前提にする
- root cause 単位の回帰テストが存在する

## Feature Classification

### Keep

- work branch lifecycle 自体
- optimistic locking
- branch-ready wait / reopen existing branch UX
- merge log の light-first 方針

### Constrain

- approve
- submit
- cross-copy rows / table
- CSV preview / apply
- history / search degraded path
- request badge refresh

### Move to Admin

- `main` への schema expansion を伴う通常 cross-copy
- CLI 必須復旧
- `merged but cleanup failed` の後始末

### Remove

- dead `/sync` 契約
- 未到達 `BaseState`
- 未接続 recovery 導線
- stale docs にだけ残る feature 約束

## Compatibility Policy

- 既存 endpoint shape は可能な限り維持する
- ただし response semantics は新しい `OperationOutcome` に寄せる
- 互換のために adapter field を一時的に残してよいが、UI が完了表示を誤る contract は維持しない
- 互換優先順位:
  1. UI flow 維持
  2. safety / audit / completion の真実性
  3. field-level backward compatibility

## Execution Order

1. Track A: Safety Boundary
2. Track B: Audit / Completion Model
3. Track C: UI Contract Alignment
4. Track D: Docs / Tests Contract

この順序で進める理由は、UI や docs を先に整えても backend の truth boundary が曖昧なままだと再度ずれるため。

## Test Invariants

### Backend service / integration

- 許可されない branch/ref は UI を経由しなくても拒否される
- metadata API が writable `main` session を取らない
- `main` / `audit` を汚す操作は未完了扱いにならない
- approve 後の audit / request cleanup / work item 再開状態が一貫する
- `merged/*` 欠損時でも audit truth が壊れない、または operation 自体が未完了になる
- cross-copy / CSV / search / history で silent degrade を success 扱いしない

### Frontend / E2E

- branch/context 切替で古い `previewCommit` / `selectedTable` / modal 状態を持ち越さない
- `completed` / `failed` / `retry_required` が UI 上で見分けられる
- dead 導線を残さない

### Docs contract

- README / API docs / tests / code が同じ公開 API と主要状態機械を前提にしている

## Immediate Deliverables For The Next Step

この文書の次に作るべき成果物は次の 4 つ。

1. Track A の設計メモ
   backend の policy / repository 再編案
2. Track B の契約メモ
   approve / submit / history の outcome と audit truth 再定義
3. Track C の最小 UI 修正メモ
   context epoch reset、state mapping、dead 導線整理
4. Track D の contract test リスト
   backend integration、Playwright、docs 差分

## Relation To Existing Review

- 個別 findings と evidence は `docs/reviews/master-review-20260311.md` を参照する
- 本文書は、その findings を実装順序と責務分割に変換した refactor strategy である
