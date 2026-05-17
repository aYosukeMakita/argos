import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'

type MessageAgent = 'REVIEWER' | 'EXAMINER' | 'REBUTTAL'
type NextActor = 'EXAMINER' | 'REBUTTAL'
type FinalJudgment = 'OK' | 'NG'
type CompletionReason = 'approved' | 'max_rounds_reached'

interface ExtensionSettings {
  includeContext: boolean
  contextBudget: number
}

interface DiscussionMessageRecord {
  id: number
  session_id: string
  round: number
  agent: MessageAgent
  model_name: string | null
  content: string
  judgment: FinalJudgment | null
  created_at: string
}

interface NextAction {
  agent: NextActor | null
  round: number
  status: 'ongoing' | 'finished'
  final_judgment: FinalJudgment | null
  completion_reason: CompletionReason | null
}

interface ReviewerOutput {
  has_findings: boolean
  content: string
}

interface ExaminerOutput {
  judgment: FinalJudgment
  content: string
}

interface RebuttalOutput {
  content: string
}

interface ConclusionOutput {
  content: string
}

interface RunInput {
  purpose: string
  repositoryRoot: string
  diffPatch: string
  codeContext?: string
  reviewId?: string
  sessionId?: string
}

interface SelectedModels {
  reviewer: vscode.LanguageModelChat
  examiner: vscode.LanguageModelChat
  rebuttal: vscode.LanguageModelChat
}

interface ReviewFormResult {
  purpose: string
  models: SelectedModels
}

interface SerializedModel {
  id: string
  name: string
  description: string
  detail: string
}

interface ReviewFormLabels {
  htmlLang: string
  title: string
  connectionAriaLabel: string
  workspace: string
  models: string
  reviewRequirements: string
  reviewRequirementsPlaceholder: string
  cancel: string
  startReview: string
  emptyPurpose: string
}

interface ReviewReport {
  reviewId: string
  sessionId: string
  createdAt: string
  purpose: string
  repositoryRoot: string
  diffRange: string
  markdownUri: vscode.Uri
  conclusionMarkdown: string
  finalJudgment: FinalJudgment
  completionReason: CompletionReason
  models: {
    reviewer: string
    examiner: string
    rebuttal: string
  }
  messages: DiscussionMessageRecord[]
}

const execFileAsync = promisify(execFile)
const textDecoder = new TextDecoder('utf8')
const textEncoder = new TextEncoder()

const metadataFiles = [
  'package.json',
  'tsconfig.json',
  'next.config.js',
  'next.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'README.md',
]

const ignoredPathParts = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.turbo'])
const textExtensions = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const reviewerModelKeywords = [
  'gpt-5',
  'gpt-4.1',
  'gpt-4o',
  'o3',
  'o4',
  'claude-opus',
  'claude sonnet',
  'claude-sonnet',
  'gemini',
]

const examinerModelKeywords = [
  'mini',
  'flash',
  'gpt-5',
  'gpt-4o',
  'gpt-4.1',
  'claude-sonnet',
  'claude sonnet',
  'gemini',
]

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ARGOS')
  context.subscriptions.push(output)

  context.subscriptions.push(
    vscode.commands.registerCommand('argos.startAutoReview', async () => {
      try {
        await startAutoReview(context, output)
      } catch (error) {
        const message = formatError(error)
        output.appendLine(`[ERROR] ${message}`)
        output.show(true)
        void vscode.window.showErrorMessage(`ARGOS auto review failed: ${message}`)
      }
    }),
  )
}

export function deactivate(): void {}

