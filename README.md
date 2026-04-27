# ARGOS

ARGOS は、VSCode の GitHub Copilot Chat を使った複数モデルレビュー運用を支える MCP サーバーと Web UI です。

この実装では次を提供します。

- MCP ツールによるレビュー保存と議論状態管理
- SQLite 永続化
- REST API による読み取り専用ダッシュボード
- Docker Compose による一括起動
- Copilot Chat 用 custom agent テンプレート

## ディレクトリ構成

- mcp-server: MCP サーバー、REST API、SQLite 状態遷移ロジック
- web-ui: Next.js ダッシュボード
- agents: Copilot custom agent のひな形
- 要件定義書.md: 実装の元になった要件定義

## セットアップ

### ローカル起動

1. Node.js 22 系をインストールする
2. mcp-server で依存を入れる
3. web-ui で依存を入れる
4. mcp-server を起動する
5. web-ui を起動する

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
- MCP endpoint: http://localhost:3001/mcp

### Docker Compose 起動

```bash
docker compose up --build
```

### 注意: 別マシンからアクセスする場合の Web UI と API のホスト検出

Web UI はブラウザ上で実行されるため、`localhost` はクライアント側を指します。
同じマシン上で `web-ui` と `mcp-server` を動かす運用では、Web UI が実行されているホストのIPアドレスを使って API にアクセスする必要があります。

このリポジトリの Web UI は、クライアント実行時に現在のページのホスト名を使って API のベース URL を自動生成します。API の接続先は常に `http(s)://<現在のホスト>:3001` です。

例: ブラウザで次の URL を開いた場合:

```bash
http://192.168.0.60:8080/reviews
```

Web UI は自動的に次の API に接続します。

```bash
http://192.168.0.60:3001
```

## VSCode で MCP サーバーを使う設定

VSCode はデフォルト状態のままでは、この MCP サーバーに自動接続しません。
GitHub Copilot Chat から ARGOS のツールを使うには、VSCode 側で MCP サーバーの接続先を設定する必要があります。

設定方法は 2 通りあります。

- ワークスペース単位で設定する: `.vscode/mcp.json`
- ユーザープロファイル単位で設定する: VSCode のユーザー設定用 `mcp.json`

チームで共有するなら、ワークスペース側の `.vscode/mcp.json` を使うのが適しています。

リモート開発では、どの `mcp.json` が使われるかに注意してください。

- ローカルの通常起動 VSCode では、ユーザープロファイル側 `mcp.json` は OS ごとの User 設定フォルダにあります
- WSL / SSH / Dev Container などのリモート接続では、ローカル User 設定と Remote User 設定は別です
- リモート接続中に ARGOS をそのリモート側で使いたい場合は、パスを手入力で決め打ちせず `MCP: Open User Configuration` または `MCP: Open Remote User Configuration` から開いて編集するのが確実です

特に Linux 系では `User` と `user` は別パスです。`~/.config/Code/user/mcp.json` のような小文字パスは通常は使われません。

### ワークスペース設定の例

ワークスペース直下に `.vscode/mcp.json` を作成して、次を設定します。

```json
{
	"servers": {
		"argos": {
			"type": "http",
			"url": "http://localhost:3001/mcp"
		}
	}
}
```

Docker で起動していて、同じ PC 上の VSCode から接続する場合は `http://localhost:3001/mcp` を使います。

ノート PC 上の Docker ホストに対して、別のデスクトップ PC の VSCode から接続する場合は、`localhost` ではなくノート PC の IP アドレスを指定します。

例:

```json
{
	"servers": {
		"argos": {
			"type": "http",
			"url": "http://192.168.1.10:3001/mcp"
		}
	}
}
```

この場合は、以下も満たす必要があります。

- ノート PC 側で 3001 番ポートに到達できること
- ファイアウォールが通信を遮断しないこと
- Docker Compose で `3001:3001` が公開されていること

### VSCode での設定手順

1. ARGOS の MCP サーバーを起動する
2. VSCode でこのワークスペースを開く
3. コマンドパレットを開く
4. `MCP: Open Workspace Folder Configuration` を実行する
5. 開いた `.vscode/mcp.json` に上記設定を書く
6. MCP サーバーの起動確認または信頼確認ダイアログが出たら許可する
7. `MCP: List Servers` を実行し、`argos` が一覧に表示されることを確認する
8. `argos` を選んで状態を確認し、必要なら Enable または Start を実行する
9. Chat ビューでツール一覧に `argos` のツールが出ることを確認する

別の方法として、コマンドパレットから `MCP: Add Server` を実行し、対話形式で `type = http` と `url = http://localhost:3001/mcp` を設定しても構いません。

### 他のプロジェクトでも使うには

別のプロジェクトの VSCode でも `save_review` を使いたい場合は、次の 2 つを分けて設定する必要があります。

- agent を使えるようにする設定
- MCP ツールへ接続する設定

この 2 つのうち片方だけでは不十分です。

