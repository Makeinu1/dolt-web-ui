# LLM 共同開発プラン

> このファイルは、複数の LLM が交互にトークンを消費しながら共同開発するための
> 引き継ぎドキュメントです。各 LLM はセッション開始時にこのファイルを読み、
> 現在の開発状況を把握してから作業を開始してください。

---

## 現在のプロジェクト状態

**最終更新**: 2026-03-09
**最終コミット**: feat: ユーザ不満5件対応 UX改善（リフレッシュ修正/ドラフトフィルタ/コピーボタン統合/ソースブランチ選択/一括編集拡張）
**ブランチ**: `master`（直接プッシュ運用）

---

## 実装キュー（優先順位順）

### 次のタスク: なし

2026-03-09 のユーザ不満5件対応完了。次に対処すべき構造的問題は以下に記録（スコープ外）。

---

## 完了済み改修

| 改修 | 内容 | コミット |
|------|------|---------|
| 改修1+2 | IsProtectedBranch(audit追加) + BranchLock(reqタグ) | `d3dbd28` |
| 改修3 | コミットメッセージ構造化（[自動保存]廃止、ブランチ名+内訳フォーマット、UI日本語化） | `853f8e6` |
| 改修4 | Activity Log（変更ログ検索）— keyword/期間フィルタ + ActivityLog モーダル | `d6eacef` |
| E2E改善統合 | Revert/BranchLock/ConnPool/行Undo/ModalManager | `d3dbd28` |
| F8 コメント機能 | セル単位コメント（作業ノート） | `4b7ceeb` |
| **複合PK Phase 1** | コアCRUD複合PK対応 — pkCols配列化・WHERE複合化・PK_COLLISION検出・PK列編集解放 | `4215ab0` |
| **複合PK Phase 2** | clone/batch: vary_column方式 + bulk_update TSV N列PK対応 | `d9a49ff` |
| **複合PK Phase 3** | コメント pk_value JSON化（onCellClicked → rowPkId 送信） | `3d86ae0` |
| **BUG-1修正** | rowPkId アルファベット順ソート正規化（コメントセルキー不一致修正） | `cb67014` |
| **BUG-2修正** | cascade-delete に旧コメント(単純文字列PK)対応 + normalizePkJSON追加 | `cb67014` |
| **E2Eテスト追加** | composite-pk.spec.ts — 複合PKのCRUD・PK_COLLISION・後方互換（GAP-1/2/3カバー） | `cb67014` |
| **BUG-3/4修正** | PK_COLLISION定数追加 + mainGuard audit保護統一 | `787a9db` |
| **BUG-5/7/9修正** | conflict.go/sync.go SQL injection防止 (validateRef追加) | `787a9db` |
| **BUG-10/11修正** | TS PreviewCloneRequest vary_column/new_values追加 + constraint_violations optional化 | `dd7e69f` |
| **BUG-12修正** | preview.go PreviewBulkUpdate — pkMap JSON正規化(複合PK重複検出安定化) | `cbf139c` |
| **BUG-13修正** | comment.go AddComment/DeleteComment を ConnWrite (書き込みセッション) に変更 | `cbf139c` |
| **BUG-14修正** | BatchGenerateModal — pkCols.filter で全PK列取得・template_pk全列送信 | `cbf139c` |
| **BUG-15修正** | request.go SubmitRequest — DOLT_MERGE/TAG実行を Conn から ConnWrite に変更し安全な書き込みセッション確保 | `1754c03` |
| **BUG-16修正** | conflict.go ResolveConflicts — checkBranchLocked 追加（P8違反修正） | `dcb4230` |
| **BUG-17修正** | api/client.ts exportDiffZip — throw error → throw new ApiError(res.status, error) | `dcb4230` |
| **BUG-18修正** | request.go ApproveRequest — ConnDB → ConnWrite パターン統一 | `dcb4230` |
| **TS型修正** | CLIRunbook.tsx / ConflictView.tsx — constraint_violations optional対応（?? 0） | `dcb4230` |
| **Phase 4** | 複数行選択 — チェックボックス選択 + 一括コピー/削除 (handleCloneRows / handleDeleteRows) | `002ca16` |
| **変更1** | PK保持コピー — 行クローン時にPK自動採番を廃止し元行のPKをそのまま保持 | 本コミット |
| **変更2** | エラー表示改善 — 「日本語説明: 英語エラー詳細」併記 + ApiErrorエンベロープ展開修正 | 本コミット |
| **変更3** | Dolt_Description列固定 — AG Grid `pinned: 'left'` で左端固定 + 先頭ソート | 本コミット |
| **変更4** | ブランチ種別 — main/audit保護統一(isProtected) + audit→main同期エンドポイント + メモテーブル保護 + ContextSelectorアイコン | `7b280c7` |
| **クロスDB コピー** | `POST /cross-copy/preview` + `/rows` + `/table` — DB間レコード/テーブルコピー + CrossCopyModal(React) | `d9faf91` |
| **クロスDB バグ修正** | BUG-1〜7 + ConnWrite常時DOLT_CHECKOUT + DOLT_ADD新テーブル対応 | `d9faf91` |
| **クロスDB E2Eテスト** | `/tmp/dolt-e2e-crosscopy.sh` — 46チェック (P1〜P11 全安全プロパティ証明) | `d9faf91` |
| **⑭ ブランチ作成バグ修正** | `verifyBranchQueryable()` 共通化 + ApproveRequest/CrossCopyTable に検証ループ追加 | `f5fa279` |
| **本番障害修正 Fix A** | ApproveRequest: verifyBranchQueryable 失敗時のブランチ削除を廃止 → 常に NextBranch 返却 | 本コミット |
| **本番障害修正 Fix B** | verifyBranchQueryable: リトライ 3回×200ms → 5回×500ms (2-5GB DB 対応) | 本コミット |
| **本番障害修正 Fix C** | HTTP WriteTimeout: 60s → 300s (大規模 DOLT_MERGE タイムアウト対応) | 本コミット |
| **⑨ マージログ検索** | MergeLog.tsx にキーワード入力フィールド追加（バックエンド変更なし） | 本コミット |
| **⑪ エラー永続化修正** | 8秒自動消去タイマー + useHeadSync エラー上書き抑制（hasError ガード） | 本コミット |
| **⑬ 手動同期廃止・申請統合** | SubmitRequest にコンフリクト自動解決を統合、/sync ルート削除、上書き通知追加 | 本コミット |
| **⑩ 文字型カラム自動拡張** | CrossCopyPreview/Rows/Table で VARCHAR/TEXT 幅不足時に ALTER TABLE MODIFY COLUMN を自動実行 | 本コミット |
| **⑫ CSVバルク更新** | `POST /csv/preview` + `/csv/apply` + CSVImportModal（最大1000行、INSERT/UPDATE/skip） | 本コミット |
| **⑧ 全テーブル横断検索** | `GET /search` — 全テーブル + メモ検索（LIKE クエリ）+ SearchModal | 本コミット |
| **F1 PK 一括置換** | `BulkPKReplaceModal` + `draft.ts:bulkReplacePKInDraft` — 選択 INSERT 行の PK を一括検索/置換（プレビュー付き） | `bfb387e` |
| **F2 フィルタ全件コピー** | `table.go` pageSize 上限 1000 + `all=true` 対応 / ツールバー「全件コピー」ボタン（フィルタ有効時） | `bfb387e` |
| **F3 重複 PK ハイライト** | INSERT 行の PK が既存 DB 行と衝突する場合に橙ハイライト + CommitDialog に警告バナー | `bfb387e` |
| **P1 コミット後リフレッシュ修正** | `refreshKey` 専用 useEffect 追加 — schemaTable ガードをスキップして無条件リロード | 本コミット |
| **P2 ドラフト行フィルタ** | 「📝 ドラフトのみ」トグルボタン + `displayRows` useMemo — INSERT/UPDATE/DELETE 行のみ表示 | 本コミット |
| **P3 コピーボタン統合** | 選択行あり→「コピー (N)」、選択なし+フィルタ→「全件コピー (N)」、両方なし→非表示 | 本コミット |
| **P4 クロスDB 取り込み保護** | CrossCopyRowsModal/CrossCopyTableModal の source selector を廃止し、protected branch (`main` / `audit`) 上の現在 branch をコピー元に固定。work branch では入口自体を出さない | 本コミット |
| **P5 一括編集拡張** | `BulkEditModal` — 全カラム対象 +「すべて置換」/「空欄のみ埋める」モード + 全選択行（INSERT/UPDATE/既存行）対応 | 本コミット |

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