async function startAutoReview(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const workspaceFolder = await selectWorkspaceFolder()
  if (!workspaceFolder) {
    throw new Error('ワークスペースフォルダーが選択されていません')
  }

  const settings = readSettings()
  const reviewForm = await showReviewForm(workspaceFolder, settings)
  if (!reviewForm) {
    return
  }
  const { models, purpose } = reviewForm

  const reviewerPrompt = await readPromptAsset(context, 'reviewer.md')
  const examinerPrompt = await readPromptAsset(context, 'examiner.md')
  const rebuttalPrompt = await readPromptAsset(context, 'rebuttal.md')

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ARGOS auto review',
      cancellable: true,
    },
    async (progress, token) => {
      output.clear()
      output.show(true)
      logStep(output, `Workspace: ${workspaceFolder.uri.fsPath}`)
      logStep(output, `Report directory: ${workspaceFolder.uri.fsPath}`)
      logStep(output, `Reviewer model: ${modelNameForStorage(models.reviewer)}`)
      logStep(output, `Examiner model: ${modelNameForStorage(models.examiner)}`)
      logStep(output, `Rebuttal model: ${modelNameForStorage(models.rebuttal)}`)

      progress.report({ message: '変更差分を収集しています' })
      const collected = await collectReviewInput(workspaceFolder.uri.fsPath, settings)
      throwIfCancelled(token)
      logStep(output, `Git repository: ${collected.repositoryRoot}`)
      logStep(output, `Diff range: ${collected.diffRange}`)
      logStep(output, `Diff: ${collected.diffPatch.length} chars`)
      logStep(output, `Context: ${collected.codeContext?.length ?? 0} chars`)

      const input: RunInput = {
        purpose,
        repositoryRoot: collected.repositoryRoot,
        diffPatch: collected.diffPatch,
        codeContext: collected.codeContext,
      }
      const reviewId = createLocalId('review')
      const sessionId = createLocalId('session')
      input.reviewId = reviewId
      input.sessionId = sessionId
      const messages: DiscussionMessageRecord[] = []
      const createdAt = new Date().toISOString()

      progress.report({ message: `Reviewer を ${models.reviewer.name} で実行しています` })
      logStep(output, `Reviewer を ${modelNameForStorage(models.reviewer)} で実行します`)
      const reviewerRaw = await callLanguageModel(
        models.reviewer,
        buildPrompt(reviewerPrompt, reviewerUserInput(input)),
        token,
        output,
        'Reviewer',
      )
      const reviewer = parseJsonObject<ReviewerOutput>(reviewerRaw, validateReviewerOutput)
      throwIfCancelled(token)
      messages.push({
        id: messages.length + 1,
        session_id: sessionId,
        round: 1,
        agent: 'REVIEWER',
        model_name: modelNameForStorage(models.reviewer),
        content: reviewer.content,
        judgment: null,
        created_at: new Date().toISOString(),
      })
      logArtifact(output, `review_id: ${reviewId}`)
      logArtifact(output, `session_id: ${sessionId}`)

      let nextAction: NextAction = {
        agent: 'EXAMINER',
        round: 1,
        status: 'ongoing',
        final_judgment: null,
        completion_reason: null,
      }

      while (nextAction.status === 'ongoing' && nextAction.agent) {
        throwIfCancelled(token)

        if (nextAction.agent === 'EXAMINER') {
          progress.report({
            message: `Round ${nextAction.round}: Examiner を ${models.examiner.name} で実行しています`,
          })
          logStep(output, `Round ${nextAction.round}: Examiner を ${modelNameForStorage(models.examiner)} で実行します`)
          const examinerRaw = await callLanguageModel(
            models.examiner,
            buildPrompt(examinerPrompt, examinerUserInput(input, messages)),
            token,
            output,
            `Round ${nextAction.round} Examiner`,
          )
          const examiner = parseJsonObject<ExaminerOutput>(examinerRaw, validateExaminerOutput)
          messages.push({
            id: messages.length + 1,
            session_id: sessionId,
            round: nextAction.round,
            agent: 'EXAMINER',
            model_name: modelNameForStorage(models.examiner),
            content: examiner.content,
            judgment: examiner.judgment,
            created_at: new Date().toISOString(),
          })
          logArtifact(output, `Examiner judgment: ${examiner.judgment}`)
          nextAction = nextActionAfterExaminer(nextAction.round, examiner.judgment)
          continue
        }

        progress.report({
          message: `Round ${nextAction.round}: Rebuttal を ${models.rebuttal.name} で実行しています`,
        })
        logStep(output, `Round ${nextAction.round}: Rebuttal を ${modelNameForStorage(models.rebuttal)} で実行します`)
        const rebuttalRaw = await callLanguageModel(
          models.rebuttal,
          buildPrompt(rebuttalPrompt, rebuttalUserInput(input, messages)),
          token,
          output,
          `Round ${nextAction.round} Rebuttal`,
        )
        const rebuttal = parseJsonObject<RebuttalOutput>(rebuttalRaw, validateRebuttalOutput)
        messages.push({
          id: messages.length + 1,
          session_id: sessionId,
          round: nextAction.round,
          agent: 'REBUTTAL',
          model_name: modelNameForStorage(models.rebuttal),
          content: rebuttal.content,
          judgment: null,
          created_at: new Date().toISOString(),
        })
        logArtifact(output, 'Rebuttal を投稿しました')
        nextAction = {
          agent: 'EXAMINER',
          round: nextAction.round,
          status: 'ongoing',
          final_judgment: null,
          completion_reason: null,
        }
      }

      if (!nextAction.final_judgment || !nextAction.completion_reason) {
        throw new Error('レビューの最終判定を確定できませんでした')
      }

      progress.report({ message: '最終的にバグと判定された指摘を抽出しています' })
      logStep(output, 'Conclusion: 最終的にバグと判定された指摘だけを抽出します')
      const conclusionRaw = await callLanguageModel(
        models.examiner,
        buildPrompt(conclusionSystemPrompt(), conclusionUserInput(input, messages, nextAction.final_judgment)),
        token,
        output,
        'Conclusion',
      )
      const conclusion = parseJsonObject<ConclusionOutput>(conclusionRaw, validateConclusionOutput)
      throwIfCancelled(token)

      const reportDraft: Omit<ReviewReport, 'markdownUri'> = {
        reviewId,
        sessionId,
        createdAt,
        purpose,
        repositoryRoot: collected.repositoryRoot,
        diffRange: collected.diffRange,
        conclusionMarkdown: conclusion.content,
        finalJudgment: nextAction.final_judgment,
        completionReason: nextAction.completion_reason,
        models: {
          reviewer: modelNameForStorage(models.reviewer),
          examiner: modelNameForStorage(models.examiner),
          rebuttal: modelNameForStorage(models.rebuttal),
        },
        messages,
      }
      const markdownUri = await writeMarkdownReport(workspaceFolder.uri.fsPath, reportDraft)
      const report: ReviewReport = { ...reportDraft, markdownUri }
      const finalJudgment = report.finalJudgment
      logArtifact(output, `Final judgment: ${finalJudgment}`)
      logArtifact(output, `Completion reason: ${report.completionReason}`)
      logArtifact(output, `Markdown report: ${report.markdownUri.fsPath}`)
      await openReviewPreview(context, report)
    },
  )
}

async function selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const activeUri = vscode.window.activeTextEditor?.document.uri
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined
  if (activeFolder) {
    return activeFolder
  }

  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 1) {
    return folders[0]
  }

  const selected = await vscode.window.showQuickPick(
    folders.map(folder => ({ label: folder.name, detail: folder.uri.fsPath, folder })),
    { title: 'ARGOS target workspace', placeHolder: 'レビュー対象のワークスペースを選択してください' },
  )
  return selected?.folder
}

function readSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('argos')
  return {
    includeContext: config.get('includeContext', true),
    contextBudget: config.get('contextBudget', 220_000),
  }
}

async function showReviewForm(
  workspaceFolder: vscode.WorkspaceFolder,
  settings: ExtensionSettings,
): Promise<ReviewFormResult | undefined> {
  const availableModels = await getAvailableLanguageModels()
  if (availableModels.length === 0) {
    throw new Error('VS Code から利用可能な Language Model が見つかりませんでした')
  }

  const sortedModels = sortModelsForDisplay(availableModels)
  const modelById = new Map(availableModels.map(model => [model.id, model]))
  const defaultReviewer = rankModels(availableModels, reviewerModelKeywords)[0] ?? sortedModels[0]
  const defaultExaminer = rankModels(availableModels, examinerModelKeywords)[0] ?? sortedModels[0]
  const labels = getReviewFormLabels(vscode.env.language)
  const panel = vscode.window.createWebviewPanel('argosAutoReview', labels.title, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })

  panel.webview.html = renderReviewFormHtml({
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    workspaceName: workspaceFolder.name,
    workspacePath: workspaceFolder.uri.fsPath,
    reviewerModels: sortedModels.map(serializeModel),
    examinerModels: sortedModels.map(serializeModel),
    defaultReviewerId: defaultReviewer.id,
    defaultExaminerId: defaultExaminer.id,
    labels,
  })

  return await new Promise<ReviewFormResult | undefined>((resolve, reject) => {
    let settled = false
    const finish = (value: ReviewFormResult | undefined) => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
      panel.dispose()
    }

    panel.onDidDispose(() => {
      if (!settled) {
        settled = true
        resolve(undefined)
      }
    })

    panel.webview.onDidReceiveMessage(message => {
      if (!message || typeof message !== 'object') {
        return
      }

      const record = message as Record<string, unknown>
      if (record.command === 'cancel') {
        finish(undefined)
        return
      }

      if (record.command !== 'submit') {
        return
      }

      try {
        const reviewer = getModelById(modelById, record.reviewerModelId)
        const examiner = getModelById(modelById, record.examinerModelId)
        const rebuttal = getModelById(modelById, record.rebuttalModelId)
        const purpose =
          typeof record.purpose === 'string' && record.purpose.trim() ? record.purpose.trim() : labels.emptyPurpose
        finish({ purpose, models: { reviewer, examiner, rebuttal } })
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function getAvailableLanguageModels(): Promise<vscode.LanguageModelChat[]> {
  const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' })
  const models = copilotModels.length > 0 ? copilotModels : await vscode.lm.selectChatModels()
  const seen = new Set<string>()
  return models.filter(model => {
    if (seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function serializeModel(model: vscode.LanguageModelChat): SerializedModel {
  return {
    id: model.id,
    name: model.name,
    description: modelFamilyDescription(model),
    detail: `${model.id} / max input ${model.maxInputTokens.toLocaleString()} tokens`,
  }
}

function getModelById(modelById: Map<string, vscode.LanguageModelChat>, value: unknown): vscode.LanguageModelChat {
  if (typeof value !== 'string') {
    throw new Error('モデル選択が不正です')
  }

  const model = modelById.get(value)
  if (!model) {
    throw new Error(`選択されたモデルが見つかりません: ${value}`)
  }
  return model
}

function getReviewFormLabels(language: string): ReviewFormLabels {
  const normalizedLanguage = language.toLowerCase()
  const isJapanese = normalizedLanguage === 'ja' || normalizedLanguage.startsWith('ja-')

  if (isJapanese) {
    return {
      htmlLang: 'ja',
      title: 'ARGOS 自動レビュー',
      connectionAriaLabel: '接続先',
      workspace: 'ワークスペース',
      models: 'モデル',
      reviewRequirements: 'レビュー観点',
      reviewRequirementsPlaceholder: 'Markdown でレビュー観点や追加要件を書けます',
      cancel: 'キャンセル',
      startReview: 'レビュー開始',
      emptyPurpose: '追加要件なし',
    }
  }

  return {
    htmlLang: 'en',
    title: 'ARGOS Auto Review',
    connectionAriaLabel: 'Connection targets',
    workspace: 'Workspace',
    models: 'Models',
    reviewRequirements: 'Review requirements',
    reviewRequirementsPlaceholder: 'Write review requirements or extra context in Markdown',
    cancel: 'Cancel',
    startReview: 'Start Review',
    emptyPurpose: 'No additional requirements',
  }
}

function renderReviewFormHtml(input: {
  cspSource: string
  nonce: string
  workspaceName: string
  workspacePath: string
  reviewerModels: SerializedModel[]
  examinerModels: SerializedModel[]
  defaultReviewerId: string
  defaultExaminerId: string
  labels: ReviewFormLabels
}): string {
  const reviewerOptions = renderModelOptions(input.reviewerModels, input.defaultReviewerId)
  const examinerOptions = renderModelOptions(input.examinerModels, input.defaultExaminerId)
  const labels = input.labels

  return `<!DOCTYPE html>
<html lang="${escapeAttribute(labels.htmlLang)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${input.cspSource} 'unsafe-inline'; script-src 'nonce-${input.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(labels.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px;
    }

    h1 {
      margin: 0 0 18px;
      font-size: 22px;
      font-weight: 600;
    }

    form {
      display: grid;
      gap: 18px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
    }

    .summary-item {
      min-width: 0;
    }

    .summary-label,
    label,
    legend {
      display: block;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .summary-value {
      overflow-wrap: anywhere;
    }

    fieldset {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
    }

    select,
    textarea {
      width: 100%;
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }

    select {
      min-height: 32px;
      padding: 5px 8px;
    }

    textarea {
      min-height: 300px;
      padding: 10px;
      resize: vertical;
      line-height: 1.5;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding-top: 4px;
    }

    button {
      min-width: 96px;
      min-height: 32px;
      padding: 6px 14px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
      font: inherit;
    }

    button[type='submit'] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    button[type='submit']:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button[type='button'] {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    button[type='button']:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>${escapeHtml(labels.title)}</h1>
    <form id="review-form">
      <section class="summary" aria-label="${escapeAttribute(labels.connectionAriaLabel)}">
        <div class="summary-item">
          <span class="summary-label">${escapeHtml(labels.workspace)}</span>
          <div class="summary-value">${escapeHtml(input.workspaceName)}<br>${escapeHtml(input.workspacePath)}</div>
        </div>
      </section>

      <fieldset>
        <legend>${escapeHtml(labels.models)}</legend>
        <div>
          <label for="reviewer-model">Reviewer</label>
          <select id="reviewer-model" required>${reviewerOptions}</select>
        </div>
        <div>
          <label for="examiner-model">Examiner</label>
          <select id="examiner-model" required>${examinerOptions}</select>
        </div>
        <div>
          <label for="rebuttal-model">Rebuttal</label>
          <select id="rebuttal-model" required>${examinerOptions}</select>
        </div>
      </fieldset>

      <div>
        <label for="purpose">${escapeHtml(labels.reviewRequirements)}</label>
        <textarea id="purpose" placeholder="${escapeAttribute(labels.reviewRequirementsPlaceholder)}"></textarea>
      </div>

      <div class="actions">
        <button id="cancel" type="button">${escapeHtml(labels.cancel)}</button>
        <button type="submit">${escapeHtml(labels.startReview)}</button>
      </div>
    </form>
  </main>

  <script nonce="${input.nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('review-form');
    const examinerModel = document.getElementById('examiner-model');
    const rebuttalModel = document.getElementById('rebuttal-model');
    const purpose = document.getElementById('purpose');

    document.getElementById('cancel').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      vscode.postMessage({
        command: 'submit',
        reviewerModelId: document.getElementById('reviewer-model').value,
        examinerModelId: examinerModel.value,
        rebuttalModelId: rebuttalModel.value,
        purpose: purpose.value,
      });
    });
  </script>
</body>
</html>`
}

function renderModelOptions(models: SerializedModel[], selectedId: string): string {
  return models
    .map(model => {
      const selected = model.id === selectedId ? ' selected' : ''
      return `<option value="${escapeAttribute(model.id)}"${selected}>${escapeHtml(model.name)} - ${escapeHtml(model.description || model.detail)}</option>`
    })
    .join('')
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function modelFamilyDescription(model: vscode.LanguageModelChat): string {
  return [model.vendor, model.family, model.version].filter(Boolean).join(' / ')
}

function rankModels(models: vscode.LanguageModelChat[], keywords: string[]): vscode.LanguageModelChat[] {
  const preferred: vscode.LanguageModelChat[] = []
  const rest: vscode.LanguageModelChat[] = []

  for (const model of models) {
    const haystack = `${model.name} ${model.id} ${model.vendor} ${model.family}`.toLowerCase()
    if (keywords.some(keyword => haystack.includes(keyword))) {
      preferred.push(model)
    } else {
      rest.push(model)
    }
  }

  return [...preferred.sort(compareModels), ...rest.sort(compareModels)]
}

function sortModelsForDisplay(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat[] {
  return [...models].sort(compareModels)
}

function compareModels(left: vscode.LanguageModelChat, right: vscode.LanguageModelChat): number {
  const leftLabel = `${left.name} ${left.vendor} ${left.family} ${left.version} ${left.id}`
  const rightLabel = `${right.name} ${right.vendor} ${right.family} ${right.version} ${right.id}`
  return leftLabel.localeCompare(rightLabel, 'en', { numeric: true, sensitivity: 'base' })
}

function modelNameForStorage(model: vscode.LanguageModelChat): string {
  const name = `${model.name} (${model.id})`
  return name.length > 120 ? name.slice(0, 117) + '...' : name
}

async function readPromptAsset(context: vscode.ExtensionContext, fileName: string): Promise<string> {
  const uri = vscode.Uri.file(context.asAbsolutePath(path.join('assets', 'prompts', fileName)))
  const bytes = await vscode.workspace.fs.readFile(uri)
  return textDecoder.decode(bytes)
}

async function collectReviewInput(
  workspaceRoot: string,
  settings: ExtensionSettings,
): Promise<{ repositoryRoot: string; diffRange: string; diffPatch: string; codeContext?: string }> {
  const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
  const baseBranch = await inferReviewBaseBranch(repositoryRoot)
  const diffRange = `${baseBranch}...HEAD`
  const diffPatch = await readReviewDiff(repositoryRoot, diffRange)

  if (!diffPatch.trim()) {
    throw new Error(`レビュー対象の Git 変更差分が見つかりませんでした (${diffRange})`)
  }

  const codeContext = settings.includeContext
    ? await buildCodeContext(repositoryRoot, diffPatch, settings.contextBudget)
    : undefined

  return { repositoryRoot, diffRange, diffPatch, codeContext: codeContext || undefined }
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string> {
  try {
    const stdout = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])
    return stdout.trim() || workspaceRoot
  } catch {
    throw new Error('現在のワークスペースは Git リポジトリとして認識できませんでした')
  }
}

async function inferReviewBaseBranch(repositoryRoot: string): Promise<string> {
  const fallbackBranch = await getDefaultBranch(repositoryRoot)
  const currentBranch = (await runGitOrEmpty(repositoryRoot, ['branch', '--show-current'])).trim()
  const headCommit = (await runGitOrEmpty(repositoryRoot, ['rev-parse', 'HEAD'])).trim()

  if (!currentBranch || currentBranch === fallbackBranch) {
    return fallbackBranch
  }

  const branchOutput = await runGitOrEmpty(repositoryRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes',
  ])
  const candidates = [
    ...new Set(
      branchOutput
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean),
    ),
  ]
    .filter(branch => branch !== 'HEAD')
    .filter(branch => !branch.endsWith('/HEAD'))
    .filter(branch => branch !== currentBranch)
    .filter(branch => !branch.endsWith(`/${currentBranch}`))
    .sort()

  let bestBranch = ''
  let bestTimestamp = 0
  for (const branch of candidates) {
    const mergeBase = (await runGitOrEmpty(repositoryRoot, ['merge-base', 'HEAD', branch])).trim()
    if (!mergeBase || mergeBase === headCommit) {
      continue
    }

    const timestampText = (await runGitOrEmpty(repositoryRoot, ['show', '-s', '--format=%ct', mergeBase])).trim()
    const timestamp = Number.parseInt(timestampText, 10)
    if (Number.isFinite(timestamp) && timestamp > bestTimestamp) {
      bestTimestamp = timestamp
      bestBranch = branch
    }
  }

  return bestBranch || fallbackBranch
}

async function getDefaultBranch(repositoryRoot: string): Promise<string> {
  const remoteHead = (
    await runGitOrEmpty(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  ).trim()
  if (remoteHead) {
    const branch = path.posix.basename(remoteHead.replace(/\\/g, '/')).trim()
    if (branch) {
      return branch
    }
  }

  return 'main'
}

async function readReviewDiff(repositoryRoot: string, diffRange: string): Promise<string> {
  try {
    return await runGit(repositoryRoot, ['diff', '--no-ext-diff', diffRange, '--'])
  } catch (error) {
    throw new Error(`レビュー差分の生成に失敗しました (${diffRange}): ${formatError(error)}`)
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return String(result.stdout)
}

async function runGitOrEmpty(cwd: string, args: string[]): Promise<string> {
  try {
    return await runGit(cwd, args)
  } catch {
    return ''
  }
}

function normalizeWorkspacePath(workspaceRoot: string, candidate: string): string | null {
  const normalized = path.normalize(candidate).replace(/^[/\\]+/, '')
  if (!normalized || normalized === '.' || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null
  }

  const parts = normalized.split(path.sep)
  if (parts.some(part => ignoredPathParts.has(part))) {
    return null
  }

  const absolutePath = path.resolve(workspaceRoot, normalized)
  const absoluteRoot = path.resolve(workspaceRoot)
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    return null
  }

  return normalized
}

function parseDiffPaths(diffPatch: string, workspaceRoot: string): string[] {
  const paths = new Set<string>()
  for (const line of diffPatch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.*?) b\/(.*)$/)
      if (match?.[2]) {
        const parsed = normalizeWorkspacePath(workspaceRoot, match[2])
        if (parsed) {
          paths.add(parsed)
        }
      }
      continue
    }

    if (line.startsWith('+++ b/')) {
      const parsed = normalizeWorkspacePath(workspaceRoot, line.slice('+++ b/'.length).trim())
      if (parsed) {
        paths.add(parsed)
      }
    }
  }
  return [...paths]
}

function shouldReadTextFile(filePath: string): boolean {
  return textExtensions.has(path.extname(filePath).toLowerCase())
}

async function buildCodeContext(workspaceRoot: string, diffPatch: string, budget: number): Promise<string> {
  const paths = new Set<string>()
  for (const fileName of metadataFiles) {
    const parsed = normalizeWorkspacePath(workspaceRoot, fileName)
    if (parsed) {
      paths.add(parsed)
    }
  }

  for (const fileName of parseDiffPaths(diffPatch, workspaceRoot)) {
    paths.add(fileName)
  }

  const blocks: string[] = []
  let remainingBudget = Math.max(0, budget)
  for (const relativePath of paths) {
    const block = await readContextFile(workspaceRoot, relativePath, remainingBudget)
    if (!block) {
      continue
    }
    blocks.push(block)
    remainingBudget -= block.length
    if (remainingBudget <= 0) {
      break
    }
  }

  return blocks.join('\n\n---\n\n')
}

async function readContextFile(
  workspaceRoot: string,
  relativePath: string,
  remainingBudget: number,
): Promise<string | null> {
  if (remainingBudget <= 0 || !shouldReadTextFile(relativePath)) {
    return null
  }

  const fullPath = path.resolve(workspaceRoot, relativePath)
  try {
    const stats = await fs.stat(fullPath)
    if (!stats.isFile()) {
      return null
    }

    const content = await fs.readFile(fullPath, 'utf8')
    const clipped = content.length > remainingBudget ? `${content.slice(0, remainingBudget)}\n...[truncated]` : content
    return `### ${relativePath}\n\n\`\`\`\n${clipped}\n\`\`\``
  } catch {
    return null
  }
}

function buildPrompt(systemPrompt: string, userPrompt: string): string {
  return `${systemPrompt.trim()}\n\n---\n\n${userPrompt.trim()}`
}

function reviewerUserInput(input: RunInput): string {
  return `レビュー観点・要件:\n${input.purpose}\n\nリポジトリ:\n${input.repositoryRoot}\n\n差分:\n\n${input.diffPatch}${formatCodeContext(input)}`
}

function examinerUserInput(input: RunInput, messages: DiscussionMessageRecord[]): string {
  return `レビュー観点・要件:\n${input.purpose}\n\n対象 review_id:\n${input.reviewId ?? 'unknown'}\n対象 session_id:\n${input.sessionId ?? 'unknown'}\n\nこれまでの会話:\n${formatMessages(messages)}\n\n差分:\n\n${input.diffPatch}${formatCodeContext(input)}`
}

function rebuttalUserInput(input: RunInput, messages: DiscussionMessageRecord[]): string {
  return `レビュー観点・要件:\n${input.purpose}\n\n対象 review_id:\n${input.reviewId ?? 'unknown'}\n対象 session_id:\n${input.sessionId ?? 'unknown'}\n\nこれまでの会話:\n${formatMessages(messages)}\n\n差分:\n\n${input.diffPatch}${formatCodeContext(input)}`
}

function conclusionSystemPrompt(): string {
  return `あなたは ARGOS の最終結論を作成します。

## 目的

reviewer / examiner / rebuttal の議論から、最終的にバグと判定された指摘だけを抽出してください。

## 制約

- 誤検知、根拠不足、要再検討、前提依存、未確定の指摘は含めない
- 最終 examiner が妥当と明示した指摘だけを含める
- 判断が曖昧な指摘は含めない
- 新しい指摘を作らない
- バグが 1 件も確定していない場合は「最終的にバグと判定された指摘はありません。」とだけ書く

## 出力

必ず JSON だけを返してください。Markdown フェンスや説明文は付けないでください。

{"content":"Markdown の結論本文"}

## Markdown 形式

確定バグがある場合:

### H1

- 重大度: High | Medium | Low
- 対象: path/to/file.ext:123
- バグ:
- 根拠:
- 影響:
- 修正方針:

必要な件数だけ続け、重大度の高い順に並べてください。`
}

function conclusionUserInput(
  input: RunInput,
  messages: DiscussionMessageRecord[],
  finalJudgment: FinalJudgment,
): string {
  return `レビュー観点・要件:
${input.purpose}

対象 review_id:
${input.reviewId ?? 'unknown'}
対象 session_id:
${input.sessionId ?? 'unknown'}
最終判定:
${finalJudgment}

これまでの会話:
${formatMessages(messages)}`
}

function formatCodeContext(input: RunInput): string {
  return input.codeContext ? `\n\n関連コードコンテキスト:\n\n${input.codeContext}` : ''
}

function formatMessages(messages: DiscussionMessageRecord[]): string {
  return messages
    .map(message => {
      const judgment = message.judgment ? ` judgment=${message.judgment}` : ''
      return `Round ${message.round} ${message.agent} model=${message.model_name ?? 'Unknown'}${judgment}\n${message.content}`
    })
    .join('\n\n---\n\n')
}

async function callLanguageModel(
  model: vscode.LanguageModelChat,
  prompt: string,
  token: vscode.CancellationToken,
  output: vscode.OutputChannel,
  label: string,
): Promise<string> {
  const startedAt = Date.now()
  logProgress(output, `${label}: Language Model API に送信します (${formatCount(prompt.length)} chars prompt)`)

  let response: vscode.LanguageModelChatResponse
  const requestHeartbeat = setInterval(() => {
    logProgress(output, `${label}: モデル応答待機中 (${formatElapsed(startedAt)})`)
  }, 15_000)

  try {
    response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {
        justification: 'ARGOS 自動レビューで reviewer / examiner / rebuttal を実行するために利用します。',
      },
      token,
    )
  } finally {
    clearInterval(requestHeartbeat)
  }

  logProgress(output, `${label}: 応答ストリームを受信開始 (${formatElapsed(startedAt)})`)

  let text = ''
  let lastLoggedAt = Date.now()
  let lastLoggedLength = 0
  const streamHeartbeat = setInterval(() => {
    logProgress(output, `${label}: 応答受信中 ${formatCount(text.length)} chars (${formatElapsed(startedAt)})`)
  }, 15_000)

  try {
    for await (const fragment of response.text) {
      text += fragment
      const now = Date.now()
      if (text.length - lastLoggedLength >= 4_000 || now - lastLoggedAt >= 5_000) {
        logProgress(output, `${label}: 応答受信中 ${formatCount(text.length)} chars (${formatElapsed(startedAt)})`)
        lastLoggedAt = now
        lastLoggedLength = text.length
      }
    }
  } finally {
    clearInterval(streamHeartbeat)
  }

  logProgress(output, `${label}: 応答受信完了 ${formatCount(text.length)} chars (${formatElapsed(startedAt)})`)
  return text
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence ? fence[1].trim() : trimmed
}

/**
 * モデル応答の JSON 文字列内に含まれる不正なエスケープシーケンス（`\な` のように
 * `\` の後に JSON 仕様上有効でない文字が続くケース）を `\\` に変換して
 * JSON.parse が通る状態に正規化する。
 * 有効な JSON エスケープ: \" \\ \/ \b \f \n \r \t \uXXXX
 */
function sanitizeJsonEscapes(text: string): string {
  return text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
}

function parseJsonObject<T>(text: string, validate: (value: unknown) => T): T {
  const stripped = stripJsonFence(text)
  const sanitized = sanitizeJsonEscapes(stripped)
  try {
    return validate(JSON.parse(sanitized))
  } catch {
    const start = sanitized.indexOf('{')
    const end = sanitized.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return validate(JSON.parse(sanitized.slice(start, end + 1)))
    }
    throw new Error(`モデル応答が JSON として解釈できませんでした: ${stripped.slice(0, 300)}`)
  }
}

function validateReviewerOutput(value: unknown): ReviewerOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('reviewer response must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.has_findings !== 'boolean' || typeof record.content !== 'string' || !record.content.trim()) {
    throw new Error('reviewer response must include has_findings and content')
  }
  return { has_findings: record.has_findings, content: record.content.trim() }
}

function validateExaminerOutput(value: unknown): ExaminerOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('examiner response must be an object')
  }
  const record = value as Record<string, unknown>
  if ((record.judgment !== 'OK' && record.judgment !== 'NG') || typeof record.content !== 'string') {
    throw new Error('examiner response must include judgment OK/NG and content')
  }
  return { judgment: record.judgment, content: record.content.trim() }
}

