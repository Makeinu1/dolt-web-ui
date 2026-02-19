# Dolt Web UI

PSXデータ変更管理ワークベンチ。Dolt（Git風バージョン管理付きSQLデータベース）のWeb UIです。スプレッドシート風の編集操作と、厳格な変更管理・承認ワークフロー、バージョン比較、レコード履歴を提供します。

## 特徴

- **単一バイナリ配布** - Go `embed`パッケージでフロントエンドを埋め込み。ラボ環境にGo/Node.jsの追加インストール不要
- **スプレッドシート風テーブル編集** - AG Gridによるセル直接編集、ページング、カラム表示切替
- **右クリックコンテキストメニュー** - Clone Row（PK自動採番）/ Show History / Set as Template
- **Git風バージョン管理** - ブランチ作成・削除、コミット、Sync（main→ワークブランチマージ）
- **並行マージ** - Doltのセルレベル3-wayマージにより、複数プロジェクトが同時進行可能
- **承認ワークフロー** - 申請（Submit）→ 承認（Approve）/ 却下（Reject）の変更管理フロー
  - 承認時にワークブランチの変更内容をプレビュー（three-dot diff）
  - 承認後は次ラウンドブランチ（`wi/foo/01` → `wi/foo/02`）を自動作成
- **コンフリクト解決** - Sync時のマージ競合をUI上でOurs/Theirsで解決
- **バージョン比較** - `merged/*` タグをバージョンとして選択し、DB全体の変更サマリーを確認
- **レコード履歴** - 任意のレコードの変更タイムラインを右クリックから参照
- **一括操作** - バッチ生成、TSV一括更新
- **Optimistic Locking** - 全書き込み操作で`expected_head`を検証し、同時編集を安全に制御
- **MainGuard** - mainブランチは読み取り専用。書き込みはワークブランチのみ
- **ドラフト管理** - 未コミットの変更をsessionStorageで管理（揮発性）
- **状態マシン** - UI状態を厳密に管理（Idle / DraftEditing / Committing / Syncing / Conflicts系 / StaleHead）

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Backend | Go 1.22+ / chi router |
| Frontend | React 19 + TypeScript + Vite 7 |
| データグリッド | AG Grid Community 35 |
| 状態管理 | Zustand 5 |
| DB | Dolt SQL Server（MySQL互換プロトコル） |

## 画面構成

### レイアウト