## ユーザ不満5件対応 UX改善 実装詳細（2026-03-09）

### P1: コミット後グリッドリロード修正

`TableGrid.tsx` の `loadRows` useCallback が `schemaTable !== tableName` ガードで `refreshKey` 変更後のリロードをスキップする競合を修正。`refreshKey` 専用の useEffect を追加（eslint-disable コメント付き）。

### P2: ドラフト行フィルタ

| ファイル | 変更内容 |
|---|---|
| `frontend/src/components/TableGrid/TableGrid.tsx` | `showDraftOnly` state + `displayRows` useMemo（`draftIndex.has` または `_draftId != null` でフィルタ）+ ツールバー「📝 ドラフトのみ」トグルボタン |

AG Grid の `rowData` prop を `displayRows` に変更。テーブル切替時に `setShowDraftOnly(false)` でリセット。

### P3: コピーボタン統合

選択行あり → 「コピー (N)」（selectedRows ブロック内）、選択なし + フィルタあり → 「全件コピー (N)」（外側）の2ボタン体制に整理。見た目は1ボタンずつ条件表示。

### P4: クロスDB ソースブランチ選択

| ファイル | 変更内容 |
|---|---|
| `frontend/src/components/CrossCopyModal/CrossCopyRowsModal.tsx` | `sourceBranch` state（デフォルト `"main"`）+ `sourceBranches` ロード + UI ドロップダウン + API 呼び出し変更 |
| `frontend/src/components/CrossCopyModal/CrossCopyTableModal.tsx` | 同上。`branchName` 参照を削除し `sourceBranch` に統一 |

