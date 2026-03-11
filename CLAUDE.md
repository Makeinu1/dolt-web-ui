# Dolt Web UI

## Project Overview

Web UI for Dolt (Git-like version control SQL database). PSX data change management workbench.

## Architecture

- **Backend**: Go + chi router (stateless API server)
- **Frontend**: React 19 + TypeScript + Vite (SPA, embedded in Go binary)
- **Database**: Dolt SQL Server (external, configured via config.yaml)
- **Deployment**: Single binary with embedded frontend (cross-compiled for Linux)

## Directory Structure

- `backend/` - Go API server
- `frontend/` - React SPA
- `dist/` - Built binaries (gitignored by default, force-add when releasing)
- `参考/` - v6f specification documents (read-only reference)

## Specification Reference

All API implementations must conform to the OpenAPI spec (SSOT):
`参考/dolt_web_ui_artifacts_20260211_v6f/dolt_web_ui_openapi_v6f.yaml`

SQL implementations follow:
`参考/dolt_web_ui_artifacts_20260211_v6f/dolt_web_ui_api_sql_mapping_v6f.md`

---

## Build Commands

```bash
make build          # Build for macOS (frontend + backend)
make build-linux    # Cross-compile for Linux amd64
make test           # Run all tests
make lint           # Run linters (go vet + tsc --noEmit)
```

---

## Git & Release Workflow

### コード変更後の必須手順（毎回）

バックエンドを変更したら必ず以下の順序で実行:

```bash
# 1. macOS バイナリを再ビルド
cd dolt-web-ui/backend && go build -o ../dist/dolt-web-ui ./cmd/server

# 2. Linux バイナリをクロスコンパイル（CRITICAL: macOS Icon\r ファイルを先に削除）
find backend/cmd/server/static -name $'Icon\r' -delete
GOOS=linux GOARCH=amd64 go build -o ../dist/dolt-web-ui-linux-amd64 ./cmd/server

# 3. git に追加してコミット
git add -f dist/dolt-web-ui dist/dolt-web-ui-linux-amd64
git add <変更したソースファイル>
git commit -m "fix: ..."
git push origin master
```

フロントエンドも変更した場合は **必ず** フルビルドを実行（embed されるため）:

```bash
# フロントエンド再ビルド → static/ にコピー → macOS バイナリ
cd frontend && npm run build
rm -rf ../backend/cmd/server/static && cp -r dist ../backend/cmd/server/static
find ../backend/cmd/server/static -name $'Icon\r' -delete
cd ../backend && go build -o ../dist/dolt-web-ui ./cmd/server

# Linux バイナリも同じ static/ から再ビルド
GOOS=linux GOARCH=amd64 go build -o ../dist/dolt-web-ui-linux-amd64 ./cmd/server
```

> **落とし穴**: Linux ビルド（`make build-linux`）でフロントエンドが再ビルドされた後、macOS バイナリを再ビルドしないと古い UI が埋め込まれたまま残る。必ず両方セットで再ビルドすること。

### よくあるつまづきポイント

#### macOS `Icon\r` ファイルが `go:embed` を壊す

`make build-linux` が以下のエラーで失敗する場合:
```
cmd/server/main.go:24:12: pattern static/*: cannot embed file static/Icon: invalid name Icon
```

**対処**:
```bash
find backend/cmd/server/static -name $'Icon\r' -delete
```

フロントエンド再ビルド（`npm run build` → `cp -r frontend/dist backend/cmd/server/static`）の後に macOS が自動生成するファイル。make 実行前に必ず削除する。

#### `dist/` は .gitignore 対象

`dist/dolt-web-ui` と `dist/dolt-web-ui-linux-amd64` は `.gitignore` により通常は追跡されない。
バイナリを Git に含める場合は **`git add -f`** で強制追加する:

```bash
git add -f dist/dolt-web-ui dist/dolt-web-ui-linux-amd64
```

#### サーバー再起動を忘れない

バックエンドを変更したらサーバーを再起動しないと変更が反映されない:

```bash
pkill -f dolt-web-ui          # 旧プロセスを停止
./dist/dolt-web-ui &          # 新バイナリで起動
curl http://localhost:8080/health  # 起動確認
```

#### 複数のコミットで論理的に分ける

- Backend バグ修正: 1コミット
- Frontend UI 変更: 別コミット
- ドキュメント更新 + バイナリ: 別コミット

---

## Backend Conventions

