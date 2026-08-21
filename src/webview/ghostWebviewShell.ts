type GhostShellChild = Node | string | null | undefined
type GhostShellAttributes = Record<string, string | boolean | number | undefined>

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: GhostShellAttributes = {},
  children: GhostShellChild[] = []
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) {
      continue
    }
    if (name === 'className') {
      element.className = String(value)
    } else if (name === 'textContent') {
      element.textContent = String(value)
    } else if (name === 'hidden') {
      element.hidden = Boolean(value)
    } else if (name === 'checked' && element instanceof HTMLInputElement) {
      element.checked = Boolean(value)
    } else if (name === 'value' && 'value' in element) {
      const valueElement = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      valueElement.value = String(value)
    } else if (name === 'htmlFor' && element instanceof HTMLLabelElement) {
      element.htmlFor = String(value)
    } else {
      element.setAttribute(name, String(value))
    }
  }

  for (const child of children) {
    if (child !== null && child !== undefined) {
      element.append(child instanceof Node ? child : document.createTextNode(child))
    }
  }

  return element
}

const svgIcon = (path: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'ui-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  pathElement.setAttribute('d', path)
  pathElement.setAttribute('fill', 'none')
  pathElement.setAttribute('stroke', 'currentColor')
  pathElement.setAttribute('stroke-linecap', 'round')
  pathElement.setAttribute('stroke-linejoin', 'round')
  pathElement.setAttribute('stroke-width', '1.8')
  svg.append(pathElement)
  return svg
}

const option = (value: string, label = value, selected = false): HTMLOptionElement =>
  createElement('option', { value, selected }, [label])

const select = (id: string, options: HTMLOptionElement[], attributes: GhostShellAttributes = {}): HTMLSelectElement =>
  createElement('select', { id, ...attributes }, options)

const label = (text: string, htmlFor?: string, attributes: GhostShellAttributes = {}): HTMLLabelElement =>
  createElement('label', { ...attributes, ...(htmlFor ? { htmlFor } : {}) }, [text])

const input = (id: string, type: string, attributes: GhostShellAttributes = {}): HTMLInputElement =>
  createElement('input', { id, type, ...attributes })

const textarea = (id: string, attributes: GhostShellAttributes = {}): HTMLTextAreaElement =>
  createElement('textarea', { id, ...attributes })

const button = (id: string, text: string, attributes: GhostShellAttributes = {}, children: GhostShellChild[] = []): HTMLButtonElement =>
  createElement('button', { id, type: 'button', ...attributes }, children.length ? children : [text])

const closeButton = (modalId: string, labelText: string): HTMLButtonElement =>
  button('', '×', { className: 'icon-button', 'data-close-modal': modalId, 'aria-label': labelText })

const ghostFace = (iconUri: string, className: string): HTMLSpanElement =>
  createElement('span', { className, 'aria-hidden': 'true' }, [
    createElement('img', { src: iconUri, alt: '' }),
    createElement('span', { className: 'ghost-eye ghost-eye-left' }, [createElement('span', { className: 'ghost-pupil' })]),
    createElement('span', { className: 'ghost-eye ghost-eye-right' }, [createElement('span', { className: 'ghost-pupil' })])
  ])

const modal = (id: string, title: string, titleId: string, content: Node, footer: Node): HTMLDivElement =>
  createElement('div', { className: 'modal-backdrop', id, hidden: true }, [
    createElement('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      createElement('div', { className: 'modal-header' }, [
        createElement('h2', { id: titleId }, [title]),
        closeButton(id, `Close ${title.toLowerCase()}`)
      ]),
      content,
      createElement('div', { className: 'modal-footer' }, [footer])
    ])
  ])

const settingRow = (text: string, control: Node, id?: string, title?: string): Node[] => [
  label(text, id, title ? { title } : {}),
  control
]

const checkboxSetting = (id: string, text: string, title?: string, checked = false): HTMLLabelElement =>
  createElement('label', { className: 'settings-checkbox', htmlFor: id, ...(title ? { title } : {}) }, [
    input(id, 'checkbox', { checked }),
    text
  ])

