export class ApprovalRaceGuard {
  private readonly active = new Set<string>()

  begin(toolCallId: string): boolean {
    if (this.active.has(toolCallId)) {
      return false
    }
    this.active.add(toolCallId)
    return true
  }

  end(toolCallId: string): void {
    this.active.delete(toolCallId)
  }

  clear(): void {
    this.active.clear()
  }
}