- `~/.copilot/agents/` に `reviewer.agent.md` を置いただけでは、agent 名は出ても `save_review` は使えません
- `.vscode/mcp.json` を ARGOS リポジトリにだけ置いた場合、その設定は他のプロジェクトには引き継がれません

複数のプロジェクトで共通利用したい場合の推奨構成は次の通りです。

1. ARGOS の MCP サーバーを常時起動できる場所で起動する
2. `agents/reviewer.agent.md` などを `~/.copilot/agents/` にコピーする
3. VSCode のユーザープロファイル側の `mcp.json` に `argos` サーバーを登録する

ユーザープロファイル側に登録すると、その VSCode プロファイルで開く他のプロジェクトからも同じ `argos` MCP サーバーを参照できます。

設定イメージ:

```json
{
	"servers": {
		"argos": {
			"type": "http",
			"url": "http://localhost:3001/mcp"
		}
	}
}
```

要するに、全プロジェクト共通で使いたいなら次の組み合わせにします。

- agent 定義: `~/.copilot/agents/*.agent.md`
- MCP サーバー設定: VSCode ユーザープロファイル側の `mcp.json`

プロジェクト単位で閉じたいなら次の組み合わせです。

- agent 定義: 利用先リポジトリの `.github/agents/`
- MCP サーバー設定: 利用先リポジトリの `.vscode/mcp.json`

### 接続確認の目安

MCP 接続が正しくできていれば、Copilot Chat から少なくとも以下のツールが見えるようになります。

確認手順の例:

1. コマンドパレットから `MCP: List Servers` を実行する
2. 一覧に `argos` が見えることを確認する
3. `argos` を選び、状態が有効であることを確認する
4. Chat ビューで `save_review` などのツールが見えることを確認する

- save_review
- get_review
- list_reviews
- start_session
- get_session
- list_sessions
- get_session_messages
- submit_message
- get_next_action

### トラブルシュート

- Chat にツールが出ない場合は、`MCP: List Servers` で `argos` が有効か確認する
- エラー時は `MCP: List Servers` から対象サーバーを選び、出力ログを確認する
- リモート接続時に失敗する場合は、`localhost` ではなく Docker ホストの IP アドレスを設定しているか確認する
- ブラウザで `http://localhost:3001/health` が開くかを先に確認すると切り分けしやすい

## MCP ツール一覧

- save_review
- get_review
- list_reviews
- start_session
- get_session
- list_sessions
- get_session_messages
- submit_message
- get_next_action

## Custom Agent の配置方法

このリポジトリの [agents](agents) 配下には、Copilot Chat で使う custom agent ファイルのひな形を置いています。
このリポジトリ自体をそのまま `.github/agents` 付きで運用する前提ではありません。

含まれている主なファイル:

- [agents/reviewer.agent.md](agents/reviewer.agent.md): reviewer の一次レビュー用
- [agents/examiner.agent.md](agents/examiner.agent.md): examiner 用
- [agents/rebuttal.agent.md](agents/rebuttal.agent.md): rebuttal の反論用

実際に custom agent として使う場合は、利用先の環境にこれらのファイルをコピーしてください。

配置先は 2 通りあります。

- ワークスペース単位で使う場合: 利用先リポジトリの `.github/agents/`
- ユーザープロファイル単位で使う場合: `~/.copilot/agents/`

`~/.copilot/agents/` 以下に配置した `*.agent.md` はグローバル設定として扱われ、ワークスペースをまたいで利用できます。

例:

- `agents/reviewer.agent.md` を利用先の `.github/agents/reviewer.agent.md` にコピーする
- `agents/examiner.agent.md` を利用先の `.github/agents/examiner.agent.md` にコピーする
- `agents/rebuttal.agent.md` を利用先の `.github/agents/rebuttal.agent.md` にコピーする
- `agents/reviewer.agent.md` を `~/.copilot/agents/reviewer.agent.md` にコピーする
- `agents/examiner.agent.md` を `~/.copilot/agents/examiner.agent.md` にコピーする
- `agents/rebuttal.agent.md` を `~/.copilot/agents/rebuttal.agent.md` にコピーする

その後、Copilot Chat の agent picker から `reviewer`、`examiner`、`rebuttal` を選んで実行できます。

`reviewer` は入力付き custom agent です。
実行時に、変更の目的や追加で重視したいレビュー観点を自由文で渡してください。
目的文が複数行になっても構いません。

これらの agent は model picker 依存で使う前提です。
agent ファイルに固定の `model` は持たせず、実行時に選ばれているモデル名が明示的に読み取れる場合はその値を `model_name` として保存します。
実行時モデル名を agent が判別できない場合は、`Unknown` を保存します。

MCP API の内部識別子としては、reviewer / rebuttal 側を `REVIEWER`、examiner 側を `EXAMINER` として扱います。
そのためツール呼び出し例では `reviewer="REVIEWER"` や `agent="REVIEWER"` が登場します。

## Web UI 画面

- /reviews
- /reviews/[reviewId]
- /sessions
- /sessions/[sessionId]

