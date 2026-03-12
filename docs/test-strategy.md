# Dolt Web UI Test Strategy

長寿命 Work Branch 方式への切り替え後の回帰を、4 層のテストで管理するための運用ドキュメントです。  
manual checklist を source-of-truth としつつ、fast suite と real Dolt suite を明確に分離します。

プロダクト原則は [docs/product-principles.md](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/docs/product-principles.md) を参照してください。  
このテスト戦略では、`Core` を壊さないこと、日常的に使う強力な機能の到達性を落とさないこと、`Recovery` が normal user に届くことを優先します。

## 4 Layers

| Layer | 主目的 | 実行コマンド | Gate |
|---|---|---|---|
| `manual matrix` | 受け入れ判断、UI/運用確認、実機観察 | `docs/manual-test-checklist.md` | release 前 / 必要時 |
| `backend pure/unit` | pure function と軽量ロジックの高速回帰 | `cd backend && go test -race ./...` | PR 必須 |
| `mocked Playwright` | UI 契約、分岐、branch 引数伝搬、unexpected client error の高速回帰 | `cd frontend && npm run test:e2e:mock` | PR 必須 |
| `real-Dolt integration / real Playwright` | 実Dolt上の branch lifecycle、unexpected backend/client error、end-to-end 回帰 | `cd backend && go test -tags=integration ./internal/service` / `cd frontend && npm run test:e2e:real:smoke` | PR smoke / nightly full |

## Real Test Harness

共通 fixture は [config.test.yaml](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/config.test.yaml) と [scripts/testenv/reset](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/reset) を基準にします。

| Asset | Role |
|---|---|
| [scripts/testenv/seed](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/seed) | `test_db` / `dest_db` と基本 branch を再作成 |
| [scripts/testenv/start](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/start) | `dolt sql-server` 起動 |
| [scripts/testenv/stop](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/stop) | server 停止 |
| [scripts/testenv/reset](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/reset) | `seed -> start` の共通入口 |
| [scripts/testenv/run-backend.sh](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/run-backend.sh) | real Playwright 用 backend wrapper。stdout/stderr を成果物へ tee 可能 |

## Observability Policy

- mocked / real Playwright は `pageerror`、`console.error`、unexpected API `5xx`、`requestfailed` を収集し、未許可なら test を fail にする
- 意図した失敗系シナリオは spec 側で allowlist する。暗黙許可は作らない
- real Playwright は backend log tail も成果物へ添付し、UI 上は成功でも裏で `branch not found` や internal error が出ていれば追える状態にする
- browser reload に伴う GET の `ERR_ABORTED` だけは navigation noise として除外し、POST abort は引き続き fail 対象にする

## Gate Policy

| Gate | Included |
|---|---|
| `fast suite` | backend pure/unit + frontend unit + mocked Playwright |
| `real smoke` | branch lifecycle 中心の integration + real Playwright `@smoke-real` |
| `nightly full` | real Playwright full + quarantine を含む実Dolt回帰 |

`@quarantine` は既知不整合の期待仕様を固定するために使います。  
PR smoke では `--grep-invert @quarantine`、nightly full では含めて実行します。

## Product-Led Acceptance Lens

| Lens | 受け入れ条件 |
|---|---|
| `Core smoke` | 業務ユーザが `create/edit/commit/submit/approve/reject/reopen/recover` だけで main 反映まで完結できる |
| `Advanced regression` | cross-DB / CSV / bulk / deep history が直接使えて、かつ安全制約と完了表示が壊れない |
| `Recovery regression` | `branch not ready` / `stale head` / `lock` / `recovery reload` で復旧不能にならない |
| `Heavy-screen safety` | 一覧画面が巨大DBで勝手に重い diff を走らせない |

## Implemented Branch Lifecycle Coverage

