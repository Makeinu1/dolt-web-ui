# Dolt Web UI

PSXデータ変更管理ワークベンチ。Dolt（Git風バージョン管理付きSQLデータベース）のWeb UIです。スプレッドシート風の編集操作と、厳格な変更管理・承認ワークフローを提供します。

## 特徴

- **単一バイナリ配布** - Go `embed`パッケージでフロントエンドを埋め込み。ラボ環境にGo/Node.jsの追加インストール不要
- **スプレッドシート風テーブル編集** - AG Gridによるセル直接編集、ページング、カラム表示切替
- **Git風バージョン管理** - ブランチ作成・削除、コミット、Sync（main→ワークブランチマージ）、Diff表示
- **承認ワークフロー** - 申請（Submit）→ 承認（Approve）/ 却下（Reject）の変更管理フロー
- **コンフリクト解決** - Sync時のマージ競合をUI上でOurs/Theirsで解決
- **一括操作** - 行コピー（Copy）、バッチ生成、TSV一括更新
- **PK検索** - プライマリキーによる行の即時検索
- **Optimistic Locking** - 全書き込み操作で`expected_head`を検証し、同時編集を安全に制御
- **MainGuard** - mainブランチは読み取り専用。書き込みはワークブランチのみ
- **ドラフト管理** - 未コミットの変更をsessionStorageで管理（揮発性）
- **状態マシン** - UI状態を厳密に管理（Idle / DraftEditing / Previewing / Committing / Syncing / Conflicts系 / StaleHead）
- **監査ログ** - 全APIリクエストのログ出力

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
┌─────────────────────────────────────────────┐
│ Header (タイトル, HEAD hash, Request badge)  │
├─────────────────────────────────────────────┤
│ ContextSelector (Target / Database / Branch) │
├─────────────────────────────────────────────┤
│ Error Banner (エラー時のみ表示)               │
├──────────┬──────────┬───────────────────────┤
│  Work    │ Conflicts│     Requests          │  ← タブバー
├──────────┴──────────┴───────────────────────┤
│                                             │
│  タブコンテンツ (下記参照)                     │
│                                             │
├─────────────────────────────────────────────┤
│ Action Bar (Sync / Commit / Submit / Refresh)│
├─────────────────────────────────────────────┤
│ Status Bar (状態バッジ, コンテキスト, ops数)   │
└─────────────────────────────────────────────┘
```

### タブ

| タブ | 機能 |
|------|------|
| **Work** | テーブルデータの閲覧・直接編集。右ドロワーで Changed / Diff を表示 |
| **Conflicts** | Sync後のマージ競合一覧と解決UI（Ours/Theirs選択） |
| **Requests** | 承認リクエスト一覧。承認者は承認・却下を実行 |

### Work タブの詳細

| 要素 | 機能 |
|------|------|
| **テーブル選択** | ドロップダウンでテーブルを切替 |
| **Columns** | カラム表示/非表示の切替（PKカラムは常に表示） |
| **PK Search** | プライマリキー値で行を即時検索 |
| **AG Grid** | セル直接編集、ページング。PKカラムは編集不可 |
| **Copy ボタン** | 各行の左端。クリックで行を複製（PK自動採番） |
| **Changed ドロワー** | 未コミットのドラフト操作一覧。個別取り消し・全破棄が可能 |
| **Diff ドロワー** | mainブランチとの差分表示（追加/削除/変更を色分け） |

### アクションバー（ワークブランチのみ）

| ボタン | 機能 | 条件 |
|--------|------|------|
| **Sync from Main** | mainの最新変更をマージ | ドラフト空 & Idle状態 |
| **Commit** | ドラフトの変更をコミット | ドラフトあり & Idle/DraftEditing |
| **Submit Request** | 承認リクエスト送信 | ドラフト空 & Idle状態 |
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

> **ブランチ命名規則**: `wi/<作業項目名>/<ラウンド番号>` 形式を推奨（例: `wi/psx-update/01`）。`config.yaml` の `allowed_branches` パターンに一致する必要があります。

### 3. データの編集

1. ワークブランチを選択（mainブランチでは編集不可）
2. **Work** タブでテーブルのセルをダブルクリックして直接編集
3. PKカラムは編集不可（データの整合性を保護）
4. 変更はブラウザのsessionStorageに「ドラフト」として保存されます

#### 行の複製（Copy）

各行の左端にある **Copy** ボタンをクリックすると、その行をテンプレートとして新しいPKで複製します。PKは自動採番されます。未コミット（ドラフト）の行にはCopyボタンは表示されません。

#### 一括操作

- **Batch Generate**: テンプレート行から複数行を一括生成（特定カラムの値を変えて）
- **Bulk Update**: TSV形式のデータを貼り付けて一括更新プレビュー

### 4. コミット

1. ツールバーの **Changed** ボタンでドロワーを開き変更内容を確認
2. **Commit** ボタンをクリック
3. コミットメッセージを入力して実行
4. Doltにコミットが記録され、ドラフトがクリアされます

### 5. Sync（mainからの更新取り込み）

1. ドラフトが空であることを確認（未コミットの変更があるとSyncできません）
2. ツールバーの **Sync from Main** をクリック
3. mainブランチの最新変更がワークブランチにマージされます
4. コンフリクトが発生した場合は **Conflicts** タブで解決

### 6. 承認リクエスト

1. 全ての変更をコミットし、ドラフトが空の状態で **Submit Request** をクリック
2. 承認者は **Requests** タブでリクエストを確認
3. **Approve** でmainにsquashマージ、**Reject** で却下

## 変更管理フロー全体図

```
main (read-only)
  │
  ├── wi/work-item/01 (work branch)
  │     │
  │     ├── セル編集 / Copy / Batch Generate / Bulk Update
  │     │     └── ドラフト (sessionStorage)
  │     │
  │     ├── Commit → Doltコミット
  │     │
  │     ├── Sync from Main → マージ（コンフリクト時は解決）
  │     │
  │     └── Submit Request → 承認待ち
  │           ├── Approve → main に squash merge
  │           └── Reject → 却下タグ作成
  │
  └── (次のラウンド: wi/work-item/02)