const createSettingsContent = (): HTMLDivElement => {
  const grid = createElement('div', { className: 'settings-grid' })
  const appendRows = (...rows: Node[][]): void => rows.forEach(row => grid.append(...row))

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'generation' }, ['Generation']))
  appendRows(
    settingRow('Temperature', input('temperature', 'range', { min: 0, max: 2, step: 0.1, value: 0.3, title: 'Temperature: 0 is most focused; 1 is balanced; 2 is most varied.' }), 'temperature', 'Controls randomness. An output value is shown beside the label.'),
    [createElement('output', { id: 'temperature-value' }, ['0.3'])],
    settingRow('Top P', input('top-p', 'number', { min: 0, max: 1, step: 0.01, value: 0.9 }), 'top-p'),
    settingRow('Top K', input('top-k', 'number', { min: 0, step: 1, value: 20 }), 'top-k'),
    settingRow('Min P', input('min-p', 'number', { min: 0, max: 1, step: 0.01, value: 0.05 }), 'min-p'),
    settingRow('Presence penalty', input('presence-penalty', 'number', { min: -2, max: 2, step: 0.1, value: 0 }), 'presence-penalty'),
    settingRow('Repeat penalty', input('repeat-penalty', 'number', { min: 0, max: 3, step: 0.05, value: 1.05 }), 'repeat-penalty'),
    settingRow('Max context tokens', input('max-context', 'number', { min: 1, step: 256, value: 8192 }), 'max-context'),
    settingRow('Response length', select('response-length', [option('short', 'Short'), option('balanced', 'Balanced'), option('long', 'Long'), option('unlimited', 'Unlimited')]), 'response-length'),
    settingRow('Workflow mode', select('mode', [option('ask', 'Ask'), option('edit', 'Edit'), option('agent', 'Agent — implement changes'), option('explain', 'Explain'), option('inline', 'Inline / Completion')]), 'mode'),
    [createElement('p', { className: 'settings-help' }, ['Provider parameter details: ', createElement('a', { href: 'https://github.com/MickyBalladelli/Ghost/blob/main/OLLAMA_PARAMETERS.md', target: '_blank', rel: 'noreferrer' }, ['open the parameter guide'])])],
    [button('restore-generation-defaults', 'Restore generation defaults', { className: 'secondary settings-inline-action' })]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'agent safety' }, ['Agent safety']))
  appendRows(
    settingRow('File edit approval', select('file-edit-approval', [option('confirm', 'Confirm each edit'), option('one-edit', 'Auto-accept one edit'), option('current-file', 'Auto-accept current file'), option('request', 'Auto-accept this request'), option('session', 'Auto-accept this session'), option('workspace', 'Auto-accept this workspace'), option('always', 'Always auto-accept file edits')]), 'file-edit-approval'),
    [createElement('p', { className: 'settings-help' }, ['Auto-accept can change files without asking. Terminal and other dangerous tools always need approval.'])],
    settingRow('Composer size', input('composer-height', 'range', { min: 80, max: 320, step: 10, value: 180 }), 'composer-height'),
    settingRow('Prompt rows', input('prompt-rows', 'number', { min: 1, max: 12, step: 1, value: 3 }), 'prompt-rows'),
    settingRow('Prompt history entries', input('prompt-history-limit', 'number', { min: 10, max: 500, step: 10, value: 100 }), 'prompt-history-limit')
  )

  grid.append(button('toggle-provider-settings', 'Provider settings: Collapse', {
    className: 'settings-section-toggle',
    'data-settings-section-heading': 'provider',
    'aria-controls': 'provider-settings-fields',
    'aria-expanded': 'true'
  }))
  const providerSettings = createElement('div', { className: 'settings-section-content', id: 'provider-settings-fields' })
  grid.append(providerSettings)
  const appendProviderRows = (...rows: Node[][]): void => rows.forEach(row => providerSettings.append(...row))
  appendProviderRows(
    settingRow('Provider endpoint', input('provider-endpoint', 'url', { placeholder: 'http://localhost:11434' }), 'provider-endpoint'),
    [createElement('p', { className: 'settings-help', id: 'provider-help' }, ['Endpoint for the selected provider.'])],
    settingRow('Compatibility profile', select('openai-profile', [option('generic', 'OpenAI-compatible'), option('anthropic', 'Anthropic'), option('gemini', 'Google Gemini'), option('azure-openai', 'Azure OpenAI'), option('lm-studio', 'LM Studio'), option('llama-cpp', 'llama.cpp'), option('vllm', 'vLLM'), option('litellm', 'LiteLLM'), option('custom', 'Custom HTTP')]), 'openai-profile'),
    settingRow('Azure API version', input('openai-api-version', 'text', { value: '2024-10-21', placeholder: '2024-10-21' }), 'openai-api-version'),
    settingRow('Custom models path', input('openai-custom-models-path', 'text', { value: '/v1/models' }), 'openai-custom-models-path'),
    settingRow('Custom chat path', input('openai-custom-chat-path', 'text', { value: '/v1/chat/completions' }), 'openai-custom-chat-path'),
    settingRow('Custom response format', select('openai-custom-response-format', [option('openai-sse', 'OpenAI SSE'), option('json', 'One JSON response')]), 'openai-custom-response-format'),
    settingRow('Custom JSON request template', textarea('openai-custom-request-template', { rows: 5, spellcheck: false, placeholder: '{"model":"{{model}}","messages":"{{messages}}","stream":"{{stream}}"}' }), 'openai-custom-request-template'),
    settingRow('OpenAI API key header', input('openai-api-key-header', 'text', { value: 'Authorization' }), 'openai-api-key-header'),
    settingRow('OpenAI API key prefix', input('openai-api-key-prefix', 'text', { value: 'Bearer' }), 'openai-api-key-prefix'),
    settingRow('Organization header', input('openai-organization-header', 'text', { value: 'OpenAI-Organization' }), 'openai-organization-header'),
    settingRow('Organization value', input('openai-organization', 'text', { placeholder: 'Optional organization ID' }), 'openai-organization'),
    settingRow('Project header', input('openai-project-header', 'text', { value: 'OpenAI-Project' }), 'openai-project-header'),
    settingRow('Project value', input('openai-project', 'text', { placeholder: 'Optional project ID' }), 'openai-project'),
    settingRow('OpenAI proxy', input('openai-proxy', 'url', { placeholder: 'http://proxy.example:8080' }), 'openai-proxy'),
    settingRow('OpenAI no-proxy hosts', input('openai-no-proxy', 'text', { placeholder: 'localhost, 127.0.0.1, ::1' }), 'openai-no-proxy'),
    [checkboxSetting('openai-tls-reject-unauthorized', 'Verify OpenAI HTTPS certificates', undefined, true)],
    settingRow('TLS CA file', input('openai-tls-ca-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-ca-file'),
    settingRow('TLS client certificate', input('openai-tls-cert-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-cert-file'),
    settingRow('TLS client key', input('openai-tls-key-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-key-file'),
    [createElement('p', { className: 'settings-help' }, ['OpenAI-compatible settings apply to that provider only. API key values stay in VS Code SecretStorage.'])],
    [button('test-provider', 'Test provider connection'), button('refresh-models', 'Refresh models', { className: 'secondary' })],
    [button('open-tool-permissions', 'Configure tool permissions…', { className: 'permission-action-button' })],
    [createElement('div', { className: 'settings-help' }, [createElement('strong', {}, ['Tool permissions']), createElement('br'), createElement('span', { id: 'tool-permissions-summary' }, ['Configure which tools Ghost can use.'])])],
    [button('open-terminal-environment-permissions', 'Configure terminal environment…', { className: 'permission-action-button' })],
    [createElement('div', { className: 'settings-help' }, [createElement('strong', {}, ['Terminal environment']), createElement('br'), createElement('span', { id: 'terminal-environment-permissions-summary' }, ['Configure which environment variables Ghost passes to commands.'])])]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'appearance' }, ['Appearance']))
  appendRows(
    settingRow('Assistant name', input('assistant-name', 'text', { maxlength: 40, value: 'Ghost' }), 'assistant-name'),
    settingRow('Assistant avatar', input('assistant-avatar', 'text', { maxlength: 4, value: '✦' }), 'assistant-avatar'),
    settingRow('Accent color', input('accent-color', 'color', { value: '#3794ff' }), 'accent-color')
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'persistence' }, ['Persistence']))
  appendRows(
    [checkboxSetting('show-reasoning', 'Show provider reasoning when explicitly returned')],
    [checkboxSetting('persist-conversations', 'Save conversations and preferences in VS Code storage')],
    [checkboxSetting('compact-layout', 'Compact conversation layout')],
    [checkboxSetting('show-thinking', 'Show thinking details')],
    [checkboxSetting('show-tool-progress', 'Show verbose tool details')],
    [checkboxSetting('show-diagnostics', 'Show telemetry-free diagnostics')],
    settingRow('Local log level', select('log-level', [option('off', 'Off'), option('error', 'Errors'), option('warn', 'Warnings'), option('info', 'Info'), option('debug', 'Debug')]), 'log-level'),
    [createElement('p', { className: 'settings-help' }, ['Logs stay local in the “Ghost Logs” output channel.'])],
    [checkboxSetting('auto-context', 'Collect context automatically')],
    [checkboxSetting('workspace-settings', 'Use workspace-specific settings')]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'advanced' }, ['Advanced']))
  appendRows(
    settingRow('Custom system instructions', textarea('system-instructions', { rows: 4, maxlength: 8000, placeholder: 'Optional instructions for Ghost' }), 'system-instructions'),
    [button('reset-system-instructions', 'Reset system instructions', { className: 'secondary' })],
    [createElement('p', { className: 'settings-help' }, ['These instructions are sent to the selected model. Do not put secrets here.'])]
  )

  return grid
}

