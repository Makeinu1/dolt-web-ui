# Dolt Web UI Product Principles

このプロダクトは「高機能な DB 編集 UI」ではなく、**業務ユーザが安全にデータ変更を進めるための、レビュー可能で復旧可能な作業台**として設計します。

## Primary Promise

1. **普通の業務ユーザが永続的に詰まらない**
2. **`main` / `audit` を常に信頼できる**
3. **work item は stable な名前で再発見できる**
4. **成功・失敗・要再試行が UI で明確に分かる**
5. **日常的に必要な機能はすぐ使え、強力な機能も安全に使える**

## Feature Tiers

### Core

通常の業務フローをこれだけで完結させる機能です。

- protected branch 閲覧
- work branch 作成 / 再開
- work branch 編集
- commit
- submit
- approve / reject
- 基本 diff
- 基本検索
- recovery reload / stale head recovery への導線

### Advanced but kept

必要なときだけではなく、日常的に使われることもある機能です。削除せず残し、visible なままでも安全性と完了の明確さを優先します。

- cross-DB copy
- CSV import / apply
- bulk replace
- MergeLog 深掘り
- 過去版比較 / 詳細 diff
- 大量件数への一括操作

### Admin / Escape Hatch

通常業務では見せず、異常時や運用者向けに限定する機能です。

- recovery reload
- stale head からの client reset
- merge abort
- CLI runbook が必要な例外復旧

## Review Lens

レビューやリファクタリングでは、機能の有無より次を優先します。

- partial success を success 扱いしていないか
- stale client state / optimistic branch open で壊れないか
- 重い処理を一覧画面で勝手に走らせていないか
- 成功完了が曖昧で、再操作や不安を生まないか
- 日常的に使う強力な機能が不要に隠されていないか

## Current UI Direction

- `Core` は常に見える
- `Advanced` も日常運用で必要なら visible でよい
- `Admin` はエラー時や特定の blocking state でだけ出す

この原則により、機能の到達性を落とさずに、壊れやすさと迷いを減らします。
