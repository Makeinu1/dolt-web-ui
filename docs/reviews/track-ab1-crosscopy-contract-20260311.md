# Track AB1: Cross-Copy Contract

Date: 2026-03-11

## Goal

Track A の safety boundary と Track B1 の write outcome を前提に、`/cross-copy/rows` と `/cross-copy/table` の契約を固定する。

この文書で決めること:

- rows/table cross-copy を normal flow に残せるか
- schema expansion をどこで実行するか
- `wi/*` / import branch / admin lane の責務分離
- `completed` / `failed` / `retry_required` の条件
- rollback / repair / retry invariants
- `Keep / Constrain / Move to admin` の分類

## Locked Premises

- UI flow は freeze する
  - preview/apply という現行 surface は維持する
  - ただし backend は normal flow の許可条件を絞ってよい
- normal user flow では protected ref への durable side effect を残さない
  - 対象は `main` / `audit`
- write outcome は Track B1 の `OperationOutcome` を採用する
- Track B2 の audit truth は approval 用である
  - cross-copy は新しい audit truth を作らない
  - cross-copy 用の protected maintenance commit は approval history / MergeLog の truth に昇格させない

## Current Problem Breakdown

### 1. 現行 rows/table は normal flow 中に `main` を更新する

現実装では、rows/table の両方が copy 本体の前に `main` へ schema expansion を commit している。

- `backend/internal/service/crosscopy.go`
  - `CrossCopyRows` が `ConnProtectedMaintenance(..., "main")` で DDL を実行し、その後に `wi/*` へ row copy している
- `backend/internal/service/crosscopy_table.go`
  - `CrossCopyTable` が `main` に DDL commit した後、import work branch を作成して table copy している

このため、normal flow の失敗で protected ref に durable residue が残りうる。

### 2. preview は既に schema mismatch を観測できる

`backend/internal/service/crosscopy.go` の `CrossCopyPreview` と `backend/internal/model/api.go` の `CrossCopyPreviewResponse` は、既に `expand_columns` を返せる。

つまり「schema expansion が必要か」は apply 前に判定できる。normal flow の apply で protected DDL を先行実行する必然性はない。

### 3. rows と table は residue の性質が違う

- rows
  - 宛先は既存の user-owned `wi/*`
  - 失敗時の residue はユーザーの作業 branch に直接残る
- table
  - 宛先は system-created import branch
  - 失敗時の residue は system-owned branch に閉じ込めやすいが、branch 作成後の cleanup / queryability が曖昧になりうる

### 4. 現行 response では completion truth が足りない

`CrossCopyRowsResponse.hash` と `CrossCopyTableResponse.hash/branch_name` だけでは、次を区別できない。

- destination commit が durable に確定したのか
- branch readiness が満たされたのか
- protected ref residue が残っていないのか

Track B1 の `destination_committed` / `destination_branch_ready` / `protected_refs_clean` を入れない限り、success toast の根拠が曖昧なままになる。

## Design Options

### Option A: normal flow に残しつつ、schema expansion は destination lane に限定する

内容:

- rows
  - 既存 `wi/*` を widen してから row copy
- table
  - import branch 作成後にその branch だけ widen してから table copy
- `main` / `audit` には触らない

利点:

- protected ref side effect は消せる
- UI flow を増やさずに one-shot copy を維持しやすい

欠点:

- rows failure 後に、既存 `wi/*` に schema-only residue が残りやすい
- DDL は transaction rollback できないため、`failed` に落とせる範囲が狭い
- rows は `retry_required` に寄りやすく、B1 の outcome を硬く定義しにくい
- 「data copy のつもりで schema change まで起きる」ので normal flow の意図が曖昧になる

評価:

- protected ref safety は満たす
- ただし normal flow の完了条件が弱く、rows の repair burden が重い

### Option B: normal flow は schema-compatible case のみ許可し、schema expansion は admin lane に移す

内容:

- preview は現行どおり `expand_columns` を返す
- rows/table apply は `expand_columns` が空のときだけ実行する
- schema expansion が必要な場合、normal flow apply は write 前に precondition error で止める
- protected schema expansion は admin lane で明示的に実行する
- rows は admin prep 後に、必要なら `main -> wi/*` sync を通して destination schema を揃える
- table は admin prep 後、`main` から import branch を作ることで prepared schema を継承する

利点:

- Track A の safety boundary と完全に整合する
- `completed` / `failed` / `retry_required` の切り分けが最も明確
- preview が既に持っている `expand_columns` をそのまま使える
- cross-copy が approval/audit truth と結合しない

欠点:

- schema mismatch case は即時 apply できなくなる
- admin lane か manual prep が別途必要になる

評価:

- safety / outcome / lane 分離の整合が最も良い
- UI flow freeze とも両立しやすい
  - UI surface は増やさず、backend が apply の許可条件を明示化するだけでよい

### Option C: 現行 main-first DDL を維持し、失敗時だけ `retry_required` を返す

内容:

- `main` 先行 DDL は残す
- failure や確認不足は `retry_required` で表す

利点:

- 実装変更が最小

欠点:

- Track A の「normal user flow で protected ref への durable side effect を残さない」に反する
- `protected_refs_clean=true` を `completed` の必須条件にできない
- retry が protected branch repair に依存し、A/B の責務分離が崩れる

評価:

- 採用不可

## Recommendation

Option B を採用する。

決定:

- rows/table cross-copy は normal flow に残してよい
- ただし normal flow で許すのは schema-compatible case のみ
- protected schema expansion は admin lane に移す
- cross-copy normal flow は `ConnProtectedMaintenance` を取得しない

理由:

- Track A の acceptance criteria を満たせる
- Track B1 の `protected_refs_clean=true` を `completed` の必須条件に固定できる
- preview の `expand_columns` をそのまま precondition signal に使える
- Track B2 の「audit truth は approval 用」を汚さない

## Lane Split

### 1. Source lane

- source ref は `main` または `audit` の read-only revision に固定する
- source は truth source であり、copy 中に mutate しない

### 2. `wi/*` lane

- rows cross-copy のみが使う
- 宛先は既存の user-owned `wi/*`
- normal flow は schema-compatible な data copy commit だけを行う
- schema prep が必要なら、admin lane 完了後に通常の sync/refresh で schema を取り込んでから再試行する

### 3. import branch lane

- table cross-copy のみが使う
- branch は system-created work branch とし、protected ref ではない
- branch 作成元は prepared `main`
- import branch は review/approval 可能な work artifact であり、audit truth ではない

### 4. admin lane

- protected ref maintenance 専用
- 役割は次に限定する
  - `main` の schema expansion
  - system-owned stale import branch の repair/cleanup
- normal flow endpoint からは直接呼ばない
- ここで作られる commit は approval footer や `merged/*` の代替ではない

## Outcome Contract

schema mismatch は write を始める前に判定できるため、`OperationOutcome` に落とさず precondition failure として返す。

apply endpoint の outcome は「write phase に入った後」のみで使う。

### Pre-write stop

次の場合、`/cross-copy/rows` と `/cross-copy/table` は durable write 前に止める。

- `expand_columns` が空でない
- destination lane が policy に合わない
- destination branch readiness の前提を満たさない

返し方:

- `ErrorEnvelope`
- code は `PRECONDITION_FAILED` または既存のより適切な precondition 系 code
- success / `failed` / `retry_required` にはしない

### `/cross-copy/rows`

`completed`:

- destination `wi/*` に copy commit が存在する
- 返却 `hash` がその commit を指す
- `destination_branch_ready=true`
- `protected_refs_clean=true`

`failed`:

- destination `wi/*` の durable state は未変更
- backend が follow-up 不要と言い切れる
- `protected_refs_clean=true`

`retry_required`:

- protected ref は clean
- ただし destination `wi/*` 側に residue または完了可否の曖昧さが残る
- 例:
  - commit は作られた可能性があるが確認できない
  - branch readiness 再確認に失敗した
  - existing `wi/*` に normal flow では掃除できない residue が残る

### `/cross-copy/table`

`completed`:

- import branch が queryable
- copy commit が存在する
- 返却 `branch_name` / `hash` がその durable state を指す
- `destination_branch_ready=true`
- `protected_refs_clean=true`

`failed`:

- 利用者フローに見える import branch residue が残らない
- branch 作成済みだった場合も cleanup 完了まで backend が責任を持つ
- `protected_refs_clean=true`

`retry_required`:

- protected ref は clean
- import branch 側に residue または queryability の曖昧さが残る
- 例:
  - branch は作れたが queryable 確認ができない
  - commit はあるかもしれないが readiness を確定できない
  - cleanup 失敗により stale import branch が残った

