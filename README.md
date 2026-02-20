# Dolt Web UI

PSXデータ変更管理ワークベンチ。Dolt（Git風バージョン管理付きSQLデータベース）のWeb UIです。スプレッドシート風の編集操作と、厳格な変更管理・承認ワークフロー、バージョン比較、レコード履歴を提供します。

## 特徴

- **単一バイナリ配布** - Go `embed`パッケージでフロントエンドを埋め込み。ラボ環境にGo/Node.jsの追加インストール不要
- **スプレッドシート風テーブル編集** - AG Gridによるセル直接編集、ページング、カラム表示切替
- **右クリックコンテキストメニュー** - Clone Row（PK自動採番）/ Batch Clone / Show History / Delete Row
- **Git風バージョン管理** - ブランチ作成・削除、コミット。Submit時にmain→ワークブランチ自動Sync
- **並行マージ** - Doltのセルレベル3-wayマージにより、複数プロジェクトが同時進行可能
- **承認ワークフロー** - 申請（Submit）→ 承認（Approve）/ 却下（Reject）の変更管理フロー
  - Submit時にmainを自動マージ（コンフリクト時は事前検出）
  - 承認時にワークブランチの変更内容をプレビュー（three-dot diff）
  - 承認後は次ラウンドブランチ（`wi/foo/01` → `wi/foo/02`）を自動作成
- **コンフリクト解決** - Sync時のマージ競合をUI上でOurs/Theirsで解決
- **バージョン比較** - `merged/*` タグをバージョンとして選択し、DB全体の変更サマリーを確認
- **レコード履歴** - 任意のレコードの変更タイムラインを右クリックから参照
- **一括操作** - バッチ生成（Batch Clone）、TSV一括更新
- **Optimistic Locking** - 全書き込み操作で`expected_head`を検証し、同時編集を安全に制御
- **MainGuard** - mainブランチは読み取り専用。書き込みはワークブランチのみ
- **ドラフト管理** - 未コミットの変更をsessionStorageで管理（揮発性）。変更済みセルを黄太字・挿入行を緑・削除行を赤で可視化
- **状態駆動アクションボタン** - 現在やるべき操作だけをヘッダーに表示

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
┌──────────────────────────────────────────────────────────┐
│ Test@prod  [wi/ProjA/01 ▼]  [Test1 ▼●]  [⚙]            │
│                                    [Commit(3)] [📋2] [⋮] │  36px
├──────────────────────────────────────────────────────────┤
│                                                          │
│                      AG Grid                             │  flex:1
│                     (全幅・全高)                           │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ◀ 1/50 ▶                                    1,000 rows  │  28px (複数ページ時のみ)
└──────────────────────────────────────────────────────────┘
```

**オーバーヘッド**: 36px（+ 28px ページネーション） = **最小 36px / 最大 64px**

### ヘッダー要素

| 要素 | 位置 | 説明 |
|------|------|------|
| `DB@Target` | 左端 | DB@Target を静的テキスト表示。クリック → 設定ダイアログ |
| `[Branch ▼]` | 左 | ブランチドロップダウン。リスト + 「新規作成」+ 「削除」を内包 |
| `[Table ▼ ●]` | 左 | テーブルセレクター。ドラフト変更ありテーブルに ● 表示 |
| `[⚙]` | 左 | カラム表示/非表示トグル（ポップアップ） |
| `[Commit(N)]` | 右 | ドラフトがある時だけ表示。状態に応じて変化（下記） |
| `[📋 N]` | 右 | 承認待ちバッジ。N>0 の時のみ表示。クリック → 承認者ビュー |
| `[⋮]` | 右端 | オーバーフローメニュー（Submit / Commit Log / Settings） |

### アクションボタン（状態駆動）

| UI状態 | ヘッダー右の表示 |
|--------|-----------------|
| Idle（ドラフトなし） | 非表示 |
| DraftEditing | **[Commit (N)]** （primary/青） |
| Committing | [Committing...] （disabled） |
| StaleHeadDetected | **[↻ Refresh]** （warning/橙） |
| MergeConflictsPresent | バナー表示（ConflictViewオーバーレイが自動表示） |

mainブランチ選択時: アクションボタン非表示。グリッドは read-only。

### [⋮] オーバーフローメニュー

| 項目 | 有効条件 |
|------|---------|
| **Submit Request...** | ドラフトなし + コミット済み + リクエストなし |
| **Compare Versions...** | 常時 |
| **Commit Log** | 常時 |
| **Settings** | 常時 |

### 右クリックメニュー

| メニュー項目 | 機能 |
|-------------|------|
| **Show History** | そのレコードの変更タイムライン（最大30件）を表示。変更セルを黄色ハイライトし old→new を表示 |
| **Clone Row** | 行を複製（PK自動採番）。ドラフトに insert 操作として追加 |
| **Batch Clone...** | バッチ生成モーダルを起動。複数行を一括生成 |
| **Delete Row** | 行を削除。ドラフトに delete 操作として追加（取消線で表示） |

> Show History は main ブランチ・ワークブランチ両方で使用可能。main ブランチでは Clone/Delete は非表示。

### ドラフト可視化

| op type | 表示スタイル |
|---------|------------|
| insert | 左 3px 緑ボーダー + 薄緑背景 |
| update | 変更カラムのみ **太字** + 薄黄背景 |
| delete | 薄赤背景 + 取消線 |

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

成果物:
- `dist/dolt-web-ui` — macOS 向け実行バイナリ
- `dist/dolt-web-ui-linux-amd64` — Linux amd64 向け実行バイナリ

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
./dist/dolt-web-ui -config config.yaml

# Linux サーバー
./dist/dolt-web-ui-linux-amd64 -config config.yaml

# 開発モード（バックエンド）
cd backend && go run ./cmd/server -config ../config.yaml

# 開発モード（フロントエンド）
cd frontend && npm run dev
```

