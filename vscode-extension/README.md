# ARGOS Auto Review VS Code Extension

This private extension runs ARGOS auto review from inside VS Code using the Copilot Language Model API.

## Usage

1. Start the existing ARGOS server and Web UI.
2. Open the target repository in VS Code.
3. Run `ARGOS: Start Auto Review` from the Command Palette.
4. Pick reviewer, examiner, and rebuttal models in the ARGOS Webview form.
5. Enter optional review requirements as multiline Markdown.

The extension generates the review diff internally using the same style as `gd-review`: it infers a base branch and sends the equivalent of `git diff "${baseBranch}...HEAD"`. You do not need to create `diff.patch` manually.

The extension saves reviews and session messages through the existing ARGOS REST API. After a session is created, it opens the matching ARGOS Web UI session page in VS Code's Simple Browser, falling back to the external browser if needed.

The input form uses the VS Code display language. Japanese VS Code shows Japanese labels; other languages use English labels.

## Build VSIX

```bash
npm run build
```

Install the generated `argos-vscode-extension-*.vsix` with `Extensions: Install from VSIX...`.

## Settings

- `argos.apiBaseUrl`: ARGOS REST API base URL. Default: `http://localhost:3001`.
- `argos.webUiBaseUrl`: ARGOS Web UI base URL. Default: `http://localhost:8080`.
- `argos.includeContext`: Include changed file contents and common metadata files. Default: `true`.
- `argos.contextBudget`: Maximum additional context characters. Default: `220000`.