const createSettingsModal = (): HTMLDivElement => {
  const content = createElement('div', { className: 'modal-scroll' }, [
    label('Search settings', 'settings-search', { className: 'settings-search-label' }),
    input('settings-search', 'search', { placeholder: 'Search settings', 'aria-label': 'Search settings' }),
    createSettingsContent(),
    createElement('div', { className: 'preset-section' }, [
      createElement('div', { className: 'modal-subheader' }, [createElement('h3', {}, ['Prompt presets']), button('new-preset', 'New', { className: 'context-button' })]),
      createElement('div', { className: 'preset-row' }, [select('preset-select', [option('', 'Choose a preset')], { 'aria-label': 'Prompt preset' }), button('delete-preset', 'Delete', { className: 'context-button' })]),
      input('preset-name', 'text', { placeholder: 'Preset name', 'aria-label': 'Preset name' }),
      textarea('preset-prompt', { rows: 3, placeholder: 'Reusable prompt text', 'aria-label': 'Preset prompt' })
    ])
  ])
  const footer = [button('save-preset', 'Save'), button('', 'Close', { className: 'secondary', 'data-close-modal': 'settings-modal' })]
  const settings = modal('settings-modal', 'Composer controls', 'settings-title', content, footer[0])
  settings.querySelector('.modal-footer')?.append(footer[1])
  settings.querySelector('.modal-header')?.append(button('privacy-page', 'Privacy', { className: 'secondary' }))
  return settings
}