## 推奨運用フロー

ARGOS の v1 は、1 回の一次レビュー本文に複数の指摘を含める運用を前提としています。
1 指摘ごとに review を分割するのではなく、reviewer が 1 本のレビュー本文を保存し、その本文を複数の examiner session が吟味します。

### 基本方針

- reviewer は、現在開いている PR について 1 回のレビュー本文を作成する
- レビュー本文の中に複数の指摘をまとめて含める
- 指摘がない場合は save_review を呼ばず、reviewer のレビューだけで完結する
- 指摘がある場合だけ save_review を呼び、review_id を得る
- examiner に吟味させる場合は、review_id を元に start_session を呼んで新しい session を作る
- Web UI は表示専用であり、review や session の作成は行わない

### reviewer の一次レビュー

1. reviewer に現在の PR をレビューさせる
2. 指摘がなければ保存しない
3. 指摘があれば、複数の指摘を 1 本のレビュー本文にまとめて `model_name` 付きで save_review を呼ぶ
4. reviewer の最終出力には、少なくとも review_id を含める

### examiner への吟味依頼

1. 利用者が Web UI の /reviews または /reviews/[reviewId] で review 内容を確認する
2. 吟味に回したい review_id を決める
3. 次の 2 通りのどちらかで開始する
4. 手動開始: 任意のチャットウィンドウから start_session(review_id=..., reviewer="REVIEWER") を呼ぶ
5. 自動開始: examiner agent に review_id だけを渡し、agent 側で start_session を実行させる
6. 追加の examiner が必要なら、同じ review_id でもう一度 start_session(review_id=..., reviewer="REVIEWER") を呼ぶ
7. 作成された session_id を /sessions または /sessions/[sessionId] で確認する
8. examiner 用チャットには session_id または review_id を渡す

### examiner の吟味結果保存

- examiner は review_id しかない場合は start_session で新しい examiner session を作成してから進む
- examiner は get_session、get_session_messages、get_next_action を使って指定された session_id の内容だけを確認する
- examiner は `model_name` を付けて submit_message(session_id=..., agent="EXAMINER", model_name=..., content=..., judgment="OK" or "NG") を呼んで結果を保存する
- 同じ review_id に対して複数の examiner session を作成でき、保存先は session_id ごとに分かれる

### rebuttal の反論

- rebuttal は自動でポーリングしない
- 利用者が Web UI の /sessions または /sessions/[sessionId] を見て、next_actor が rebuttal 側の手番になったことを確認してから rebuttal に再度依頼する
- rebuttal は get_next_action(session_id=...) を確認し、自分の手番のときだけ get_session、get_session_messages を読んで `model_name` 付きで submit_message(session_id=..., agent="REVIEWER", model_name=..., content=..., judgment=null) を呼ぶ
- status が finished の session には投稿しない

## Copilot Chat の使い方

1. 利用先の環境に [agents/reviewer.agent.md](agents/reviewer.agent.md)、[agents/examiner.agent.md](agents/examiner.agent.md)、[agents/rebuttal.agent.md](agents/rebuttal.agent.md) を配置する
2. reviewer 用チャットでは `reviewer` agent を選び、変更の目的や追加で重視したいレビュー観点を自由文で渡す
3. reviewer に現在の PR をレビューさせる
4. 指摘がある場合だけ reviewer が save_review を呼び、review_id を取得する
5. 利用者が吟味に回したいと判断したら、必要に応じて start_session を呼ぶか、examiner agent に review_id をそのまま渡す
6. examiner 用チャットでは `examiner` agent を選び、session_id または review_id を渡す
7. examiner は review_id しかない場合は start_session で examiner 用 session を自動作成し、その後 get_session、get_session_messages、get_next_action を使って吟味する
8. examiner が submit_message で OK/NG を保存する
9. 利用者が Web UI または examiner の返答で session_id を確認する
10. 利用者が next_actor を確認し、必要なときだけ rebuttal 用チャットで `rebuttal` agent を選び、session_id を渡して反論させる

### モデル名表示

- review 保存時と examiner / rebuttal の投稿時には `model_name` を保存する
- 実行中モデル名が agent から明示的に読み取れる場合はその値を保存する
- 読み取れない場合は `Unknown` を保存する
- Web UI では保存された `model_name` を優先表示し、未保存の過去データは従来の Agent reviewer / Examiner 表示にフォールバックする

### 運用上の注意

- review_id は一次レビュー本文を特定する ID
- session_id は 1 つの examiner との吟味・反論の流れを保存する ID
- examiner には session_id を渡してもよいし、review_id だけ渡して session 作成から自動で始めてもよい
- review_id を何度も渡すと session が複数作られる可能性がある
- Web UI からは start_session を実行できないため、session 作成は MCP ツールから行う
- 現在開いている PR を ARGOS が自動認識するわけではないため、どの review を吟味対象にするかは利用者が選ぶ

## デモ

demo/sample-demo.md に複数の examiner session を並行で進める手順を記載しています。
