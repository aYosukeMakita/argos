# ARGOS

ARGOS は、VS Code の GitHub Copilot Language Model API を使って reviewer / examiner / rebuttal の自動レビュー対話を実行し、結果を既存サーバーと Web UI に保存・表示するためのツールセットです。

この実装では次を提供します。

- VS Code 拡張による Copilot Language Model API ベースの自動レビュー
- reviewer / examiner / rebuttal ごとのモデル選択
- 複数行 Markdown でのレビュー観点入力
- 変更差分と関連コンテキストの収集
- REST API による review / session / message の永続化
- SQLite による状態保存
- Web UI によるレビュー結果と議論履歴の確認
- Docker Compose による一括起動

## ディレクトリ構成

- `mcp-server`: REST API、MCP endpoint、SQLite 状態遷移ロジック
- `vscode-extension`: VS Code 内から自動レビューを起動する拡張
- `web-ui`: Next.js ダッシュボード
- `spec.md`: VS Code 拡張化の要件定義

reviewer / examiner / rebuttal の prompt は VS Code 拡張内の `vscode-extension/assets/prompts` に同梱されています。利用者が `.agent.md` ファイルを `~/.copilot/agents/` や `.github/agents/` に配置する必要はありません。

## セットアップ

### ローカル起動

1. Node.js 22 系をインストールする
2. `mcp-server` の依存を入れて起動する
3. `web-ui` の依存を入れて起動する

```bash
cd mcp-server
npm install
npm run dev
```

別ターミナル:

```bash
cd web-ui
npm install
npm run dev
```

ブラウザ:

- Web UI: http://localhost:8080
- REST API: http://localhost:3001/api/reviews
- Health check: http://localhost:3001/health
- MCP endpoint: http://localhost:3001/mcp

### Docker Compose 起動

```bash
docker compose up --build
```

ブラウザ:

- Web UI: http://localhost:8080
- REST API: http://localhost:3001

## VS Code 拡張で自動レビューを実行する

ARGOS サーバーと Web UI を起動した状態で、拡張を Extension Development Host から実行できます。

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
6. reviewer を 1 回実行し、review を ARGOS REST API に保存する
7. session を作成し、Web UI の該当 session ページを VS Code の Simple Browser で開く
8. examiner / rebuttal が最終判断まで自動で対話する

入力画面の表示言語は VS Code の表示言語に従います。日本語 VS Code では日本語、それ以外では英語で表示します。

実行中の進捗は `ARGOS` Output Channel に出力されます。モデル応答待ち、ストリーム受信量、ARGOS API への保存などの途中経過も確認できます。

## VSIX の作成とインストール

ローカルインストール用の VSIX は次で作成できます。

```bash
cd vscode-extension
npm run package
```

生成された `argos-vscode-extension-*.vsix` を VS Code の `Extensions: Install from VSIX...` でインストールできます。

## 拡張設定

VS Code の `settings.json` で変更できます。

```json
{
  "argos.apiBaseUrl": "http://localhost:3001",
  "argos.webUiBaseUrl": "http://localhost:8080",
  "argos.includeContext": true,
  "argos.contextBudget": 220000
}
```

- `argos.apiBaseUrl`: ARGOS REST API の base URL。既定値は `http://localhost:3001`
- `argos.webUiBaseUrl`: ARGOS Web UI の base URL。既定値は `http://localhost:8080`
- `argos.includeContext`: 変更ファイル本文と主要メタデータファイルを追加コンテキストに含める。既定値は `true`
- `argos.contextBudget`: 追加コンテキストの最大文字数。既定値は `220000`

`argos.apiBaseUrl` は MCP endpoint ではなく REST API の base URL です。`http://localhost:3001/mcp` ではなく `http://localhost:3001` のように指定してください。

## 別マシンからアクセスする場合

Web UI はブラウザ上で実行されるため、`localhost` はクライアント側を指します。同じマシン上で `web-ui` と `mcp-server` を動かす運用では、Web UI が実行されているホストの IP アドレスを使って API にアクセスする必要があります。

このリポジトリの Web UI は、クライアント実行時に現在のページのホスト名を使って API の base URL を自動生成します。API の接続先は常に `http(s)://<現在のホスト>:3001` です。

例: ブラウザで次の URL を開いた場合:

```bash
http://192.168.0.60:8080/reviews
```

Web UI は自動的に次の API に接続します。

```bash
http://192.168.0.60:3001
```

VS Code 拡張から別マシンの ARGOS サーバーに接続する場合は、VS Code の `settings.json` で `argos.apiBaseUrl` と `argos.webUiBaseUrl` をそのホストに合わせてください。

```json
{
  "argos.apiBaseUrl": "http://192.168.0.60:3001",
  "argos.webUiBaseUrl": "http://192.168.0.60:8080"
}
```

## REST API

VS Code 拡張は、既存の ARGOS REST API を使って結果を保存します。

- `POST /api/reviews`
- `POST /api/sessions`
- `GET /api/sessions/:sessionId/next-action`
- `GET /api/sessions/:sessionId/messages`
- `POST /api/sessions/:sessionId/messages`

Web UI は保存済みの review と session を表示します。

- `/reviews`
- `/reviews/[reviewId]`
- `/sessions`
- `/sessions/[sessionId]`

## MCP endpoint について

`mcp-server` は互換性のため MCP endpoint も提供しています。

- MCP endpoint: `http://localhost:3001/mcp`

ただし、VS Code 拡張の自動レビューは MCP ツールには依存せず、REST API を直接呼び出します。通常の自動レビュー運用では、VS Code 側に `.vscode/mcp.json` や user profile の `mcp.json` を設定する必要はありません。

## トラブルシュート

- 拡張から接続できない場合は、`argos.apiBaseUrl` が REST API の base URL になっているか確認する
- `http://localhost:3001/health` が開くか確認する
- Web UI が開かない場合は、`argos.webUiBaseUrl` を確認する
- リモート接続時に失敗する場合は、`localhost` ではなく ARGOS サーバーを動かしているホストの IP アドレスを設定する
- レビューが進んでいるか不安な場合は、`ARGOS` Output Channel の `[PROGRESS]` ログを確認する
