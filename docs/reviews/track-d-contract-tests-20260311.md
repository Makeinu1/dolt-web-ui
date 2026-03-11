# Track D: Docs / Tests Contract

Date: 2026-03-11

## Goal

README、API docs、tests、code の契約を 1 つの refactor package に揃え、refactor 開始前に「何を守るか」を固定する。

## Canonical Sources

- Public API / UI contract:
  `docs/api-reference.md`
- Refactor intent / internal contract:
  `docs/reviews/pre-refactor-package-20260311.md`
  `docs/reviews/backend-led-refactor-strategy-20260311.md`
  `docs/reviews/track-a-safety-boundary-20260311.md`
  `docs/reviews/track-b-audit-completion-model-20260311.md`
  `docs/reviews/track-c-ui-contract-alignment-20260311.md`
- README:
  overview only
  未実装 contract を先行して約束しない

## Current Mismatches To Resolve

- `/sync` は docs/client/state に残るが router には無い
- `SchemaConflictDetected` / `ConstraintViolationDetected` は docs/state にあるが主要導線と不整合
- MergeLog / history は docs 上 `merged/*` 主体に見え、refactor 方針では `main` merge commit 主体に変わる
- request / approve の success semantics が docs と UI で曖昧

## Required Test Layers

### 1. Backend unit / service tests

対象:

- policy enforcement
- request / approve outcome
- audit footer parse
- cross-copy rollback
- degraded history/search handling

固定する invariant:

- disallowed branch/ref は service で拒否
- metadata API は writable `main` session を使わない
- `main` 汚染を伴う失敗は completed にならない
- approve partial failure は `retry_required`
- `merged/*` 欠損でも audit truth は `main` から読める

### 2. Backend integration tests

対象:

- branch lifecycle
- approve / reject / resubmit
- archive/index failure injection
- cross-copy failure rollback

最低追加ケース:

- archive tag failure injection
- request tag cleanup failure injection
- branch advance failure injection
- cross-copy schema expansion failure path
- allowed branch policy mismatch

### 3. Frontend unit tests

対象:

- context epoch reset
- outcome mapping
- request badge reset
- dead state cleanup

最低追加ケース:

- branch change で `previewCommit` が消える
- branch change で invalid `selectedTable` が先頭に落ちる
- `retry_required` では success toast を出さない
- `/sync` 削除後に dead state が残らない

### 4. Playwright mock tests

対象:

- UI flow 保持
- outcome 表示
- lazy heavy diff
- recovery banner

最低追加ケース:

- submit/approve open 時に heavy diff を叩かない
- approve partial failure で retry UI を出す
- request badge refresh failure で stale count を出さない
- branch/context 切替で modal / preview を閉じる

### 5. Playwright real smoke

対象:

- branch lifecycle
- submit / approve / reject
- cross-copy import branch
- MergeLog / history primary truth

## Docs Update Rules

- code とずれた docs は refactor と同じ PR で更新する
- README は overview だけを書く
- API shape を約束する文は `docs/api-reference.md` に限定する
- dead endpoint / dead state は docs から先に消してよい

## Definition Of Ready For Refactor

refactor 着手前に次が揃っていること。

1. pre-refactor package が存在する
2. Track A-D の設計文書が存在する
3. canonical source が固定されている
4. invariant test list が固定されている
5. dead `/sync` 契約の扱いが決まっている

## First Implementation Notes

- 先に test list を固定し、その後に Track A/B 実装へ入る
- docs update は最後ではなく各 track の PR に同梱する
