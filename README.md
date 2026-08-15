# Ghost

Ghost (`ghost`) is a privacy-first VS Code coding assistant. It runs prompts against local Ollama or MLX/VLM-compatible servers, so source code can stay on your machine.

## Prerequisites

- VS Code 1.125 or newer
- Node.js 20 or newer and npm
- Ollama, or an OpenAI-compatible local server

Install Ollama from [ollama.com](https://ollama.com), then pull the recommended models:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
```

Start Ollama using its normal desktop app or service. The extension uses `http://localhost:11434` by default.

## Features

- Inline code completion with Fill-in-the-Middle prompts.
- Native `@local` chat participant for local coding help.
- `@workspace` context search and file attachments from chat references.
- Optional MLX VLM and generic OpenAI-compatible providers.
- Local agent tools for reading files, writing files, listing directories, and running terminal commands.
- Confirmation prompts for file changes and terminal commands.
- Status bar health indicator and model diagnostic commands.

## Run from source

```bash
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch the Extension Development Host.

## Commands and key bindings

Open the Command Palette and run:

- `Ghost: Check Ollama Connection` checks the configured provider.
- `Ghost: Check Required Models` checks the two recommended Ollama models.
- `Ghost: Toggle Autocomplete` enables or disables inline completion.

There are no default keyboard shortcuts. Add your own in VS Code Keyboard Shortcuts if desired. Click the Ghost status bar item to check the provider connection.

In the Chat view, use `@local` to ask the local agent a question. Use `@workspace` plus a keyword to search workspace files and include matching code in the prompt. Attach files through the chat reference picker when more specific context is needed.

## Interface guide

The Ghost view has a provider and model strip, conversation sidebar, message log, and composer.

- Press `Enter` to send. Press `Shift+Enter` for a new line.
- Use **Context** to toggle workspace, folders, active file, selection, open files, and tools.
- Use **Attach** to add text files to the current request. Attachments are not saved in conversation history.
- Choose Ask, Edit, Agent, Explain, or Inline mode from **Controls**.
- Enable thinking details, tool progress, diagnostics, compact layout, custom instructions, or a custom assistant identity in **Controls**.
- File edits show a diff and need approval. Approved edits can be restored when the restore action is available.
- Use the conversation sidebar to create, switch, rename, or remove conversations. Long conversations load older messages on demand.

Keyboard-only use is supported. Focused controls show a visible outline. The view responds to high-contrast themes, reduced-motion settings, and narrow sidebars.

## Customization and privacy

Provider URLs, model defaults, context limits, temperature, response length, workflow mode, tool allow/deny lists, persistence, debug logging, and inline completion are available in VS Code settings or the **Controls** panel. Workspace-specific settings can override global settings.

Persistence is off by default. When enabled, chat state is stored in VS Code storage with schema migration and common credential redaction. Debug logging is opt-in, local, structured, and telemetry-free. An external provider URL is shown in the interface so network scope is visible.

## Troubleshooting

- **Offline**: open **Controls**, confirm the provider URL, then use **Test provider connection**. For Ollama, check that the service is running and that the selected model is installed.
- **No model**: refresh models, then select a discovered model. Check `Ghost: Check Required Models` for the recommended Ollama models.
- **Empty or failed response**: verify the provider API mode and endpoint suffix. OpenAI-compatible servers normally use `/v1`; Ollama normally uses its base URL.
- **Slow interface**: lower the context limit, disable automatic context, hide progress details, or use compact layout. Long histories are paginated.
- **Tool blocked**: check the workspace tool allowlist and denylist. File edits and terminal commands still require approval.

## Testing and release verification

```bash
npm run compile
npm test
npx vsce package --out ghost-1.0.12.vsix
```

Before release, open the VSIX in a clean Extension Development Host and manually verify light, dark, and high-contrast themes; Ask, Edit, Agent, and Explain; file attachments; workspace search; tool approval; diff review; cancellation; retry; multiline composer input; conversation switching; settings changes; and external endpoint status.

See [the architecture guide](docs/architecture.md) for the host, webview, provider, agent, persistence, and approval flow.

## Configuration

Settings are under `ghost` in VS Code settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.provider` | `ollama` | Provider: `ollama`, `mlx-vlm`, or `openai-compatible`. |
| `ghost.ollamaUrl` | `http://localhost:11434` | Ollama server URL. |
| `ghost.mlxUrl` | `http://localhost:8000` | MLX VLM or compatible server URL. |
| `ghost.openaiUrl` | `http://localhost:8001/v1` | OpenAI-compatible server URL. |
| `ghost.chatModel` | `qwen2.5-coder:7b` | Model used for chat. |
| `ghost.autocompleteModel` | `qwen2.5-coder:1.5b` | Fast model used for inline completion. |
| `ghost.maxContextTokens` | `8192` | Maximum context budget sent to the model. |
| `ghost.enableInlineCompletions` | `true` | Master switch for inline completion. |
| `ghost.enableConversationPersistence` | `false` | Save conversations and preferences in VS Code storage. Enable only when wanted. |
| `ghost.toolAllowlist` / `ghost.toolDenylist` | — | Control which agent tools can run in the workspace. |

The **Controls** panel also changes context collection, response length, temperature, workflow mode, provider endpoint, assistant appearance, thinking/tool progress visibility, custom system instructions, and composer size. Enable workspace-specific settings when a project needs different provider or model defaults.

Privacy notes:

- Persistence is off by default. When enabled, conversations stay in VS Code global/workspace storage.
- Attachments are used for the current request and are not saved in conversation state.
- Custom system instructions are sent to the selected provider with each request.
- Ghost has no telemetry service. Provider requests go only to the configured endpoint.
- Larger context limits and tool progress use more memory; tool allow/deny settings control agent permissions.

If an MLX server is detected at port 8000 while Ollama is unavailable, Ghost reports that `mlx-vlm` may be a better provider choice.

## Package the extension

```bash
npm run vscode:prepublish
npx vsce package --out ghost-1.0.12.vsix
```

Install the generated VSIX from the VS Code Extensions view using **Install from VSIX.

```bash
code --install-extension ./ghost-1.0.12.vsix
```
## License

MIT. See [LICENSE](LICENSE).
