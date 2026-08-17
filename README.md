<p align="center">
  <img src="icon.png" alt="Ghost icon" width="96">
</p>

<h1 align="center">Ghost</h1>

<p align="center">AI coding assistant for VS Code.</p>

<p align="center">
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
- Source-editor edit previews with Accept/Reject controls, selected-hunk approval, and restore actions for applied edits.
- Ask, Edit, Agent, Explain, and Inline workflow modes.
- Conversation history popup, prompt history, reusable presets, import/export, retry, regenerate, and cancellation.
- Configurable assistant name, avatar, accent color, layout, context, and response behavior.
- Keyboard-friendly interface with visible focus, screen-reader status updates, high-contrast theme support, reduced motion, and narrow-panel layout support.
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

The Ghost view contains the provider and model strip, message log, composer, and top-bar conversation history.

- Press `Enter` to send a message. Press `Shift+Enter` for a new line.
- Use **Context** to choose workspace, folders, active file, selection, open files, or tools. The popup also shows the available tool and open-file details.
- Use **Attach** to add text files to the current request. Attachments are not saved in conversation history.
- Use the **History** button at the top to search, select, rename, or delete previous conversations.
- Use the **Settings** gear to change the model, workflow, context, appearance, persistence, and tool permissions.
- Choose **Agent — implement changes** when Ghost should inspect files and modify the workspace. Ghost stages proposed file changes in the real source editor and asks for approval before saving file edits or running terminal commands.
- Use `@local` in the VS Code Chat view for the native local participant.
- Use `@workspace` with a keyword to search workspace files and include matching code in the prompt.
- File writes, structured edits, and terminal commands require confirmation unless already approved for the current session.
- Structured edits appear directly in the source editor. Use the `Accept Ghost edit` or `Reject Ghost edit` code lens at the top of the file, or use the approval controls in the Ghost view. Accepted edits are saved; rejected edits are restored. Selected hunks can be applied from the Ghost view.

## Workspace tools

Ghost exposes these tools to the agent:

| Tool | What it does | Approval |
| --- | --- | --- |
| `ghost_read_file` | Reads a text file inside the current workspace. | Safe workspace tool |
| `ghost_write_file` | Creates or replaces a text file. | Required |
| `ghost_apply_edit` | Applies reviewed, line-based edits. | Required |
| `ghost_run_terminal_command` | Runs a shell command in the workspace. | Required |
| `ghost_list_directory` | Lists files and folders under a workspace path. | Safe workspace tool |

The **Context** popup shows the tools currently available to the request. The **Settings** panel and `ghost.toolAllowlist` / `ghost.toolDenylist` settings control which tools Ghost may use.

Large files are read in chunks. Ghost reports the line range and gives the next `startLine`/`endLine` range when more content is available. Ghost also stops repeated edits to the same file and stops after eight successful edits to one file to prevent edit loops.

Ghost allows up to 128 tool calls per batch. It asks whether to continue after that limit. The counter includes reads, edits, terminal commands, and directory listings.

Tool progress is compact by default: Ghost says what it is reading, editing, or executing. Enable **Show verbose tool details** in Settings to show raw arguments, results, timings, and previews.

## Settings

All VS Code settings use the `ghost` prefix. Open **Settings** and search for `Ghost`, or use the **Settings** gear in the Ghost view.

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
| `ghost.temperature` | `0.3` | Sampling temperature from `0` to `2`. Lower values are more predictable; higher values are more varied. |
| `ghost.topP` | `0.9` | Nucleus sampling from `0` to `1`. Keeps the smallest likely-token group reaching this probability. |
| `ghost.topK` | `20` | Limits each next token to the K most likely choices. `0` disables the limit. |
| `ghost.minP` | `0.05` | Removes tokens below this fraction of the most likely token. `0` disables the filter. |
| `ghost.presencePenalty` | `0.0` | Penalizes tokens already used. Positive values encourage new topics; negative values allow reuse. |
| `ghost.repeatPenalty` | `1.05` | Ollama repeat penalty. `1` disables it; values above `1` penalize repeated text more. |
| `ghost.responseLength` | `balanced` | Choose `short`, `balanced`, `long`, or `unlimited`. |
| `ghost.mode` | `agent` | Choose `ask`, `edit`, `agent`, `explain`, or `inline`. Agent implements approved code changes. |