ソートは保護ブランチ（main/audit）を上位に表示。

### P5: 一括編集拡張（BulkEditModal）

| ファイル | 変更内容 |
|---|---|
| `frontend/src/components/BulkPKReplaceModal/BulkEditModal.tsx` | **新規**: 全カラム対象 + モード選択（すべて置換/空欄のみ埋める）+ プレビュー付き |
| `frontend/src/store/draft.ts` | `bulkReplacePKInDraft` 削除（`addOp` 直接呼び出しに置換） |
| `frontend/src/store/draft.test.ts` | `bulkReplacePKInDraft` テスト削除（13テスト → 11テスト） |
| `frontend/src/components/TableGrid/TableGrid.tsx` | `handleBulkEdit` 追加（`addOp` で UPDATE op、INSERT rows は自動吸収）+ rowData 即時更新 + ボタン条件を `selectedRows.length > 0` に緩和 |

**重要設計**:
- INSERT 行への update は `draft.ts:addOp` の INSERT 吸収ロジック（`insertIdx` 探索）で自動マージ
- `"fill-empty"` モード: 空文字・`"null"`・`"NULL"` のセルのみ書き込み
- Undo ボタン表記: 「⟲ 元に戻す」 → 「⟲ Undo」

## 同テーブルコピーフロー UX改善 実装詳細（2026-03-07）

### F1: PK 一括置換モーダル（廃止 → BulkEditModal に統合済み）