const createAppShell = (iconUri: string): HTMLDivElement => {
  const providerOptions = [option('ollama', 'Ollama'), option('mlx-vlm', 'MLX / VLM'), option('openai-compatible', 'OpenAI-compatible')]
  const header = createElement('header', { className: 'header' }, [
    createElement('div', { className: 'brand' }, [ghostFace(iconUri, 'brand-mark ghost-face'), createElement('div', {}, [createElement('div', { className: 'title' }, ['Ghost']), createElement('div', { className: 'subtitle' }, ['AI coding assistant'])])]),
    createElement('div', { className: 'header-actions' }, [
      button('history', '', { className: 'icon-button history-button', 'aria-haspopup': 'dialog', 'aria-label': 'History', title: 'History' }, [svgIcon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2')]),
      button('new-chat', '+', { className: 'icon-button', 'aria-label': 'New conversation', title: 'New conversation' }),
      button('import', '⇩', { className: 'icon-button', 'aria-label': 'Import conversations', title: 'Import conversations' }),
      button('export', '⇧', { className: 'icon-button', 'aria-label': 'Export conversations', title: 'Export conversations' }),
      button('reset', '', { className: 'icon-button danger-button', 'aria-label': 'Delete all conversation history and preferences', title: 'Delete all conversation history and preferences' }, [svgIcon('M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Zm-1 7v6m4-6v6m4-6v6')])
    ])
  ])
  const providerAreaContent = createElement('div', { className: 'provider-area-content', id: 'provider-area-content' }, [
    createElement('div', { className: 'provider-field' }, [label('Provider', 'provider', { className: 'control-label' }), select('provider', providerOptions, { 'aria-label': 'Model provider' })]),
    createElement('div', { className: 'provider-field' }, [label('Model', 'model', { className: 'control-label' }), select('model', [], { 'aria-label': 'Chat model' })]),
    createElement('div', { className: 'provider-field' }, [label('Profile', 'model-profile', { className: 'control-label' }), select('model-profile', [], { 'aria-label': 'Model profile' })]),
    createElement('span', { className: 'model-profile-effective', id: 'model-profile-effective', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    createElement('span', { className: 'model-capabilities', id: 'model-capabilities', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    createElement('span', { className: 'connection-indicator', id: 'connection-indicator', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [createElement('span', { className: 'status-dot', 'aria-hidden': 'true' }), createElement('span', { id: 'connection-text' }, ['Checking…'])]),
    createElement('span', { className: 'auto-accept-indicator', id: 'auto-accept-indicator', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    button('quick-switch', 'Quick switch', { className: 'context-button quick-switch-button', 'aria-haspopup': 'dialog' }),
    button('settings', '', { className: 'control-button settings-button', 'aria-haspopup': 'dialog', 'aria-label': 'Settings', title: 'Settings' }, [svgIcon('M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14.1 2h-4.2l-.3 3.1A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6-1.5l2.4 1 2.4-1 2-3.4-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z')])
  ])
  const controls = createElement('section', { className: 'control-strip', 'aria-label': 'Prompt controls' }, [
    button('toggle-provider-area', '', { className: 'provider-area-toggle', 'aria-label': 'Collapse provider controls', title: 'Collapse provider controls', 'aria-controls': 'provider-area-content', 'aria-expanded': 'true' }, [svgIcon('M6 9l6 6 6-6')]),
    providerAreaContent
  ])
  const composer = createElement('form', { className: 'composer', id: 'composer' }, [
    label('Message Ghost', 'prompt', { className: 'screen-reader-only' }),
    createElement('div', { className: 'context-row' }, [button('context-preview', 'Context', { className: 'context-button', 'aria-haspopup': 'dialog', title: 'View prompt context and available tools' }), createElement('label', { className: 'workspace-root-control', htmlFor: 'workspace-root' }, ['Root', select('workspace-root', [], { 'aria-label': 'Workspace root' })]), button('attach', 'Attach', { className: 'context-button' }), input('file-input', 'file', { multiple: true, hidden: true }), createElement('span', { className: 'attachment-limit', id: 'attachment-limit', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })]),
    createElement('div', { className: 'attachment-list', id: 'attachment-list', 'aria-label': 'Attachments' }),
    createElement('div', { className: 'prompt-wrap' }, [textarea('prompt', { rows: 3, placeholder: 'Ask Ghost anything...', 'aria-describedby': 'composer-hint composer-count' }), createElement('div', { className: 'mention-menu', id: 'mention-menu', role: 'listbox', hidden: true })]),
    createElement('div', { className: 'composer-footer' }, [createElement('span', { className: 'composer-hint', id: 'composer-hint' }, ['Enter to send · Shift+Enter for a new line · ↑/↓ prompt history']), createElement('span', { className: 'composer-count', id: 'composer-count' }, ['0 chars · ~0 tokens']), createElement('span', { className: 'persistence-status', id: 'persistence-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), createElement('span', { className: 'prompt-history-actions', 'aria-label': 'Prompt history' }, [button('search-prompt-history', '⌕', { className: 'secondary prompt-history-button', 'aria-label': 'Search prompt history', title: 'Search prompt history' }), button('previous-prompt', '↑', { className: 'secondary prompt-history-button', 'aria-label': 'Previous prompt' }), button('next-prompt', '↓', { className: 'secondary prompt-history-button', 'aria-label': 'Next prompt' })]), button('stop', 'Stop', { className: 'stop-button', hidden: true }), button('send', 'Send', {}, [])])
  ])
  const chat = createElement('div', { className: 'chat-layout' }, [createElement('main', { className: 'chat-main' }, [createElement('section', { className: 'messages', id: 'messages', role: 'log', 'aria-label': 'Conversation messages', 'aria-live': 'polite' }), createElement('div', { className: 'screen-reader-status', id: 'screen-reader-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), composer, createElement('footer', { className: 'status-footer', id: 'status-footer' }, [ghostFace(iconUri, 'thinking-ghost ghost-face'), createElement('span', { className: 'status-dot', 'aria-hidden': 'true' }), createElement('span', { id: 'status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Ready'])])])])

  const toolsContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose what Ghost does for each tool. Allow runs safe tools automatically. Ask pauses for your approval. Deny blocks the tool.']), createElement('div', { id: 'tool-permissions-list' })])
  const terminalContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose which environment variables Ghost may pass to approved terminal commands. Secret-looking names are always blocked.']), createElement('div', { id: 'terminal-environment-permissions-list' }), createElement('div', { className: 'settings-help' }, [label('Add variable name', 'terminal-environment-name'), input('terminal-environment-name', 'text', { placeholder: 'MY_VARIABLE' }), button('add-terminal-environment', 'Add variable', { className: 'secondary' })])])
  const privacyContent = createElement('div', { className: 'modal-scroll privacy-content' }, ['Providers', 'Provider keys', 'Workspace and terminal access', 'Storage', 'Exports', 'Redaction'].map(heading => createElement('div', {}, [createElement('h3', {}, [heading]), createElement('p', {}, ['Ghost keeps provider and workspace data within the configured privacy settings. Review the selected provider before sending sensitive context.'])])))
  const contextContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose what Ghost may include when you submit this prompt.']), createElement('div', { className: 'context-preview', id: 'context-preview-list' })])
  const quickContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Change provider or model without opening full settings.']), createElement('div', { className: 'quick-switch-grid' }, [label('Provider', 'quick-provider'), select('quick-provider', providerOptions), label('Model', 'quick-model'), select('quick-model', [])]), createElement('section', { className: 'diagnostic-card', 'aria-label': 'Connection diagnostics' }, [createElement('strong', { id: 'quick-connection-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Checking…']), createElement('p', { id: 'quick-connection-details', className: 'modal-description', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })])])
  const setupContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Check your local provider before your first request. Ghost stays local unless you choose an external endpoint.']), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['Workflow']), createElement('p', { className: 'modal-description' }, ['Default mode is Agent: Ghost implements approved workspace changes. Ask answers without editing. Edit proposes file changes for you to review. File writes and terminal commands need your approval unless you change Tool permissions. Agent mode is unreliable on MLX/VLM because that provider has no native tool calling; prefer Ollama or an OpenAI-compatible server for tools.'])]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['1. Provider']), createElement('span', { id: 'setup-provider-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Checking…']), button('setup-check-provider', 'Check provider', { className: 'secondary' })]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['2. Models']), createElement('span', { id: 'setup-model-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Waiting for model list…']), createElement('div', { className: 'setup-model-list', id: 'setup-model-list' })]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['3. Test request']), createElement('span', { id: 'setup-test-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Optional: send one small request to verify generation.']), button('setup-test-request', 'Run test request')]), createElement('div', { className: 'setup-capabilities', id: 'setup-capabilities' })])
  const historyContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose a previous conversation to continue.']), createElement('div', { className: 'history-search-row' }, [input('history-search', 'search', { placeholder: 'Search conversations and messages', 'aria-label': 'Search conversation history and messages' }), createElement('label', {}, [input('history-bookmarks-only', 'checkbox'), ' Bookmarks only'])]), createElement('p', { className: 'modal-description', id: 'history-search-summary', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), createElement('div', { className: 'history-list', id: 'history-list' })])
  const promptHistoryContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Search prompts from this conversation. Choose one to put it back in the composer.']), input('prompt-history-search', 'search', { placeholder: 'Search prompts', 'aria-label': 'Search prompts' }), createElement('div', { className: 'prompt-history-list', id: 'prompt-history-list' })])
  const editContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Edit the JSON arguments, then send them back through the approval flow.']), label('Arguments', 'edit-tool-arguments'), textarea('edit-tool-arguments', { className: 'edit-tool-arguments', spellcheck: false, 'aria-describedby': 'edit-tool-error' }), createElement('p', { className: 'form-error', id: 'edit-tool-error', role: 'alert' })])

  const root = createElement('div', { className: 'app' }, [header, controls, chat, createSettingsModal(), modal('tool-permissions-modal', 'Tool permissions', 'tool-permissions-title', toolsContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'tool-permissions-modal' })), modal('terminal-environment-permissions-modal', 'Terminal environment', 'terminal-environment-permissions-title', terminalContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'terminal-environment-permissions-modal' })), modal('privacy-modal', 'Ghost privacy', 'privacy-title', privacyContent, button('', 'Close', { className: 'secondary', 'data-close-modal': 'privacy-modal' })), modal('context-modal', 'Prompt context', 'context-title', contextContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'context-modal' })), modal('quick-switch-modal', 'Quick switch', 'quick-switch-title', quickContent, createElement('span', {}, [button('copy-diagnostics', 'Copy diagnostics', { className: 'secondary' }), button('quick-refresh-models', 'Refresh models', { className: 'secondary' }), button('', 'Done', { className: 'secondary', 'data-close-modal': 'quick-switch-modal' })])), modal('first-run-modal', 'Set up Ghost', 'first-run-title', setupContent, button('finish-first-run', 'Finish setup')), modal('history-modal', 'Conversation history', 'history-title', historyContent, createElement('span', {}, [button('new-history-chat', 'New conversation', { className: 'secondary' }), button('', 'Close', { className: 'secondary', 'data-close-modal': 'history-modal' })])), modal('prompt-history-modal', 'Prompt history', 'prompt-history-title', promptHistoryContent, button('', 'Close', { className: 'secondary', 'data-close-modal': 'prompt-history-modal' })), (() => {
    const form = createElement('form', { id: 'edit-tool-form' }, [editContent, createElement('div', { className: 'modal-footer' }, [button('', 'Cancel', { className: 'secondary', 'data-close-modal': 'edit-tool-modal' }), button('edit-tool-save', 'Validate and send')])])
    const wrapper = createElement('div', { className: 'modal-backdrop', id: 'edit-tool-modal', hidden: true }, [createElement('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edit-tool-title' }, [createElement('div', { className: 'modal-header' }, [createElement('h2', { id: 'edit-tool-title' }, ['Edit tool arguments']), closeButton('edit-tool-modal', 'Close edit tool arguments')]), form])])
    return wrapper
  })()])
  return root
}

const ghostShellGlobal = globalThis as typeof globalThis & { GhostShell: { createAppShell: (iconUri: string) => HTMLDivElement } }
ghostShellGlobal.GhostShell = { createAppShell }
