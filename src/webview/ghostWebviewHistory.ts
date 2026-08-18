type GhostHistoryConversation = {
  title: string
  messages: Array<{ content: string; bookmarked?: boolean }>
}

type GhostHistoryStoreApi = {
  filterConversations: <T extends GhostHistoryConversation>(conversations: T[], query: string, bookmarksOnly: boolean) => T[]
  matchingMessageCount: (conversations: GhostHistoryConversation[], query: string) => number
}

const ghostHistoryStore: GhostHistoryStoreApi = {
  filterConversations: (conversations, query, bookmarksOnly) => conversations
    .filter(conversation => !bookmarksOnly || conversation.messages.some(message => message.bookmarked))
    .filter(conversation => !query || conversation.title.toLowerCase().includes(query) || conversation.messages.some(message => message.content.toLowerCase().includes(query))),
  matchingMessageCount: (conversations, query) => query
    ? conversations.reduce((count, conversation) => count + conversation.messages.filter(message => message.content.toLowerCase().includes(query)).length, 0)
    : 0
}

const ghostHistoryGlobal = globalThis as typeof globalThis & { GhostHistoryStore: GhostHistoryStoreApi }
ghostHistoryGlobal.GhostHistoryStore = ghostHistoryStore