旧 `BulkPKReplaceModal` の機能は P5 `BulkEditModal` に包含。`draft.ts:bulkReplacePKInDraft` は削除済み。

### F2: フィルタ全件コピー

| ファイル | 変更内容 |
|---|---|
| `backend/internal/handler/table.go` | `pageSize` 上限 500 → 1000 / `all=true` で `page=1, pageSize=1000` にオーバーライド |
| `frontend/src/api/client.ts` | `getTableRows()` に `all = false` オプション追加 |
| `frontend/src/components/TableGrid/TableGrid.tsx` | `handleCloneAllFiltered` + ツールバー「全件コピー (N)」ボタン（`serverFilter !== ""` 時のみ表示） |

**仕様**: `totalCount > 1000` 時は「最大 1,000 件のみコピー」旨の確認ダイアログ

### F3: 重複 PK リアルタイム警告

| ファイル | 変更内容 |
|---|---|
| `frontend/src/store/ui.ts` | `duplicatePkCount: number` + `setDuplicatePkCount` 追加 |
| `frontend/src/components/TableGrid/TableGrid.tsx` | `duplicatePkIds` (useMemo) + UIStore 同期 + `cellStyle` 橙ハイライト |
| `frontend/src/components/common/CommitDialog.tsx` | `duplicatePkCount > 0` 時に橙警告バナー表示 |

**動作**: コピー直後は全 INSERT 行が橙（PK 未変更）→ PK 置換後に緑に変わる = 置換完了の視覚的確認

---

## フィードバック7件 実装詳細（2026-03-03）

### ⑭ ブランチ作成後のスキーマ取得失敗バグ修正（最優先）

**原因**: `ApproveRequest()` と `CrossCopyTable()` が branch 更新直後に検証なしで即 `ConnWrite()` → Dolt ブランチ伝播ラグで失敗

**修正**:
- `service/metadata.go` — `verifyBranchQueryable(ctx, targetID, dbName, branch)` 共通関数追加（3回リトライ、200ms 間隔）
- `service/request.go` — `ApproveRequest()` の work branch 再整列後に verifyBranchQueryable 呼び出し、失敗時は warning を返して `main` 反映自体は維持
- `service/crosscopy.go` — `CrossCopyTable()` の新ブランチ作成後に同じ検証を追加
- `frontend/src/components/RequestDialog/RequestDialog.tsx` — `ApproveModal` が `result.active_branch` / `result.active_branch_advanced` を読み遷移先を決定
- `frontend/src/components/CrossCopyModal/CrossCopyTableModal.tsx` — 100ms setTimeout を削除（バックエンドが検証後に返却するため不要）

### ⑨ マージログ コミットメッセージ検索

- `frontend/src/components/MergeLog/MergeLog.tsx` のみ変更（バックエンドは keyword 既対応済み）
- `keyword` state + テキスト入力 + Enter キー対応

### ⑪ エラー永続化修正

- `frontend/src/App.tsx` — error 発生から8秒後に `setError(null)` する useEffect 追加
- `frontend/src/hooks/useHeadSync.ts` — `hasError?: () => boolean` オプション追加。バックグラウンド HEAD 取得失敗時にユーザー表示中エラーを上書きしない

### ⑬ 手動同期廃止・承認申請統合

- `service/request.go` — `SubmitRequest()` に `previewMergeInfo()` + `resolveDataConflicts()` 統合（autocommit=1 → START TRANSACTION に変更）
- `handler/handler.go` — `/sync` ルート削除
- `handler/write.go` — `Sync` ハンドラ削除（Commit ハンドラのみ残留）
- `frontend/src/App.tsx` — `handleSync` 削除、「↻ Main と同期」メニュー削除、上書きテーブル通知追加
- `types/api.ts` / `model/api.go` — `SubmitRequestResponse.overwritten_tables` フィールド追加

### ⑩ クロスDB コピー 文字型カラム自動拡張