- Go module: `github.com/Makeinu1/dolt-web-ui/backend`
- Router: `github.com/go-chi/chi/v5`
- Config: YAML via `gopkg.in/yaml.v3`
- DB driver: `github.com/go-sql-driver/mysql` (Dolt uses MySQL protocol)
- 接続プール: `Conn()`（リード、ステートレス revision specifier `USE \`db/branch\``）/ `ConnWrite()`（ライト、`USE db` + `DOLT_CHECKOUT`）。`MaxIdleConns=10`
- All write endpoints validate `expected_head` (optimistic locking)
- Protected branches: `main` + `audit` は読み取り専用（`IsProtectedBranch()` + ProtectedBranchGuard middleware）
- Branch lock: Submit中（`req/*` タグ存在時）は Commit/Sync をブロック（HTTP 423 `BRANCH_LOCKED`）

### Dolt/SQL 注意事項

- `*sql.Conn` 上で2回目のクエリを実行する前に `rows.Close()` を必ず呼ぶ（`defer` 不可）
- `CALL DOLT_MERGE()` は4列返す: `(hash, fast_forward, conflicts, message)`
- `DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY(branch, 'main')` は Dolt v1.x で **3列**: `(table, num_data_conflicts, num_schema_conflicts)` ← 4列でScanするとdeadlock
- `CALL DOLT_COMMIT('--allow-empty', '--all', '-m', 'message')` — 引数は個別に渡す（`-Am` の組み合わせ不可）
- `autocommit=1` はプールされたコネクションに永続するので使用後は `SET autocommit=0` でリセット
- Dolt merge コンフリクトは `autocommit=1` 時に MySQL error 1105 として返る（`conflicts > 0` ではなく `err.Error()` をチェック）
- `dolt_commit_ancestors` テーブルでマージコミット判定: `GROUP BY commit_hash HAVING COUNT(*) > 1` → 親2つ以上 = マージコミット
- `DOLT_DIFF()` テーブル関数はページネーション可: `SELECT COUNT(*) FROM DOLT_DIFF(?,?)` + `LIMIT ? OFFSET ?`
- `DOLT_DIFF()` の `diff_type` 列は `"added"` / `"modified"` / `"removed"` の3値（WHERE 句でフィルタ可）

### `/health` エンドポイント

`/api/v1/health` ではなく **`/health`**（ルートパス直下）に配置されている。

### ConnWrite の注意事項

`ConnWrite()` は branchName が `"main"` であっても常に `CALL DOLT_CHECKOUT(?)` を実行する。
スキップすると、プールから再取得した接続が別ブランチのまま残り、`DOLT_BRANCH(name)` が誤ったHEADから作成される（"nothing to commit" の原因）。

### 動的 DB 作成とプール

`CREATE DATABASE` で作成した新規DBは、既存のプール接続では `USE \`newdb/branch\`` が "database not found" になる。
テスト・開発時はサーバーを再起動してから接続する。

### `DOLT_ADD` と新規テーブル

`DOLT_COMMIT('--all')` は既存テーブルの変更のみステージする。
`CREATE TABLE` 後は `CALL DOLT_ADD('.')` を明示的に呼ぶこと。

### CrossCopy cleanup の注意事項

`crosscopy_table.go` の `parseCopyError` マッチパス（Data too long / FK violation）では `cleanupIfNeeded()` を呼ぶ。
cleanup 失敗時は `crossCopyTableFailureResponse(..., cleanupErr)` を返して `outcome=retry_required` に格上げする。
**この動作は単体テスト (`crosscopy_outcome_test.go`) で検証済み。**

### 承認 footer パーサー

`internal/footer/footer.go` に共有パーサー (`ParseApprovalFooter`, `BuildApprovalFooter`) を実装。
`service/approval_footer.go` は型エイリアス (`type approvalFooter = footer.ApprovalFooter`) で委譲。
`cmd/footer-scan/main.go` がこのパーサーを使って DB の全コミットを検証する。

```bash
# main ブランチの全コミットをスキャンして不正 footer を検出
go run ./cmd/footer-scan --config config.yaml --target default --db Test
```

---

## Frontend Conventions

- Package manager: npm
- State management: Zustand (3 stores: context / draft / ui)
  - **ストア分離原則**: `context.ts` は他ストア（draft/ui）を直接呼ばない。副作用（ドラフトクリア等）は App.tsx の `useEffect` で処理（C-3パターン）