function validateRebuttalOutput(value: unknown): RebuttalOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('rebuttal response must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string' || !record.content.trim()) {
    throw new Error('rebuttal response must include content')
  }
  return { content: record.content.trim() }
}

function validateConclusionOutput(value: unknown): ConclusionOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('conclusion response must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string' || !record.content.trim()) {
    throw new Error('conclusion response must include content')
  }
  return { content: record.content.trim() }
}

function createLocalId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function nextActionAfterExaminer(round: number, judgment: FinalJudgment): NextAction {
  if (judgment === 'OK') {
    return {
      agent: null,
      round,
      status: 'finished',
      final_judgment: 'OK',
      completion_reason: 'approved',
    }
  }

  if (round >= 3) {
    return {
      agent: null,
      round,
      status: 'finished',
      final_judgment: 'NG',
      completion_reason: 'max_rounds_reached',
    }
  }

  return {
    agent: 'REBUTTAL',
    round: round + 1,
    status: 'ongoing',
    final_judgment: null,
    completion_reason: null,
  }
}

async function writeMarkdownReport(
  workspaceRoot: string,
  report: Omit<ReviewReport, 'markdownUri'>,
): Promise<vscode.Uri> {
  const directoryUri = vscode.Uri.file(workspaceRoot)
  const fileName = `${toFileTimestamp(report.createdAt)}-${report.finalJudgment.toLowerCase()}-${report.sessionId}.md`
  const reportUri = vscode.Uri.joinPath(directoryUri, fileName)
  await vscode.workspace.fs.writeFile(reportUri, textEncoder.encode(renderReportMarkdown(report)))
  return reportUri
}

function toFileTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function renderReportMarkdown(report: Omit<ReviewReport, 'markdownUri'>): string {
  const lines = [
    '# ARGOS Review',
    '',
    `- Final judgment: ${report.finalJudgment}`,
    `- Completion reason: ${report.completionReason}`,
    `- Review ID: ${report.reviewId}`,
    `- Session ID: ${report.sessionId}`,
    `- Created: ${report.createdAt}`,
    `- Repository: ${report.repositoryRoot}`,
    `- Diff range: ${report.diffRange}`,
    `- Reviewer model: ${report.models.reviewer}`,
    `- Examiner model: ${report.models.examiner}`,
    `- Rebuttal model: ${report.models.rebuttal}`,
    '',
    '## Review Requirements',
    '',
    report.purpose,
    '',
    '## Conclusion',
    '',
    report.conclusionMarkdown,
    '',
    '## Discussion',
    '',
  ]

  for (const message of report.messages) {
    const judgment = message.judgment ? ` (${message.judgment})` : ''
    lines.push(`### Round ${message.round} - ${formatAgentLabel(message.agent)}${judgment}`)
    lines.push('')
    lines.push(`- Model: ${message.model_name ?? 'Unknown'}`)
    lines.push(`- Created: ${message.created_at}`)
    lines.push('')
    lines.push(message.content)
    lines.push('')
  }

  return `${lines.join('\n').trim()}\n`
}