- `service/crosscopy.go` — `parseVarcharLen()` / `stringTypeLevel()` / `needsExpansion()` / `applyExpandColumns()` 追加
  - `CrossCopyPreview()` — 型比較で expandable カラムを検出し `expand_columns` として返却
  - `CrossCopyRows()` / `CrossCopyTable()` — コピー前に `applyExpandColumns()` で `ALTER TABLE MODIFY COLUMN` 実行
- `model/api.go` — `ExpandColumn` 型 + `CrossCopyPreviewResponse.expand_columns` フィールド追加
- `frontend/src/types/api.ts` — 同型追加
- `frontend/src/components/CrossCopyModal/CrossCopyRowsModal.tsx` — expand_columns 通知表示

### ⑫ CSVバルク更新（最大1000行）

| ファイル | 内容 |
|---|---|
| `backend/internal/service/csvimport.go` | `CSVPreview()` + `CSVApply()` 実装 |
| `backend/internal/handler/csvimport.go` | `POST /csv/preview` + `POST /csv/apply` ハンドラ |
| `backend/internal/model/api.go` | CSV 関連型追加 |
| `frontend/src/components/CSVImportModal/CSVImportModal.tsx` | 3ステップ モーダル（select→preview→done） |
| `frontend/src/App.tsx` | overflow menu に「📥 CSVインポート」追加 |

**動作仕様**:
- CSVはフロントエンドで UTF-8 パース（引用符対応）、最大1000行
- プレビューで insert/update/skip/error 件数 + サンプル差分表示
- CSVにないPKはスキップ（削除しない）、_memo_ テーブルは触れない
- 実行後は新 HEAD で TableGrid リフレッシュ

### ⑧ 全テーブル横断検索

| ファイル | 内容 |
|---|---|
| `backend/internal/service/search.go` | `Search()` 実装（全テーブル LIKE + メモ検索） |
| `backend/internal/handler/search.go` | `GET /search` ハンドラ |
| `backend/internal/model/api.go` | `SearchResult` + `SearchResponse` 型追加 |
| `frontend/src/components/SearchModal/SearchModal.tsx` | 検索モーダル（テーブル別グループ表示、クリックでナビゲート） |
| `frontend/src/App.tsx` | overflow menu に「🔍 全テーブル検索」追加 |

---

## クロスDB コピー 実装詳細（次 LLM への参考情報）

### API 仕様

| エンドポイント | 用途 |
|---|---|
| `POST /api/v1/cross-copy/preview` | 指定PKのコピー差分プレビュー（insert/update 判定） |
| `POST /api/v1/cross-copy/rows` | 選択行を別DB/ブランチへコピー（ON DUPLICATE KEY UPDATE） |
| `POST /api/v1/cross-copy/table` | テーブル全件を別DBに `wi/import-{sourceDB}-{table}` ブランチとしてコピー。既存 branch がある場合は再作成せず既存 branch を開く |

### 主要ファイル

| ファイル | 変更内容 |
|---|---|
| `backend/internal/service/crosscopy.go` | 全3サービス実装 + BUG-1〜7 修正 |
| `backend/internal/handler/crosscopy.go` | 3ハンドラー |
| `backend/internal/model/api.go` | Request/Response 型定義 |
| `backend/internal/repository/dolt.go` | `ConnWrite` 常時 DOLT_CHECKOUT 修正 |
| `frontend/src/components/CrossCopyModal/` | CrossCopyModal コンポーネント群 |
| `frontend/src/api/client.ts` | crossCopyPreview/Rows/Table API クライアント |
| `frontend/src/types/api.ts` | CrossCopy 型定義 |

### 重要な実装メモ

