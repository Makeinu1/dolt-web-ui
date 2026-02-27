# LLM 共同開発プラン

> このファイルは、複数の LLM が交互にトークンを消費しながら共同開発するための
> 引き継ぎドキュメントです。各 LLM はセッション開始時にこのファイルを読み、
> 現在の開発状況を把握してから作業を開始してください。

---

## 現在のプロジェクト状態

**最終更新**: 2026-02-28
**最終コミット**: (本コミット) — 4機能追加（PK保持コピー・エラー表示改善・列固定・ブランチ種別/audit同期）
**ブランチ**: `master`（直接プッシュ運用）

---

## 実装キュー（優先順位順）

### 次のタスク: なし（4機能追加完了）

4機能（PK保持コピー・エラー表示改善・Dolt_Description列固定・ブランチ種別/audit同期）の実装は本コミットでプッシュ済み。

次に追加したい機能や改修がある場合は、このセクションに記載してください。

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
| **変更4** | ブランチ種別 — main/audit保護統一(isProtected) + audit→main同期エンドポイント + メモテーブル保護 + ContextSelectorアイコン | 本コミット |

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
