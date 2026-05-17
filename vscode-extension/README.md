# ARGOS Auto Review VS Code Extension

This private extension runs ARGOS auto review from inside VS Code using the Copilot Language Model API.

## Usage

1. Open the target repository in VS Code.
2. Run `ARGOS: Start Auto Review` from the Command Palette.
3. Pick reviewer, examiner, and rebuttal models in the ARGOS Webview form.
4. Enter optional review requirements as multiline Markdown.

The extension generates the review diff internally using the same style as `gd-review`: it infers a base branch and sends the equivalent of `git diff "${baseBranch}...HEAD"`. You do not need to create `diff.patch` manually.

The extension runs the full reviewer / examiner / rebuttal discussion locally in the extension process. When the review finishes, it saves a Markdown report at the root of the opened workspace folder and opens a decorated ARGOS Webview preview with the final judgment badge, model names, a confirmed-bugs conclusion, metadata, and round-by-round discussion.

The input form uses the VS Code display language. Japanese VS Code shows Japanese labels; other languages use English labels.

## Build VSIX

```bash
npm run build
```

Install the generated `argos-vscode-extension-*.vsix` with `Extensions: Install from VSIX...`.

## Settings

- `argos.includeContext`: Include changed file contents and common metadata files. Default: `true`.
- `argos.contextBudget`: Maximum additional context characters. Default: `220000`.