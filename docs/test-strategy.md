# Dolt Web UI Test Strategy

長寿命 Work Branch 方式への切り替え後の回帰を、4 層のテストで管理するための運用ドキュメントです。  
manual checklist を source-of-truth としつつ、fast suite と real Dolt suite を明確に分離します。

## 4 Layers

| Layer | 主目的 | 実行コマンド | Gate |
|---|---|---|---|
| `manual matrix` | 受け入れ判断、UI/運用確認、実機観察 | `docs/manual-test-checklist.md` | release 前 / 必要時 |
| `backend pure/unit` | pure function と軽量ロジックの高速回帰 | `cd backend && go test -race ./...` | PR 必須 |
| `mocked Playwright` | UI 契約、分岐、branch 引数伝搬の高速回帰 | `cd frontend && npm run test:e2e:mock` | PR 必須 |
| `real-Dolt integration / real Playwright` | 実Dolt上の branch lifecycle と end-to-end 回帰 | `cd backend && go test -tags=integration ./internal/service` / `cd frontend && npm run test:e2e:real:smoke` | PR smoke / nightly full |

## Real Test Harness

共通 fixture は [config.test.yaml](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/config.test.yaml) と [scripts/testenv/reset](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/reset) を基準にします。

| Asset | Role |
|---|---|
| [scripts/testenv/seed](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/seed) | `test_db` / `dest_db` と基本 branch を再作成 |
| [scripts/testenv/start](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/start) | `dolt sql-server` 起動 |
| [scripts/testenv/stop](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/stop) | server 停止 |
| [scripts/testenv/reset](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/reset) | `seed -> start` の共通入口 |
| [scripts/testenv/run-backend.sh](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/scripts/testenv/run-backend.sh) | real Playwright 用 backend wrapper |

## Gate Policy

| Gate | Included |
|---|---|
| `fast suite` | backend pure/unit + frontend unit + mocked Playwright |
| `real smoke` | branch lifecycle 中心の integration + real Playwright `@smoke-real` |
| `nightly full` | real Playwright full + quarantine を含む実Dolt回帰 |

`@quarantine` は既知不整合の期待仕様を固定するために使います。  
PR smoke では `--grep-invert @quarantine`、nightly full では含めて実行します。

## Implemented Branch Lifecycle Coverage

| Test ID | Layer | Manual Ref | Scope | Status |
|---|---|---|---|---|
| `BL-MOCK-01` | mocked Playwright | `MT-02-02` | 同名 work branch 入力時に create API を再送せず既存 branch を開く | implemented |
| `BL-MOCK-03` | mocked Playwright | `MT-02-02` | stale branch list でも `BRANCH_EXISTS` を拾って既存 branch を開く | implemented |
| `BL-MOCK-02` | mocked Playwright | `MT-06-09` | approve の `active_branch_advanced=false` で `main` fallback + warning 表示 | implemented |
| `BL-MOCK-04` | mocked Playwright | `MT-13-07` | CrossCopyTable の `BRANCH_EXISTS` で既存 import branch を開ける | implemented |
| `BL-INT-01` | backend integration | `MT-06-01` `MT-06-10` | submit -> reject -> resubmit -> approve と archive sequence `01/02` | implemented |
| `BL-INT-02` | backend integration | `MT-13-03` `MT-13-04` | request lock 中 delete 拒否 / reject 後 delete 成功 | implemented |
| `BL-INT-03` | backend integration | `MT-02-02` | duplicate create が `BRANCH_EXISTS` を返す | implemented |
| `BL-INT-04` | backend integration | `MT-13-07` | CrossCopyTable -> submit -> approve と既存 import branch 再利用 | implemented |
| `BL-REAL-01` | real Playwright smoke | `MT-02-02` | 実UIで branch 作成と同名再利用 | implemented |
| `BL-REAL-02` | real Playwright smoke | `MT-06-01` `MT-06-10` `MT-13-03` | 実UIで submit / delete lock / reject / resubmit / approve / branch advance | implemented |
| `BL-REAL-03` | real Playwright smoke | `MT-02-02` | duplicate create が `BRANCH_EXISTS` を返す | implemented |
| `BL-REAL-04` | real Playwright smoke | `MT-13-07` | cross-copy 生成 branch をそのまま submit でき、2 回目は `BRANCH_EXISTS` になる | implemented |

## Next Expansion Targets

| Area | Candidate Coverage |
|---|---|
| `History / Merge log` | `merged/<WorkItem>/<NN>` の検索、branch 名正規化、archive 連番表示 |
| `Branch-sensitive tools` | search / compare / memo / row history / cross-copy rows の real suite 化 |
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
