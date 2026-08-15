type GhostPilotViewStatus = 'ready' | 'offline'
type NoticeKind = 'error' | 'no-model' | 'info'
type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  status?: 'streaming' | 'error'
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
}

interface GhostPilotState {
  conversations: Conversation[]
  activeConversationId: string
}

type GhostPilotExtensionMessage =
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'state'
      status: GhostPilotViewStatus
      detail: string
    }
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'reset' | 'clear'
    }
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'chat-started' | 'chat-delta' | 'chat-progress' | 'chat-completed' | 'chat-error'
      requestId: string
      conversationId: string
      delta?: string
      progress?: string
      status?: 'completed' | 'cancelled'
      error?: string
    }

interface GhostPilotWebviewApi {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

interface ActiveRequest {
  requestId: string
  conversationId: string
  assistantMessageId: string
}

declare function acquireVsCodeApi(): GhostPilotWebviewApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app')

if (!app) {
  throw new Error('GhostPilot webview root is missing')
}

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

const createConversation = (): Conversation => ({
  id: createId('conversation'),
  title: 'New conversation',
  messages: []
})

const getInitialState = (): GhostPilotState => {
  const stored = vscode.getState<GhostPilotState>()
  if (
    stored &&
    Array.isArray(stored.conversations) &&
    stored.conversations.length > 0 &&
    typeof stored.activeConversationId === 'string'
  ) {
    return stored
  }

  const conversation = createConversation()
  return {
    conversations: [conversation],
    activeConversationId: conversation.id
  }
}

let state = getInitialState()
let viewStatus: GhostPilotViewStatus = 'ready'
let activeRequest: ActiveRequest | undefined
let notice: { kind: NoticeKind; message: string } | undefined
let userIsAtBottom = true
const requests = new Map<string, ActiveRequest>()

app.innerHTML = `
  <div class="app">
    <header class="header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">✦</span>
        <div>
          <div class="title">GhostPilot</div>
          <div class="subtitle">Local-first coding assistant</div>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" class="icon-button" id="export" aria-label="Export conversations" title="Export conversations">⇧</button>
        <button type="button" class="icon-button" id="reset" aria-label="Reset interface" title="Reset interface">↻</button>
      </div>
    </header>
    <div class="chat-layout">
      <aside class="sidebar" aria-label="Conversations">
        <div class="sidebar-header">
          <span class="sidebar-title">Conversations</span>
          <button type="button" class="icon-button" id="new-chat" aria-label="New conversation" title="New conversation">+</button>
        </div>
        <div class="conversation-list" id="conversation-list" role="list"></div>
      </aside>
      <main class="chat-main">
        <section class="messages" id="messages" role="log" aria-label="Conversation messages" aria-live="polite"></section>
        <div class="screen-reader-status" id="screen-reader-status" role="status" aria-live="polite"></div>
        <form class="composer" id="composer">
          <label class="screen-reader-only" for="prompt">Message GhostPilot</label>
          <textarea id="prompt" rows="1" placeholder="Ask GhostPilot anything..." aria-describedby="composer-hint composer-count"></textarea>
          <div class="composer-footer">
            <span class="composer-hint" id="composer-hint">Enter to send · Shift+Enter for a new line</span>
            <span class="composer-count" id="composer-count">0 chars · ~0 tokens</span>
            <button type="button" class="stop-button" id="stop" hidden>Stop</button>
            <button type="submit" id="send">Send</button>
          </div>
        </form>
        <footer class="status-footer" id="status-footer">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="status-text">Ready</span>
        </footer>
      </main>
    </div>
  </div>
`

const messagesElement = document.getElementById('messages') as HTMLElement
const conversationListElement = document.getElementById('conversation-list') as HTMLElement
const promptElement = document.getElementById('prompt') as HTMLTextAreaElement
const composerElement = document.getElementById('composer') as HTMLFormElement
const sendElement = document.getElementById('send') as HTMLButtonElement
const stopElement = document.getElementById('stop') as HTMLButtonElement
const statusTextElement = document.getElementById('status-text') as HTMLElement
const statusFooterElement = document.getElementById('status-footer') as HTMLElement
const screenReaderStatusElement = document.getElementById('screen-reader-status') as HTMLElement
const composerCountElement = document.getElementById('composer-count') as HTMLElement

const post = (type: string, details: Record<string, unknown> = {}) => {
  vscode.postMessage({
    source: 'ghostpilot-webview',
    version: 1,
    type,
    ...details
  })
}

const saveState = () => vscode.setState(state)

const getActiveConversation = (): Conversation => {
  const existing = state.conversations.find(conversation => conversation.id === state.activeConversationId)
  if (existing) {
    return existing
  }

  const conversation = createConversation()
  state = {
    conversations: [...state.conversations, conversation],
    activeConversationId: conversation.id
  }
  saveState()
  return conversation
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const escapeAttribute = (value: string): string => escapeHtml(value).replace(/\n/g, '&#10;')

const safeLink = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const inlineMarkdown = (value: string): string => {
  let html = escapeHtml(value)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = safeLink(url)
    return safeUrl
      ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`
      : label
  })
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')
  return html.replace(/\n/g, '<br>')
}

const codeTokenClass = (token: string): string => {
  if (/^(\/\/|#|\/\*)/.test(token)) {
    return 'code-comment'
  }
  if (/^["'`]/.test(token)) {
    return 'code-string'
  }
  if (/^\d/.test(token)) {
    return 'code-number'
  }
  return 'code-keyword'
}

