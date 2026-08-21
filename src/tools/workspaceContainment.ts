import * as path from 'node:path'

export function isInsideWorkspaceRoot(candidate: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveTerminalCwd(cwd: string | undefined, workspaceRoot: string): string {
  const resolved = cwd?.trim()
    ? path.resolve(workspaceRoot, cwd)
    : path.resolve(workspaceRoot)
  if (!isInsideWorkspaceRoot(resolved, path.resolve(workspaceRoot))) {
    throw new Error('Working directory must be inside the current workspace')
  }
  return resolved
}
