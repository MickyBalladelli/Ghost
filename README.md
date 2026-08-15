# GhostPilot AI

LocalPilot AI (`localpilot-ai`) is a privacy-first VS Code coding assistant. It runs prompts against local Ollama or MLX/VLM-compatible servers, so source code can stay on your machine.

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

- `LocalPilot: Check Ollama Connection` checks the configured provider.
- `LocalPilot: Check Required Models` checks the two recommended Ollama models.
- `LocalPilot: Toggle Autocomplete` enables or disables inline completion.

There are no default keyboard shortcuts. Add your own in VS Code Keyboard Shortcuts if desired. Click the LocalPilot status bar item to check the provider connection.

In the Chat view, use `@local` to ask the local agent a question. Use `@workspace` plus a keyword to search workspace files and include matching code in the prompt. Attach files through the chat reference picker when more specific context is needed.

## Configuration

Settings are under `localpilot` in VS Code settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `localpilot.provider` | `ollama` | Provider: `ollama`, `mlx-vlm`, or `openai-compatible`. |
| `localpilot.ollamaUrl` | `http://localhost:11434` | Ollama server URL. |
| `localpilot.mlxUrl` | `http://localhost:8000` | MLX VLM or compatible server URL. |
| `localpilot.chatModel` | `qwen2.5-coder:7b` | Model used for chat. |
| `localpilot.autocompleteModel` | `qwen2.5-coder:1.5b` | Fast model used for inline completion. |
| `localpilot.maxContextTokens` | `8192` | Maximum context budget sent to the model. |
| `localpilot.enableInlineCompletions` | `true` | Master switch for inline completion. |

If an MLX server is detected at port 8000 while Ollama is unavailable, LocalPilot reports that `mlx-vlm` may be a better provider choice.

## Package the extension

```bash
npm run vscode:prepublish
npx vsce package --out localpilot-ai-1.0.0.vsix
```

Install the generated VSIX from the VS Code Extensions view using **Install from VSIX...**.

## License

MIT. See [LICENSE](LICENSE).
