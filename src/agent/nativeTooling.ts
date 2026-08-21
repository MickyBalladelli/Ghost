import type { ChatResponseFormat, ChatToolDefinition } from '../services/chatTypes'

const stringProperty = { type: 'string' }
const booleanProperty = { type: 'boolean' }
const integerProperty = (minimum: number) => ({ type: 'integer', minimum })

const editHunkSchema = {
  type: 'object',
  properties: {
    startLine: integerProperty(1),
    endLine: integerProperty(1),
    replacement: stringProperty,
    oldText: { type: 'string', description: 'Optional exact text currently replaced by this hunk.' },
    oldHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: 'Optional SHA-256 hash of the current text replaced by this hunk.' },
    beforeContext: { type: 'string', description: 'Optional exact nearby text immediately before the hunk.' },
    afterContext: { type: 'string', description: 'Optional exact nearby text immediately after the hunk.' }
  },
  required: ['startLine', 'endLine', 'replacement'],
  anyOf: [
    { required: ['oldText'] },
    { required: ['oldHash'] },
    { required: ['beforeContext'] },
    { required: ['afterContext'] }
  ],
  additionalProperties: false
}

const transactionEditSchema = {
  type: 'object',
  properties: {
    path: stringProperty,
    content: { type: 'string', description: 'Complete replacement content. Use this or hunks, not both.' },
    expectedContent: { type: 'string', description: 'Optional exact content expected before applying this file edit.' },
    hunks: { type: 'array', minItems: 1, maxItems: 50, items: editHunkSchema }
  },
  required: ['path'],
  anyOf: [
    { required: ['content'] },
    { required: ['hunks'] }
  ],
  additionalProperties: false
}

export const GHOST_NATIVE_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'ghost_read_file',
      description: 'Read a file or an open editor buffer in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: stringProperty,
          allowSpecialFile: { type: 'boolean', description: 'Set true only when the user explicitly asks to inspect a generated, vendored, or ignored file.' },
          source: { type: 'string', enum: ['editor', 'disk'] },
          mode: { type: 'string', enum: ['head', 'tail', 'lines', 'bytes', 'symbol', 'matches'] },
          startLine: integerProperty(1),
          endLine: integerProperty(1),
          lineCount: integerProperty(1),
          startByte: { type: 'integer', minimum: 0 },
          endByte: { type: 'integer', minimum: 0 },
          symbol: { type: 'string', description: "Required when mode is 'symbol'." },
          match: { type: 'string', description: "Required when mode is 'matches'." },
          caseSensitive: booleanProperty,
          maxMatches: integerProperty(1)
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_search_workspace',
      description: 'Search text in workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: stringProperty,
          path: stringProperty,
          glob: stringProperty,
          caseSensitive: booleanProperty,
          maxResults: integerProperty(1)
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_get_diagnostics',
      description: 'Read compiler and editor diagnostics.',
      parameters: {
        type: 'object',
        properties: { path: stringProperty, severity: { type: 'string', enum: ['error', 'warning', 'information', 'hint'] }, maxResults: integerProperty(1) },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_git_context',
      description: 'Read workspace Git status, diff, branch, or history.',
      parameters: {
        type: 'object',
        properties: { operation: { type: 'string', enum: ['status', 'diff', 'stagedDiff', 'branch', 'history'] }, path: stringProperty, maxEntries: integerProperty(1) },
        required: ['operation'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_update_task_plan',
      description: 'Optional bookkeeping for a bounded task plan. Never a substitute for a file tool.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'object', properties: { id: stringProperty, title: stringProperty, checked: booleanProperty }, required: ['id', 'title', 'checked'], additionalProperties: false } },
          currentStep: stringProperty,
          blockedReason: stringProperty,
          completionEvidence: { type: 'array', items: stringProperty }
        },
        required: ['steps'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_record_completion',
      description: 'Optional final completion record. Call only after files actually changed. Never a substitute for a file tool.',
      parameters: {
        type: 'object',
        properties: {
          changedFiles: { type: 'array', items: stringProperty },
          checksRun: { type: 'array', items: stringProperty },
          failures: { type: 'array', items: stringProperty },
          remainingWork: { type: 'array', items: stringProperty }
        },
        required: ['changedFiles', 'checksRun', 'failures', 'remainingWork'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_write_file',
      description: 'Write complete content to a workspace file after it has been read.',
      parameters: {
        type: 'object',
        properties: { path: stringProperty, content: stringProperty },
        required: ['path', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_apply_edit',
      description: 'Apply focused, context-checked edits to a workspace file. Include oldText, oldHash, beforeContext, or afterContext in every hunk.',
      parameters: {
        type: 'object',
        properties: {
          path: stringProperty,
          expectedContent: stringProperty,
          hunks: { type: 'array', minItems: 1, maxItems: 50, items: editHunkSchema }
        },
        required: ['path', 'hunks'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_apply_transaction',
      description: 'Apply several coordinated workspace edits as one transaction.',
      parameters: {
        type: 'object',
        properties: { edits: { type: 'array', minItems: 2, maxItems: 50, items: transactionEditSchema } },
        required: ['edits'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_run_terminal_command',
      description: 'Run a requested or useful verification command in the workspace.',
      parameters: {
        type: 'object',
        properties: { command: stringProperty, cwd: stringProperty },
        required: ['command'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_list_directory',
      description: 'List files and folders in the workspace.',
      parameters: {
        type: 'object',
        properties: { path: stringProperty, recursive: booleanProperty, pageSize: integerProperty(1), maxDepth: { type: 'integer', minimum: 0 }, cursor: stringProperty },
        required: ['path'],
        additionalProperties: false
      }
    }
  }
]

export const JSON_OBJECT_RESPONSE_FORMAT: ChatResponseFormat = {
  type: 'json_object'
}
