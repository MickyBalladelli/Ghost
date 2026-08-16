<p align="center">
  <img src="icon.png" alt="Ghost icon" width="96">
</p>

<h1 align="center">Ghost</h1>

<p align="center">A privacy-first, local-first coding assistant for VS Code.</p>

<p align="center">
  <a href="https://github.com/MickyBalladelli/Ghost/stargazers"><img src="https://img.shields.io/github/stars/MickyBalladelli/Ghost?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/MickyBalladelli/Ghost/issues"><img src="https://img.shields.io/github/issues/MickyBalladelli/Ghost?style=flat-square" alt="GitHub issues"></a>
  <a href="https://github.com/MickyBalladelli/Ghost/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MickyBalladelli/Ghost?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.125%2B-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white" alt="VS Code 1.125 or newer">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
</p>

Ghost runs chat, agent tools, and inline completion against Ollama, MLX/VLM, or another OpenAI-compatible server. Your code stays on your machine when you use a local provider.

## Highlights

- Local chat through the Ghost view and the native `@local` chat participant.
- Ollama support with automatic API compatibility handling.
- MLX/VLM and generic OpenAI-compatible provider support.
- Inline code completion with a fast Fill-in-the-Middle model.
- Workspace context from the workspace, folders, active editor, selection, and open files.
- Text-file attachments for focused requests.
- Five workspace tools with allowlists, denylists, approval prompts, and visible progress.
- Diff previews for edits, selected-hunk approval, and restore actions for applied edits.
- Ask, Edit, Agent, Explain, and Inline workflow modes.
- Conversation sidebar, prompt history, presets, import/export, retry, regenerate, and cancellation.
- Configurable assistant name, avatar, accent color, layout, context, and response behavior.
- Keyboard-friendly interface with visible focus, screen-reader status updates, high-contrast theme support, reduced motion, and narrow-sidebar layout support.
- No Ghost telemetry service. Provider requests go only to the configured endpoint.

## Requirements

- VS Code 1.125 or newer
- Node.js 20 or newer and npm when running Ghost from source
- Ollama, MLX/VLM, or another OpenAI-compatible local server

