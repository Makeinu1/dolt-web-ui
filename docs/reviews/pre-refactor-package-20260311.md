# Pre-Refactor Package

Date: 2026-03-11

## Purpose

本パッケージは、`dolt-web-ui` の refactor 開始前に必要な判断を固定するための入口文書である。

ここで固定するのは次の 3 点。

1. なぜ backend 主導で進めるのか
2. どこまで UI を維持し、どこから整合修正を許すのか
3. どの順序で Track A-D を実装するのか

## Document Set

- Review findings:
  [master-review-20260311.md](master-review-20260311.md)
- Refactor strategy:
  [backend-led-refactor-strategy-20260311.md](backend-led-refactor-strategy-20260311.md)
- Track A:
  [track-a-safety-boundary-20260311.md](track-a-safety-boundary-20260311.md)
- Track B:
  [track-b-audit-completion-model-20260311.md](track-b-audit-completion-model-20260311.md)
- Track C:
  [track-c-ui-contract-alignment-20260311.md](track-c-ui-contract-alignment-20260311.md)
- Track D:
  [track-d-contract-tests-20260311.md](track-d-contract-tests-20260311.md)

## Locked Decisions

- UI freeze は `Flow固定のみ`
- 主戦場は backend
- ただし UI の state / contract alignment は最小変更で許容
- `main` / `audit` の trust は first-class backend contract に戻す
- `merged/*` は補助インデックスに格下げする
- dead `/sync` 契約は整理対象に含める
- refactor の前に invariant test list を固定する

## Execution Order

1. Track A: Safety Boundary
2. Track B: Audit / Completion Model
3. Track C: UI Contract Alignment
4. Track D: Docs / Tests Contract

この順序を変えない。Track A/B を先にやらずに UI や docs だけ整えると、後でまた契約が崩れるため。

## Definition Of Ready

refactor に入ってよい状態は次の通り。

- Track A-D 文書が存在する
- canonical source が固定されている
- dead contract の扱いが明文化されている
- invariant test list が固定されている
- 実装者が追加判断なしで最初の PR を切れる

## First Refactor PR Boundary

最初の PR は Track A のみとし、次を含める。

- repository session type の導入
- `ConnDB()` の read path 置換開始
- `AllowedRefPolicy` の導入
- tests の最初の invariant 化

Track B/C/D は同じ PR に混ぜない。
