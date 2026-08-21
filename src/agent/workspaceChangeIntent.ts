const HOW_TO_QUESTION = /^\s*(?:how(?:\s+do(?:es)?|\s+can|\s+should)?\s+(?:i|we|you)?|what(?:'s| is)|why|when|where)\b/i
const EXPLICIT_WORK = /\b(?:implement|refactor|wire(?:\s+up)?)\b/i
const EDIT_ARTIFACT = /\b(?:edit|modify|update|change|rewrite|replace|patch|fix)\s+(?:the\s+)?(?:file|code|function|class|method|component|test|import|export|handler|route|module|bug|error|issue|typo)\b/i
const ADD_ARTIFACT = /\b(?:add|create|write|delete|remove)\s+(?:a\s+|an\s+|the\s+|this\s+)?(?:file|function|class|method|component|test|hunk|import|export|type|interface|module|route|handler|endpoint)\b/i
const PATH_EDIT = /\b(?:edit|change|update|modify|fix|write(?:\s+to)?|create|delete|remove|add|implement)\b[\s\S]{0,80}?\b[\w./\\-]+\.\w{1,8}\b/i
const APPLY_EDIT = /\bapply\s+(?:this|the|these|that)\s+(?:edit|change|patch|fix|diff|hunks?)\b/i
const DIRECT_REQUEST = /\b(?:please|go ahead and|make sure to)\s+(?:fix|edit|implement|update|add|create|write|remove|delete|replace|refactor)\b/i

export function describesWorkspaceChange(value: string): boolean {
  const text = value.trim()
  if (!text) {
    return false
  }

  const matchesIntent = EXPLICIT_WORK.test(text)
    || EDIT_ARTIFACT.test(text)
    || ADD_ARTIFACT.test(text)
    || PATH_EDIT.test(text)
    || APPLY_EDIT.test(text)
    || DIRECT_REQUEST.test(text)

  if (!matchesIntent) {
    return false
  }

  if (HOW_TO_QUESTION.test(text) && !PATH_EDIT.test(text) && !DIRECT_REQUEST.test(text) && !/\b(?:this file|the workspace|the project)\b/i.test(text)) {
    return false
  }

  return true
}

export function isLikelyConversationalPrompt(value: string): boolean {
  const prompt = value.trim()
  if (!prompt || prompt.length > 240 || describesWorkspaceChange(prompt)) {
    return false
  }
  return !/\b(?:file|folder|workspace|project|repository|repo|code|bug|error|test|diagnostic|terminal|command|run|inspect|read|search|find|list|tool|function|class|module|api|extension)\b/i.test(prompt)
}
