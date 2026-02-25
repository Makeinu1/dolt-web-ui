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
- Branch lock: Submit中（`req/*` タグ存在時）は Commit/Sync/Revert をブロック（HTTP 423 `BRANCH_LOCKED`）

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
- ドラフト管理（sessionStorage、Insert/Update/Delete の色分け表示）
- ブランチ作成・削除（`wi/{WorkItem}/{Round}` パターン）
- コミット（楽観ロック `expected_head`、DOLT_VERIFY_CONSTRAINTS 付き）
- Main との同期（DOLT_MERGE、コンフリクト検出・解決 UI）
- 承認ワークフロー（Submit → Approve/Reject、`req/*` タグベース）
- 承認リクエスト自動検出（アプリ起動・コンテキスト切替時に自動チェック）

### データ閲覧・比較
- バージョン比較（DiffSummary → DiffGrid フルスクリーン AG Grid）
  - サーバーサイドページネーション（50件/ページ）
  - diff_type フィルタ（全て / 追加 / 変更 / 削除）
- コミット履歴フィルタリング（main: マージのみ / 作業ブランチ: 自動マージ除外）
- コミット復元（Revert）— HistoryTab から任意コミットを `DOLT_REVERT` で打ち消し
- セル単位の変更履歴（RecordHistoryPopup、直近20件）
- 行クローン（自動PK採番）、一括クローン（BatchGenerateModal）

### 編集補助
- 行 Undo（「⟲ 元に戻す」ボタン、直近の操作を取り消し）
- 変更をクリア（ドラフト全消去ボタン）
- ドラフト更新マージ（同一行の連続 update を自動統合）
- ドラフト SQL エクスポート（StaleHead 時に `📥 ドラフトをSQLで退避` でファイルダウンロード）
- スマート自動コミットメッセージ（空欄時: `[自動保存] {table}テーブルの変更 ({N}件)`）

### 運用
- CLIRunbook（致命的エラー時の手動復旧手順表示）
- 単一バイナリデプロイ（フロントエンド `//go:embed static/*`）
- macOS / Linux amd64 クロスコンパイル
- Playwright ブラウザテスト（19テスト、APIモックベース、`frontend/tests/e2e/`）

---

## Release Checklist（毎回必須）

> **重要**: コード変更後は **必ず** 以下の手順をすべて実行すること。
> E2E テストが成功したら、ドキュメント更新・バイナリビルド・Git コミット＆プッシュまでを一連の流れとして毎回行う。

1. `npx tsc --noEmit`（フロントエンド変更時）/ `go build`（バックエンド変更時）でコンパイルエラーがないことを確認
2. フロントエンド変更時: `cd frontend && npm run build` → `rm -rf ../backend/cmd/server/static && cp -r dist ../backend/cmd/server/static`
3. `find backend/cmd/server/static -name $'Icon\r' -delete` — macOS ゴミファイル削除
4. `bash /tmp/dolt-e2e-test.sh` — 58/58 PASS
5. `bash /tmp/dolt-e2e-extended.sh` — 52/52 PASS
6. macOS バイナリビルド: `cd backend && go build -o ../dist/dolt-web-ui ./cmd/server`
7. Linux バイナリビルド: `cd backend && GOOS=linux GOARCH=amd64 go build -o ../dist/dolt-web-ui-linux-amd64 ./cmd/server`
8. `git add -f dist/dolt-web-ui dist/dolt-web-ui-linux-amd64` + ソース変更をステージング
9. コミット・プッシュ（`git commit` → `git push origin master`）
