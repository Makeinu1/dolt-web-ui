# LLM 共同開発プラン

> このファイルは、複数の LLM が交互にトークンを消費しながら共同開発するための
> 引き継ぎドキュメントです。各 LLM はセッション開始時にこのファイルを読み、
> 現在の開発状況を把握してから作業を開始してください。

---

## 現在のプロジェクト状態

**最終更新**: 2026-03-12
**状態**: backend / frontend 契約更新はほぼ反映済み。公開 docs を現行 router / response shape に同期済み。
**ブランチ**: `master`（直接プッシュ運用）

> このファイルは引き継ぎメモです。API / behavior の source of truth は
> 実装コード + `docs/reviews/` + [api-reference.md](api-reference.md) とする。

---

## 現行プロダクト方針

プロダクト原則は [product-principles.md](product-principles.md) を正とします。

- `Core`: 業務ユーザが安全に main 反映まで進める主導線
- `Advanced`: cross-DB / CSV / bulk / deep history など、日常的にも使われる強力な機能
- `Admin / escape hatch`: recovery reload, merge abort, CLI runbook などの復旧導線

**原則（優先順位順）**:

1. 普通の業務ユーザが永続的に詰まらない
2. `main` / `audit` を常に信頼できる
3. 成功・失敗・要再試行が UI で明確に分かる
4. 強力な機能の到達性を落とさずに安全・完了・復旧を明確にする

---

## 現在のフェーズ: Contract Sync 後半

### 方針概要

Track A/B/AB/C の contract 実装を先行で揃え、public docs と handoff 文書を追随させる。
詳細設計は `docs/reviews/` を参照。

### 設計文書一覧