const highlightCode = (code: string): string => {
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|from|export|async|await|new|true|false|null|undefined|public|private|extends|implements|def|in|with|try|catch|throw)\b)/g
  let html = ''
  let lastIndex = 0

  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    html += escapeHtml(code.slice(lastIndex, index))
    html += `<span class="${codeTokenClass(token)}">${escapeHtml(token)}</span>`
    lastIndex = index + token.length
  }

  return html + escapeHtml(code.slice(lastIndex))
}

const codeBlock = (code: string, language: string): string => {
  const encodedCode = encodeURIComponent(code)
  const label = language || 'code'
  return `<div class="code-block">
    <div class="code-header"><span>${escapeHtml(label)}</span><button type="button" class="code-copy" data-code="${encodedCode}" aria-label="Copy code">Copy</button></div>
    <pre><code>${highlightCode(code)}</code></pre>
  </div>`
}

const tableCells = (line: string): string[] => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map(cell => cell.trim())

const isTableSeparator = (line: string): boolean => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

const renderMarkdown = (markdown: string): string => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let paragraph: string[] = []
  let listOpen = false
  let codeLines: string[] = []
  let codeLanguage = ''
  let inCode = false

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`)
      paragraph = []
    }
  }

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>')
      listOpen = false
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        output.push(codeBlock(codeLines.join('\n'), codeLanguage))
        codeLines = []
        codeLanguage = ''
        inCode = false
      } else {
        flushParagraph()
        closeList()
        inCode = true
        codeLanguage = line.trim().slice(3).trim()
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }

    if (line.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph()
      closeList()
      const headers = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      index -= 1
      output.push(`<table><thead><tr>${headers.map(header => `<th>${inlineMarkdown(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList()
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const listItem = /^\s*[-*]\s+(.+)$/.exec(line)
    if (listItem) {
      flushParagraph()
      if (!listOpen) {
        output.push('<ul>')
        listOpen = true
      }
      output.push(`<li>${inlineMarkdown(listItem[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  if (inCode) {
    output.push(codeBlock(codeLines.join('\n'), codeLanguage))
  }
  flushParagraph()
  closeList()
  return output.join('') || '<p class="message-placeholder">No response yet.</p>'
}

const findMessage = (conversation: Conversation, messageId: string): ChatMessage | undefined => (
  conversation.messages.find(message => message.id === messageId)
)

const findMessageElement = (messageId: string): HTMLElement | undefined => (
  Array.from(messagesElement.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find(element => element.dataset.messageId === messageId)
)

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  screenReaderStatusElement.textContent = 'Copied to clipboard'
}

const addAction = (container: HTMLElement, label: string, action: string, messageId: string) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'message-action'
  button.textContent = label
  button.setAttribute('aria-label', `${label} message`)
  button.dataset.action = action
  button.dataset.messageId = messageId
  container.append(button)
}

const createMessageElement = (message: ChatMessage): HTMLElement => {
  const article = document.createElement('article')
  article.className = `message ${message.role}${message.status === 'error' ? ' error' : ''}`
  article.dataset.messageId = message.id
  article.innerHTML = `
    <div class="message-header"><strong>${message.role === 'user' ? 'You' : 'GhostPilot'}</strong><span class="message-state">${message.status === 'streaming' ? 'Thinking...' : ''}</span></div>
    <div class="message-body">${renderMarkdown(message.content)}</div>
    <div class="message-actions" aria-label="Message actions"></div>
  `
  const actions = article.querySelector<HTMLElement>('.message-actions')
  if (actions && message.role === 'assistant' && message.content) {
    addAction(actions, 'Copy', 'copy', message.id)
    addAction(actions, 'Retry', 'retry', message.id)
    addAction(actions, 'Regenerate', 'regenerate', message.id)
    addAction(actions, 'Edit & resend', 'edit-resend', message.id)
  }
  if (actions && message.role === 'user') {
    addAction(actions, 'Edit', 'edit', message.id)
  }
  return article
}

const stateCard = (): string => {
  if (viewStatus === 'offline') {
    return '<div class="state-card"><div class="state-icon">!</div><h1>Provider offline</h1><p>GhostPilot cannot reach the configured local model. Check the connection, then try again.</p><button type="button" data-state-action="check">Check connection</button></div>'
  }
  if (notice?.kind === 'no-model') {
    return `<div class="state-card"><div class="state-icon">↓</div><h1>No model installed</h1><p>${escapeHtml(notice.message)}</p><p class="state-help">Pull the configured model, then retry your prompt.</p></div>`
  }
  if (notice?.kind === 'error') {
    return `<div class="state-card"><div class="state-icon">!</div><h1>Something went wrong</h1><p>${escapeHtml(notice.message)}</p></div>`
  }
  return '<div class="state-card"><div class="state-icon">✦</div><h1>Start a conversation</h1><p>Ask about your code, explain an error, or let GhostPilot help with a task.</p></div>'
}

const updateMessageElement = (message: ChatMessage) => {
  const element = findMessageElement(message.id)
  if (!element) {
    renderMessages(false)
    return
  }
  const body = element.querySelector<HTMLElement>('.message-body')
  const status = element.querySelector<HTMLElement>('.message-state')
  if (body) {
    body.innerHTML = renderMarkdown(message.content)
  }
  if (status) {
    status.textContent = message.status === 'streaming' ? 'Thinking...' : ''
  }
  element.classList.toggle('error', message.status === 'error')
}

const scrollMessages = (force: boolean) => {
  requestAnimationFrame(() => {
    if (force || userIsAtBottom) {
      messagesElement.scrollTop = messagesElement.scrollHeight
    }
  })
}

const renderConversationList = () => {
  conversationListElement.textContent = ''
  for (const conversation of state.conversations) {
    const item = document.createElement('div')
    item.className = `conversation-item${conversation.id === state.activeConversationId ? ' active' : ''}`
    item.setAttribute('role', 'listitem')
    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'conversation-select'
    select.textContent = conversation.title
    select.title = conversation.title
    select.dataset.conversationId = conversation.id
    const actions = document.createElement('span')
    actions.className = 'conversation-actions'
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'conversation-action'
    rename.textContent = '…'
    rename.title = 'Rename conversation'
    rename.setAttribute('aria-label', `Rename ${conversation.title}`)
    rename.dataset.conversationAction = 'rename'
    rename.dataset.conversationId = conversation.id
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'conversation-action'
    remove.textContent = '×'
    remove.title = 'Delete conversation'
    remove.setAttribute('aria-label', `Delete ${conversation.title}`)
    remove.dataset.conversationAction = 'delete'
    remove.dataset.conversationId = conversation.id
    actions.append(rename, remove)
    item.append(select, actions)
    conversationListElement.append(item)
  }
}

const updateComposer = () => {
  const length = promptElement.value.length
  composerCountElement.textContent = `${length} chars · ~${Math.ceil(length / 4)} tokens`
  promptElement.style.height = 'auto'
  promptElement.style.height = `${Math.min(promptElement.scrollHeight, 180)}px`
  promptElement.style.overflowY = promptElement.scrollHeight > 180 ? 'auto' : 'hidden'
  const busy = Boolean(activeRequest)
  sendElement.disabled = busy || promptElement.value.trim().length === 0
  stopElement.hidden = !busy
  promptElement.disabled = busy
  statusFooterElement.classList.toggle('busy', busy)
  statusFooterElement.classList.toggle('offline', viewStatus === 'offline')
}

const renderMessages = (forceScroll: boolean) => {
  const conversation = getActiveConversation()
  const previousScrollTop = messagesElement.scrollTop
  messagesElement.textContent = ''
  if (conversation.messages.length === 0) {
    messagesElement.innerHTML = stateCard()
  } else {
    for (const message of conversation.messages) {
      messagesElement.append(createMessageElement(message))
    }
  }
  if (!forceScroll && !userIsAtBottom) {
    requestAnimationFrame(() => {
      messagesElement.scrollTop = previousScrollTop
    })
  } else {
    scrollMessages(forceScroll)
  }
}

const updateStatus = () => {
  if (activeRequest) {
    statusTextElement.textContent = 'GhostPilot is thinking…'
    screenReaderStatusElement.textContent = 'GhostPilot is generating a response'
  } else if (viewStatus === 'offline') {
    statusTextElement.textContent = 'Offline'
  } else if (notice) {
    statusTextElement.textContent = notice.kind === 'no-model' ? 'Model not installed' : 'Error'
  } else {
    statusTextElement.textContent = 'Ready'
  }
  updateComposer()
}

const render = (forceScroll = false) => {
  renderConversationList()
  renderMessages(forceScroll)
  updateStatus()
  saveState()
}

const startNewConversation = () => {
  const conversation = createConversation()
  state = {
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id
  }
  notice = undefined
  render(true)
  promptElement.focus()
}

const submitPrompt = (rawPrompt: string) => {
  const prompt = rawPrompt.trim()
  if (!prompt || activeRequest) {
    return
  }

  const conversation = getActiveConversation()
  const userMessage: ChatMessage = { id: createId('message'), role: 'user', content: prompt }
  const assistantMessage: ChatMessage = {
    id: createId('message'),
    role: 'assistant',
    content: '',
    status: 'streaming'
  }
  if (conversation.messages.length === 0) {
    conversation.title = prompt.length > 32 ? `${prompt.slice(0, 32)}…` : prompt
  }
  conversation.messages.push(userMessage, assistantMessage)
  const requestId = createId('request')
  activeRequest = {
    requestId,
    conversationId: conversation.id,
    assistantMessageId: assistantMessage.id
  }
  requests.set(requestId, activeRequest)
  notice = undefined
  promptElement.value = ''
  render(true)
  post('submit', {
    requestId,
    conversationId: conversation.id,
    prompt
  })
}

const editMessage = (messageId: string) => {
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  if (!message) {
    return
  }
  promptElement.value = message.content
  updateComposer()
  promptElement.focus()
  promptElement.setSelectionRange(promptElement.value.length, promptElement.value.length)
}

const retryMessage = (messageId: string) => {
  if (activeRequest) {
    return
  }
  const conversation = getActiveConversation()
  const assistantIndex = conversation.messages.findIndex(message => message.id === messageId)
  const userMessage = assistantIndex > 0 ? conversation.messages[assistantIndex - 1] : undefined
  if (!userMessage || userMessage.role !== 'user') {
    return
  }
  conversation.messages = conversation.messages.slice(0, assistantIndex - 1)
  submitPrompt(userMessage.content)
}

const editAndResendMessage = (messageId: string) => {
  if (activeRequest) {
    return
  }
  const conversation = getActiveConversation()
  const assistantIndex = conversation.messages.findIndex(message => message.id === messageId)
  const userMessage = assistantIndex > 0 ? conversation.messages[assistantIndex - 1] : undefined
  if (!userMessage || userMessage.role !== 'user') {
    return
  }
  const editedPrompt = window.prompt('Edit prompt and resend', userMessage.content)?.trim()
  if (!editedPrompt) {
    return
  }
  conversation.messages = conversation.messages.slice(0, assistantIndex - 1)
  submitPrompt(editedPrompt)
}

const handleMessageAction = (action: string, messageId: string) => {
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  if (!message) {
    return
  }
  if (action === 'copy') {
    void copyText(message.content)
  } else if (action === 'edit') {
    editMessage(messageId)
  } else if (action === 'edit-resend') {
    editAndResendMessage(messageId)
  } else if (action === 'retry' || action === 'regenerate') {
    retryMessage(messageId)
  }
}

const handleConversationAction = (action: string, conversationId: string) => {
  const conversation = state.conversations.find(item => item.id === conversationId)
  if (!conversation) {
    return
  }
  if (action === 'rename') {
    const title = window.prompt('Conversation name', conversation.title)?.trim()
    if (title) {
      conversation.title = title
      render(false)
    }
  } else if (action === 'delete') {
    if (!window.confirm(`Delete “${conversation.title}”?`)) {
      return
    }
    state.conversations = state.conversations.filter(item => item.id !== conversationId)
    if (state.conversations.length === 0) {
      state.conversations.push(createConversation())
    }
    if (state.activeConversationId === conversationId) {
      state.activeConversationId = state.conversations[0].id
    }
    notice = undefined
    render(true)
  }
}

const handleExtensionMessage = (message: GhostPilotExtensionMessage) => {
  if (message.type === 'state') {
    viewStatus = message.status
    render(false)
    return
  }
  if (message.type === 'reset') {
    state = {
      conversations: [createConversation()],
      activeConversationId: ''
    }
    state.activeConversationId = state.conversations[0].id
    activeRequest = undefined
    requests.clear()
    notice = undefined
    render(true)
    return
  }
  if (message.type === 'clear') {
    const conversation = getActiveConversation()
    conversation.messages = []
    activeRequest = undefined
    requests.clear()
    notice = undefined
    render(true)
    return
  }

  if (!('requestId' in message) || !('conversationId' in message)) {
    return
  }

  const request = requests.get(message.requestId)
  if (!request || request.conversationId !== message.conversationId) {
    return
  }
  const conversation = state.conversations.find(item => item.id === request.conversationId)
  const assistantMessage = conversation ? findMessage(conversation, request.assistantMessageId) : undefined
  if (!conversation || !assistantMessage) {
    return
  }

  if (message.type === 'chat-started') {
    updateStatus()
    return
  }
  if (message.type === 'chat-progress') {
    screenReaderStatusElement.textContent = message.progress ?? 'GhostPilot is working'
    return
  }
  if (message.type === 'chat-delta') {
    assistantMessage.content += message.delta ?? ''
    updateMessageElement(assistantMessage)
    scrollMessages(false)
    return
  }
  if (message.type === 'chat-error') {
    assistantMessage.status = 'error'
    assistantMessage.content = message.error ?? 'GhostPilot request failed'
    notice = { kind: 'error', message: assistantMessage.content }
  }
  if (message.type === 'chat-completed' || message.type === 'chat-error') {
    assistantMessage.status = message.type === 'chat-error' ? 'error' : undefined
    if (message.status === 'cancelled' && assistantMessage.content.length === 0) {
      assistantMessage.content = 'Request cancelled.'
    }
    if (/model.*(not found|missing)|ollama pull/i.test(assistantMessage.content)) {
      notice = { kind: 'no-model', message: assistantMessage.content }
    }
    if (activeRequest?.requestId === message.requestId) {
      activeRequest = undefined
    }
    requests.delete(message.requestId)
    updateMessageElement(assistantMessage)
    render(false)
  }
}

const isExtensionMessage = (value: unknown): value is GhostPilotExtensionMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const message = value as Record<string, unknown>
  if (message.source !== 'ghostpilot-extension' || message.version !== 1 || typeof message.type !== 'string') {
    return false
  }
  if (message.type === 'state') {
    return (message.status === 'ready' || message.status === 'offline') && typeof message.detail === 'string'
  }
  if (message.type === 'reset' || message.type === 'clear') {
    return true
  }
  if (!['chat-started', 'chat-delta', 'chat-progress', 'chat-completed', 'chat-error'].includes(message.type)) {
    return false
  }
  return (
    'requestId' in message &&
    'conversationId' in message &&
    typeof message.requestId === 'string' &&
    typeof message.conversationId === 'string'
  )
}

messagesElement.addEventListener('scroll', () => {
  userIsAtBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40
})

messagesElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const codeCopy = target.closest<HTMLButtonElement>('.code-copy')
  if (codeCopy) {
    void copyText(decodeURIComponent(codeCopy.dataset.code ?? ''))
    return
  }
  const stateAction = target.closest<HTMLButtonElement>('[data-state-action]')
  if (stateAction?.dataset.stateAction === 'check') {
    post('check-status')
    return
  }
  const action = target.closest<HTMLButtonElement>('[data-action]')
  if (action?.dataset.action && action.dataset.messageId) {
    handleMessageAction(action.dataset.action, action.dataset.messageId)
  }
})

conversationListElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const action = target.closest<HTMLButtonElement>('[data-conversation-action]')
  if (action?.dataset.conversationAction && action.dataset.conversationId) {
    handleConversationAction(action.dataset.conversationAction, action.dataset.conversationId)
    return
  }
  const select = target.closest<HTMLButtonElement>('[data-conversation-id]')
  if (select?.dataset.conversationId) {
    state.activeConversationId = select.dataset.conversationId
    notice = undefined
    render(true)
  }
})

document.getElementById('new-chat')?.addEventListener('click', startNewConversation)
document.getElementById('export')?.addEventListener('click', () => post('export'))
document.getElementById('reset')?.addEventListener('click', () => post('reset'))
stopElement.addEventListener('click', () => {
  if (activeRequest) {
    post('cancel', { requestId: activeRequest.requestId })
  }
})
promptElement.addEventListener('input', updateComposer)
promptElement.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    composerElement.requestSubmit()
  }
})
composerElement.addEventListener('submit', event => {
  event.preventDefault()
  submitPrompt(promptElement.value)
})
window.addEventListener('message', event => {
  if (event.origin === window.location.origin && isExtensionMessage(event.data)) {
    handleExtensionMessage(event.data)
  }
})

render(false)
post('ready')