- `ConnWrite()` は branchName が "main" であっても必ず `CALL DOLT_CHECKOUT(?)` を実行する（プールの古い接続がbranch汚染するため）
- `CREATE DATABASE` した直後の DB はプール接続では認識されない → テスト時はサーバー再起動が必要
- 新規テーブルのコミットは `DOLT_COMMIT('--all')` ではなく `DOLT_ADD('.') + DOLT_COMMIT('-m', ...)` が必要
- `CrossCopyTable` のクロスDB SELECT: `INSERT INTO dst SELECT cols FROM \`srcdb/branch\`.tbl` は同一 Dolt サーバー内で動作確認済み（BUG-3は問題なし）
- 0件コピー時（全PKがソースに存在しない）は `ROLLBACK` して current HEAD を返す（BUG-7修正）

### E2E テスト

`/tmp/dolt-e2e-crosscopy.sh` — 46チェック、全 PASS 確認済み

---

## 改修4 実装詳細（次 LLM への参考情報）

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `backend/internal/service/diff.go` | `HistoryCommits` をクエリビルダーパターンにリファクタ。`keyword`/`fromDate`/`toDate` 引数追加 |
| `backend/internal/handler/diff.go` | `keyword`, `from_date`, `to_date` クエリパラメータ追加 |
| `frontend/src/api/client.ts` | `getHistoryCommits` にオプション引数追加 |
| `frontend/src/components/ActivityLog/ActivityLog.tsx` | **新規**: 検索フォーム + コミット一覧 + Diff展開 |
| `frontend/src/components/ModalManager/ModalManager.tsx` | ActivityLog 登録 |
| `frontend/src/App.tsx` | `showActivityLog` ステート + ⋮メニューに「📜 変更ログ検索...」 |

### DiffTableDetail の `fromRef`/`toRef` 対応

`ActivityLog.tsx` では `DiffTableDetail` のコミット個別 Diff 表示に `fromRef={c.hash + "^"}` を使用。
`DiffTableDetail` が `fromRef`/`toRef` props を受け付けない場合は、修正が必要になる可能性がある。
（現時点では `branchName` ベースの diff のみサポートしている可能性 — 要確認）

---

## 安全プロパティ確認状況

| # | プロパティ | 状態 | 根拠 |
|---|----------|------|------|
| P1 | Lost Write Prevention | ✅ | expected_head + ConnWrite |
| P2 | ドラフト永続性 | ⚠️ | sessionStorage（揮発性）。exportDraftSQL で緩和。将来課題。 |
| P3 | main/audit 書き込み保護 | ✅ | handler `mainGuard` (BUG-4修正後) + service `IsProtectedBranch` 二重ガード |
| P4 | 承認なしマージ防止 | ✅ | main への唯一経路は ApproveRequest。Sync は pull のみ。 |
| P5 | 作者追跡 | ✅ | Dolt commit metadata |
| P6 | 選択的マージ | ✅ | PJ ブランチにはPJ編集のみ入る運用前提 |
| P7 | 100万行対応 | ✅ | サーバーサイドページネーション + ストリーミング |
| P8 | ブランチロック | ✅ | req/タグ存在時に commit/revert/sync を HTTP 423 で拒否 — 改修2 |
| — | 複合PK安全性 | ✅ | BUG-1/2/12/14修正済み。P1〜P8は複合PK変更で毀損されないことを3ラウンド静的証明済み（2026-02-26）|
| — | QA状況 | ✅ | 全5ラウンド完了。全18バグ修正済み。`go vet`/`tsc` ゼロエラー。詳細は [docs/QA_REPORT.md](QA_REPORT.md) 参照 |

---

## LLM 間引き継ぎルール

1. **セッション開始時**: このファイルと `CLAUDE.md` を読む
2. **作業開始前**: `git log --oneline -5` と `git diff --stat` で現状確認
3. **変更されたファイルがある場合**: 差分を確認し、前の LLM の作業を評価してから続行
4. **作業完了時**: このファイルの該当タスクを「✅ 完了」に更新し、次のタスクを明記
5. **ビルド**: フロントエンド + バックエンド両方のビルド成功を確認してからコミット
6. **コミット**: 改修単位でコミット（改修3 と改修4 は別コミット推奨）
