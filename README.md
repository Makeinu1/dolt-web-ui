# Dolt Web UI

PSXデータ変更管理ワークベンチ。Dolt（Git風バージョン管理付きSQLデータベース）のWeb UIです。スプレッドシート風の編集操作と、厳格な変更管理・承認ワークフロー、バージョン比較、レコード履歴を提供します。

## プロダクト原則

このプロダクトの中心は「高機能な DB 編集 UI」ではなく、**業務ユーザが安全に変更を進め、詰んでも自力で復旧できる作業台**です。

- `main` / `audit` は常に信頼できる状態を保つ
- work item は stable な名前で再発見できる
- 成功・失敗・要再試行が UI で明確に分かる
- 高度機能は残してよいが、通常導線を汚さない

詳細は [docs/product-principles.md](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/docs/product-principles.md) を参照してください。

## 特徴

- **単一バイナリ配布** - Go `embed`パッケージでフロントエンドを埋め込み。ラボ環境にGo/Node.jsの追加インストール不要
- **スプレッドシート風テーブル編集** - AG Gridによるセル直接編集、ページング、カラム表示切替
- **カラム表示設定の永続化** - 列の非表示設定を localStorage に保存（テーブル×DB×ターゲット単位）。リロードしても設定を維持
- **行アクションツールバー** - 選択行に応じてコピー / 一括置換 / 履歴 / 他DBコピー / 削除を直接表示。AG Grid Community 構成でも hidden error を出さずに使える導線に統一
  - **フィルタ全件操作の対象補完** - `全件コピー / 全件一括置換 / 全件削除` は最大 1,000 件を上限にしつつ、ドラフト更新で先頭側の行が filter / sort の対象外へ落ちた場合でも、後続ページを backfill して「ドラフト反映後の先頭 1,000 件」を対象に再計算
- **Git風バージョン管理** - ブランチ作成・削除、コミット（日本語UI）。Submit時にmainをワークブランチへ自動マージして申請内容を固定
- **並行マージ** - Doltのセルレベル3-wayマージにより、複数プロジェクトが同時進行可能
- **承認ワークフロー** - 申請（Submit）→ 承認（Approve）/ 却下（Reject）の変更管理フロー
  - Submit時にmainを自動マージ（コンフリクト時は事前検出）
  - 承認時にワークブランチの変更内容をプレビュー（three-dot diff）
  - 承認後は同じワークブランチ（`wi/foo`）を main 最新位置に揃え、同じ名前で次の修正を継続
  - 承認履歴の正は main merge commit の approval footer。`merged/*` は補助インデックス
  - **承認待ちバッジ自動取得** - 起動時・コンテキスト切替時に件数を自動チェック（`📋 N` 表示）
- **ブランチロック** - Submit中（`req/*` タグ存在中）のブランチはコミットや branch delete などの編集系操作を自動ブロック（HTTP 423 `BRANCH_LOCKED`）。却下されるとロック解除
- **競合時の復旧導線** - Submit前のmain取り込みで上書きが発生したテーブルは ConflictView で通知。スキーマ競合 / 制約違反は CLIRunbook に切り替えて CLI 解決手順を提示
- **行比較モード** - グリッド上でチェックボックス選択した行を A群としてスナップショットし、別の行を B群として選択→「比較実行」で横並びグリッドモーダルを表示。差分カラムは🔴ヘッダー＋背景色ハイライト。「差分列のみ表示」「差分ペアのみ表示」フィルタ付き。CSV ダウンロード対応
- **バージョン比較** - From / To でブランチとバージョン（HEAD または特定コミット）を選択し、DB全体の変更サマリーを確認
  - **差分ZIP一括エクスポート** - DiffSummary 画面から全テーブルの変更を操作種別（insert/update/delete）ごとにCSVファイル化してZIPダウンロード