ブラウザで `http://localhost:8080`（本番）または `http://localhost:5173`（開発）を開きます。

## 使い方

### 1. コンテキストの選択

ヘッダー左の **DB@Target** テキストをクリックして設定ダイアログを開き、**Target** と **Database** を選択します。

### 2. ワークブランチの作成

ヘッダーの **Branch ドロップダウン** をクリックし、「+ Create new branch」を選択してブランチ名を入力します。mainブランチから新しいワークブランチが作成され、自動的にそのブランチに切り替わります。

> **ブランチ命名規則**: `wi/<作業項目名>/<ラウンド番号>` 形式（例: `wi/psx-update/01`）。`config.yaml` の `allowed_branches` パターンに一致する必要があります。

### 3. データの編集

1. ワークブランチを選択（mainブランチでは編集不可）
2. テーブルセレクターでテーブルを選択。ドラフト変更あり = ●
3. セルをダブルクリックして直接編集（変更セル → 黄太字）
4. PKカラムは編集不可（データの整合性を保護）
5. 変更はブラウザのsessionStorageに「ドラフト」として保存されます

#### 右クリック操作

| 操作 | 説明 |
|------|------|
| **Clone Row** | 行を複製（PK自動採番）→ insert ドラフトに追加（緑表示） |
| **Batch Clone...** | バッチ生成モーダル起動。複数行を一括生成 |
| **Delete Row** | 行を削除予約 → delete ドラフトに追加（赤・取消線表示） |
| **Show History** | レコードの変更タイムラインを表示 |

#### 一括操作

- **Bulk Update**: TSV形式のデータを貼り付けて一括更新プレビュー（[⋮] メニューから）

### 4. コミット

1. ヘッダーの **Commit (N)** ボタンをクリック（ドラフトあり時のみ表示）
2. CommitDialog でテーブル別の変更一覧を確認（× ボタンで個別キャンセル可）
3. コミットメッセージを入力して確定
4. Doltにコミットが記録され、ドラフトがクリアされます

### 5. 承認リクエスト（Submit → Approve）

1. 全ての変更をコミット（ドラフトが空の状態）
2. **[⋮] → Submit Request...** をクリック
3. SubmitDialog 内でバックグラウンドに main を自動マージ（コンフリクト時はダイアログ内でエラー表示）
4. 「mainに反映される変更」（three-dot diff）を確認
5. 概要（summary_ja）を入力して送信
6. 承認者は **[📋]** バッジをクリックして承認者ビューを開く
7. diff プレビューを確認し、**Approve** でmainに3-wayマージ
8. 承認後、次ラウンドブランチ（例: `wi/work/02`）が自動作成される

> Sync（手動）は廃止。Submit時に自動で main → ブランチ のマージを実行します。コンフリクトが検出された場合は Submit がブロックされ、ConflictView で解決後に再試行してください。

### 6. コンフリクト解決

Syncコンフリクトや Submit 時の自動マージコンフリクトは ConflictView オーバーレイで解決:

1. コンフリクトバナーが表示される（または ConflictView が自動表示）
2. テーブルを選択し、行ごとに **Ours** / **Theirs** を選択
3. 解決後に再コミット → Submit

### 7. バージョン比較（[⋮] → Compare Versions...）