| Test ID | Layer | Manual Ref | Scope | Status |
|---|---|---|---|---|
| `BL-MOCK-01` | mocked Playwright | `MT-02-02` | 同名 work branch 入力時に create API を再送せず既存 branch を開く | implemented |
| `BL-MOCK-03` | mocked Playwright | `MT-02-02` | stale branch list でも `BRANCH_EXISTS` を拾って既存 branch を開く | implemented |
| `BL-MOCK-02` | mocked Playwright | `MT-06-09` | approve の `active_branch_advanced=false` で `main` fallback + warning 表示 | implemented |
| `BL-MOCK-04` | mocked Playwright | `MT-13-07` | CrossCopyTable の `BRANCH_EXISTS` で既存 import branch を開ける | implemented |
| `BL-MOCK-05` | mocked Playwright | `MT-13-08` `MT-13-09` | cross-copy は protected branch でのみ表示され、modal は current protected branch を source に固定する | implemented |
| `BL-INT-01` | backend integration | `MT-06-01` `MT-06-10` | submit -> reject -> resubmit -> approve と archive sequence `01/02` | implemented |
| `BL-INT-02` | backend integration | `MT-13-03` `MT-13-04` | request lock 中 delete 拒否 / reject 後 delete 成功 | implemented |
| `BL-INT-03` | backend integration | `MT-02-02` | duplicate create が `BRANCH_EXISTS` を返す | implemented |
| `BL-INT-04` | backend integration | `MT-13-07` | CrossCopyTable -> submit -> approve と既存 import branch 再利用 | implemented |
| `BL-INT-05` | backend integration | `MT-13-10` | `source_branch=audit` は成功し、`source_branch=wi/...` は `INVALID_ARGUMENT` で拒否される | implemented |
| `BL-INT-06` | backend integration | `MT-02-03` | `GetBranchReady` が existing branch で ready を返し、missing branch を `NOT_FOUND` で返す | implemented |
| `BL-REAL-01` | real Playwright smoke | `MT-02-02` | 実UIで branch 作成と同名再利用 | implemented |
| `BL-REAL-02` | real Playwright smoke | `MT-06-01` `MT-06-10` `MT-13-03` | 実UIで submit / delete lock / reject / resubmit / approve / branch advance | implemented |
| `BL-REAL-03` | real Playwright smoke | `MT-02-02` | duplicate create が `BRANCH_EXISTS` を返す | implemented |
| `BL-REAL-04` | real Playwright smoke | `MT-13-07` | cross-copy 生成 branch をそのまま submit でき、2 回目は `BRANCH_EXISTS` になる | implemented |
| `BL-REAL-05` | real Playwright smoke | `MT-13-08` `MT-13-09` `MT-13-10` | protected branch だけで cross-copy を見せ、`audit -> wi/*` の row copy を current branch source で完了できる | implemented |
| `ER-UNIT-01` | frontend unit | `MT-13-12` | recovery reload flag が one-shot cleanup を行い、通常 reload では draft を保持する | implemented |
| `ER-MOCK-01` | mocked Playwright | `MT-13-11` `MT-13-12` | `復旧付き再読み込み` は error 時だけ表示され、`STALE_HEAD` で secondary action として見える | implemented |

## Next Expansion Targets

| Area | Candidate Coverage |
|---|---|
| `History / Merge log` | `merged/<WorkItem>/<NN>` の検索、branch 名正規化、archive 連番表示 |
| `Branch-sensitive tools` | search / compare / memo / row history の real suite 化 |
| `Partial failures` | archive tag failure / request tag cleanup failure / branch advance failure の injected test |
| `Manual matrix parity` | branch lifecycle 以外の checklist 項目に `Automated By` を段階的に付与 |

## Commands

```bash
# Fast suite
cd backend && go test -race ./...
cd frontend && npm run test && npm run test:e2e:mock

# Real Dolt harness
./scripts/testenv/reset

# Real integration / smoke
cd backend && go test -tags=integration ./internal/service
cd frontend && npm run test:e2e:real:smoke

# Real full regression
cd frontend && npm run test:e2e:real:full
```
