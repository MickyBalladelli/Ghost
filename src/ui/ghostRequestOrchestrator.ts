export class GhostRequestOrchestrator<T> {
  readonly requests = new Map<string, T>()
  readonly activeRequestByConversation = new Map<string, string>()
  readonly completedRequests = new Set<string>()

  markCompleted(requestId: string, conversationId: string): void {
    this.requests.delete(requestId)
    if (this.activeRequestByConversation.get(conversationId) === requestId) {
      this.activeRequestByConversation.delete(conversationId)
    }
    this.completedRequests.add(requestId)
    if (this.completedRequests.size > 100) {
      const oldest = this.completedRequests.values().next().value
      if (typeof oldest === 'string') {
        this.completedRequests.delete(oldest)
      }
    }
  }

  clear(): void {
    this.requests.clear()
    this.activeRequestByConversation.clear()
    this.completedRequests.clear()
  }

  dispose(): void {
    this.clear()
  }
}