- **マージログ（拡張版）** - mainブランチへの全マージを時系列一覧で可視化
  - **ブランチ名バッジ** - 各マージ行に `🔀 wi/xxx` バッジでマージ元ブランチを明示
  - **2バージョン間比較** - ☑チェックボックスで任意の2件を選択し「🔍 比較」ボタンでテーブル別変更数を一覧化。テーブル行クリックで行レベル差分を展開
  - **過去バージョン閲覧** - 「📋 閲覧」ボタンで選択コミット時点のデータをグリッドに表示（読み取り専用）。セルメモも同コミット時点のものを参照。黄色バナーで閲覧中を明示し「✕ 現在に戻る」で即座に復帰
- **コミット履歴フィルタ** - mainブランチは承認マージ単位、ワークブランチは手動コミット単位でフィルタ表示
- **レコード履歴** - 任意のレコードの変更タイムラインを選択ツールバーから参照
- **セル単位メモ（作業ノート）** - セルごとに 1 件の memo を保持。変更理由・コピー元・要件IDなどを残し、値検索に加えて memo も横断検索可能。memo ありセルは右上に amber の三角マーカーで可視化
- **Optimistic Locking** - 全書き込み操作で`expected_head`を検証し、同時編集を安全に制御
- **ProtectedBranchGuard** - `main` ブランチおよび `audit` ブランチは読み取り専用。書き込みはワークブランチのみ
- **ドラフト管理** - 未コミットの変更をsessionStorageで管理（揮発性）。変更済みセルを黄太字・挿入行を緑・削除行を赤で可視化
  - **ドラフト更新マージ** - 同一行への連続した update は自動的に1つの操作に統合（ドラフト肥大化防止）
  - **コンテキスト復元** - Target / DB / Branch 選択も sessionStorage に保持し、reload 後も同じグリッドと draft-only 表示に戻れる
  - **行 Undo（⟲ 元に戻す）** - 選択行の最新ドラフト操作を個別に取り消し
  - **変更をクリア** - ヘッダーの「変更をクリア」ボタンで全ドラフトを一括破棄
  - **ドラフトSQLエクスポート** - StaleHead検出時に未保存ドラフトを `.sql` ファイルとしてダウンロード退避
- **テーブル変更件数インジケータ** - テーブルセレクタにドラフト変更の内訳を表示（例: `Test1 (+2 ~1 -0)`）
- **状態駆動アクションボタン** - 現在やるべき操作だけをヘッダーに表示
- **高機能を visible のまま安全化** - cross-DB copy / CSV / bulk replace / deep history も日常的に使える前提で、到達性は保ちつつ復旧可能性と完了の明確さを優先
- **接続プール最適化** - リード操作はステートレス revision specifier（`USE \`db/branch\``）でプール再利用、ライト操作は専用の `ConnWrite`（`DOLT_CHECKOUT` ベース）を使用
- **永続的エラー撲滅（Auto-Healing + Escape Hatch）**
  - **Safe Storage** - localStorage/sessionStorage の読み書きを安全ラッパー（`safeStorage.ts`）で統一。JSON破損時は自動クリア＆デフォルト復帰
  - **復旧付き再読み込み** - エラーバナーと ErrorBoundary にだけ「復旧付き再読み込み」を表示。押下時だけ draft を破棄して one-shot cleanup 後に reload し、壊れた local state / modal / branch 表示を持ち越さない
  - **マージ中止ボタン** - スキーマコンフリクト等でスタックしたマージ状態を、CLIRunbook 画面の「💥 マージを中止」ボタンから `DOLT_MERGE('--abort')` を実行して安全に離脱
  - **タグ削除リトライ** - 承認（Approve）処理でのリクエストタグ削除を最大3回リトライ。瞬断による孤立ロックを事実上ゼロに
  - **接続寿命管理** - `ConnMaxLifetime` を無期限→1時間に設定。Doltサーバー再起動後の全面接続エラーを防止

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Backend | Go 1.22+ / chi router |
| Frontend | React 19 + TypeScript + Vite 7 |
| データグリッド | AG Grid Community 35 |
| 状態管理 | Zustand 5 |
| DB | Dolt SQL Server（MySQL互換プロトコル） |
| E2Eテスト | Playwright（APIモック方式） |

