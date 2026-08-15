# GhostPilot AI

GhostPilot AI (`ghostpilot-ai`) is a privacy-first VS Code coding assistant. It runs prompts against local Ollama or MLX/VLM-compatible servers, so source code can stay on your machine.

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

- `GhostPilot: Check Ollama Connection` checks the configured provider.
- `GhostPilot: Check Required Models` checks the two recommended Ollama models.
- `GhostPilot: Toggle Autocomplete` enables or disables inline completion.

There are no default keyboard shortcuts. Add your own in VS Code Keyboard Shortcuts if desired. Click the GhostPilot status bar item to check the provider connection.

In the Chat view, use `@local` to ask the local agent a question. Use `@workspace` plus a keyword to search workspace files and include matching code in the prompt. Attach files through the chat reference picker when more specific context is needed.

## Configuration

Settings are under `ghostpilot` in VS Code settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghostpilot.provider` | `ollama` | Provider: `ollama`, `mlx-vlm`, or `openai-compatible`. |
| `ghostpilot.ollamaUrl` | `http://localhost:11434` | Ollama server URL. |
| `ghostpilot.mlxUrl` | `http://localhost:8000` | MLX VLM or compatible server URL. |
| `ghostpilot.openaiUrl` | `http://localhost:8001/v1` | OpenAI-compatible server URL. |
| `ghostpilot.chatModel` | `qwen2.5-coder:7b` | Model used for chat. |
| `ghostpilot.autocompleteModel` | `qwen2.5-coder:1.5b` | Fast model used for inline completion. |
| `ghostpilot.maxContextTokens` | `8192` | Maximum context budget sent to the model. |
| `ghostpilot.enableInlineCompletions` | `true` | Master switch for inline completion. |
| `ghostpilot.enableConversationPersistence` | `false` | Save conversations and preferences in VS Code storage. Enable only when wanted. |
| `ghostpilot.toolAllowlist` / `ghostpilot.toolDenylist` | — | Control which agent tools can run in the workspace. |

The **Controls** panel also changes context collection, response length, temperature, workflow mode, provider endpoint, assistant appearance, thinking/tool progress visibility, custom system instructions, and composer size. Enable workspace-specific settings when a project needs different provider or model defaults.

Privacy notes:

- Persistence is off by default. When enabled, conversations stay in VS Code global/workspace storage.
- Attachments are used for the current request and are not saved in conversation state.
- Custom system instructions are sent to the selected provider with each request.
- GhostPilot has no telemetry service. Provider requests go only to the configured endpoint.
- Larger context limits and tool progress use more memory; tool allow/deny settings control agent permissions.

If an MLX server is detected at port 8000 while Ollama is unavailable, GhostPilot reports that `mlx-vlm` may be a better provider choice.

## Package the extension

```bash
npm run vscode:prepublish
npx vsce package --out ghostpilot-ai-1.0.0.vsix
```

Install the generated VSIX from the VS Code Extensions view using **Install from VSIX...**.

## License

MIT. See [LICENSE](LICENSE).