| 文書 | 内容 |
|------|------|
| [pre-refactor-package](reviews/pre-refactor-package-20260311.md) | 入口文書。判断3点を固定 |
| [master-review](reviews/master-review-20260311.md) | 全体レビュー findings（P0〜P2） |
| [backend-led-refactor-strategy](reviews/backend-led-refactor-strategy-20260311.md) | リファクタ方針 |
| [track-a-safety-boundary](reviews/track-a-safety-boundary-20260311.md) | Safety Boundary（branch/ref許可、ConnDB廃止） |
| [track-b-audit-completion-model](reviews/track-b-audit-completion-model-20260311.md) | Audit/Completion Model（footer truth、outcome契約） |
| [track-b1-outcome-contract](reviews/track-b1-outcome-contract-20260311.md) | OperationOutcome 契約（completed/failed/retry） |
| [track-b2-audit-truth](reviews/track-b2-audit-truth-20260311.md) | Footer schema、lifecycle truth、merged/*格下げ |
| [track-ab1-crosscopy-contract](reviews/track-ab1-crosscopy-contract-20260311.md) | Cross-copy 契約（Option B採用、admin lane分離） |
| [track-c-ui-contract-alignment](reviews/track-c-ui-contract-alignment-20260311.md) | UI Contract Alignment（contextEpoch、dead state削除） |
| [track-c1-ui-alignment-followup](reviews/track-c1-ui-alignment-followup-20260311.md) | UI Alignment 詳細（reset matrix、fail-loud、light-first） |
| [track-d-contract-tests](reviews/track-d-contract-tests-20260311.md) | Docs/Tests Contract（テスト戦略） |
| [track-d1-backend-tests](reviews/track-d1-backend-tests-20260311.md) | Backend テスト計画（PR分割、テストケースmatrix） |
| [track-d2-frontend-docs-contract](reviews/track-d2-frontend-docs-contract-20260311.md) | Frontend/Docs 契約（stale docs修正、E2E追加） |

### 実施順序

```
Track A: Safety Boundary → Track B: Audit/Completion → Track C: UI Alignment → Track D: Docs/Tests
```

Track D のテスト計画は各 Track に同梱済み。現在は docs 同期が中心。

---

## 実装状況

### Track 状態

| Track / PR | 状態 | メモ |
|------------|------|------|
| **Track A** | ✅ landed | safety boundary, allowed ref policy, read/write session split を維持 |
| **B-PR1** | ✅ landed | footer writer + approve outcome |
| **B-PR2** | ✅ landed | footer-first history read |
| **B-PR3** | ✅ landed | search fail-loud、degraded `req/*` JSON approve、read/write contract 揃え |
| **AB-PR2** | ✅ landed | cross-copy normal flow から protected maintenance / main-first schema expansion を除去 |
| **AB-PR3** | ✅ landed | cross-copy `failed` / `retry_required` 契約、cleanup 分類、protected clean invariant |
| **AB-PR4** | ✅ landed | cross-copy admin lane で schema prep / stale import cleanup を modal 内に追加 |
| **C-PR1** | ✅ landed | frontend types/client を `OperationResultFields` / `ReadResultFields` に揃えた |
| **D1** | ✅ landed | backend test matrix 整理済み |
| **D2-PR1** | ✅ landed | `docs/api-reference.md` / `README.md` / 本ファイルを現行実装に同期 |

### 現行の固定事項

- 承認の audit truth は main merge commit の approval footer。`merged/*` は secondary index。
- write 系 success truth は `outcome=completed`。`warnings` は advisory で success truth には使わない。
- read 系は partial を返さない。`history` / `search` は integrity 問題を fail-loud で返す。
- cross-copy source ref は `main` / `audit` のみ。schema widening が必要なら normal flow は `412 PRECONDITION_FAILED` で停止し、admin lane が destination `main` prep と stale import cleanup を担う。

### 残件

- **実運用 E2E 拡張**: `read_integrity` / `retry_required` 系の real Playwright coverage を増やす余地あり

---

## LLM コードレビュー 安定化対応（2026-03-12）

ChatGPT との相互レビュー後、以下の追加対応を実施。

| # | 対応 | 状態 |
|---|------|------|
| 1 | `backend/cmd/footer-scan` CLI 作成（main 全コミットスキャン、共有 parser 使用、不正 hash 一覧出力） | ✅ |
| 2 | `internal/footer` 共有 parser パッケージ作成（`ParseApprovalFooter` / `BuildApprovalFooter` をエクスポート、`service/approval_footer.go` は型エイリアスで委譲） | ✅ |
| 3 | `service/ref_policy_test.go` 新規作成（`ensureAllowedBranchRef` / `ensureAllowedWorkBranchWrite` / `ensureHistoryRef` 直接テスト、12ケース） | ✅ |
| 4 | `validation/validate_test.go` 拡張（`ValidateDBName` / `ValidateRevisionRef` / `ValidateBranchName` の SQL 特殊文字 reject テスト追加） | ✅ |
| 5 | `service/crosscopy_table.go` バグ修正（`parseCopyError` マッチパスで `cleanupIfNeeded()` が呼ばれていなかった — Data too long / FK violation の各経路でも cleanup を実行するよう修正） | ✅ |
| 6 | `service/crosscopy_outcome_test.go` 拡張（data-too-long / FK violation 各経路で cleanup 1回呼び出し確認 + cleanup failure → retry_required 確認、4ケース追加） | ✅ |
| 7 | `go test -race -cover ./internal/service ./internal/validation` PASS 確認 | ✅ |

### footer-scan 使用方法

```bash
go run ./cmd/footer-scan --config config.yaml --target default --db Test
# 0件なら OK（exit 0）、不正 footer があれば一覧出力して exit 1
```

### 直近の検証

- backend unit: `go test ./internal/service ./internal/validation ./internal/config`
- backend integration: `go test -tags=integration ./internal/service`
- frontend unit: `npm test`
- frontend build: `npm run build`
- frontend mock E2E: `CI=1 npx playwright test tests/e2e/branch-sensitive.spec.ts --reporter=line`
- frontend real E2E: `CI=1 npx playwright test --config=playwright.real.config.ts tests/e2e-real/branch-lifecycle.spec.ts --reporter=line`

---

## 将来的に対処すべき構造的問題（スコープ外・記録のみ）

2-5GB DB での調査で発見。優先度順に記録。

| # | 問題 | ファイル | 影響 |
|---|------|---------|------|
| D | DiffSummary: 全テーブル×DOLT_DIFF をN+1で逐次実行 | `diff.go:179-216` | 50テーブル×数秒=分単位 |
| E | Submit/Sync: previewMergeInfo + DOLT_MERGE で2回マージ評価 | `sync.go:52+65`, `request.go:75+84` | merge処理2倍 |
| F | Search: 全テーブル×全カラムのLIKE走査 | `search.go:49-115` | 分単位 |
| G | ExportDiffZip: 全diffをメモリにバッファ | `diff.go:313-423` | OOMリスク |
| H | ConnMaxIdleTime未設定 | `dolt.go:39` | MySQL側タイムアウトでstale接続 |

---

## 完了済み改修（概要）

全ての完了済み改修はコミット履歴を参照。主要マイルストーン:

| マイルストーン | 内容 |
|---|---|
| コアCRUD | 改修1-4、E2E改善統合 |
| 複合PK Phase 1-3 | PK配列化・WHERE複合化・コメントJSON化 |
| BUG-1〜18修正 | QA 5ラウンド完了 |
| Phase 4 | 複数行選択・一括操作 |
| クロスDB コピー | preview/rows/table + E2E 46チェック |
| CSV バルク更新 | 最大1000行 INSERT/UPDATE |
| 全テーブル検索 | LIKE走査 + メモ検索 |
| UX改善 5件（P1-P5） | リフレッシュ修正、ドラフトフィルタ、コピー統合、ソース固定、一括編集 |
| 同テーブルコピー（F1-F3） | PK一括置換、全件コピー、重複PKハイライト |
| フィードバック 7件（⑧-⑭） | 検索、ログ、同期廃止、型拡張、CSV、ブランチ修正 |
| **master review + 設計文書** | reviews/ に 13 文書完成 |

---

## 安全プロパティ確認状況

| # | プロパティ | 状態 | 根拠 |
|---|----------|------|------|
| P1 | Lost Write Prevention | ✅ | expected_head + ConnWrite |
| P2 | ドラフト永続性 | ⚠️ | sessionStorage（揮発性）。exportDraftSQL で緩和。将来課題。 |
| P3 | main/audit 書き込み保護 | ✅ | handler `mainGuard` + service `IsProtectedBranch` 二重ガード |
| P4 | 承認なしマージ防止 | ✅ | main への唯一経路は ApproveRequest |
| P5 | 作者追跡 | ✅ | Dolt commit metadata |
| P6 | 選択的マージ | ✅ | PJ ブランチにはPJ編集のみ入る運用前提 |
| P7 | 100万行対応 | ✅ | サーバーサイドページネーション + ストリーミング |
| P8 | ブランチロック | ✅ | req/タグ存在時に direct write lane を拒否。現行 public API では少なくとも commit は HTTP 423 |
| — | 複合PK安全性 | ✅ | 3ラウンド静的証明済み |
| — | QA状況 | ✅ | 全5ラウンド完了。全18バグ修正済み。[QA_REPORT.md](QA_REPORT.md) 参照 |

---

## リファクタリングで修正予定の findings（reviews/master-review より）

| 優先度 | 問題 | 対応Track |
|--------|------|-----------|
| P0 | cross-copy が `main` を直接変更し、失敗時に戻らない | Track A + AB |
| P1 | Approve partial success を success 扱い | Track B |
| P1 | Schema conflict / constraint violation の escape hatch が dead | Track C |
| P2 | Submit/Approve の critical path で heavy diff summary | Track C |
| P2 | CSV preview が失敗を隠して「全部 insert」と見せる | Track B |
| P2 | 承認待ちバッジが silent failure で stale | Track C |

---

## LLM 間引き継ぎルール

1. **セッション開始時**: このファイルを読む
2. **作業開始前**: `git log --oneline -5` と `git diff --stat` で現状確認
3. **設計文書確認**: 作業対象の Track 文書を `docs/reviews/` から読む
4. **変更されたファイルがある場合**: 差分を確認し、前の LLM の作業を評価してから続行
5. **作業完了時**: このファイルの進捗を更新
6. **ビルド**: フロントエンド + バックエンド両方のビルド成功を確認してからコミット
7. **コミット**: PR 単位でコミット（Track A/B/C/D を混ぜない）
