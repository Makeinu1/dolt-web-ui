# Track A: Safety Boundary

Date: 2026-03-11

## Goal

branch/ref の許可境界、protected branch 保護、repository 接続責務を backend の強制境界として定義し直す。

## Current State

- `allowed_branches` は config に存在するが、実効的な allowlist としては使われていない
- `ConnDB()` が `main` writable checkout を暗黙に取得する
- metadata API が `ConnDB()` に依存している
- handler の `mainGuard` と service の `IsProtectedBranch` が主要ガードになっている
- branch/ref validation は regex 中心で、feature ごとの許可範囲がない
- diff/history 系は commit hash / tag / branch を広く受け付ける一方、write 系の禁止は UI 前提になりやすい

## Code Anchors

- `backend/internal/config/config.go`
- `backend/internal/repository/dolt.go`
- `backend/internal/service/metadata.go`
- `backend/internal/service/branch_readiness.go`
- `backend/internal/service/crosscopy.go`
- `backend/internal/service/crosscopy_table.go`
- `backend/internal/validation/validate.go`
- `backend/internal/service/diff.go`

## Decisions

### 1. Policy Layers

backend は次の順で必ず policy を適用する。

1. `DatabasePolicy`
   - 対象 target/db が設定上存在するか
2. `AllowedRefPolicy`
   - その db で許可される branch/ref か
3. `FeatureRefPolicy`
   - その API が受け付ける ref の種類か
4. `ProtectedRefPolicy`
   - write が protected branch に向いていないか
5. `SessionPolicy`
   - 取得する接続種別が feature に適合しているか

regex validation は最後の SQL safety check に格下げし、許可判定の本体にはしない。

### 2. Repository Session Types

repository API は次の 3 種に固定する。

- `ConnRevision`
  - read-only revision DB access
  - branch, tag, commit hash, revision ref を受け付ける
- `ConnWorkBranchWrite`
  - `wi/*` 系 work branch 専用の write session
  - expected head / branch lock / protected branch check の前提を満たすこと
- `ConnProtectedMaintenance`
  - 明示的な管理操作だけが取得可能
  - 通常 flow からは直接使わない

`ConnDB()` は廃止対象とする。移行期間中に残す場合も、新規利用は禁止する。

### 3. Feature Ref Matrix

各機能が受け付ける ref を次に固定する。

- Metadata
  - branches/list/head/table/schema/rows/search/history read:
    `AllowedRefPolicy` を通した read-only ref
- Diff / History
  - branch, tag, commit hash, `^`, `~` は read-only feature に限り許可
- Write
  - commit / submit / CSV apply / merge abort:
    `wi/*` のみ
- Approve / Reject
  - request ID から解決される work item のみ
- Cross-copy source
  - `main` または `audit` のみ
- Cross-copy destination
  - 既存 `wi/*` または system が作る import work branch のみ

### 4. Allowed Branches Semantics

`allowed_branches` は次の意味に固定する。

- DB ごとの公開 branch/ref の allowlist
- UI だけでなく API 境界でも強制
- `main` / `audit` / `wi/*` のような pattern を受け付ける
- commit hash のような raw ref は read-only features でのみ許可し、allowlist とは別枠の `HistoryRefPolicy` で扱う

### 5. Protected Branch Rule

`main` / `audit` 保護は次を含む。

- 直接 write しない
- 暗黙に writable checkout しない
- 通常 flow の副作用として schema expansion しない
- 管理上必要な protected branch maintenance は `ConnProtectedMaintenance` に限定する

## Migration Plan

1. `ConnRevision` / `ConnWorkBranchWrite` / `ConnProtectedMaintenance` を定義
2. metadata / head / branch readiness / requests / history の read path から `ConnDB()` を追い出す
3. `AllowedRefPolicy` と `FeatureRefPolicy` を追加し、service 手前で適用
4. cross-copy の `main` 直接変更経路を通常 flow から分離
5. `ConnDB()` を削除

## Acceptance Criteria

- UI を経由しなくても禁止 branch/ref は拒否される
- metadata API が writable `main` session を取得しない
- cross-copy failure 後に `main` HEAD / schema が変化しない
- `allowed_branches` が UI と API の両方で同じ意味を持つ
- protected branch 保護が helper の暗黙利用でも破れない

## First Implementation Notes

- 最初の PR では動作を変えすぎない
- まず `ConnDB()` の read path 利用を置換し、その後に policy 強制を入れる
- cross-copy の設計変更は Track B の outcome 契約と同時に進める
