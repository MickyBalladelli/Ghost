type GhostToolTimelineApi = {
  compactAction: (name: string) => string
  summarizeOpenCodeToolProgress: (lines: string[]) => string[]
}

const OPENCODE_TOOL_STATUS_PATTERN = /^OpenCode ([^\s:]+):\s*(.+?)\s*$/

const summarizeOpenCodeToolRun = (entries: Array<{ tool: string; status: string }>): string => {
  const order: string[] = []
  const latest = new Map<string, { status: string; count: number }>()
  for (const entry of entries) {
    const known = latest.get(entry.tool)
    if (!known) {
      order.push(entry.tool)
      latest.set(entry.tool, { status: entry.status, count: 1 })
    } else {
      known.status = entry.status
      known.count += 1
    }
  }
  const parts = order.map(tool => {
    const state = latest.get(tool) as { status: string; count: number }
    return state.count > 1 ? `${tool} ×${state.count} ${state.status}` : `${tool} ${state.status}`
  })
  return `OpenCode tools: ${parts.join(' · ')}`
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
  },
  summarizeOpenCodeToolProgress: lines => {
    const summarized: string[] = []
    let run: Array<{ tool: string; status: string }> = []
    const flushRun = (): void => {
      if (run.length > 0) {
        summarized.push(summarizeOpenCodeToolRun(run))
        run = []
      }
    }
    for (const line of lines) {
      const match = OPENCODE_TOOL_STATUS_PATTERN.exec(line.trim())
      if (!match) {
        flushRun()
        summarized.push(line)
        continue
      }
      run.push({ tool: match[1].slice(0, 32), status: match[2].slice(0, 32) })
    }
    flushRun()
    return summarized
  }
}

const ghostToolTimelineGlobal = globalThis as typeof globalThis & { GhostToolTimeline: GhostToolTimelineApi }
ghostToolTimelineGlobal.GhostToolTimeline = ghostToolTimeline
