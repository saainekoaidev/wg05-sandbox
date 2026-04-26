# WG05 追体験サンドボックス — 作業指示

このリポジトリは, 2〜3画面の小規模システムを **要件定義 → 設計 → 製造 → テスト** まで一気通貫で追体験するための個人用作業環境です。
Claude Code (VSCode拡張) が, 工程の流れと品質ゲート・CI/CDの「意味」を実環境で体感できるよう支援します。

---

## Tier 1 構成 (8項目)

| # | ツール | 担う工程 |
|---|---|---|
| 1 | VSCode + Claude Code | AI支援開発の中核 |
| 2 | Git + GitHub (公開repo) | ソース管理 |
| 3 | GitHub Issues + Projects | バックログ (優先順位付きの作業列) |
| 4 | Figma Free + figma-developer-mcp | UIクイックPoC + 設計書生成 |
| 5 | docs/ + docs/adr/ | 設計書 + ADR |
| 6 | CLAUDE.md + .claude/settings.json | ガードレール |
| 7 | GitHub Actions (最小 ci.yml) | CI/CD |
| 8 | Vitest | 単体テスト |

Tier 2 (余裕があれば追加): gh CLI + GitHub MCP server / Claude Code GitHub Action / ESLint + Prettier / devcontainer

---

## 元資料の主役ツール対応表

| 元資料の主役 | このサンドボックスでの対応 |
|---|---|
| GitHub | そのまま GitHub |
| Azure DevOps (タスク管理) | GitHub Issues + Projects |
| Figma + Figma MCP | Figma Free + figma-developer-mcp (OSS) |
| GitHub Coding Agent | Claude Code GitHub Action (任意) |
| GitHub Copilot | Claude Code |
| AVD (仮想開発環境) | devcontainer (任意) |
| MD設計書 | docs/*.md |
| ADR | docs/adr/*.md |
| ガードレール | CLAUDE.md + .claude/settings.json |
| Knowledge Graph | Claude Code auto-memory |

---

## 制約

- Claude Code 以外の有償ツールは入れない (Figma も Free プラン)
- 関心の重点は **バックログ (優先順位付きのチケット列)** の体感

---

## 最初の一歩

このサンドボックスは「容れ物」のみ作成済みです。Tier 1各要素は未整備のため, 順次以下を進めてください (本リポジトリ単体では完結しません):

1. Git 初期化 + GitHub repo 作成 + 初回コミット
2. GitHub Issues + Projects でバックログを作成
3. `docs/requirements.md` に要件を記入
4. Figma Free + figma-developer-mcp を `.mcp.json` に設定 (`.mcp.json.example` を参照)
5. `docs/design.md` + `docs/ui.md` を整備
6. `src/` 配下にアプリを init (フレームワーク選定後)
7. Vitest 導入 + GitHub Actions の `ci.yml` を作成
8. 各工程通過時の所感を `wg05-progress.md` に記録

## 工程運用ルール

設計判断 (ライブラリ選定・データ構造・命名規約・例外処理方針等) を行った際は, docs/adr/ に新規 ADR ファイルを追加する。ファイル名は連番 + 短い件名 (例: 0002-state-management.md), 中身は 0001-template.md の構成 (Status / Context / Decision / Consequences) に従う。判断の根拠と帰結を残すことで, 後の意思決定が過去の判断を踏まえて進められる状態を保つ。

新しい要件が発生した場合は, まず docs/requirements.md に追記する。次にその要件を元に GitHub の Issue を起票する。要件文書を起点としてIssueを派生させる順序を守ることで, 要件の全体像が常に docs/requirements.md で把握できる状態を保つ。

画面に関する判断 (画面構成・遷移・操作フロー・主要なUI要素) を行った場合は, docs/ui.md に反映する。画面仕様の変更履歴がこのファイルに集約されることで, UIの最新状態が常に1か所で確認できる状態を保つ。
