# Track B2: Audit Truth / History Model

Date: 2026-03-11

## Goal

`dolt-web-ui` の pre-refactor package 前提で、Track B の未確定部分を固定する。

- main merge commit footer schema
- MergeLog / history の primary source of truth
- `merged/*` を secondary index に落とす移行方針
- `req/*` / approved / rejected の lifecycle truth
- footer parse failure の扱い

この文書でいう audit truth は `audit` branch のことではなく、approve 済み変更の durable record を何に置くか、という意味で使う。

## Why This Addendum Exists

既存 Track B 文書は方向性を固定しているが、現実装はまだ次に依存している。

- approve 成功後の audit truth が `merged/*` tag に寄っている
- `history/commits` と MergeLog が `merged/*` を primary source として読む
- approve は archive tag / request cleanup / branch advance の失敗を warning 付き success に混ぜる
- `req/*` の message JSON が lifecycle truth と metadata の境界を曖昧にしている

この文書は、その曖昧さをなくすための Track B2 決定文書である。

## Current Evidence

- approve は `main` merge 後に `merged/*` 作成、`req/*` 削除、work branch 前進を best-effort で行い、失敗を `warnings` に混ぜて success を返す
  - `backend/internal/service/request.go`
- history は `dolt_tags WHERE tag_name LIKE 'merged/%'` を primary read にしている
  - `backend/internal/service/diff_history.go`
- work item identity helper は `req/*` と `merged/*` naming を中心に組まれている
  - `backend/internal/service/workitem.go`
- MergeLog UI は `history/commits` が返す `HistoryCommit.merge_branch` を primary display にしている
  - `frontend/src/components/MergeLog/MergeLog.tsx`
- 公開 docs も approve history を `merged/*` 中心に説明している
  - `docs/api-reference.md`
  - `README.md`

## Locked Decisions

### 1. Canonical Approval Record

approved の primary audit truth は `main` 上の dedicated approval commit とする。

- approve は `main` に機械可読 footer を持つ専用 commit を必ず残す
- fast-forward only で専用 commit を残せない approve は canonical ではない
- 実装は `--no-ff` 相当、または同等の方法で `main` 側に distinct approval commit を作る
- `completed` は audit truth より厳しい
- approve operation が `completed` になる条件は `approval footer recorded + request cleared + resume branch ready`

### 2. Footer Schema Draft

footer は human-readable subject/body の末尾 trailer block とする。

例:

```text
承認マージ: ProjectA

Dolt-Approval-Schema: v1
Request-Id: req/ProjectA
Work-Item: ProjectA
Work-Branch: wi/ProjectA
Submitted-Work-Hash: 0123456789abcdefghijklmnopqrstuv
Submitted-Main-Hash: fedcba9876543210abcdefghijklmnop
Request-Submitted-At: 2026-03-11T09:15:00Z
```

required:

- `Dolt-Approval-Schema`
  - 固定値 `v1`
- `Request-Id`
  - `req/<WorkItem>`
- `Work-Item`
  - `<WorkItem>`
- `Work-Branch`
  - `wi/<WorkItem>`
- `Submitted-Work-Hash`
  - submit 時点の work HEAD

optional:

- `Submitted-Main-Hash`
  - submit 時点の main HEAD
- `Request-Submitted-At`
  - RFC3339 UTC

parse rules:

- parser は key を ASCII case-insensitive で正規化してよい
- required field 欠損は parse failure
- `Request-Id` / `Work-Item` / `Work-Branch` は相互整合していなければ parse failure
- hash field は Dolt commit hash 形式でなければ parse failure
- unknown field は forward compatibility のため無視してよい
- UI 表示用メッセージ本文は footer parse に使わない

補足:

- `summary_ja` は footer required field にしない
- `req/*` message JSON が壊れていても、canonical footer を組み立てられるよう required field は最小化する

### 3. Lifecycle Truth

request lifecycle の unit は `request instance` とし、最小識別子は次とする。

- `request_id`
- `submitted_work_hash`

state truth は次に固定する。

| State | Truth | Notes |
|------|-------|-------|
| pending | `req/<WorkItem>` tag の存在 + tag target hash | tag message JSON は metadata であり truth ではない |
| approved (audit) | `main` approval commit footer | `merged/*` は source of truth ではない |
| approved (operation completed) | audit truth + request cleared + resume branch ready | merge 済みでも cleanup 未完了なら `completed` ではない |
| rejected | pending request instance の `req/*` 削除成功 | durable audit event にはしない |

追加原則:

- approved の durable record は `main` footer であり request tag deletion ではない
- rejected は lock 解消の operational truth であり approved history には載せない
- `req/*` message JSON は summary / submitted_at / submitted_main_hash の carrier だが、pending existence の truth ではない

### 4. MergeLog / History Primary Source Of Truth

MergeLog / `history/commits` の primary source of truth は `main` commit history 上の approval footer とする。

read model:

1. `main` の commit history を新しい順に読む
2. valid approval footer を持つ commit だけを approval history とみなす
3. `hash` は approval commit hash
4. `message` は commit message の human-readable 部分
5. `timestamp` は commit timestamp
6. `merge_branch` は footer の `Work-Branch`

