import type { GhostStreamEvent } from './ghostProtocol'
import type { GhostProgressPhase, GhostRequestStatus } from './ghostState'

export interface GhostRequestStatusEvent {
  type: GhostStreamEvent['type']
  state?: GhostRequestStatus
  phase?: GhostProgressPhase
  status?: 'completed' | 'cancelled' | 'failed'
}

export function getRequestStatusForEvent(
  event: GhostRequestStatusEvent,
  current: GhostRequestStatus
): GhostRequestStatus {
  if (event.state) {
    return event.state
  }
  if (event.phase === 'context') {
    return 'preparing'
  }
  if (event.phase === 'provider') {
    return 'connecting'
  }
  if (event.phase === 'streaming') {
    return 'streaming'
  }
  if (event.phase === 'tool') {
    return event.type === 'tool-requested' ? 'waiting-for-approval' : 'thinking'
  }
  if (event.phase === 'error') {
    return 'failed'
  }
  if (event.phase === 'complete') {
    return 'completed'
  }
  if (event.type === 'request-started') {
    return 'preparing'
  }
  if (event.type === 'thinking') {
    return 'thinking'
  }
  if (event.type === 'text-delta' || event.type === 'code-delta') {
    return 'streaming'
  }
  if (event.type === 'tool-requested') {
    return 'waiting-for-approval'
  }
  if (event.type === 'tool-result') {
    return 'thinking'
  }
  if (event.type === 'request-completed') {
    return event.status === 'completed'
      ? 'completed'
      : event.status === 'cancelled'
        ? 'cancelled'
        : 'failed'
  }
  return current
}
