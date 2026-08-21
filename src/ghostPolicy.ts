export const GHOST_POLICY = {
  agent: {
    maxToolRounds: 128,
    minToolCallTokens: 4096,
    toolResultCharacterLimits: {
      ghost_read_file: 16000,
      ghost_search_workspace: 16000,
      ghost_get_diagnostics: 12000,
      ghost_git_context: 24000,
      ghost_update_task_plan: 12000,
      ghost_record_completion: 12000,
      ghost_write_file: 8000,
      ghost_apply_edit: 12000,
      ghost_apply_transaction: 16000,
      ghost_run_terminal_command: 24000,
      ghost_list_directory: 12000
    },
    requestBudget: {
      files: 24,
      changedLines: 4000,
      changedBytes: 1_000_000,
      commands: 32,
      modelTokens: 64_000
    }
  },
  file: {
    maxReadLines: 400,
    maxReadCharacters: 12000,
    maxReadBytes: 12000,
    maxSafeReadBytes: 1_048_576
  },
  edit: {
    maxHunks: 50,
    maxReplacementCharacters: 100000,
    maxContextCharacters: 10000
  },
  terminal: {
    commandTimeoutMs: 120000,
    maxOutputCharacters: 200000,
    outputRingChunkCharacters: 8192,
    processTerminationGraceMs: 500
  },
  search: {
    maxQueryLength: 1000,
    defaultMaxResults: 100,
    maxResults: 200
  },
  diagnostics: {
    maxResults: 200
  },
  git: {
    commandTimeoutMs: 10000,
    maxOutputCharacters: 24000,
    maxEntries: 200
  },
  provider: {
    requestTimeoutMs: 15 * 60 * 1000,
    defaultMaxAttempts: 2,
    maxRetryDelayMs: 30000,
    retryBaseDelayMs: 250
  },
  protocol: {
    maxWebviewMessageBytes: 8 * 1024 * 1024
  },
  persistence: {
    maxStringCharacters: 24000,
    maxStateBytes: 4 * 1024 * 1024,
    maxPromptHistory: 100
  },
  parser: {
    maxStreamedToolArguments: 200000
  }
} as const