- Data grid: AG Grid Community 35
- Draft data stored in sessionStorage only (volatile)
- TemplatePanel / template store は廃止済み（右クリック直接操作に移行）
- エラー処理: `ApiError` クラス（`api/errors.ts`）で status/code/details を型安全に伝搬
- App.tsx リファクタ: HEAD管理は `useHeadSync` フック、モーダル群は `ModalManager` コンポーネントに分離

### CSS 詳細度の落とし穴

`index.css` にグローバルな `button.danger`, `button.primary` 等のスタイルが定義されている。
コンポーネント固有の `<button>` に別クラスを付けても、グローバルスタイルの詳細度が勝つ場合がある。

- 例: `.overflow-item { background: none }` (0,1,0) < `button.danger { background: red }` (0,1,1)
- 修正: `.overflow-item.danger { background: none }` (0,2,0) で明示的にオーバーライド

**原則**: コンポーネント固有のボタンスタイルでは `background`, `color`, `border` を明示的に指定する。

### AG Grid 型の注意点

- `getRowStyle` の `params.data` は `T | undefined`（`RowClassParams` 型）。引数型は `params: { data?: T }` でオプショナルとして扱うこと。
- AG Grid Community 35 はサーバーサイドモデル非対応。クライアントサイドで `rowData` を渡す方式のみ。

### UI 言語方針

- ユーザー向けテキストはすべて **日本語**
- 技術的識別子（API パス、関数名、ブランチ名パターン）は英語のまま
- アイコン＋短ラベル（📤, 🔄 等）は言語非依存で可

### 承認リクエストの自動検出パターン

`requestPending` フラグはセッション内で Submit 後にのみ立つ設計だったが、
App.tsx の `useEffect` で `listRequests()` を自動呼び出して起動時・コンテキスト切替時に同期する:

```tsx
useEffect(() => {
  if (!isContextReady) return;
  api.listRequests(targetId, dbName)
    .then((requests) => setRequestPending(requests.length > 0))
    .catch(() => {}); // 非致命的なので無視
}, [targetId, dbName, branchRefreshKey]);
```

---

## Mac でのローカル試験手順

### 1. Dolt サーバーを起動する

```bash
# data_dir は dolt-data/ の親ディレクトリで起動（Test DB を認識させるため）
cd /Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-data
dolt sql-server &
# → 127.0.0.1:3306 で起動（Test/config.yaml の listener 設定が反映される）
```

起動確認:
```bash
dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql -q "SELECT 1"
```

### 2. Web UI サーバーを起動する

```bash
cd /Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui
./dist/dolt-web-ui &
# → http://localhost:8080 で起動
```

起動確認:
```bash
curl http://localhost:8080/health
# → {"status":"ok"}
```

ブラウザで `http://localhost:8080` を開いて動作確認できる。

### 3. E2E テストを実行する

```bash
# 基本 58 チェック（INSERT/UPDATE/Sync/Submit/Approve/Cell-level merge）
bash /tmp/dolt-e2e-test.sh

# 拡張 52 チェック（DELETE/DiffSummary/RowHistory/Filter/Conflict/EdgeCase）
bash /tmp/dolt-e2e-extended.sh
```

> テストスクリプトはセクション 0 に自前クリーンアップが含まれているため、連続実行しても安全。

### 4. クリーンアップ・停止手順

#### サーバーを停止する

```bash
# dolt-web-ui サーバーを停止
pkill -f dolt-web-ui

# Dolt SQL サーバーを停止
pkill -f "dolt sql-server"
```

#### Dolt DB を試験前の状態に戻す（完全リセット）

```bash
# E2E テストが作成したブランチ・タグを全削除してmainだけにする
DOLT_REPO="/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-data/Test"

# wi/* ブランチを削除
for branch in $(dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql -q \
  "SELECT name FROM dolt_branches WHERE name LIKE 'wi/%'" --result-format=csv | tail -n +2); do
  dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql \
    -q "CALL DOLT_BRANCH('-D', '$branch')"
done

# req/* タグ・merged/* タグを削除
for tag in $(dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql -q \
  "SELECT tag_name FROM dolt_tags WHERE tag_name LIKE 'req/%' OR tag_name LIKE 'merged/%'" \
  --result-format=csv | tail -n +2); do
  dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql \
    -q "CALL DOLT_TAG('-d', '$tag')"
done

# Test1 / Test2 テーブルのE2Eデータを削除してコミット
(cd "$DOLT_REPO" && dolt sql -q "
  DELETE FROM Test1 WHERE id >= 100;
  DELETE FROM Test2 WHERE id >= 100;
" && dolt sql -q "CALL DOLT_COMMIT('--allow-empty', '--all', '-m', 'e2e cleanup')")
```

