# ARGOS 自動レビュー VS Code 拡張

このリポジトリは、Copilot Language Model API を使って VS Code 内から ARGOS 自動レビューを実行する private 拡張本体だけを含みます。以前存在していた `mcp-server` と `web-ui` は削除され、現在はこのディレクトリ単体でビルドと配布が完結します。

## 使い方

1. レビュー対象のリポジトリを VS Code で開きます。
2. コマンドパレットから `ARGOS: 自動レビューを開始` を実行します。
3. ARGOS の Webview フォームでプリセットを選び、モデル欄で `レビュワー（初回）`、`評価者`、`レビュワー（2, 3回目）` を選択します。
4. 必要に応じてレビュー観点を複数行 Markdown で入力します。
5. 追加資料がある場合は、レビュー観点欄の下にある `ファイル添付` ボタンからファイルを選択します。画像はクリップボードから貼り付けても添付できます。

添付は画像が最大 5 枚、画像以外も含めた合計が最大 10 件です。テキスト系ファイルは内容をレビュー資料として渡し、画像は画像入力として選択モデルに渡します。

プリセットを選択すると、レビュワー（初回）、評価者、レビュワー（2, 3回目）のモデル欄がプリセットの内容に合わせて自動更新されます。その後に個別のモデル欄を変更し、同じ組み合わせのプリセットが存在しない状態になると、プリセット欄は空欄になります。

この拡張は `gd-review` と同じ考え方でレビュー用 diff を内部生成します。base branch を推定し、`git diff "${baseBranch}...HEAD"` 相当の差分を送信するため、手動で `diff.patch` を作成する必要はありません。

拡張プロセス内でレビュワー（初回） / 評価者 / レビュワー（2, 3回目）の議論を最後まで実行します。レビューが完了すると、開いているワークスペースフォルダーのルートに Markdown レポートを保存し、最終判定バッジ、モデル名、確定バグの結論、メタデータ、ラウンドごとの議論を含む ARGOS Webview プレビューを開きます。

同時に、既定では `.github/prompts/argos-<session_id>.prompt.md` も生成します。この prompt file は、レビュー完了後に Copilot へ追加質問や修正依頼をするためのものです。reviewer が従ったシステムプロンプト、レビュー要件、差分、関連コードコンテキスト、テキスト添付、最終結論、全ラウンドの議論を含むため、レビュー内容を説明してもらうだけでなく、不具合の再現方法や修正方法を差分に基づいて確認しやすくなります。

生成された prompt file を使うには、Copilot Chat で `/` を入力して `ARGOS <session_id>` を選択するか、`Chat: Run Prompt...` から該当 prompt file を実行します。ARGOS Webview プレビューの `Prompt を開く` ボタンから生成ファイルを開いて確認することもできます。prompt file は `agent` モードで動作するため、質問だけでなく、ユーザーが明示的に修正実装を依頼した場合は Copilot がコード確認や編集まで進められます。通常のチャットへ常に自動適用されるものではないため、レビュー内容を前提に質問したいときに選択して使います。

入力フォームは VS Code の表示言語に従います。日本語の VS Code では日本語ラベル、それ以外の言語では英語ラベルを表示します。

## VSIX のビルド

依存関係のインストール:

```bash
npm install
```

コンパイル確認:

```bash
npm run vscode:prepublish
```

VSIX パッケージの生成:

```bash
npm run build
```

生成された `argos-vscode-extension-*.vsix` は、`Extensions: Install from VSIX...` からインストールします。

## 設定

- `argos.includeContext`: 変更ファイルの内容と一般的なメタデータファイルを追加コンテキストに含めます。既定値は `true` です。
- `argos.contextBudget`: 各モデルリクエストへ送信する追加コンテキストの最大文字数です。既定値は `220000` です。
- `argos.generatePromptFile`: レビュー完了後に Copilot への追加質問・修正依頼用 `.github/prompts/*.prompt.md` を生成します。既定値は `true` です。
- `argos.activePreset`: 既定選択として使うモデル preset 名です。
- `argos.presets`: レビュワー（初回） / 評価者 / レビュワー（2, 3回目）の名前付きモデルプリセットです。リポジトリや worktree をまたいで同じ個人用プリセットを使いたい場合は、VS Code の User Settings に設定します。

User Settings JSON の例:

```json
{
	"argos.activePreset": "balanced",
	"argos.presets": {
		"balanced": {
			"label": "Balanced",
			"reviewer": { "model": "Claude Opus 4.7" },
			"examiner": { "model": "GPT-5.4" },
			"rebuttal": { "model": "Claude Sonnet 4.6" }
		},
		"strict": {
			"label": "Strict",
			"reviewer": { "model": "GPT-5.5" },
			"examiner": { "model": "Claude Opus 4.7" },
			"rebuttal": { "model": "GPT-5.4" }
		}
	}
}
```

`model` の値には、内部 model ID ではなく、VS Code 上でユーザーに表示されるモデルラベルを指定します。