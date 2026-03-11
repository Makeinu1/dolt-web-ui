# LLM 共同開発プラン

> このファイルは、複数の LLM が交互にトークンを消費しながら共同開発するための
> 引き継ぎドキュメントです。各 LLM はセッション開始時にこのファイルを読み、
> 現在の開発状況を把握してから作業を開始してください。

---

## 現在のプロジェクト状態

**最終更新**: 2026-03-11
**最終コミット**: `eee90ec` Refine diff summaries and restore direct actions
**ブランチ**: `master`（直接プッシュ運用）

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

## 現在のフェーズ: Backend 主導リファクタリング

### 方針概要

UI flow 固定 + backend truth rebuild + minimal UI alignment。
詳細は `docs/reviews/` を参照。

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

ただし Track D のテスト計画は各 Track の PR に同梱する。

---

## 実装キュー

### D1 テスト計画に基づく PR 分割と進捗

| PR | 内容 | 状態 |
|----|------|------|
| **A-PR1** | Repository session boundary（ConnDB read path 除去） | 📋 未着手 |
| **A-PR2** | AllowedRefPolicy / FeatureRefPolicy | 📋 未着手 |
| **B-PR1** | Footer writer + approve outcome | 📋 未着手 |
| **B-PR2** | Footer-first history read ← **次のタスク** | 🔜 次 |
| **AB-PR2** | Normal-flow safety cut（cross-copy） | 📋 未着手 |
| **AB-PR3** | Import-lane cleanup and retry contract | 📋 未着手 |
| **AB-PR4** | Admin lane（placeholder） | 📋 未着手 |

> **現在地**: D1 の設計文書は完了。B-PR2 のテスト（footer-first history）の実装が次。

### B-PR2 で実装するテスト

| テストケース | レイヤ | 固定する invariant |
|---|---|---|
| ApproveRequest_SecondaryIndexFailure_DoesNotEraseAuditTruth | service | `merged/*` 作成失敗だけでは audit truth は壊れない |
| HistoryCommits_FooterFirst_ReadsPostCutoverWithoutMergedTag | integration | post-cutover approval は `merged/*` 欠損でも footer だけで history 復元可能 |
| HistoryCommits_InvalidFooter_ReturnsIntegrityError | service | footer present but invalid は silent skip しない |
| HistoryCommits_FooterMergedMismatch_PrefersFooter | service | footer と `merged/*` が矛盾したら footer を正 |
| HistoryCommits_LegacyMergedAdapter_OnlyPreCutover | service | footer absent record への `merged/*` fallback は pre-cutover legacy に限る |

### B-PR2 の前提テスト（B-PR1 で先に必要）

B-PR1 はまだ未実装。B-PR2 は以下の B-PR1 成果物を前提とする:

- **Footer parser/writer**（unit: ApprovalFooter_RoundTrip_Valid 等）
- **Approve outcome 契約**（service: ApproveRequest_CompletedRequiresFooter 等）
- **Search fail-loud**（service: Search_PartialTableFailure_FailsLoud 等）

**判断**: B-PR1 → B-PR2 の順番で進める。B-PR2 のテスト設計は完了済みだが、実装は B-PR1 の footer 基盤が必要。

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
| P8 | ブランチロック | ✅ | req/タグ存在時に commit/revert/sync を HTTP 423 で拒否 |
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
