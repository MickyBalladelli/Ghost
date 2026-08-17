import * as vscode from 'vscode'

export interface TaskPlanStep {
  id: string
  title: string
  checked: boolean
  evidence?: string
}

export interface TaskPlan {
  steps: TaskPlanStep[]
  currentStep?: string
  blockedReason?: string
  completionEvidence: string[]
  updatedAt: number
}

export interface TaskPlanInput {
  steps: Array<{ id: string; title: string; checked: boolean; evidence?: string }>
  currentStep?: string
  blockedReason?: string
  completionEvidence?: string[]
}

export const TASK_PLAN_MARKER = 'Ghost task plan:'

const cleanText = (value: string, maximum: number): string => value.trim().slice(0, maximum)

export function normalizeTaskPlan(input: TaskPlanInput): TaskPlan {
  const seen = new Set<string>()
  const steps = input.steps.slice(0, 50).flatMap(step => {
    const id = cleanText(step.id, 100)
    const title = cleanText(step.title, 500)
    if (!id || !title || seen.has(id)) return []
    seen.add(id)
    return [{ id, title, checked: step.checked === true, ...(step.evidence?.trim() ? { evidence: cleanText(step.evidence, 1000) } : {}) }]
  })
  const currentStep = input.currentStep && seen.has(input.currentStep) ? input.currentStep : undefined
  const completionEvidence = (input.completionEvidence ?? [])
    .filter(item => typeof item === 'string' && item.trim())
    .slice(0, 10)
    .map(item => cleanText(item, 1000))
  return {
    steps,
    ...(currentStep ? { currentStep } : {}),
    ...(input.blockedReason?.trim() ? { blockedReason: cleanText(input.blockedReason, 1000) } : {}),
    completionEvidence,
    updatedAt: Date.now()
  }
}

export function parseTaskPlanMarker(value: string): TaskPlan | undefined {
  if (!value.startsWith(TASK_PLAN_MARKER)) return undefined
  try {
    const parsed = JSON.parse(value.slice(TASK_PLAN_MARKER.length).trim()) as TaskPlanInput
    return parsed && Array.isArray(parsed.steps) ? normalizeTaskPlan(parsed) : undefined
  } catch {
    return undefined
  }
}

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

export class TaskPlanTool implements vscode.LanguageModelTool<TaskPlanInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<TaskPlanInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new Error('Task plan update cancelled')
    const input = options.input
    if (!input || !Array.isArray(input.steps) || input.steps.length > 50) throw new Error('steps must have at most 50 items')
    if (input.steps.some(step => !step || typeof step.id !== 'string' || typeof step.title !== 'string' || typeof step.checked !== 'boolean')) {
      throw new Error('Each task plan step needs string id, string title, and boolean checked')
    }
    const plan = normalizeTaskPlan(input)
    return textResult(`${TASK_PLAN_MARKER} ${JSON.stringify(plan)}`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<TaskPlanInput>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Updating task plan (${options.input.steps.length} steps)` }
  }
}

export function registerTaskPlanTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('ghost_update_task_plan', new TaskPlanTool()))
}