### Agent permissions

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.toolAllowlist` | All five tools | Tools Ghost may use in the workspace. |
| `ghost.toolDenylist` | `[]` | Tools Ghost must never use in the workspace. Deny rules override allow rules. |
| `ghost.fileEditApproval` | `confirm` | Ask before each file edit, or use `auto` to apply file edits automatically. |

### Persistence and diagnostics

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.enableConversationPersistence` | `false` | Save conversations and preferences in VS Code storage. |
| `ghost.enableDebugLogging` | `false` | Enable local, telemetry-free debug logging in the extension host. |

The **Settings** panel also includes:

- Automatic context collection
- Workspace-specific settings
- Context token limit, temperature, response length, and workflow mode
- Temperature, Top P, Top K, Min P, presence penalty, and repeat penalty controls with tooltips
- Provider endpoint and model selection
- Composer height and prompt row count
- Assistant name, avatar, and accent color
- Compact conversation layout
- Provider reasoning visibility
- Thinking details and compact or verbose tool progress
- Telemetry-free diagnostics
- Custom system instructions
- Conversation persistence
- Local debug logging

Generation settings are sent with each request. Native Ollama supports all six sampling controls. MLX/VLM and OpenAI-compatible endpoints receive the standard `temperature`, `top_p`, and `presence_penalty` fields; their servers may ignore the Ollama-specific `topK`, `minP`, and `repeatPenalty` controls.

The panel also manages prompt presets. Saving a preset closes the panel. When conversation persistence is enabled, presets are stored in VS Code extension storage rather than in the project. The **Use workspace-specific settings** option controls where Ghost configuration is written: enabled writes to the current workspace settings, while disabled writes to global VS Code user settings.

### Persistence and privacy

`ghost.enableConversationPersistence` is off by default. When enabled, Ghost saves conversations and preferences in VS Code storage. State is schema-versioned and common credentials are redacted before storage, export, diagnostics, and display.

Ghost has no telemetry service. Requests are sent only to the provider URL selected in Ghost. If you use a remote OpenAI-compatible or MLX endpoint, the interface marks the connection as external.

## Commands

Run these from the Command Palette:

- `Ghost: Open Interface`
- `Ghost: Focus Interface`
- `Ghost: Check Provider Connection`
- `Ghost: Check Required Models`
- `Ghost: Toggle Autocomplete`
- `Ghost: Reset Interface` — delete all Ghost conversations and preferences after confirmation
- `Ghost: Export Interface`
- `Ghost: Clear Interface`

There are no default keyboard shortcuts. Add your own in **Keyboard Shortcuts** if desired. Click the Ghost status bar item to check provider health.

## Troubleshooting

### Provider is offline

Open the **Settings** gear, confirm the provider URL, and use **Test provider connection**. For Ollama, confirm the service is running.

### Model is missing

Refresh models in the Ghost view and select an installed model. For the recommended Ollama setup, run:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
```

### Responses are slow

Lower `ghost.maxContextTokens`, disable automatic context, hide thinking details, choose compact tool progress, or enable compact layout. Long histories are loaded in pages.

### A tool is blocked

Check the tool allowlist and denylist in **Settings** or VS Code settings. File edits and terminal commands still need approval.

### OpenAI-compatible endpoint fails

Check the API mode and endpoint suffix. Most OpenAI-compatible servers use `/v1`; Ollama normally uses its base URL without `/v1`.

## Development

```bash
npm install
npm run compile
```

Create and install a local VSIX with:

```bash
./create-vsix.sh
```

The script increments the patch version, compiles Ghost, creates `ghost-${version}.vsix`, and installs it in VS Code. Publish an already-created matching VSIX with:

```bash
./publish.sh
```

`publish.sh` reads the version from `package.json`, requires `ghost-${version}.vsix`, and publishes that exact package through `vsce`.

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

- [Issues and feature requests](https://github.com/MickyBalladelli/Ghost/issues)
- [Architecture guide](docs/architecture.md)
