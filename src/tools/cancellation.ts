import * as vscode from 'vscode'

export function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) {
    throw new GhostError('Request cancelled', { code: 'tool.cancelled', retryable: true })
  }
}

export async function awaitCancellable<T>(operation: PromiseLike<T>, token?: vscode.CancellationToken): Promise<T> {
  throwIfCancelled(token)
  if (!token) return operation
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const subscription = token.onCancellationRequested(() => {
      if (settled) return
      settled = true
      subscription.dispose()
      reject(new GhostError('Request cancelled', { code: 'tool.cancelled', retryable: true }))
    })
    operation.then(value => {
      if (settled) return
      settled = true
      subscription.dispose()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      subscription.dispose()
      reject(error)
    })
  })
}
import { GhostError } from '../ghostErrors'