async function openReviewPreview(context: vscode.ExtensionContext, report: ReviewReport): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'argosReviewPreview',
    `ARGOS Review ${report.finalJudgment}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  )

  panel.webview.html = renderReviewPreviewHtml({
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    report,
  })

  const disposable = panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== 'object') {
      return
    }

    const record = message as Record<string, unknown>
    if (record.command === 'openMarkdown') {
      await vscode.window.showTextDocument(report.markdownUri, { preview: false })
    }
  })
  context.subscriptions.push(disposable)
}

function renderReviewPreviewHtml(input: { cspSource: string; nonce: string; report: ReviewReport }): string {
  const report = input.report
  const judgmentClass = report.finalJudgment === 'OK' ? 'ok' : 'ng'
  const messageCards = report.messages.map(renderMessageCardHtml).join('')
  const markdownPath = vscode.workspace.asRelativePath(report.markdownUri, false)

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${input.cspSource} 'unsafe-inline'; script-src 'nonce-${input.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARGOS Review</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.6;
    }
    .shell {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 24px 48px;
    }
    .header {
      display: grid;
      gap: 18px;
      margin-bottom: 22px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 650;
    }
    h2 {
      margin: 28px 0 12px;
      font-size: 18px;
      font-weight: 650;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 2px 10px;
      border-radius: 999px;
      border: 1px solid currentColor;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .badge.ok {
      color: var(--vscode-testing-iconPassed, #2da44e);
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #2da44e) 12%, transparent);
    }
    .badge.ng {
      color: var(--vscode-testing-iconFailed, #cf222e);
      background: color-mix(in srgb, var(--vscode-testing-iconFailed, #cf222e) 12%, transparent);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .meta-item {
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
    }
    .meta-label {
      display: block;
      margin-bottom: 3px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .meta-value {
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    button {
      min-height: 32px;
      padding: 5px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
      font: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .path {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .purpose,
    .conclusion,
    .message-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
    }
    .purpose,
    .conclusion {
      padding: 14px 16px;
    }
    .purpose {
      white-space: pre-wrap;
    }
    .message-list {
      display: grid;
      gap: 14px;
    }
    .message-card {
      overflow: hidden;
    }
    .message-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .message-title {
      font-weight: 700;
    }
    .model {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .message-body {
      padding: 14px 18px 18px;
    }
    .markdown h1,
    .markdown h2,
    .markdown h3,
    .markdown h4 {
      margin: 18px 0 8px;
      line-height: 1.3;
    }
    .markdown h1 { font-size: 21px; }
    .markdown h2 { font-size: 18px; }
    .markdown h3 { font-size: 16px; }
    .markdown h4 { font-size: 14px; }
    .markdown p { margin: 8px 0; }
    .markdown ul,
    .markdown ol { margin: 8px 0 8px 22px; padding: 0; }
    .markdown li { margin: 3px 0; }
    .markdown code {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family);
    }
    .markdown pre {
      overflow: auto;
      padding: 12px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
    }
    .markdown pre code { padding: 0; background: transparent; }
    .markdown blockquote {
      margin: 10px 0;
      padding-left: 12px;
      border-left: 3px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .markdown hr {
      border: 0;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 16px 0;
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <div class="title-row">
        <h1>ARGOS Review</h1>
        <span class="badge ${judgmentClass}">${escapeHtml(report.finalJudgment)}</span>
      </div>
      <div class="meta-grid">
        ${renderMetaItem('Completion', report.completionReason)}
        ${renderMetaItem('Review ID', report.reviewId)}
        ${renderMetaItem('Session ID', report.sessionId)}
        ${renderMetaItem('Created', report.createdAt)}
        ${renderMetaItem('Repository', report.repositoryRoot)}
        ${renderMetaItem('Diff Range', report.diffRange)}
        ${renderMetaItem('Reviewer Model', report.models.reviewer)}
        ${renderMetaItem('Examiner Model', report.models.examiner)}
        ${renderMetaItem('Rebuttal Model', report.models.rebuttal)}
      </div>
      <div class="actions">
        <button id="open-markdown" type="button">Open Markdown</button>
        <span class="path">${escapeHtml(markdownPath)}</span>
      </div>
    </header>

    <section>
      <h2>Review Requirements</h2>
      <div class="purpose">${escapeHtml(report.purpose)}</div>
    </section>

    <section>
      <h2>Conclusion</h2>
      <div class="conclusion markdown">${renderMarkdownToHtml(report.conclusionMarkdown)}</div>
    </section>

    <section>
      <h2>Discussion</h2>
      <div class="message-list">${messageCards}</div>
    </section>
  </main>
  <script nonce="${input.nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open-markdown').addEventListener('click', () => {
      vscode.postMessage({ command: 'openMarkdown' });
    });
  </script>
</body>
</html>`
}