#### ブランチ一覧・タグ一覧の確認

```bash
dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql \
  -q "SELECT name FROM dolt_branches"

dolt --host 127.0.0.1 --port 3306 --user root --password "" --no-tls sql \
  -q "SELECT tag_name FROM dolt_tags"
```

### パス早見表

| 項目 | パス |
|------|------|
| Dolt データディレクトリ | `/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-data/` |
| Dolt DB（Test） | `/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-data/Test/` |
| Web UI プロジェクト | `/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/` |
| macOS バイナリ | `dolt-web-ui/dist/dolt-web-ui` |
| Linux バイナリ | `dolt-web-ui/dist/dolt-web-ui-linux-amd64` |
| Web UI 設定 | `dolt-web-ui/config.yaml` |
| E2E 基本テスト | `/tmp/dolt-e2e-test.sh` |
| E2E 拡張テスト | `/tmp/dolt-e2e-extended.sh` |

---

## Dolt Server

```
Host: 127.0.0.1
Port: 3306
User: root
Password: (none)
Database: Test
```

---

## 実装済み機能一覧

### コア機能
- AG Grid によるスプレッドシート編集（セル編集、フィルタ、ソート、ページネーション）
- **複数行選択（Phase 4）** — チェックボックスで単一/複数行を選択（`suppressRowClickSelection`）
  - ツールバーの「コピー (N)」「削除 (N)」で選択行を一括操作
  - 右クリックメニューも選択行数に応じて「選択 N 行をコピー」「選択 N 行を削除」に動的変化
- **複合PK対応** — 複数列を主キーとするテーブルの完全CRUD（INSERT/UPDATE/DELETE）
  - PK列の直接編集が可能（サーバー側で `PK_COLLISION` を検出）
  - `rowPkId` でアルファベット順正規化された JSON キーを使用（メモセルキーとの一致保証）
