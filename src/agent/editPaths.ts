export interface EditPathCall {
  name: string
  arguments: Record<string, unknown>
}

export function canonicalizeEditPath(
  filePath: string,
  resolveFilePath: (filePath: string) => string
): string {
  try {
    return resolveFilePath(filePath)
  } catch {
    return filePath
  }
}

function rawEditPaths(call: EditPathCall): string[] {
  if (call.name === 'ghost_apply_transaction') {
    const edits = call.arguments.edits
    if (!Array.isArray(edits)) {
      return []
    }
    return edits.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return []
      }
      const filePath = (item as { path?: unknown }).path
      return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
    })
  }
  if (call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') {
    return []
  }
  const filePath = call.arguments.path
  return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
}

export function getCanonicalEditPaths(
  call: EditPathCall,
  resolveFilePath: (filePath: string) => string
): string[] {
  return [...new Set(rawEditPaths(call).map(filePath => canonicalizeEditPath(filePath, resolveFilePath)))]
}

export function getCanonicalEditPath(
  call: EditPathCall,
  resolveFilePath: (filePath: string) => string
): string | undefined {
  if (call.name === 'ghost_apply_transaction') {
    return undefined
  }
  const paths = getCanonicalEditPaths(call, resolveFilePath)
  return paths.length === 1 ? paths[0] : undefined
}

export function argumentsWithCanonicalPath(
  call: EditPathCall,
  canonicalPath: string
): Record<string, unknown> {
  return { ...call.arguments, path: canonicalPath }
}