1. 比較したい2つのバージョン（`merged/*` タグ）を選択して **Compare**
2. DB全テーブルの変更サマリーを確認
3. テーブルを選択して行レベルのdiffにドリルダウン

## 変更管理フロー全体図

```
Main (read-only / SSOT)
  │
  ├── wi/ProjectA/01 (担当者A)
  │     ├── セル編集 / Clone Row / Batch Clone / Bulk Update / Delete Row
  │     │     └── ドラフト (sessionStorage)
  │     ├── Commit → Doltコミット
  │     └── Submit Request → main自動マージ → 承認待ち (req/ProjectA/01 タグ)
  │           ├── Approve → main に 3-wayマージ
  │           │     ├── merged/ProjectA/01 タグ作成（監査ログ）
  │           │     ├── wi/ProjectA/01 削除
  │           │     └── wi/ProjectA/02 自動作成（次ラウンド）
  │           └── Reject → reqタグ削除のみ（ブランチ保持・再Submit可能）
  │
  ├── wi/ProjectB/01 (担当者B) ← 並行して進行可能
  │     └── ... → Approve → main に 3-wayマージ（freeze gate なし）
  │
  └── merged/* タグ → [⋮]→Compare Versions でバージョン比較
```

**Doltのセルレベル3-wayマージ**: 異なるプロジェクトが同一テーブルの異なるレコード（または同一レコードの異なるカラム）を編集した場合は自動マージ。同一セルの競合のみ `MERGE_CONFLICTS_PRESENT` エラーとなります。

## UI 状態マシン

| 状態 | 表示 | 説明 |
|------|------|------|
| `Idle` | Ready | 初期状態。全操作可能 |
| `DraftEditing` | Draft | 未コミットの変更あり |
| `Committing` | Committing... | コミット処理中 |
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
├── dist/
│   ├── dolt-web-ui              # macOS arm64 実行バイナリ
│   └── dolt-web-ui-linux-amd64  # Linux amd64 実行バイナリ
├── frontend/
│   ├── src/
│   │   ├── api/              # APIクライアント
│   │   ├── components/
│   │   │   ├── BatchGenerateModal/  # バッチ生成モーダル
│   │   │   ├── CLIRunbook/          # CLI介入ガイド（致命的エラー時、最小化可能）
│   │   │   ├── ConflictView/        # コンフリクト解決UI
│   │   │   ├── ContextSelector/     # Branch ドロップダウン（Target/DBは設定ダイアログへ）
│   │   │   ├── HistoryTab/          # バージョン比較タブ
│   │   │   ├── RequestDialog/       # 承認者ビュー（モーダルオーバーレイ）
│   │   │   ├── TableGrid/           # AG Grid + 右クリックメニュー + ドラフト可視化
│   │   │   └── common/
│   │   │       ├── CommitDialog.tsx       # コミットダイアログ（op一覧 + 個別キャンセル）
│   │   │       ├── DiffTableDetail.tsx    # テーブル差分詳細
│   │   │       └── RecordHistoryPopup.tsx # レコード変更タイムライン
│   │   ├── store/            # Zustand ストア (3個)
│   │   │   ├── context.ts    # Target/DB/Branch 選択状態
│   │   │   ├── draft.ts      # 未コミット操作 (sessionStorage)
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
| POST | `/api/v1/sync` | Sync（mainからマージ、手動用途） |

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
| GET | `/api/v1/conflicts` | コンフリクトサマリ（data_conflicts / schema_conflicts） |
| GET | `/api/v1/conflicts/table` | テーブル別コンフリクト行（base/ours/theirs） |
| POST | `/api/v1/conflicts/resolve` | コンフリクト解決（ours/theirs） |

### 申請 / 承認
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/request/submit` | 承認申請（mainへの自動Sync → req/* タグ作成） |
| GET | `/api/v1/requests` | 申請一覧 |
| GET | `/api/v1/request` | 申請詳細 |
| POST | `/api/v1/request/approve` | 承認（mainに3-wayマージ + 次ラウンドブランチ作成） |
| POST | `/api/v1/request/reject` | 却下（reqタグ削除のみ。ブランチは保持） |

### ヘルスチェック
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/health` | サービス稼働状態（`/api/v1` プレフィックスなし） |

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

### E2Eテスト（APIレベル）

```bash
# 基本 58 チェック（INSERT/UPDATE/Sync/Submit/Approve/Cell-level merge）
bash /tmp/dolt-e2e-test.sh

# 拡張 52 チェック（DELETE/DiffSummary/RowHistory/Filter/Conflict/EdgeCase）
bash /tmp/dolt-e2e-extended.sh
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