### Outcome rule shared by rows/table

- `completed` の必須 completion key は次に固定する
  - `destination_committed=true`
  - `destination_branch_ready=true`
  - `protected_refs_clean=true`
- `warnings` は apply endpoint で返さない
- `protected_refs_clean=false` を normal flow の許容状態にしない
  - もし発生したら contract violation であり、設計上は残してはならない

## Rollback / Repair / Retry Invariants

### Rollback invariants

- normal flow は `main` / `audit` を変更しない
- `failed` を返すときは follow-up 不要でなければならない
- rows で `failed` を返すなら destination `wi/*` HEAD は不変である
- table で `failed` を返すなら import branch は利用者フローから消えている

### Repair invariants

- `retry_required` で残る residue は destination lane に限定する
- rows の repair scope は destination `wi/*` のみ
- table の repair scope は import branch のみ
- protected ref repair を normal user flow に押し込まない
- stale import branch repair は admin lane が扱う

### Retry invariants

- retry は hidden protected cleanup を前提にしない
- rows retry は destination `wi/*` が queryable で、schema-compatible になった後にだけ許可する
- table retry は stale import branch の扱いが確定した後にだけ許可する
- retry guidance は branch/hash を特定できる形で返す

## Keep / Constrain / Move To Admin

### Keep

- `/cross-copy/preview`
- schema-compatible な `/cross-copy/rows`
- schema-compatible な `/cross-copy/table`
- source ref を `main|audit` の read-only source として使うこと

### Constrain

- normal flow apply は `expand_columns=[]` を必須にする
- rows の destination は既存 `wi/*` のみ
- table の destination は system-created import branch のみ
- apply endpoint は `ConnProtectedMaintenance` を使わない
- `completed` 判定は `hash` / `branch_name` 単独ではなく B1 completion keys で決める
- `retry_required` の residue は destination lane に閉じ込める

### Move to admin

- protected `main` への schema expansion
- stale import branch の repair/cleanup
- normal flow が扱えない protected maintenance

## Acceptance Criteria

- `/cross-copy/rows` と `/cross-copy/table` の normal flow 実装が `ConnProtectedMaintenance` を取得しない
- schema mismatch case は durable write 前に precondition failure で止まる
- `CrossCopyPreviewResponse.expand_columns` が admin prep 必要性の唯一の判定材料として使える
- `completed` は `destination_committed=true` / `destination_branch_ready=true` / `protected_refs_clean=true` を満たす
- `failed` は follow-up 不要である
  - rows: destination `wi/*` HEAD 不変
  - table: stale import branch が残らない
- `retry_required` は destination lane の不確実性だけを表す
  - protected ref residue を含まない
- cross-copy は approval footer / `merged/*` / audit truth を新設しない
- MergeLog / history の truth は cross-copy 導入前後で変わらない

## Implementation PR Split

### PR1: Contract and response plumbing

- この文書を基準に cross-copy outcome contract を固定する
- `backend/internal/model/api.go` に cross-copy 用 `OperationOutcome` 追加方針を反映する
- handler/frontend adapter が `outcome` を優先できる最小 plumbing を入れる

### PR2: Normal-flow safety cut

- `/cross-copy/rows` / `/cross-copy/table` から protected DDL 経路を除去する
- apply 前に schema compatibility を判定し、必要なら precondition failure に切る
- `completed` / `failed` / `retry_required` を destination lane 基準で返す
- invariant test を追加する
  - normal flow failure 後に `main` HEAD / schema が不変
  - schema mismatch では write が始まらない

### PR3: Import-lane cleanup and retry contract

- table cross-copy の import branch cleanup を hardened する
- stale import branch が残る場合の `retry_required` / repair guidance を固定する
- rows/table 共通の completion key を backend で埋める

### PR4: Admin lane

- protected schema expansion の admin path を追加する
- stale import branch repair/cleanup を admin path に集約する
- cross-copy 用 audit truth は作らず、maintenance commit は operational record に留める

## Decision Summary

- rows/table cross-copy 自体は normal flow に残してよい
- ただし normal flow は schema-compatible copy に限定する
- protected schema expansion は admin lane に移す
- `retry_required` は destination lane residue だけに使い、protected residue には使わない
- cross-copy は approval/audit truth を増やさない
