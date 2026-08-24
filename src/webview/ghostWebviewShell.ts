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

const svgIcon = (path: string, viewBox = '0 0 24 24'): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'ui-icon')
  svg.setAttribute('viewBox', viewBox)
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

const settingsIconPath = [
  'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42C14.47 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.5.42L9.12 5.07c-.61.25-1.18.59-1.69.98l-2.49-1c-.23-.08-.48 0-.6.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65Z',
  'M12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7Z'
].join(' ')

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

const settingRow = (text: string, control: Node, id?: string, title?: string, providerScope?: string): Node[] => {
  const scope = providerScope ? { 'data-provider-scope': providerScope } : {}
  if (providerScope && control instanceof HTMLElement) control.dataset.providerScope = providerScope
  return [
    label(text, id, { ...(title ? { title } : {}), ...scope }),
    control
  ]
}

const checkboxSetting = (id: string, text: string, title?: string, checked = false, providerScope?: string): HTMLLabelElement =>
  createElement('label', { className: 'settings-checkbox', htmlFor: id, ...(title ? { title } : {}), ...(providerScope ? { 'data-provider-scope': providerScope } : {}) }, [
    input(id, 'checkbox', { checked }),
    text
  ])

const createSettingsContent = (): HTMLDivElement => {
  const grid = createElement('div', { className: 'settings-grid' })
  const appendRows = (...rows: Node[][]): void => rows.forEach(row => grid.append(...row))

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'generation' }, ['Generation']))
  appendRows(
    settingRow('Temperature', input('temperature', 'range', { min: 0, max: 2, step: 0.1, value: 0.3, title: 'Temperature: 0 is most focused; 1 is balanced; 2 is most varied.' }), 'temperature', 'Controls randomness. An output value is shown beside the label.', 'not-opencode'),
    [createElement('output', { id: 'temperature-value', 'data-provider-scope': 'not-opencode' }, ['0.3'])],
    settingRow('Top P', input('top-p', 'number', { min: 0, max: 1, step: 0.01, value: 0.9 }), 'top-p', undefined, 'not-opencode'),
    settingRow('Top K', input('top-k', 'number', { min: 0, step: 1, value: 20 }), 'top-k', undefined, 'not-opencode'),
    settingRow('Min P', input('min-p', 'number', { min: 0, max: 1, step: 0.01, value: 0.05 }), 'min-p', undefined, 'not-opencode'),
    settingRow('Presence penalty', input('presence-penalty', 'number', { min: -2, max: 2, step: 0.1, value: 0 }), 'presence-penalty', undefined, 'not-opencode'),
    settingRow('Repeat penalty', input('repeat-penalty', 'number', { min: 0, max: 3, step: 0.05, value: 1.05 }), 'repeat-penalty', undefined, 'not-opencode'),
    settingRow('Max context tokens', input('max-context', 'number', { min: 1, step: 256, value: 8192 }), 'max-context'),
    settingRow('Response length', select('response-length', [option('short', 'Short'), option('balanced', 'Balanced'), option('long', 'Long'), option('unlimited', 'Unlimited')]), 'response-length', undefined, 'not-opencode'),
    [createElement('p', { className: 'settings-help', 'data-provider-scope': 'not-opencode' }, ['Provider parameter details: ', createElement('a', { href: 'https://github.com/MickyBalladelli/Ghost/blob/main/OLLAMA_PARAMETERS.md', target: '_blank', rel: 'noreferrer' }, ['open the parameter guide'])])],
    [button('restore-generation-defaults', 'Restore generation defaults', { className: 'secondary settings-inline-action', 'data-provider-scope': 'not-opencode' })]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'inline completion' }, ['Inline completion']))
  appendRows(
    [checkboxSetting('enable-inline-completions', 'Enable inline code completion', 'Show Ghost suggestions while typing.')],
    [createElement('p', { className: 'settings-help' }, ['Inline completion uses the separate autocomplete model and does not change the chat workflow.'])]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'agent safety' }, ['Agent safety']))
  appendRows(
    settingRow('File edit approval', select('file-edit-approval', [option('confirm', 'Confirm each edit'), option('one-edit', 'Auto-accept one edit'), option('current-file', 'Auto-accept current file'), option('request', 'Auto-accept this request'), option('session', 'Auto-accept this session'), option('workspace', 'Auto-accept this workspace'), option('always', 'Always auto-accept file edits')]), 'file-edit-approval', undefined, 'not-opencode'),
    settingRow('File edit approval', select('opencode-file-edit-approval', [option('confirm', 'Confirm each edit'), option('request', 'Auto-accept each request'), option('workspace', 'Auto-accept this workspace'), option('always', 'Always auto-accept file edits')]), 'opencode-file-edit-approval', undefined, 'opencode'),
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
    settingRow('OpenCode username', input('opencode-username', 'text', { value: 'opencode', placeholder: 'opencode' }), 'opencode-username', undefined, 'opencode'),
    settingRow('OpenCode agent', input('opencode-agent', 'text', { placeholder: 'Use server default' }), 'opencode-agent', undefined, 'opencode'),
    settingRow('Session handling', select('opencode-session-reuse', [option('workspace', 'Reuse per conversation'), option('new', 'New session for every request')]), 'opencode-session-reuse', undefined, 'opencode'),
    [button('set-opencode-password', 'Set OpenCode password…', { className: 'secondary settings-inline-action', 'data-provider-scope': 'opencode' })],
    [createElement('p', { className: 'settings-help', 'data-provider-scope': 'opencode' }, ['Password is optional and stays in VS Code SecretStorage.'])],
    settingRow('OpenRouter HTTP-Referer', input('openrouter-referer', 'url', { placeholder: 'Optional site URL' }), 'openrouter-referer', undefined, 'openrouter'),
    settingRow('OpenRouter title', input('openrouter-title', 'text', { value: 'Ghost Coding Assistant' }), 'openrouter-title', undefined, 'openrouter'),
    [button('set-openrouter-api-key', 'Set OpenRouter API key…', { className: 'secondary settings-inline-action', 'data-provider-scope': 'openrouter' })],
    [checkboxSetting('openrouter-allow-fallbacks', 'Allow provider fallbacks', 'Let OpenRouter try another provider when the selected one fails.', true, 'openrouter')],
    [checkboxSetting('openrouter-require-parameters', 'Require requested parameters', 'Only use routed providers that support all parameters Ghost sends.', false, 'openrouter')],
    settingRow('Data collection', select('openrouter-data-collection', [option('allow', 'Allow'), option('deny', 'Deny')]), 'openrouter-data-collection', undefined, 'openrouter'),
    settingRow('Provider order', input('openrouter-provider-order', 'text', { placeholder: 'anthropic, openai' }), 'openrouter-provider-order', 'Comma-separated OpenRouter provider slugs.', 'openrouter'),
    settingRow('OpenRouter proxy', input('openrouter-proxy', 'url', { placeholder: 'http://proxy.example:8080' }), 'openrouter-proxy', undefined, 'openrouter'),
    settingRow('OpenRouter no-proxy hosts', input('openrouter-no-proxy', 'text', { placeholder: 'localhost, 127.0.0.1, ::1' }), 'openrouter-no-proxy', undefined, 'openrouter'),
    [checkboxSetting('openrouter-tls-reject-unauthorized', 'Verify OpenRouter HTTPS certificates', undefined, true, 'openrouter')],
    settingRow('OpenRouter TLS CA file', input('openrouter-tls-ca-file', 'text', { placeholder: 'Optional PEM file path' }), 'openrouter-tls-ca-file', undefined, 'openrouter'),
    settingRow('OpenRouter TLS client certificate', input('openrouter-tls-cert-file', 'text', { placeholder: 'Optional PEM file path' }), 'openrouter-tls-cert-file', undefined, 'openrouter'),
    settingRow('OpenRouter TLS client key', input('openrouter-tls-key-file', 'text', { placeholder: 'Optional PEM file path' }), 'openrouter-tls-key-file', undefined, 'openrouter'),
    [createElement('p', { className: 'settings-help', 'data-provider-scope': 'openrouter' }, ['OpenRouter sends prompts and workspace context to its remote model providers. Set routing and data collection to match your privacy needs.'])],
    settingRow('Compatibility profile', select('openai-profile', [option('generic', 'OpenAI-compatible'), option('anthropic', 'Anthropic'), option('gemini', 'Google Gemini'), option('azure-openai', 'Azure OpenAI'), option('lm-studio', 'LM Studio'), option('llama-cpp', 'llama.cpp'), option('vllm', 'vLLM'), option('litellm', 'LiteLLM'), option('custom', 'Custom HTTP')]), 'openai-profile', undefined, 'openai-compatible'),
    settingRow('Azure API version', input('openai-api-version', 'text', { value: '2024-10-21', placeholder: '2024-10-21' }), 'openai-api-version', undefined, 'openai-compatible'),
    settingRow('Custom models path', input('openai-custom-models-path', 'text', { value: '/v1/models' }), 'openai-custom-models-path', undefined, 'openai-compatible'),
    settingRow('Custom chat path', input('openai-custom-chat-path', 'text', { value: '/v1/chat/completions' }), 'openai-custom-chat-path', undefined, 'openai-compatible'),
    settingRow('Custom response format', select('openai-custom-response-format', [option('openai-sse', 'OpenAI SSE'), option('json', 'One JSON response')]), 'openai-custom-response-format', undefined, 'openai-compatible'),
    settingRow('Custom JSON request template', textarea('openai-custom-request-template', { rows: 5, spellcheck: false, placeholder: '{"model":"{{model}}","messages":"{{messages}}","stream":"{{stream}}"}' }), 'openai-custom-request-template', undefined, 'openai-compatible'),
    settingRow('OpenAI API key header', input('openai-api-key-header', 'text', { value: 'Authorization' }), 'openai-api-key-header', undefined, 'openai-compatible'),
    settingRow('OpenAI API key prefix', input('openai-api-key-prefix', 'text', { value: 'Bearer' }), 'openai-api-key-prefix', undefined, 'openai-compatible'),
    settingRow('Organization header', input('openai-organization-header', 'text', { value: 'OpenAI-Organization' }), 'openai-organization-header', undefined, 'openai-compatible'),
    settingRow('Organization value', input('openai-organization', 'text', { placeholder: 'Optional organization ID' }), 'openai-organization', undefined, 'openai-compatible'),
    settingRow('Project header', input('openai-project-header', 'text', { value: 'OpenAI-Project' }), 'openai-project-header', undefined, 'openai-compatible'),
    settingRow('Project value', input('openai-project', 'text', { placeholder: 'Optional project ID' }), 'openai-project', undefined, 'openai-compatible'),
    settingRow('OpenAI proxy', input('openai-proxy', 'url', { placeholder: 'http://proxy.example:8080' }), 'openai-proxy', undefined, 'openai-compatible'),
    settingRow('OpenAI no-proxy hosts', input('openai-no-proxy', 'text', { placeholder: 'localhost, 127.0.0.1, ::1' }), 'openai-no-proxy', undefined, 'openai-compatible'),
    [checkboxSetting('openai-tls-reject-unauthorized', 'Verify OpenAI HTTPS certificates', undefined, true, 'openai-compatible')],
    settingRow('TLS CA file', input('openai-tls-ca-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-ca-file', undefined, 'openai-compatible'),
    settingRow('TLS client certificate', input('openai-tls-cert-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-cert-file', undefined, 'openai-compatible'),
    settingRow('TLS client key', input('openai-tls-key-file', 'text', { placeholder: 'Optional PEM file path' }), 'openai-tls-key-file', undefined, 'openai-compatible'),
    [createElement('p', { className: 'settings-help', 'data-provider-scope': 'openai-compatible' }, ['OpenAI-compatible settings apply to that provider only. API key values stay in VS Code SecretStorage.'])],
    [button('test-provider', 'Test provider connection')],
    [button('open-tool-permissions', 'Configure tool permissions…', { className: 'permission-action-button' })],
    [createElement('div', { className: 'settings-help' }, [createElement('strong', {}, ['Tool permissions']), createElement('br'), createElement('span', { id: 'tool-permissions-summary' }, ['Configure which tools Ghost can use.'])])],
    [button('open-terminal-environment-permissions', 'Configure terminal environment…', { className: 'permission-action-button', 'data-provider-scope': 'not-opencode' })],
    [createElement('div', { className: 'settings-help', 'data-provider-scope': 'not-opencode' }, [createElement('strong', {}, ['Terminal environment']), createElement('br'), createElement('span', { id: 'terminal-environment-permissions-summary' }, ['Configure which environment variables Ghost passes to commands.'])])]
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'appearance' }, ['Appearance']))
  appendRows(
    settingRow('Assistant name', input('assistant-name', 'text', { maxlength: 40, value: 'Ghost' }), 'assistant-name'),
    settingRow('Assistant avatar', input('assistant-avatar', 'text', { maxlength: 4, value: '✦' }), 'assistant-avatar'),
    settingRow('Accent color', input('accent-color', 'color', { value: '#3794ff' }), 'accent-color')
  )

  grid.append(createElement('div', { className: 'settings-section-heading', 'data-settings-section-heading': 'persistence' }, ['Persistence']))
  appendRows(
    [checkboxSetting('show-reasoning', 'Show provider reasoning when explicitly returned', undefined, false, 'not-opencode')],
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
  const providerOptions = [option('mlx-vlm', 'MLX / VLM'), option('ollama', 'Ollama'), option('openai-compatible', 'OpenAI-compatible'), option('opencode', 'OpenCode'), option('openrouter', 'OpenRouter')]
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
    createElement('div', { className: 'provider-field' }, [label('Provider', 'provider', { className: 'control-label' }), createElement('div', { className: 'provider-select-row' }, [select('provider', providerOptions, { 'aria-label': 'Model provider' }), button('refresh-models', 'Refresh models', { className: 'secondary provider-refresh-models', title: 'Refresh models from the provider' })])]),
    createElement('div', { className: 'provider-field model-field' }, [label('Model', 'model', { className: 'control-label' }), createElement('div', { className: 'model-autocomplete', id: 'model-autocomplete' }, [input('model', 'search', { 'aria-label': 'Chat model', role: 'combobox', autocomplete: 'off', spellcheck: false, 'aria-autocomplete': 'list', 'aria-controls': 'model-options', 'aria-expanded': 'false' }), button('model-options-toggle', '⌄', { className: 'model-options-toggle', 'aria-label': 'Show models', title: 'Show models', tabindex: -1 }), createElement('div', { className: 'model-options', id: 'model-options', role: 'listbox', 'aria-label': 'Matching models', hidden: true })])]),
    createElement('div', { className: 'provider-field', 'data-provider-scope': 'not-opencode' }, [label('Profile', 'model-profile', { className: 'control-label' }), select('model-profile', [], { 'aria-label': 'Model profile' })]),
    createElement('span', { className: 'model-profile-effective', id: 'model-profile-effective', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-provider-scope': 'not-opencode' }),
    createElement('span', { className: 'model-capabilities', id: 'model-capabilities', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    createElement('span', { className: 'connection-indicator', id: 'connection-indicator', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [createElement('span', { className: 'status-dot', 'aria-hidden': 'true' }), createElement('span', { id: 'connection-text' }, ['Checking…'])]),
    createElement('span', { className: 'auto-accept-indicator', id: 'auto-accept-indicator', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
  ])
  const controls = createElement('section', { className: 'control-strip', 'aria-label': 'Prompt controls' }, [
    button('toggle-provider-area', '', { className: 'provider-area-toggle', 'aria-label': 'Collapse provider controls', title: 'Collapse provider controls', 'aria-controls': 'provider-area-content', 'aria-expanded': 'true' }, [svgIcon('M6 9l6 6 6-6')]),
    button('settings', '', { className: 'control-button settings-button', 'aria-haspopup': 'dialog', 'aria-label': 'Settings', title: 'Settings' }, [svgIcon(settingsIconPath, '-1 -1 26 26')]),
    providerAreaContent
  ])
  const composer = createElement('form', { className: 'composer', id: 'composer' }, [
    label('Message Ghost', 'prompt', { className: 'screen-reader-only' }),
    createElement('div', { className: 'context-row' }, [button('context-preview', 'Context', { className: 'context-button', 'aria-haspopup': 'dialog', title: 'View prompt context and available tools' }), createElement('label', { className: 'workspace-root-control', htmlFor: 'workspace-root' }, ['Root', select('workspace-root', [], { 'aria-label': 'Workspace root' })]), button('attach', 'Attach', { className: 'context-button' }), input('file-input', 'file', { multiple: true, hidden: true }), createElement('span', { className: 'attachment-limit', id: 'attachment-limit', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })]),
    createElement('div', { className: 'attachment-list', id: 'attachment-list', 'aria-label': 'Attachments' }),
    createElement('div', { className: 'prompt-wrap' }, [textarea('prompt', { rows: 3, placeholder: 'Ask Ghost anything...', 'aria-describedby': 'composer-hint composer-count' }), createElement('div', { className: 'mention-menu', id: 'mention-menu', role: 'listbox', hidden: true })]),
    createElement('div', { className: 'composer-footer' }, [createElement('span', { className: 'composer-hint', id: 'composer-hint' }, ['Enter to send · Shift+Enter for a new line · ↑/↓ prompt history']), createElement('span', { className: 'composer-count', id: 'composer-count' }, ['0 chars · ~0 tokens']), createElement('span', { className: 'persistence-status', id: 'persistence-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), button('stop', 'Stop', { className: 'stop-button', hidden: true }), select('mode', [option('agent', 'Agent'), option('plan', 'Plan'), option('ask', 'Ask'), option('edit', 'Edit'), option('explain', 'Explain')], { className: 'workflow-mode-select', 'aria-label': 'Workflow mode', title: 'Workflow mode' }), button('send', '', { className: 'composer-action-button', 'aria-label': 'Send', title: 'Send' }, [svgIcon('M3 12h14M13 6l6 6-6 6')]), createElement('span', { className: 'prompt-history-actions', 'aria-label': 'Prompt history' }, [button('search-prompt-history', '', { className: 'secondary prompt-history-button composer-action-button', 'aria-label': 'Search prompt history', title: 'Search prompt history' }, [svgIcon('M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM16 16l5 5')]), button('previous-prompt', '', { className: 'secondary prompt-history-button composer-action-button', 'aria-label': 'Previous prompt', title: 'Previous prompt' }, [svgIcon('M12 18V6M6 12l6-6 6 6')]), button('next-prompt', '', { className: 'secondary prompt-history-button composer-action-button', 'aria-label': 'Next prompt', title: 'Next prompt' }, [svgIcon('M12 6v12m-6-6 6 6 6-6')])])])
  ])
  const chat = createElement('div', { className: 'chat-layout' }, [createElement('main', { className: 'chat-main' }, [createElement('section', { className: 'messages', id: 'messages', role: 'log', 'aria-label': 'Conversation messages', 'aria-live': 'polite' }), createElement('div', { className: 'screen-reader-status', id: 'screen-reader-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), composer, createElement('footer', { className: 'status-footer', id: 'status-footer' }, [ghostFace(iconUri, 'thinking-ghost ghost-face'), createElement('span', { className: 'status-dot', 'aria-hidden': 'true' }), createElement('span', { id: 'status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Ready'])])])])

  const toolsContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose what Ghost does for each tool. Allow runs safe tools automatically. Ask pauses for your approval. Deny blocks the tool.']), createElement('div', { id: 'tool-permissions-list' })])
  const terminalContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose which environment variables Ghost may pass to approved terminal commands. Secret-looking names are always blocked.']), createElement('div', { id: 'terminal-environment-permissions-list' }), createElement('div', { className: 'settings-help' }, [label('Add variable name', 'terminal-environment-name'), input('terminal-environment-name', 'text', { placeholder: 'MY_VARIABLE' }), button('add-terminal-environment', 'Add variable', { className: 'secondary' })])])
  const privacyContent = createElement('div', { className: 'modal-scroll privacy-content' }, ['Providers', 'Provider keys', 'Workspace and terminal access', 'Storage', 'Exports', 'Redaction'].map(heading => createElement('div', {}, [createElement('h3', {}, [heading]), createElement('p', {}, ['Ghost keeps provider and workspace data within the configured privacy settings. Review the selected provider before sending sensitive context.'])])))
  const contextContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose what Ghost may include when you submit this prompt.']), createElement('div', { className: 'context-preview', id: 'context-preview-list' })])
  const setupContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Check your local provider before your first request. Ghost stays local unless you choose an external endpoint.']), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['Workflow']), createElement('p', { className: 'modal-description' }, ['Default mode is Agent: Ghost implements approved workspace changes. Plan inspects the workspace and creates a read-only implementation plan. Ask answers without editing. Edit proposes file changes for you to review. File writes and terminal commands need your approval unless you change Tool permissions. Agent and Plan modes are unreliable on MLX/VLM because that provider has no native tool calling; prefer Ollama or an OpenAI-compatible server for tools.'])]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['1. Provider']), createElement('span', { id: 'setup-provider-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Checking…']), button('setup-check-provider', 'Check provider', { className: 'secondary' })]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['2. Models']), createElement('span', { id: 'setup-model-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Waiting for model list…']), createElement('div', { className: 'setup-model-list', id: 'setup-model-list' })]), createElement('div', { className: 'setup-check' }, [createElement('strong', {}, ['3. Test request']), createElement('span', { id: 'setup-test-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, ['Optional: send one small request to verify generation.']), button('setup-test-request', 'Run test request')]), createElement('div', { className: 'setup-capabilities', id: 'setup-capabilities' })])
  const historyContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Choose a previous conversation to continue.']), createElement('div', { className: 'history-search-row' }, [input('history-search', 'search', { placeholder: 'Search conversations and messages', 'aria-label': 'Search conversation history and messages' }), createElement('label', {}, [input('history-bookmarks-only', 'checkbox'), ' Bookmarks only'])]), createElement('p', { className: 'modal-description', id: 'history-search-summary', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }), createElement('div', { className: 'history-list', id: 'history-list' })])
  const deleteConversationContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description', id: 'delete-conversation-description' }, ['Delete this conversation? This cannot be undone.'])])
  const promptHistoryContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Search prompts from this conversation. Choose one to put it back in the composer.']), input('prompt-history-search', 'search', { placeholder: 'Search prompts', 'aria-label': 'Search prompts' }), createElement('div', { className: 'prompt-history-list', id: 'prompt-history-list' })])
  const editContent = createElement('div', { className: 'modal-scroll' }, [createElement('p', { className: 'modal-description' }, ['Edit the JSON arguments, then send them back through the approval flow.']), label('Arguments', 'edit-tool-arguments'), textarea('edit-tool-arguments', { className: 'edit-tool-arguments', spellcheck: false, 'aria-describedby': 'edit-tool-error' }), createElement('p', { className: 'form-error', id: 'edit-tool-error', role: 'alert' })])

  const root = createElement('div', { className: 'app' }, [header, controls, chat, createSettingsModal(), modal('tool-permissions-modal', 'Tool permissions', 'tool-permissions-title', toolsContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'tool-permissions-modal' })), modal('terminal-environment-permissions-modal', 'Terminal environment', 'terminal-environment-permissions-title', terminalContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'terminal-environment-permissions-modal' })), modal('privacy-modal', 'Ghost privacy', 'privacy-title', privacyContent, button('', 'Close', { className: 'secondary', 'data-close-modal': 'privacy-modal' })), modal('context-modal', 'Prompt context', 'context-title', contextContent, button('', 'Done', { className: 'secondary', 'data-close-modal': 'context-modal' })), modal('first-run-modal', 'Set up Ghost', 'first-run-title', setupContent, button('finish-first-run', 'Finish setup')), modal('history-modal', 'Conversation history', 'history-title', historyContent, createElement('span', {}, [button('new-history-chat', 'New conversation', { className: 'secondary' }), button('', 'Close', { className: 'secondary', 'data-close-modal': 'history-modal' })])), modal('delete-conversation-modal', 'Delete conversation', 'delete-conversation-title', deleteConversationContent, createElement('span', {}, [button('cancel-delete-conversation', 'Cancel', { className: 'secondary', 'data-close-modal': 'delete-conversation-modal' }), button('confirm-delete-conversation', 'Delete', { className: 'danger-button' })])), modal('prompt-history-modal', 'Prompt history', 'prompt-history-title', promptHistoryContent, button('', 'Close', { className: 'secondary', 'data-close-modal': 'prompt-history-modal' })), (() => {
    const form = createElement('form', { id: 'edit-tool-form' }, [editContent, createElement('div', { className: 'modal-footer' }, [button('', 'Cancel', { className: 'secondary', 'data-close-modal': 'edit-tool-modal' }), button('edit-tool-save', 'Validate and send')])])
    const wrapper = createElement('div', { className: 'modal-backdrop', id: 'edit-tool-modal', hidden: true }, [createElement('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edit-tool-title' }, [createElement('div', { className: 'modal-header' }, [createElement('h2', { id: 'edit-tool-title' }, ['Edit tool arguments']), closeButton('edit-tool-modal', 'Close edit tool arguments')]), form])])
    return wrapper
  })()])
  return root
}

const ghostShellGlobal = globalThis as typeof globalThis & { GhostShell: { createAppShell: (iconUri: string) => HTMLDivElement } }
ghostShellGlobal.GhostShell = { createAppShell }