```
┌────────────────────────────────────────────────────────────┐
│ Header: [状態バッジ] Target/DB/Branch  HEAD:xxx  [📋 N]    │  ~36px
├────────────────────────────────────────────────────────────┤
│ Tab: Work | History | Requests                             │  ~32px
├────────────────────────────────────────────────────────────┤
│ Toolbar: [Table ▼ ●] [Columns] [◀ 1/5 ▶]                  │  ~32px
│          [Sync] [Commit(N)] [Submit] [Refresh]              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│              AG Grid (テーブル 全幅)                         │  flex:1
│              右クリック → コンテキストメニュー                 │
│              ⚠ コンフリクトバナー（存在時のみ）               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**ヘッダー右端**: `[📋 N]` は承認待ちバッジ。クリックで Requests タブに切替。

### タブ

| タブ | 対象ロール | 機能 |
|------|-----------|------|
| **Work** | 作業者 | テーブルデータの閲覧・直接編集 |
| **History** | 全員 | バージョン間の変更サマリー比較 |
| **Requests** | 承認者 | 承認リクエスト一覧・承認/却下・diff プレビュー |

コンフリクトは Work タブ内のインラインアラートとして表示（コンフリクト発生時のみ）。

### Work タブの詳細

| 要素 | 機能 |
|------|------|
| **テーブル選択** | ドロップダウンでテーブルを切替。ドラフト変更があるテーブルは ● 表示 |
| **Columns** | カラム表示/非表示の切替（PKカラムは常に表示） |
| **AG Grid** | セル直接編集、ページング。PKカラムは編集不可 |
| **右クリックメニュー** | Clone Row（PK自動採番）/ Show History（変更タイムライン）/ Set as Template |
| **コンフリクトアラート** | Sync後にコンフリクトがある場合のみ表示。クリックで解決UIに遷移 |

### History タブ

- `merged/*` タグをバージョンとして選択（例: `merged/ProjectA/01`）
- 2バージョン間のDB全テーブル変更サマリーを表示（追加/変更/削除行数）
- テーブル選択で行レベルの差分に ドリルダウン

### Requests タブ（承認者ビュー）

- 承認待ちリクエスト一覧
- 各リクエストのワークブランチ変更内容（three-dot diff）をプレビュー
- Approve（mainに3-wayマージ）/ Reject（reqタグ削除、ブランチ保持）

### ツールバー（ワークブランチのみ）

| ボタン | 機能 | 条件 |
|--------|------|------|
| **Sync from Main** | mainの最新変更をマージ | ドラフト空 & Idle状態 |
| **Commit** | ドラフトの変更をコミット | ドラフトあり & Idle/DraftEditing |
| **Submit Request** | 承認リクエスト送信（diffプレビュー付き） | ドラフト空 & Idle状態 |
| **Refresh** | HEAD再取得 | 常時 |

## セットアップ

### 前提条件

- **開発環境**: Go 1.22+, Node.js 18+
- **対象DB**: Dolt SQL Server（MySQL互換、ポート3306）

### ビルド

```bash
# macOS / Linux 用ビルド
make build

# Linux amd64 クロスコンパイル（ラボ環境配備用）
make build-linux
```

ビルドパイプライン: `build-frontend` → `copy-static` → `build-backend`

### 設定ファイル

`config.example.yaml` をコピーして `config.yaml` を作成:

```yaml
targets:
  - id: lab
    host: "192.168.x.x"
    port: 3306
    user: "root"
    password: ""

databases:
  - target_id: lab
    name: your_database
    allowed_branches:
      - "main"
      - "wi/*"

server:
  port: 8080
  cors_origin: "*"
```

### 起動

```bash
# 本番（単一バイナリ）
./dolt-web-ui -config config.yaml

# 開発モード（バックエンド）
cd backend && go run ./cmd/server -config ../config.yaml

# 開発モード（フロントエンド）
cd frontend && npm run dev
```

ブラウザで `http://localhost:8080`（本番）または `http://localhost:5173`（開発）を開きます。

## 使い方

### 1. コンテキストの選択

画面上部のセレクターで **Target** → **Database** → **Branch** の順に選択します。

### 2. ワークブランチの作成

Branchセレクター横の **+ New** ボタンをクリックし、ブランチ名を入力して **Create** を押します。mainブランチから新しいワークブランチが作成され、自動的にそのブランチに切り替わります。

> **ブランチ命名規則**: `wi/<作業項目名>/<ラウンド番号>` 形式（例: `wi/psx-update/01`）。`config.yaml` の `allowed_branches` パターンに一致する必要があります。

### 3. データの編集

1. ワークブランチを選択（mainブランチでは編集不可）
2. **Work** タブでテーブルのセルをダブルクリックして直接編集
3. PKカラムは編集不可（データの整合性を保護）
4. 変更はブラウザのsessionStorageに「ドラフト」として保存されます

#### 右クリックメニュー

セルを右クリックすると以下の操作が可能です:

| メニュー項目 | 機能 |
|-------------|------|
| **Show History** | そのレコードの変更タイムライン（最大30件）を表示。変更セルを黄色ハイライトし old→new を表示 |
| **Clone Row** | 行を複製（PK自動採番）。ドラフトに insert 操作として追加 |
| **Set as Template** | バッチ生成のテンプレート行に設定 |

> Show History は main ブランチ・ワークブランチ両方で使用可能です。

#### 一括操作

- **Batch Generate**: テンプレート行から複数行を一括生成（特定カラムの値を変えて）
- **Bulk Update**: TSV形式のデータを貼り付けて一括更新プレビュー

### 4. コミット

1. ツールバーの **Commit** ボタンをクリック
2. コミットダイアログで変更内容を確認してメッセージを入力
3. Doltにコミットが記録され、ドラフトがクリアされます

### 5. Sync（mainからの更新取り込み）

1. ドラフトが空であることを確認（未コミットの変更があるとSyncできません）
2. ツールバーの **Sync** をクリック
3. mainブランチの最新変更がワークブランチにマージされます
4. コンフリクトが発生した場合は Work タブ内のアラートから解決UIを開く

### 6. 承認リクエスト（Submit → Approve）

1. 全ての変更をコミットし、ドラフトが空の状態で **Submit** をクリック
2. Submit ダイアログで「mainに反映される変更」（three-dot diff）を確認
3. 概要（summary_ja）を入力して送信
4. 承認者は **Requests** タブでリクエストを確認
5. diff プレビューを確認し、**Approve & Merge** でmainに3-wayマージ
6. 承認後、次ラウンドブランチ（例: `wi/work/02`）が自動作成される

### 7. バージョン比較（History タブ）

1. **History** タブを開く
2. 比較したい2つのバージョン（`merged/*` タグ）を選択して **Compare**
3. DB全テーブルの変更サマリーを確認
4. テーブルを選択して行レベルのdiffにドリルダウン

## 変更管理フロー全体図

```
Main (read-only / SSOT)
  │
  ├── wi/ProjectA/01 (担当者A)
  │     ├── セル編集 / Clone Row / Batch Generate / Bulk Update
  │     │     └── ドラフト (sessionStorage)
  │     ├── Commit → Doltコミット
  │     ├── Sync from Main → 3-wayマージ（コンフリクト時は解決）
  │     └── Submit Request → 承認待ち (req/ProjectA/01 タグ)
  │           ├── Approve → main に 3-wayマージ
  │           │     ├── merged/ProjectA/01 タグ作成（監査ログ）
  │           │     ├── wi/ProjectA/01 削除
  │           │     └── wi/ProjectA/02 自動作成（次ラウンド）
  │           └── Reject → reqタグ削除のみ（ブランチ保持・再Submit可能）
  │
  ├── wi/ProjectB/01 (担当者B) ← 並行して進行可能
  │     └── ... → Approve → main に 3-wayマージ（freeze gate なし）
  │
  └── merged/* タグ → History タブでバージョン比較
```

**Doltのセルレベル3-wayマージ**: 異なるプロジェクトが同一テーブルの異なるレコード（または同一レコードの異なるカラム）を編集した場合は自動マージ。同一セルの競合のみ `MERGE_CONFLICTS_PRESENT` エラーとなります。

## UI 状態マシン

| 状態 | 表示 | 説明 |
|------|------|------|
| `Idle` | Ready | 初期状態。全操作可能 |
| `DraftEditing` | Draft | 未コミットの変更あり |
| `Committing` | Committing... | コミット処理中 |
| `Syncing` | Syncing... | Sync処理中 |
| `MergeConflictsPresent` | Conflicts | データ行のマージ競合あり |
| `SchemaConflictDetected` | Schema Conflict (CLI) | スキーマ競合（CLI介入必要） |
| `ConstraintViolationDetected` | Constraint Violation (CLI) | 制約違反（CLI介入必要） |
| `StaleHeadDetected` | Stale HEAD | HEADが古い。Refresh必要 |

## プロジェクト構成

```
dolt-web-ui/
├── backend/
│   ├── cmd/server/          # エントリポイント + 埋め込み静的ファイル
│   │   ├── main.go
│   │   └── static/          # フロントエンドビルド成果物 (go:embed)
│   └── internal/
│       ├── config/           # YAML設定読み込み
│       ├── handler/          # HTTP ハンドラ (chi router)
│       ├── model/            # リクエスト/レスポンス型定義
│       ├── repository/       # Dolt DB接続管理 (MaxIdleConns=0)
│       ├── service/          # ビジネスロジック
│       └── validation/       # 入力バリデーション
├── frontend/
│   ├── src/
│   │   ├── api/              # APIクライアント
│   │   ├── components/
│   │   │   ├── BatchGenerateModal/  # バッチ生成モーダル
│   │   │   ├── CLIRunbook/          # CLI介入ガイド（致命的エラー時）
│   │   │   ├── ConflictView/        # コンフリクト解決UI
│   │   │   ├── ContextSelector/     # Target/DB/Branch セレクター
│   │   │   ├── HistoryTab/          # バージョン比較タブ
│   │   │   ├── RequestDialog/       # Submit/Approve/Reject ダイアログ
│   │   │   ├── TableGrid/           # AG Grid + 右クリックメニュー
│   │   │   ├── TemplatePanel/       # テンプレート行パネル
│   │   │   └── common/
│   │   │       ├── CommitDialog.tsx       # コミットダイアログ
│   │   │       └── RecordHistoryPopup.tsx # レコード変更タイムライン
│   │   ├── store/            # Zustand ストア (4個)
│   │   │   ├── context.ts    # Target/DB/Branch 選択状態
│   │   │   ├── draft.ts      # 未コミット操作 (sessionStorage)
│   │   │   ├── template.ts   # テンプレート行状態
│   │   │   └── ui.ts         # UI状態マシン
│   │   └── types/            # 型定義
│   └── package.json
├── config.example.yaml
├── config.yaml               # ローカル設定 (.gitignore)
└── Makefile
```

## API一覧（30エンドポイント）

### メタデータ
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/targets` | ターゲット一覧 |
| GET | `/api/v1/databases` | データベース一覧 |
| GET | `/api/v1/branches` | ブランチ一覧 |
| POST | `/api/v1/branches/create` | ブランチ作成（mainから） |
| POST | `/api/v1/branches/delete` | ブランチ削除 |
| GET | `/api/v1/head` | HEADハッシュ取得 |

### テーブル操作
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/tables` | テーブル一覧 |
| GET | `/api/v1/table/schema` | テーブルスキーマ取得 |
| GET | `/api/v1/table/rows` | 行一覧（ページング・フィルタ・ソート対応） |
| GET | `/api/v1/table/row` | PK指定で単一行取得 |

### プレビュー
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/preview/clone` | 行クローンプレビュー |
| POST | `/api/v1/preview/batch_generate` | バッチ生成プレビュー |
| POST | `/api/v1/preview/bulk_update` | TSV一括更新プレビュー |

### 書き込み
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/commit` | コミット（insert/update/delete） |
| POST | `/api/v1/sync` | Sync（mainからマージ） |

### Diff / 履歴
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/diff/table` | テーブル差分（two_dot / three_dot, From/To分離済み） |
| GET | `/api/v1/diff/summary` | DB全テーブル横断の変更サマリー |
| GET | `/api/v1/versions` | `merged/*` タグをバージョン一覧として取得 |
| GET | `/api/v1/history/commits` | コミット履歴（ページング） |
| GET | `/api/v1/history/row` | 特定行の変更履歴（dolt_history） |

### コンフリクト
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/conflicts` | コンフリクトサマリ |
| GET | `/api/v1/conflicts/table` | テーブル別コンフリクト行 |
| POST | `/api/v1/conflicts/resolve` | コンフリクト解決（ours/theirs） |

### 申請 / 承認
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/request/submit` | 承認申請（req/* タグ作成） |
| GET | `/api/v1/requests` | 申請一覧 |
| GET | `/api/v1/request` | 申請詳細 |
| POST | `/api/v1/request/approve` | 承認（mainに3-wayマージ + 次ラウンドブランチ作成） |
| POST | `/api/v1/request/reject` | 却下（reqタグ削除のみ。ブランチは保持） |

### ヘルスチェック
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/health` | サービス稼働状態 |

### その他
| パス | 説明 |
|------|------|
| `/*` | SPA catch-all（フロントエンド配信） |

## テスト

```bash
make test           # 全テスト実行
make test-backend   # Go テスト (go test -race ./...)
make test-frontend  # Vitest
make lint           # リンター (go vet + tsc --noEmit)
make clean          # ビルド成果物のクリーンアップ
```

E2Eテストスクリプト（APIレベル）: `/tmp/dolt-e2e-test.sh`

## 配備（Linuxサーバー）

```bash
# macOSでクロスコンパイル
make build-linux

# サーバーにコピー
scp dist/dolt-web-ui-linux-amd64 user@server:/opt/dolt-web-ui/
scp config.yaml user@server:/opt/dolt-web-ui/

# 起動
./dolt-web-ui-linux-amd64 -config config.yaml
```

## ライセンス

Private
