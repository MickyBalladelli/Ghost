import type { ChatResponseFormat, ChatToolDefinition } from '../services/chatTypes'

const stringProperty = { type: 'string' }
const booleanProperty = { type: 'boolean' }

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
          source: { type: 'string', enum: ['editor', 'disk'] },
          mode: { type: 'string', enum: ['head', 'tail', 'lines', 'bytes', 'symbol', 'matches'] },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          lineCount: { type: 'integer', minimum: 1 },
          symbol: { type: 'string', description: "Required when mode is 'symbol'." },
          match: { type: 'string', description: "Required when mode is 'matches'." }
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
        properties: { query: stringProperty, path: stringProperty, glob: stringProperty, maxResults: { type: 'integer', minimum: 1 } },
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
        properties: { path: stringProperty, severity: { type: 'string', enum: ['error', 'warning', 'information', 'hint'] }, maxResults: { type: 'integer', minimum: 1 } },
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
        properties: { operation: { type: 'string', enum: ['status', 'diff', 'stagedDiff', 'branch', 'history'] }, path: stringProperty, maxEntries: { type: 'integer', minimum: 1 } },
        required: ['operation'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ghost_update_task_plan',
      description: 'Create or update the bounded task plan.',
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
      description: 'Record the final completion result for the request.',
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
      description: 'Apply focused, context-checked edits to a workspace file.',
      parameters: {
        type: 'object',
        properties: { path: stringProperty, hunks: { type: 'array', items: { type: 'object', additionalProperties: true } } },
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
        properties: { edits: { type: 'array', items: { type: 'object', additionalProperties: true } } },
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
        properties: { path: stringProperty, recursive: booleanProperty, pageSize: { type: 'integer', minimum: 1 }, maxDepth: { type: 'integer', minimum: 0 }, cursor: stringProperty },
        required: ['path'],
        additionalProperties: false
      }
    }
  }
]

export const JSON_OBJECT_RESPONSE_FORMAT: ChatResponseFormat = {
  type: 'json_object'
}