- ドラフト管理（sessionStorage、Insert/Update/Delete の色分け表示）
- ブランチ作成・削除（`wi/{WorkItem}` パターン）
- **保存**（旧「コミット」、楽観ロック `expected_head`、DOLT_VERIFY_CONSTRAINTS 付き）
- Main との同期（DOLT_MERGE、データコンフリクトは main 優先で自動解決 + 上書き通知）
- 承認ワークフロー（Submit → Approve/Reject、`req/*` タグベース）
- 承認リクエスト自動検出（アプリ起動・コンテキスト切替時に自動チェック）
- セッション安全性（defer/ROLLBACK が HTTP 切断時も `context.Background()` で確実実行）
- エラー表示改善（「日本語説明: 英語エラー詳細」併記フォーマット）
- `Dolt_Description` 列の左端固定（AG Grid `pinned: 'left'`、存在する場合のみ）
- ブランチ種別表示（🔒 main / 📋 audit / 🌿 wi/*）

### データ閲覧・比較
- バージョン比較 HistoryTab（ブランチ HEAD 間比較のみ、コミット選択なし）
  - DiffSummary → DiffGrid フルスクリーン AG Grid
  - サーバーサイドページネーション（50件/ページ）
  - diff_type フィルタ（全て / 追加 / 変更 / 削除）
- マージログ MergeLog（main へのマージ履歴のみ、日付範囲フィルタ、DiffSummary 展開、ZIP エクスポート、ハッシュ非表示）
  - **検索対象切替**: コミットログ / ブランチ名 のセレクトボックスで切替（`search_field=branch` → `wi/{keyword}%` でLIKE検索）
  - **レコード単位マージ履歴**: ツールバー「履歴」ボタン（1行選択時 + PK有り）→ MergeLog が `filterTable` + `filterPk` 付きで開く。そのレコードに変更があったマージコミットのみ表示（`dolt_history_{table}` のスナップショット比較でフィルタ）。差分展開・閲覧・ZIP など MergeLog の全機能がそのまま利用可能。main/audit 等の保護ブランチでも常時表示（読み取り専用のため）
  - **ESCAPE バグ修正**: `ESCAPE '\\'` → `ESCAPE '|'` に変更（Dolt SQL パーサーのエスケープクォート誤解釈を回避）
- 行クローン（PK保持コピー方式 — 元行のPKをそのまま保持、`vary_column` + `new_values` レガシーモードも後方互換で維持）
  - コピー後のセル編集（UPDATE）は `draft.ts` の `addOp` で INSERT op にマージされる → コミット時にPK_COLLISIONが発生しない
  - コピー後の削除（DELETE）は INSERT op をキャンセルする（何も送信しない）
  - **注意**: コピー後にPKを変更しないまま保存するとPK_COLLISION — これは正しい動作

### セルメモ（Phase 2: メモテーブル移行済み）
- `_memo_{table}` 隠しテーブルでメモ管理（ユーザーのテーブル一覧に非表示）
- メモの保存・削除はドラフト ops 経由（自動コミットしない — データ変更と同フロー）
- `GET /api/v1/memo/map`, `GET /api/v1/memo` エンドポイントで取得

### 編集補助
- 行 Undo（「⟲ 元に戻す」ボタン、直近の操作を取り消し）
- 変更をクリア（ドラフト全消去ボタン）
- ドラフト更新マージ（同一行の連続 update を自動統合）
- 自動生成保存メッセージ（`[{branch}] {table}テーブル: +{i} ~{u} -{d}`）

### UX / データ安全性改善（UX網羅性レビュー対応）
- **ブランチ/ターゲット/DB切替時の確認ダイアログ** — ドラフトがある場合 `window.confirm()` でデータ喪失防止（UX-19）
- **モーダル外クリック保護** — SubmitDialog・ApproveModal で入力テキストがあれば閉じる前に確認（UX-17）
- **StaleHeadDetected 時の UI 改善** — エラーバナーの ✕ を非表示、ステートバッジをクリックで `handleRefresh`（UX-11）
- **ネットワークエラー可視化** — `fetch` の `TypeError` を `ApiError(NETWORK_ERROR)` に変換し「サーバーに接続できません」表示（UX-N1）
- **テーブル/行読み込み失敗時のエラーバナー** — グリッド上部にエラー表示 + 再試行ボタン（UX-1）
- **ZIPエクスポート失敗時のエラー表示**（UX-7）
- **マージログ読み込み失敗時のエラー表示**（UX-8）
- **行クローン中のフィードバック** — ボタン disable + 「コピー中...」表示、`useRef` で連打防止（UX-4）
- **ブランチ読み込み中のローディング表示** — `disabled` + 「読み込み中...」（UX-2）
- **テーブル一覧ローディング表示** — セレクタ `disabled` + 「読み込み中...」（UX-3）
- **AG Grid エンプティステート日本語化** — `overlayNoRowsTemplate` を「検索条件に一致するデータがありません」に（UX-N2）
- **BRANCH_LOCKED 専用メッセージ** — 「承認申請中のためロックされています」（Commit/Sync 両方対応、UX-9）
- **ConflictView オーバーレイ外クリック** — 閉じる操作が可能に（UX-14）
- **Sync ダブルクリック防止** — `baseState === "Syncing"` で早期リターン（UX-12）
- **CommitDialog の `_memo_*` テーブル名変換** — 「{table} のメモ」として表示（UX-16）
- **CellCommentPanel ドラフト破棄ボタン** — 「未保存の変更あり」バナーに「破棄」リンク追加（UX-18）

### 運用
- **クロスDB コピー（Cross-Copy）** — DB間データ転送
  - `POST /cross-copy/preview` — コピー差分プレビュー（insert/update 判定、スキーマ差異警告）
  - `POST /cross-copy/rows` — 選択PKをdest DB/branchへコピー（ON DUPLICATE KEY UPDATE、保護ブランチ/ブランチロック対応）
  - `POST /cross-copy/table` — テーブル全件を `wi/import-{table}/NN` ブランチとしてコピー（ラウンド番号自動採番）
  - CrossCopyModal（React）— プレビュー → 確認 → コピー実行のUIフロー
- CLIRunbook（致命的エラー時の手動復旧手順表示）
- 単一バイナリデプロイ（フロントエンド `//go:embed static/*`）
- macOS / Linux amd64 クロスコンパイル
- Playwright ブラウザテスト（31テスト、APIモックベース、`frontend/tests/e2e/`）
  - `composite-pk.spec.ts` — 複合PKテーブルのCRUD・PK_COLLISION・後方互換テスト
- curl ベース統合テスト（`/tmp/dolt-e2e-4changes.sh` — 19テスト、変更1〜4カバー）
- curl ベース統合テスト（`/tmp/dolt-e2e-crosscopy.sh` — 46テスト、クロスDB P1〜P11カバー）

### 撤廃済み機能（簡素化計画 Phase 0〜3 で削除）
- Revert（コミット取消）— 保存履歴を見せない方針と矛盾
- BatchGenerateModal / PreviewBulkUpdate — 行クローンで代替
- ActivityLog（変更ログ検索）— MergeLog に置換
- exportDraftSQL（ドラフト SQL エクスポート）— 複雑性削減
- ConflictView ours/theirs 選択 UI — main 優先自動解決に変更
- コメント系 API 6 本（`/comments/*`）— メモ系 API 2 本に置換
- コンフリクト系 API 3 本（`/conflicts/*`）— 自動解決のため不要
- `RecordHistoryPopup` — MergeLog のレコードフィルタ機能に完全置換（ツールバー「履歴」ボタン → MergeLog + filterTable/filterPk）
- 右クリック「履歴を表示」— Chrome で右クリックメニューが動作しない問題によりツールバーボタン方式に移行し削除

---

## Release Checklist（毎回必須）

> **重要**: コード変更後は **必ず** 以下の手順をすべて実行すること。
> E2E テストが成功したら、ドキュメント更新・バイナリビルド・Git コミット＆プッシュまでを一連の流れとして毎回行う。

1. `npx tsc --noEmit`（フロントエンド変更時）/ `go build`（バックエンド変更時）でコンパイルエラーがないことを確認
2. フロントエンド変更時: `cd frontend && npm run build` → `rm -rf ../backend/cmd/server/static && cp -r dist ../backend/cmd/server/static`
3. `find backend/cmd/server/static -name $'Icon\r' -delete` — macOS ゴミファイル削除
4. `bash /tmp/dolt-e2e-4changes.sh` — 19/19 PASS（curl ベース統合テスト）
5. `cd frontend && npx playwright test` — 20/20 PASS（Playwright ブラウザテスト）
6. macOS バイナリビルド: `cd backend && go build -o ../dist/dolt-web-ui ./cmd/server`
7. Linux バイナリビルド: `cd backend && GOOS=linux GOARCH=amd64 go build -o ../dist/dolt-web-ui-linux-amd64 ./cmd/server`
8. `git add -f dist/dolt-web-ui dist/dolt-web-ui-linux-amd64` + ソース変更をステージング
9. コミット・プッシュ（`git commit` → `git push origin master`）

---

## LLM 共同開発ルール

> 本プロジェクトでは複数の LLM が交互にトークンを消費しながら開発を行う。
> 以下のルールを **必ず** 遵守すること。

### セッション開始時の必須手順

1. **`docs/COLLAB_PLAN.md` を読む** — 現在の実装キュー、完了済み改修、安全プロパティ状態を把握
2. **`git log --oneline -10` で直近コミットを確認** — 前の LLM が何をコミットしたか把握
3. **`git diff --stat` で未コミットの変更を確認** — 前の LLM が作業途中で終了していないか確認
4. **変更されたファイルがある場合**: 差分を詳細に確認し、前の LLM の作業内容を評価・検証してから続行。問題があれば修正してからコミットする

### 開発中のルール

- **仕様駆動**: `docs/COLLAB_PLAN.md` に記載された仕様に従って実装する。仕様にない変更を勝手に加えない
- **改修単位コミット**: 改修3 と改修4 は別コミットにする。1つの改修が完了したら即コミット
- **ビルド確認必須**: コミット前に必ずフロントエンド + バックエンドのビルドが通ることを確認（Release Checklist 参照）
- **スコープ厳守**: 依頼された改修のみ実施する。リファクタや「ついで改善」は禁止
- **日本語 UI**: ユーザー向けテキストはすべて日本語。技術識別子（API パス、変数名）は英語

### セッション終了時の必須手順

1. **`docs/COLLAB_PLAN.md` を更新** — 完了したタスクを ✅ に変更、作業途中のタスクに進捗メモを追記
2. **未コミットの変更がある場合**: 可能な限りコミット＆プッシュする。途中の場合はプランに状況を記載
3. **次の LLM への引き継ぎ**: プランファイルに「次にやるべきこと」を明記

### 前の LLM の作業評価

変更されたファイルを発見した場合、以下を確認する:

1. **コンパイルエラーがないか**: `npx tsc --noEmit` + `go build`
2. **仕様との整合性**: `docs/COLLAB_PLAN.md` の仕様と実装が一致しているか
3. **既存パターンとの一貫性**: 既存コードのスタイル・パターンに従っているか
4. **安全プロパティの維持**: 変更が P1〜P8 の安全プロパティを毀損していないか
5. **問題発見時**: 修正した上で、プランファイルに問題と修正内容を記録する