For the default Ollama setup, install [Ollama](https://ollama.com) and pull the recommended models:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
```

Start Ollama with its normal desktop app or service. Ghost uses `http://localhost:11434` by default.

## Install from source

```bash
git clone https://github.com/MickyBalladelli/Ghost.git
cd Ghost
npm install
npm run compile
```

Open the folder in VS Code and press `F5` to launch the Extension Development Host. Open Ghost from the Activity Bar or run `Ghost: Open Interface` from the Command Palette.

## Install from a VSIX

Build a VSIX:

```bash
npm install
npm run vscode:prepublish
npx vsce package --out ghost.vsix
```

Then install it from the VS Code Extensions view with **Install from VSIX**, or run:

```bash
code --install-extension ./ghost.vsix
```

## Using Ghost

The Ghost view contains the provider and model strip, conversation sidebar, message log, and composer.

- Press `Enter` to send a message. Press `Shift+Enter` for a new line.
- Use **Context** to choose workspace, folders, active file, selection, open files, or tools.
- Hover or focus the tools and open-files context chips to see their full lists.
- Use **Attach** to add text files to the current request. Attachments are not saved in conversation history.
- Open **Controls** to change the model, workflow, context, appearance, and tool permissions.
- Use `@local` in the VS Code Chat view for the native local participant.
- Use `@workspace` with a keyword to search workspace files and include matching code in the prompt.
- File writes, structured edits, and terminal commands require confirmation unless already approved for the current session.
- Structured edits show a diff before applying. Approved file edits can be restored when the restore action is available.

## Workspace tools

Ghost exposes these tools to the agent:

| Tool | What it does | Approval |
| --- | --- | --- |
| `ghost_read_file` | Reads a text file inside the current workspace. | Safe workspace tool |
| `ghost_write_file` | Creates or replaces a text file. | Required |
| `ghost_apply_edit` | Applies reviewed, line-based edits. | Required |
| `ghost_run_terminal_command` | Runs a shell command in the workspace. | Required |
| `ghost_list_directory` | Lists files and folders under a workspace path. | Safe workspace tool |

The **Context** popup shows the tools currently available to the request. The **Controls** panel and `ghost.toolAllowlist` / `ghost.toolDenylist` settings control which tools Ghost may use.

## Settings

All VS Code settings use the `ghost` prefix. Open **Settings** and search for `Ghost`, or use the **Controls** panel in the Ghost view.

### Provider and model settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.provider` | `ollama` | Select `ollama`, `mlx-vlm`, or `openai-compatible`. |
| `ghost.ollamaUrl` | `http://localhost:11434` | Ollama server URL. |
| `ghost.mlxUrl` | `http://localhost:8000` | MLX/VLM server URL. |
| `ghost.openaiUrl` | `http://localhost:8001/v1` | OpenAI-compatible server URL. |
| `ghost.chatModel` | `qwen2.5-coder:7b` | Model used for chat and agent requests. |
| `ghost.autocompleteModel` | `qwen2.5-coder:1.5b` | Fast model used for inline completion. |
| `ghost.enableInlineCompletions` | `true` | Enable or disable inline code completion. |

### Response settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.maxContextTokens` | `8192` | Maximum context budget sent to the model. |
| `ghost.temperature` | `0.2` | Sampling temperature from `0` to `2`. Lower values are more predictable. |
| `ghost.responseLength` | `balanced` | Choose `short`, `balanced`, `long`, or `unlimited`. |
| `ghost.mode` | `ask` | Choose `ask`, `edit`, `agent`, `explain`, or `inline`. |

### Agent permissions

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.toolAllowlist` | All five tools | Tools Ghost may use in the workspace. |
| `ghost.toolDenylist` | `[]` | Tools Ghost must never use in the workspace. Deny rules override allow rules. |

### Persistence and diagnostics

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.enableConversationPersistence` | `false` | Save conversations and preferences in VS Code storage. |
| `ghost.enableDebugLogging` | `false` | Enable local, telemetry-free debug logging in the extension host. |

The **Controls** panel also includes:

- Automatic context collection
- Workspace-specific settings
- Context token limit, temperature, response length, and workflow mode
- Provider endpoint and model selection
- Composer height and prompt row count
- Assistant name, avatar, and accent color
- Compact conversation layout
- Provider reasoning visibility
- Thinking details and tool progress visibility
- Telemetry-free diagnostics
- Custom system instructions
- Conversation persistence
- Local debug logging

### Persistence and privacy

`ghost.enableConversationPersistence` is off by default. When enabled, Ghost saves conversations and preferences in VS Code storage. State is schema-versioned and common credentials are redacted before storage, export, diagnostics, and display.

Ghost has no telemetry service. Requests are sent only to the provider URL selected in Ghost. If you use a remote OpenAI-compatible or MLX endpoint, the interface marks the connection as external.

## Commands

Run these from the Command Palette:

- `Ghost: Open Interface`
- `Ghost: Focus Interface`
- `Ghost: Check Ollama Connection`
- `Ghost: Check Required Models`
- `Ghost: Toggle Autocomplete`
- `Ghost: Reset Interface`
- `Ghost: Export Interface`
- `Ghost: Clear Interface`

There are no default keyboard shortcuts. Add your own in **Keyboard Shortcuts** if desired. Click the Ghost status bar item to check provider health.

## Troubleshooting

### Provider is offline

Open **Controls**, confirm the provider URL, and use **Test provider connection**. For Ollama, confirm the service is running.

### Model is missing

Refresh models in the Ghost view and select an installed model. For the recommended Ollama setup, run:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
```

### Responses are slow

Lower `ghost.maxContextTokens`, disable automatic context, hide thinking and tool progress details, or enable compact layout. Long histories are loaded in pages.

### A tool is blocked

Check the tool allowlist and denylist in **Controls** or VS Code settings. File edits and terminal commands still need approval.

### OpenAI-compatible endpoint fails

Check the API mode and endpoint suffix. Most OpenAI-compatible servers use `/v1`; Ollama normally uses its base URL without `/v1`.

## Development

```bash
npm install
npm run compile
```

Run `npm test` in a VS Code-capable environment for the extension-host test suite. See [docs/architecture.md](docs/architecture.md) for the extension host, webview, providers, persistence, tools, and approval flow.

## Project structure

```text
src/
├── agent/       Chat participant, context injection, and local tool calls
├── providers/   Inline completion provider
├── services/    Ollama, MLX/VLM, and OpenAI-compatible clients
├── tools/       Workspace files, terminal, edits, and tool registration
├── ui/          VS Code webview host, protocol, state, and status bar
└── webview/     Chat interface and interaction logic
```

## License

MIT. See [LICENSE](LICENSE).

## Links

- [GitHub repository](https://github.com/MickyBalladelli/Ghost)
- [Issues and feature requests](https://github.com/MickyBalladelli/Ghost/issues)
- [Architecture guide](docs/architecture.md)