```

## UI 状態マシン

| 状態 | 表示 | 説明 |
|------|------|------|
| `Idle` | Ready | 初期状態。全操作可能 |
| `DraftEditing` | Draft | 未コミットの変更あり |
| `Previewing` | Previewing | プレビュー表示中 |
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
│       ├── repository/       # Dolt DB接続管理
│       ├── service/          # ビジネスロジック
│       └── validation/       # 入力バリデーション
├── frontend/
│   ├── src/
│   │   ├── api/              # APIクライアント
│   │   ├── components/       # Reactコンポーネント (11個)
│   │   │   ├── BatchGenerateModal/
│   │   │   ├── CLIRunbook/
│   │   │   ├── ChangedView/
│   │   │   ├── ConflictView/
│   │   │   ├── ContextSelector/
│   │   │   ├── DiffViewer/
│   │   │   ├── PKSearchBar/
│   │   │   ├── RequestDialog/
│   │   │   ├── TableGrid/
│   │   │   ├── TemplatePanel/
│   │   │   └── common/       # CommitDialog
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

## API一覧（28エンドポイント）

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
| GET | `/api/v1/diff/table` | テーブル差分（two_dot / three_dot） |
| GET | `/api/v1/history/commits` | コミット履歴（ページング） |
| GET | `/api/v1/history/row` | 特定行の変更履歴 |

### コンフリクト
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/conflicts` | コンフリクトサマリ |
| GET | `/api/v1/conflicts/table` | テーブル別コンフリクト行 |
| POST | `/api/v1/conflicts/resolve` | コンフリクト解決（ours/theirs） |

### 申請 / 承認
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/request/submit` | 承認申請 |
| GET | `/api/v1/requests` | 申請一覧 |
| GET | `/api/v1/request` | 申請詳細 |
| POST | `/api/v1/request/approve` | 承認（mainにsquash merge） |
| POST | `/api/v1/request/reject` | 却下（タグ作成） |

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
