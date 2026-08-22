type GhostToolTimelineApi = {
  compactAction: (name: string) => string
}

const ghostToolTimeline: GhostToolTimelineApi = {
  compactAction: name => {
    const labels: Record<string, string> = {
      ghost_read_file: 'Reading file',
      ghost_search_workspace: 'Searching workspace',
      ghost_get_diagnostics: 'Checking result',
      ghost_git_context: 'Checking Git context',
      ghost_update_task_plan: 'Updating task plan',
      ghost_record_completion: 'Recording completion',
      ghost_write_file: 'Writing file',
      ghost_apply_edit: 'Applying edit',
      ghost_apply_transaction: 'Applying file transaction',
      ghost_run_terminal_command: 'Running command',
      ghost_list_directory: 'Listing directory',
      opencode_permission: 'OpenCode needs permission'
    }
    return labels[name] ?? `Running ${name}`
  }
}

const ghostToolTimelineGlobal = globalThis as typeof globalThis & { GhostToolTimeline: GhostToolTimelineApi }
ghostToolTimelineGlobal.GhostToolTimeline = ghostToolTimeline