function renderMetaItem(label: string, value: string): string {
  return `<div class="meta-item"><span class="meta-label">${escapeHtml(label)}</span><div class="meta-value">${escapeHtml(value)}</div></div>`
}

function renderMessageCardHtml(message: DiscussionMessageRecord): string {
  const judgment = message.judgment
    ? ` <span class="badge ${message.judgment === 'OK' ? 'ok' : 'ng'}">${message.judgment}</span>`
    : ''
  return `<article class="message-card">
    <div class="message-header">
      <div class="message-title">Round ${message.round} - ${escapeHtml(formatAgentLabel(message.agent))}${judgment}</div>
      <div class="model">${escapeHtml(message.model_name ?? 'Unknown')}</div>
    </div>
    <div class="message-body markdown">${renderMarkdownToHtml(message.content)}</div>
  </article>`
}

function renderMarkdownToHtml(markdown: string): string {
  const blocks: string[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fence = trimmed.match(/^```(.*)$/)
    if (fence) {
      const language = fence[1].trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      const className = language ? ` class="language-${escapeAttribute(language)}"` : ''
      blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderInlineMarkdown(lines[index].trim().replace(/^[-*]\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderInlineMarkdown(lines[index].trim().replace(/^\d+\.\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${quoteLines.map(renderInlineMarkdown).join('<br>')}</blockquote>`)
      continue
    }

    const paragraph: string[] = [trimmed]
    index += 1
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index].trim())) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
  }

  return blocks.join('\n')
}

function isMarkdownBlockStart(trimmedLine: string): boolean {
  return (
    /^```/.test(trimmedLine) ||
    /^(#{1,4})\s+/.test(trimmedLine) ||
    /^[-*]\s+/.test(trimmedLine) ||
    /^\d+\.\s+/.test(trimmedLine) ||
    /^---+$/.test(trimmedLine) ||
    trimmedLine.startsWith('>')
  )
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function formatAgentLabel(agent: MessageAgent): string {
  if (agent === 'REVIEWER') {
    return 'Reviewer'
  }
  if (agent === 'EXAMINER') {
    return 'Examiner'
  }
  return 'Rebuttal'
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new Error('キャンセルされました')
  }
}

function logStep(output: vscode.OutputChannel, message: string): void {
  output.appendLine(`[STEP] ${message}`)
}

function logArtifact(output: vscode.OutputChannel, message: string): void {
  output.appendLine(`[ARTIFACT] ${message}`)
}

function logProgress(output: vscode.OutputChannel, message: string): void {
  output.appendLine(`[PROGRESS] ${message}`)
}

function formatElapsed(startedAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
