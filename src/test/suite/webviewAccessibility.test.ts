import { strict as assert } from 'node:assert'

import '../../webview/ghostWebviewAccessibility'
import '../../webview/ghostWebviewHistory'

type AccessibilityApi = {
  focusWrapTarget: (focusableCount: number, activeIndex: number, backwards: boolean) => number | undefined
  approvalKeyboardAction: (key: string, modifiers?: boolean) => string | undefined
  shouldAnimateStatus: (reducedMotion: boolean) => boolean
  toolStatusPresentation: (status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed') => { className: string; icon: string }
}

type HistoryApi = {
  filterConversations: <T extends { title: string; messages: Array<{ content: string; bookmarked?: boolean }> }>(conversations: T[], query: string, bookmarksOnly: boolean) => T[]
  matchingMessageCount: (conversations: Array<{ messages: Array<{ content: string; bookmarked?: boolean }> }>, query: string) => number
}

const accessibility = (globalThis as typeof globalThis & { GhostAccessibility: AccessibilityApi }).GhostAccessibility
const history = (globalThis as typeof globalThis & { GhostHistoryStore: HistoryApi }).GhostHistoryStore

suite('Webview accessibility helpers', () => {
  test('wraps modal focus at both ends', () => {
    assert.equal(accessibility.focusWrapTarget(3, 0, true), 2)
    assert.equal(accessibility.focusWrapTarget(3, 2, false), 0)
    assert.equal(accessibility.focusWrapTarget(3, 1, false), undefined)
    assert.equal(accessibility.focusWrapTarget(0, 0, false), undefined)
  })

  test('maps approval keyboard controls and ignores modified keys', () => {
    assert.equal(accessibility.approvalKeyboardAction('j'), 'next-hunk')
    assert.equal(accessibility.approvalKeyboardAction('ArrowUp'), 'previous-hunk')
    assert.equal(accessibility.approvalKeyboardAction('A'), 'approve')
    assert.equal(accessibility.approvalKeyboardAction('r'), 'reject')
    assert.equal(accessibility.approvalKeyboardAction('a', true), undefined)
  })

  test('respects reduced motion and exposes failure presentation', () => {
    assert.equal(accessibility.shouldAnimateStatus(false), true)
    assert.equal(accessibility.shouldAnimateStatus(true), false)
    assert.deepEqual(accessibility.toolStatusPresentation('completed'), { className: 'tool-success', icon: '✓' })
    assert.deepEqual(accessibility.toolStatusPresentation('failed'), { className: 'tool-failure', icon: '✕' })
    assert.deepEqual(accessibility.toolStatusPresentation('running'), { className: '', icon: '•' })
  })

  test('restores and filters history by title, message, and bookmark', () => {
    const conversations = [
      { title: 'Build app', messages: [{ content: 'Fix the parser', bookmarked: true }] },
      { title: 'Notes', messages: [{ content: 'Remember the release' }] }
    ]
    assert.equal(history.filterConversations(conversations, 'parser', false).length, 1)
    assert.equal(history.filterConversations(conversations, '', true).length, 1)
    assert.equal(history.matchingMessageCount(conversations, 'release'), 1)
  })
})