## 画面構成

### レイアウト

```
┌──────────────────────────────────────────────────────────┐
│ Test@prod  [wi/ProjA ▼] [+]  [Test1 ▼]  [⚙]            │
│                  [変更をクリア] [Commit(3)] [📋2] [💬] [⋮] │  36px
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
| `[Branch ▼]` | 左 | ブランチドロップダウン。リスト + 「削除」を内包 |
| `[+]` | 左 | ブランチ作成ボタン。クリック → Work Item 名入力のインラインフォーム展開 |
| `[Table ▼]` | 左 | テーブルセレクター。ドラフト変更ありテーブルは `Test1 (+2 ~1)` のように内訳表示 |
| `[⚙]` | 左 | カラム表示/非表示トグル（ポップアップ）。設定は localStorage に永続保存 |
| `[💬]` | 左 | セルを選択中にアクティブ化。クリックでセルメモパネルを開く |
| `[変更をクリア]` | 右 | ドラフトがある時だけ表示。全ドラフトを一括破棄（確認ダイアログ付き） |
| `[Commit(N)]` | 右 | ドラフトがある時だけ表示。状態に応じて変化（下記） |
| `[📋 N]` | 右 | 承認待ちバッジ。起動時・コンテキスト切替時に自動取得。N>0 の時のみ表示。クリック → 承認者ビュー |
| `[⋮]` | 右端 | オーバーフローメニュー |

### アクションボタン（状態駆動）

| UI状態 | ヘッダー右の表示 |
|--------|-----------------|
| Idle（ドラフトなし） | 非表示 |
| DraftEditing | **[変更をクリア]** + **[Commit (N)]** （primary/青） |
| Committing | [Committing...] （disabled） |
| StaleHeadDetected | **[↻ 更新して同期]** （warning/橙） + エラーバナー内の **[復旧付き再読み込み]** |
| SchemaConflictDetected / ConstraintViolationDetected | CLI Runbook オーバーレイ + `💥 マージを中止` |

mainブランチ選択時: アクションボタン非表示。グリッドは read-only。

> Submit前のmain取り込みで上書きが発生した場合は、状態遷移とは別に ConflictView が一時表示されます。

### [⋮] オーバーフローメニュー

| 項目 | 有効条件 |
|------|---------|
| **📤 承認を申請** | ドラフトなし + コミット済み + リクエストなし |
| **🔍 テーブル検索** | 常時 |
| **🗑 ブランチを削除** | work branch 選択中 |
| **📊 バージョン比較...** | 常時 |
| **📋 マージログ** | 常時 |
| **📥 CSVインポート** | work branch かつテーブル選択中 |
| **他DBへテーブルコピー** | protected branch かつテーブル選択中 |

> `Admin / escape hatch` 系の導線は [⋮] には常設しません。`復旧付き再読み込み` は error 時のみ、CLI runbook は blocking state 時のみ表示します。

### 行アクション導線

AG Grid Community 構成では enterprise-only の右クリック専用メニューは使わず、行を選択したときのツールバーに行アクションを集約します。これにより hidden console error を残さず、コピー / 一括置換 / 履歴 / 他DBコピー / 削除を同じ導線で扱えます。

### ツールバー（行選択時）

行をクリックすると AG Grid 上部にツールバーが表示されます:

| ボタン | 機能 |
|--------|------|
| **コピー** | 行をコピー |
| **削除** | 行を削除 |
| **⟲ 元に戻す** | この行の最新ドラフト操作を取り消し（ドラフト操作がある行のみ表示） |
| **比較 (N)** | 非ドラフト行選択中かつPK有り時に表示。クリックで A群スナップショット→比較モード入り |
| **一括置換 / 履歴 / 他DBコピー / フィルタ全件操作** | 選択状態や filter 条件に応じて直接表示 |

`フィルタ全件操作` は AG Grid の現在 filter / sort と draft overlay を合成した結果を基準に判定します。対象件数が 1,000 件を超える場合は先頭 1,000 件に制限されますが、先頭ページの行が draft update / delete によって対象外へ移動したときは、そのぶん後続ページから未変更行を補完して 1,000 件を維持します。

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
      - "audit"
      - "wi/*"

server:
  port: 8080
  cors_origin: "*"
  body_limit_mb: 10       # リクエストボディ上限 (MB)
  timeouts:
    read_sec: 30          # HTTP read タイムアウト
    write_sec: 300        # HTTP write タイムアウト (DOLT_MERGE 等の重い操作向け)
    idle_sec: 120         # HTTP idle タイムアウト
  recovery:
    branch_ready_sec: 10      # branch 作成/再利用後に queryable になるまで待つ上限
    branch_ready_poll_ms: 500 # readiness poll 間隔
  retries:
    tag_retry_attempts: 3     # req/merged tag 後処理の再試行回数
    tag_retry_delay_ms: 500   # tag retry 間隔
  search:
    timeout_sec: 5            # 全文検索の time budget
  pool:
    max_open: 20              # DB pool max open
    max_idle: 10              # DB pool max idle
    conn_lifetime_sec: 3600   # DB connection lifetime
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

巨大な DB で branch 作成直後に `BRANCH_NOT_READY` が出る場合は、`server.recovery.branch_ready_sec` を伸ばして調整できます。  
frontend は `GET /api/v1/branches/ready` を poll してから branch を開くため、409 が返っても UI は壊れず復帰できます。

## 使い方

### 1. コンテキストの選択

ヘッダー左の **DB@Target** テキストをクリックして設定ダイアログを開き、**Target** と **Database** を選択します。

### 2. ワークブランチの作成

ブランチドロップダウン横の **`+` ボタン**をクリックすると、インラインフォームが展開されます。**Work Item 名**（例: `psx-update`）を入力すると、プレビューに `wi/psx-update` が表示されます。**Create** ボタンをクリックするとブランチが作成され、自動的にそのブランチに切り替わります。

> **ブランチ命名規則**: `wi/<作業項目名>` 形式。1 Work Item につきアクティブなワークブランチは 1 本です。`config.yaml` の `allowed_branches` パターンに一致する必要があります。

### 3. データの編集

1. ワークブランチを選択（main / audit ブランチでは編集不可）
2. テーブルセレクターでテーブルを選択。ドラフト変更ありテーブルは件数表示（例: `Test1 (+2 ~1)`）
3. セルをダブルクリックして直接編集（変更セル → 黄太字）
4. PKカラムは編集不可（データの整合性を保護）
5. 変更はブラウザのsessionStorageに「ドラフト」として保存されます

#### 右クリック操作

| 操作 | 説明 |
|------|------|
| **行をコピー（PK自動採番）** | 行を複製 → insert ドラフトに追加（緑表示） |
| **一括コピー...** | バッチ生成モーダル起動。複数行を一括生成 |
| **行を削除** | 行を削除予約 → delete ドラフトに追加（赤・取消線表示） |
| **履歴を表示** | レコードの変更タイムラインを表示 |

### 4. コミット

1. ヘッダーの **Commit (N)** ボタンをクリック（ドラフトあり時のみ表示）
2. **変更をコミット** ダイアログでテーブル別の変更一覧を確認（× ボタンで個別キャンセル可）
3. コミットメッセージを入力して確定（空の場合は `[自動保存] {テーブル名}テーブルの変更 ({N}件)` が自動生成）
4. Doltにコミットが記録され、ドラフトがクリアされます

### 5. 承認リクエスト（Submit → Approve）

1. 全ての変更をコミット（ドラフトが空の状態）
2. **[⋮] → 📤 承認を申請** をクリック
3. SubmitDialog 内でバックグラウンドに main を自動マージし、申請対象の head を固定
4. データ競合があった場合は main 優先で自動解決し、上書きされた可能性があるテーブルだけを後続の ConflictView で通知
5. スキーマ競合 / 制約違反がある場合は Submit を止め、CLIRunbook に切り替える
6. 「mainに反映される変更」（three-dot diff）を確認
7. 概要（summary_ja）を入力して送信
8. 承認者は **[📋]** バッジをクリックして承認者ビューを開く
9. diff プレビューを確認し、**Approve & Merge** でmainに `--no-ff` 3-wayマージ
10. main の merge commit には machine-readable な approval footer を付与し、`merged/*` は補助インデックスとして残す
11. 承認後、同じワークブランチ（例: `wi/work`）が main 最新位置に揃えられ、そのまま次の修正を続けられる

> Submit後のブランチはロック状態になり、コミットなどの編集系操作は `BRANCH_LOCKED` で止まります。却下（Reject）でロック解除されます。

### 6. 競合と復旧

Submit 前の main 取り込みで差分がぶつかった場合の挙動:

1. データ行の競合は main 優先で自動解決されます
2. 上書きされた可能性があるテーブルは ConflictView に一覧表示されます
3. 必要なら同じワークブランチ上で再編集し、再コミットしてから再度 Submit します

Web UI で止まるケース:

1. `SCHEMA_CONFLICTS_PRESENT` または `CONSTRAINT_VIOLATIONS_PRESENT` になると CLIRunbook を表示します
2. 画面内の SQL 手順で診断し、必要なら `CALL DOLT_MERGE('--abort')` でマージを中止します
3. 解決後に **Refresh & Check** を押すと UI を通常状態へ戻せます

> Approve 時に same-cell merge conflict が残る場合は `MERGE_CONFLICTS_PRESENT` として fail し、管理者 / CLI での対応が必要です。

### 7. セル単位メモ（作業ノート）

セルメモは **変更理由・参照元・要件 ID** など、値だけでは伝わらない文脈を 1 セル 1 件で保持するための機能です。

#### メモの追加・閲覧

1. committed row 上のセルをクリックして選択します
2. ヘッダーの **💬** ボタンをクリックします（未選択、draft insert/delete 行、PK 変更予定行では disabled）
3. 右側のメモパネルで現在の memo を確認し、必要なら編集します
4. **下書きに追加**（または Ctrl+Enter）で `_memo_<table>` 向けの draft operation を作成します
5. 通常の Commit でデータ変更と同じトランザクションに含めて保存します

> main / audit / 過去バージョン閲覧では常に read-only です。過去バージョン閲覧中の memo パネルは、現在ブランチではなく表示中コミットの memo を参照します。
>
> memo は **1 セル 1 件** です。同じセルで再保存すると追記ではなく上書きになります。

#### セルマーカー

memo が存在するセルは右上に **amber の三角マーカー**（▲）が表示されます。追加・削除後は自動的に更新されます。

#### 検索とジャンプ

1. ヘッダーの **[⋮] → 🔍 テーブル検索** をクリック
2. 検索対象テーブルは初期状態で全選択です。重いテーブルを外したいときはここで解除します
3. キーワードを入力し、必要なら **メモも検索する** を ON にして検索します
4. 結果一覧から行をクリックすると該当テーブルへ移動し、対象行にジャンプします

#### メモとバージョン管理

- メモはブランチ上の hidden table `_memo_<table>` に保存されます
- Submit → Approve でメモも main にマージされます
- 行削除時はその行に紐づくメモも自動削除されます
- hidden memo table が未作成のときだけ空として扱い、それ以外の memo 読み取りエラーは fail-loud で表示されます
- 検索は通常セル値に加えて memo も対象にできます

### 8. バージョン比較（[⋮] → 📊 バージョン比較...）

1. From / To それぞれでブランチとバージョン（HEAD または特定のコミット）を選択して **比較する**
2. DB全テーブルの変更サマリー（追加/更新/削除の件数）を確認
3. テーブルを選択して行レベルのdiffにドリルダウン（AG Gridフルスクリーン DiffGrid で表示）
4. **📥 ZIP** ボタンで全テーブルの変更を操作種別ごとにCSVまとめてダウンロード
   - `{テーブル名}_insert.csv` / `{テーブル名}_update.csv` / `{テーブル名}_delete.csv`
   - Update CSVには変更後の値のみ（旧値は含まない）

### 9. テーブル検索とマージログ

#### テーブル検索

1. **[⋮] → 🔍 テーブル検索** を開きます
2. 検索対象テーブルは全選択で始まります。必要に応じてチェックを外して対象を絞ります
3. キーワードを入力して検索します。必要なら **メモも検索する** を ON にします
4. 結果をクリックすると該当テーブルに切り替わり、対象行へジャンプします
5. backend が integrity failure を返した場合は partial result を表示せず、そのままエラーとして扱います

#### マージログ

1. **[⋮] → 📋 マージログ** を開きます
2. main の承認マージを approval footer 優先で一覧表示します
3. 任意の 2 件を選んで比較するか、過去コミットを閲覧モードで開けます

## 変更管理フロー全体図

```
Main (read-only / SSOT)
  │
  ├── wi/ProjectA (担当者A)
  │     ├── セル編集 / 行をコピー / 一括コピー / 行を削除
  │     │     └── ドラフト (sessionStorage)
  │     ├── Commit → Doltコミット
  │     └── Submit Request → main自動マージ → 承認待ち (req/ProjectA タグ)
  │           │     ├── データ競合は main 優先で自動解決
  │           │     ├── 上書きテーブルは ConflictView で通知
  │           │     └── ブランチロック（Commit / CSV / cross-copy / branch delete などをブロック）
  │           ├── Approve → main に no-ff 3-wayマージ
  │           │     ├── main merge commit に approval footer を付与（監査ログの正）
  │           │     ├── merged/ProjectA/01 タグ作成（補助インデックス）
  │           │     ├── req/ProjectA 削除
  │           │     └── wi/ProjectA を main 最新位置へ更新
  │           └── Reject → reqタグ削除のみ（ブランチ保持・ロック解除・再Submit可能）
  │
  ├── wi/ProjectB (担当者B) ← 並行して進行可能
  │     └── ... → Approve → main に 3-wayマージ（freeze gate なし）
  │
  └── 📊 バージョン比較 → From/To RefSelector でブランチ+コミットを比較
```

**Doltのセルレベル3-wayマージ**: 異なるプロジェクトが同一テーブルの異なるレコード（または同一レコードの異なるカラム）を編集した場合は自動マージされます。Submit 前の main 取り込みで発生したデータ競合は main 優先で解消し、Approve 時に same-cell 競合が残る場合のみ `MERGE_CONFLICTS_PRESENT` として fail します。

## UI 状態マシン

| 状態 | 表示 | 説明 |
|------|------|------|
| `Idle` | Ready | 初期状態。全操作可能 |
| `DraftEditing` | Draft | 未コミットの変更あり |
| `Committing` | Committing... | コミット処理中 |
| `SchemaConflictDetected` | Schema Conflict (CLI) | スキーマ競合（CLI介入必要） |
| `ConstraintViolationDetected` | Constraint Violation (CLI) | 制約違反（CLI介入必要） |
| `StaleHeadDetected` | Stale HEAD | HEADが古い。`更新して同期` が主導線。必要ならエラーバナーの `復旧付き再読み込み` で client state を初期化して再読込 |

> main 優先の上書き通知は state machine の常駐状態ではなく、一時的な ConflictView オーバーレイとして表示されます。

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
│       ├── repository/       # Dolt DB接続管理 (Conn=リード / ConnWrite=ライト)
│       ├── service/          # ビジネスロジック
│       └── validation/       # 入力バリデーション
├── dist/
│   ├── dolt-web-ui              # macOS arm64 実行バイナリ
│   └── dolt-web-ui-linux-amd64  # Linux amd64 実行バイナリ
├── frontend/
│   ├── src/
│   │   ├── api/              # APIクライアント + ApiError クラス
│   │   ├── hooks/            # カスタムフック (useHeadSync)
│   │   ├── utils/            # ユーティリティ (exportDraft, apiResult)
│   │   ├── components/
│   │   │   ├── BulkPKReplaceModal/  # PK一括置換モーダル
│   │   │   ├── CellCommentPanel/    # 単一セル memo パネル（右サイド、draft編集）
│   │   │   ├── CLIRunbook/          # schema / constraint recovery overlay
│   │   │   ├── ConflictView/        # main優先 auto-merge 後の上書き通知
│   │   │   ├── ContextSelector/     # Branch ドロップダウン（Target/DBは設定ダイアログへ）
│   │   │   ├── CrossCopyModal/      # row / table cross-copy モーダル
│   │   │   ├── HistoryTab/          # バージョン比較 + diff summary + ZIP export
│   │   │   ├── MergeLog/            # footer-primary のマージログ + 2点比較
│   │   │   ├── ModalManager/        # モーダル/パネル描画の集約コンポーネント
│   │   │   ├── RequestDialog/       # submit / approve / reject ダイアログ
│   │   │   ├── SearchModal/         # 選択テーブル検索（値 + 任意で memo）
│   │   │   ├── TableGrid/           # AG Grid + 選択ツールバー + ドラフト可視化 + memo marker + 行Undo
│   │   │   └── common/
│   │   │       ├── CommitDialog.tsx       # コミットダイアログ（op一覧 + 個別キャンセル + 自動メッセージ生成）
│   │   │       ├── DiffTableDetail.tsx    # テーブル差分詳細（変更セルはamber背景、旧値はtooltip）
│   │   │       └── RecordHistoryPopup.tsx # レコード変更タイムライン
│   │   ├── store/            # Zustand ストア (3個、各ストアは独立)
│   │   │   ├── context.ts    # Target/DB/Branch 選択状態
│   │   │   ├── draft.ts      # 未コミット操作 (sessionStorage) + 更新マージ
│   │   │   └── ui.ts         # UI状態マシン
│   │   └── types/            # 型定義
│   ├── tests/
│   │   ├── e2e/             # Playwright E2Eテスト（APIモック方式）
│   │   └── e2e-real/        # 実Dolt + 実backend の Playwright smoke/full
│   └── package.json
├── docs/
│   ├── api-reference.md
│   ├── test-strategy.md
│   └── manual-test-checklist.md
├── scripts/
│   └── testenv/             # 実Dolt test harness (seed/start/reset/stop)
├── config.example.yaml
├── config.yaml               # ローカル設定 (.gitignore)
├── config.test.yaml          # 実Dolt test harness 用設定
└── Makefile
```

## API一覧（`/api/v1` + `/health`）

詳細な request / response 契約は [docs/api-reference.md](docs/api-reference.md) を正とします。

### メタデータ
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/targets` | ターゲット一覧 |
| GET | `/api/v1/databases` | データベース一覧 |
| GET | `/api/v1/branches` | ブランチ一覧 |
| GET | `/api/v1/branches/ready` | ブランチ queryability 確認 |
| POST | `/api/v1/branches/create` | ブランチ作成（mainから） |
| POST | `/api/v1/branches/delete` | ブランチ削除 |
| GET | `/api/v1/head` | HEADハッシュ取得 |

### テーブル操作
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/tables` | テーブル一覧 |
| GET | `/api/v1/table/schema` | テーブルスキーマ取得 |
| GET | `/api/v1/table/rows` | 行一覧（ページング・フィルタ・ソート対応） |
| GET | `/api/v1/table/row` | PK JSON 指定で単一行取得 |

### プレビュー
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/preview/clone` | 行クローンプレビュー |

### 書き込み
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/commit` | コミット（insert/update/delete） |
| POST | `/api/v1/merge/abort` | マージ中止（escape hatch） |

### Diff / 履歴
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/diff/table` | テーブル差分 |
| GET | `/api/v1/diff/summary/light` | 軽量 changed-table summary |
| GET | `/api/v1/diff/summary` | DB全テーブル横断の変更サマリー |
| GET | `/api/v1/diff/export-zip` | 差分をCSV×操作種別でZIP一括エクスポート |
| GET | `/api/v1/history/commits` | 承認履歴。main footer を primary truth として返す |
| GET | `/api/v1/history/row` | 特定行の変更履歴 |

### 申請 / 承認
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/request/submit` | 承認申請。内部で auto-sync 後に req/* を記録 |
| GET | `/api/v1/requests` | 申請一覧 |
| GET | `/api/v1/request` | 申請詳細 |
| POST | `/api/v1/request/approve` | 承認。main merge footer が audit truth、`outcome` で完了/再試行を返す |
| POST | `/api/v1/request/reject` | 却下（reqタグ削除のみ。ブランチは保持） |

### メモ
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/memo` | 単一セルのメモ取得。`branch_name` には work branch だけでなく commit hash も指定可 |
| GET | `/api/v1/memo/map` | テーブル内のメモ座標マップ取得。hidden memo table 不在以外は fail-loud |

### Cross-DB Copy
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/cross-copy/preview` | コピー preview。`expand_columns` を返す |
| POST | `/api/v1/cross-copy/rows` | 既存 destination work branch へ行コピー |
| POST | `/api/v1/cross-copy/table` | import work branch を作って全件コピー |
| POST | `/api/v1/cross-copy/admin/prepare-rows` | destination `main` の schema prep + `main -> wi/*` 同期 |
| POST | `/api/v1/cross-copy/admin/prepare-table` | destination `main` の schema prep |
| POST | `/api/v1/cross-copy/admin/cleanup-import` | deterministic stale import branch の掃除 |

`expand_columns` が返る場合、normal flow は `412 PRECONDITION_FAILED` で停止します。
必要なときだけ modal 内に admin lane が現れ、schema prep や stale import branch cleanup を実行できます。

### CSV
| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/v1/csv/preview` | CSV適用 preview |
| POST | `/api/v1/csv/apply` | CSV適用。`outcome` 付きで結果を返す |

### Search
| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/v1/search` | 選択テーブルを対象にした値 + メモ検索。partial を返さず fail-loud |

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

### Fast Suite

```bash
cd backend && go test -race ./...
cd frontend && npm run test
cd frontend && npm run test:e2e:mock
```

### Real Dolt Harness

```bash
./scripts/testenv/reset
```

### Real Integration / Real Playwright

```bash
cd backend && go test -tags=integration ./internal/service
cd frontend && npm run test:e2e:real:smoke
cd frontend && npm run test:e2e:real:full
```

- `frontend/tests/e2e` は API モック方式です。`pageerror` / `console.error` / unexpected API `5xx` / failed request を未許可なら fail にし、hidden error を gate に含めます。
- `frontend/tests/e2e-real` は `config.test.yaml` + `scripts/testenv/*` を使う実Dolt通し試験です。backend stdout/stderr も成果物に残します。
- `@quarantine` は既知不整合の期待仕様を固定するタグで、PR smoke からは除外し nightly/full に含めます。
- 詳細な層分けと test ID は [docs/test-strategy.md](/Users/shumpeiabe/Desktop/StableDiffusion/GitHub/Dolt/dolt-web-ui/docs/test-strategy.md) を参照してください。

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
