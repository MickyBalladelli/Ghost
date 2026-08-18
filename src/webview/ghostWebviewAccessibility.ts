type ApprovalKeyboardAction = 'next-hunk' | 'previous-hunk' | 'approve' | 'reject'

function focusWrapTarget(focusableCount: number, activeIndex: number, backwards: boolean): number | undefined {
  if (focusableCount <= 0) return undefined
  if (backwards && activeIndex === 0) return focusableCount - 1
  if (!backwards && activeIndex === focusableCount - 1) return 0
  return undefined
}

function approvalKeyboardAction(key: string, modifiers = false): ApprovalKeyboardAction | undefined {
  if (modifiers) return undefined
  if (key === 'j' || key === 'ArrowDown') return 'next-hunk'
  if (key === 'k' || key === 'ArrowUp') return 'previous-hunk'
  if (key.toLowerCase() === 'a') return 'approve'
  if (key.toLowerCase() === 'r') return 'reject'
  return undefined
}

function shouldAnimateStatus(reducedMotion: boolean): boolean {
  return !reducedMotion
}

function toolStatusPresentation(status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed'): { className: string; icon: string } {
  if (status === 'completed') return { className: 'tool-success', icon: '✓' }
  if (status === 'failed' || status === 'rejected') return { className: 'tool-failure', icon: '✕' }
  return { className: '', icon: '•' }
}

const ghostAccessibility = {
  focusWrapTarget,
  approvalKeyboardAction,
  shouldAnimateStatus,
  toolStatusPresentation
}

const ghostAccessibilityGlobal = globalThis as typeof globalThis & { GhostAccessibility: typeof ghostAccessibility }
ghostAccessibilityGlobal.GhostAccessibility = ghostAccessibility