record-level filter:

- approval candidate commit hash の集合を作った後に、既存の `dolt_history_*` filter を適用してよい
- row history 自体の truth は引き続き `dolt_history_*` にある

branch search:

- post-cutover record は footer の `Work-Item` / `Work-Branch` で検索する
- `merged/*` tag name prefix を primary search に使わない

ordering:

- primary ordering は `main` commit history の時系列 / topology
- `merged/*` の `NN` sequence は ordering truth ではない

### 5. Read Priority

pending request read:

1. `req/*` tag existence
2. tag target hash
3. tag message metadata

approved history read:

1. `main` approval footer
2. legacy adapter from `merged/*` for pre-cutover approvals only
3. no footer / no legacy mapping の commit は approval history に含めない

operational completion read:

1. approval footer exists
2. request tag deleted
3. work branch advanced and queryable

原則:

- `merged/*` は footer を override しない
- `req/*` は approved history の truth に昇格しない
- footer と `merged/*` が矛盾したら footer を正とし、index corruption とみなす

### 6. `merged/*` As Secondary Index

`merged/*` は secondary index に格下げする。

役割:

- legacy approval record の adapter source
- branch / work item 単位の補助検索
- optional cache / rebuild target

非役割:

- approved の canonical truth
- MergeLog / history の primary enumeration source
- approve completion の必須条件

post-cutover の扱い:

- approve は footer を primary write とする
- `merged/*` は dual-write を当面継続してよい
- `merged/*` 作成失敗は `audit_recorded=false` ではなく `secondary_index_missing=true` の問題
- `merged/*` 単独失敗は approve を audit failure にしない
- footer mismatch や missing index は repair 対象にする

### 7. Footer Parse Failure

silent skip は禁止する。

分類:

1. footer absent
   - 通常 commit
   - pre-cutover legacy approval なら `merged/*` adapter で読んでよい
2. footer present but invalid
   - data corruption
   - history read は silent skip しない
3. footer valid but `merged/*` mismatch
   - index corruption
   - footer を正とし、index repair 対象にする

API policy:

- approval record と判定された commit の footer parse が失敗したら、history は integrity error を返す
- best-effort list で当該 record を落として続行しない
- `merged/*` への fallback で parse failure を隠さない

write policy:

- approve 実行前に footer payload を構成・検証する
- merge 後に footer round-trip verification に失敗したら `completed` にはしない
- post-cutover approve で footer を書けないなら `retry_required` または `failed`

### 8. `req/*` Metadata Failure

`req/*` tag message JSON の parse failure は footer parse failure と同列に扱わない。

理由:

- pending truth は tag existence と target hash で決まる
- `work_branch` は `request_id` から再構成できる
- `submitted_work_hash` は tag target hash から取れる

したがって:

- `ListRequests` / `GetRequest` は degraded metadata を返してよい
- `Reject` は tag delete だけで成立する
- `Approve` は request message JSON が壊れていても、footer required field を満たせる限り続行可能とする
- `Submitted-Main-Hash` や `Request-Submitted-At` が取れない場合は footer optional field を省略してよい

### 9. Migration Phases

1. Contract Lock

- この文書を Track B2 の truth として固定する
- docs / tests に `merged/* primary` 前提を増やさない

2. Footer Writer + Verifier

- approve が dedicated approval commit footer を必ず残す
- approve 直後に footer を parse して round-trip verification する
- `merged/*` dual-write は維持する
- 既存 response field は残す

3. Footer-First Read

- MergeLog / `history/commits` は `main` footer を primary read に切り替える
- `merged/*` は pre-cutover approval に限って legacy adapter に使う
- cutover boundary は deploy 時点で固定し、boundary 以後の approval に legacy fallback を使わない

4. Secondary Index Downgrade

- `merged/*` 作成失敗を approve completion 条件から外す
- footer から `merged/*` を再生成する repair path を用意する
- post-cutover の検索・一覧・比較は footer primary で成立させる

5. Legacy Freeze

- pre-cutover legacy record は adapter で読み続ける
- 既存 `main` history rewrite はしない
- docs / API reference / README から `merged/* = source of truth` 記述を除去する

### 10. Legacy Compatibility

- 既存 main history は rewrite しない
- pre-cutover approval は `merged/*` adapter で読み続ける
- public `HistoryCommit` shape は当面維持してよい
- `merge_branch` は footer 由来へ切り替えるが field 名は維持してよい
- `archive_tag` / `warnings` / `active_branch` / `active_branch_advanced` は Track C cutover まで adapter field として残してよい
- ただし UI の完了判定は将来的に `outcome` / `completion` を優先し、warning success を残さない

## Acceptance Criteria

- post-cutover approval は `main` footer だけで history を復元できる
- `merged/*` 欠損だけでは audit truth が壊れない
- `req/*` JSON 破損は pending truth そのものを壊さない
- footer parse failure は silent skip されない
- MergeLog / history は `merged/*` ではなく `main` footer を primary read にする
