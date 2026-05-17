# ARGOS

ARGOS は、VS Code の GitHub Copilot Language Model API を使って reviewer / examiner / rebuttal の自動レビュー対話を実行し、結果を Markdown レポートとして保存して VS Code 拡張内 Webview で表示するためのツールセットです。

この実装では次を提供します。

- VS Code 拡張による Copilot Language Model API ベースの自動レビュー
- reviewer / examiner / rebuttal ごとのモデル選択
- 複数行 Markdown でのレビュー観点入力
- 変更差分と関連コンテキストの収集
- Markdown ファイルによるレビュー結果の保存
- 最終的にバグと判定された指摘だけをまとめる結論欄
- VS Code 拡張内 Webview によるバッジ、モデル名、議論履歴つきの整形表示

## ディレクトリ構成

- `vscode-extension`: VS Code 内から自動レビューを起動し、Markdown 保存と Webview 表示を行う拡張
- `mcp-server`: 互換用の REST API、MCP endpoint、SQLite 状態遷移ロジック
- `web-ui`: 互換用の Next.js ダッシュボード
- `spec.md`: VS Code 拡張化の要件定義

reviewer / examiner / rebuttal の prompt は VS Code 拡張内の `vscode-extension/assets/prompts` に同梱されています。利用者が `.agent.md` ファイルを `~/.copilot/agents/` や `.github/agents/` に配置する必要はありません。

## セットアップ

### VS Code 拡張のビルド

1. Node.js 22 系をインストールする
2. `vscode-extension` の依存を入れてビルドする

```bash
cd vscode-extension
npm install
npm run build
```

### Docker Compose 起動

```bash
docker compose up --build
```

ブラウザ:

- Web UI: http://localhost:8080
- REST API: http://localhost:3001

## VS Code 拡張で自動レビューを実行する

拡張を Extension Development Host から実行できます。MCP サーバー、REST API、Web UI の起動は不要です。

```bash
cd vscode-extension
npm install
npm run build
```

VS Code で `vscode-extension` を開き、拡張開発ホストを起動してからレビュー対象リポジトリで `ARGOS: Start Auto Review` を実行します。

実行時の流れ:

1. メイン領域に ARGOS の入力画面が開く
2. reviewer / examiner / rebuttal のモデルを選ぶ
3. レビュー観点や追加要件を複数行 Markdown で入力する
4. `Start Review` を押す
5. 拡張が `git diff "${baseBranch}...HEAD"` 相当の Git 変更差分と関連コンテキストを収集する
6. reviewer / examiner / rebuttal が最終判断まで自動で対話する
7. 完了時に VS Code で開いているワークスペースフォルダー直下へ Markdown レポートを保存する
8. VS Code 拡張内 Webview で、判定バッジ、確定バグだけの結論、モデル名、各ラウンドの本文を整形表示する

入力画面の表示言語は VS Code の表示言語に従います。日本語 VS Code では日本語、それ以外では英語で表示します。

実行中の進捗は `ARGOS` Output Channel に出力されます。モデル応答待ち、ストリーム受信量、Markdown レポートの保存先などの途中経過も確認できます。

## VSIX の作成とインストール

ローカルインストール用の VSIX は次で作成できます。

```bash
cd vscode-extension
npm run build
```

生成された `argos-vscode-extension-*.vsix` を VS Code の `Extensions: Install from VSIX...` でインストールできます。

## 拡張設定

VS Code の `settings.json` で変更できます。

```json
{
  "argos.includeContext": true,
  "argos.contextBudget": 220000
}
```

- `argos.includeContext`: 変更ファイル本文と主要メタデータファイルを追加コンテキストに含める。既定値は `true`
- `argos.contextBudget`: 追加コンテキストの最大文字数。既定値は `220000`

## 互換用 REST API / MCP endpoint について

`mcp-server` と `web-ui` は互換用コンポーネントとして残っています。現在の VS Code 拡張の自動レビューは MCP ツール、REST API、Web UI に依存せず、拡張内でレビュー対話を実行して Markdown レポートを保存します。

互換用サーバーを起動する場合:

```bash
cd mcp-server
npm install
npm run dev
```

- REST API: http://localhost:3001/api/reviews
- Health check: http://localhost:3001/health
- MCP endpoint: http://localhost:3001/mcp

## 互換用 REST API

互換用サーバーは次の REST API を提供します。現在の VS Code 拡張の自動レビューはこれらを使いません。

- `POST /api/reviews`
- `POST /api/sessions`
- `GET /api/sessions/:sessionId/next-action`
- `GET /api/sessions/:sessionId/messages`
- `POST /api/sessions/:sessionId/messages`

互換用 Web UI は保存済みの review と session を表示します。

- `/reviews`
- `/reviews/[reviewId]`
- `/sessions`
- `/sessions/[sessionId]`

## MCP endpoint について

`mcp-server` は互換性のため MCP endpoint も提供しています。

- MCP endpoint: `http://localhost:3001/mcp`

ただし、VS Code 拡張の自動レビューは MCP ツールには依存しません。通常の自動レビュー運用では、VS Code 側に `.vscode/mcp.json` や user profile の `mcp.json` を設定する必要はありません。

## トラブルシュート

- Markdown レポートは VS Code で開いているワークスペースフォルダー直下に保存される
- Webview から元の Markdown を開きたい場合は、プレビュー上部の `Open Markdown` を押す
- レビューが進んでいるか不安な場合は、`ARGOS` Output Channel の `[PROGRESS]` ログを確認する
