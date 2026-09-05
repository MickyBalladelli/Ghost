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

Ghost runs chat and agent tools against Ollama, MLX/VLM, another OpenAI-compatible server, or a user-managed OpenCode headless server. Inline completion uses Ollama or a FIM-capable OpenAI-compatible profile; MLX/VLM is chat and vision only. Your code stays on your machine when you use a local provider.

Current release: `1.2.27`

## Highlights

- Local chat through the Ghost view and the native `@local` chat participant.
- Ollama support with automatic API compatibility handling.
- MLX/VLM and generic OpenAI-compatible provider support.
- OpenCode headless-server integration with workspace sessions, streamed progress, model discovery, permissions, cancellation, and diffs.
- Inline code completion with a fast Fill-in-the-Middle model.
- Workspace context from the workspace, folders, active editor, selection, and open files.
- Text-file attachments for focused requests.
- Eleven workspace tools with allowlists, denylists, approval prompts, and visible progress.
- Stable Coding, Balanced, and Creative model profiles with provider capability reporting.
- Source-editor edit previews with Accept/Reject controls, selected-hunk approval, and restore actions for applied edits.
- Ask, Edit, Agent, Plan, and Explain workflow modes, plus separate inline code completion.
- Conversation history popup, prompt history, reusable presets, import/export, retry, regenerate, and cancellation.
- Configurable assistant name, avatar, accent color, layout, context, and response behavior.
- Keyboard-friendly interface with visible focus, screen-reader status updates, high-contrast theme support, reduced motion, and narrow-panel layout support.
- No Ghost telemetry service. Provider requests go only to the configured endpoint.

## Requirements

- VS Code 1.125 or newer
- Node.js 20 or newer and npm when running Ghost from source
- Ollama, MLX/VLM, another OpenAI-compatible local server, or OpenCode 1.x

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
- Choose **Plan** when Ghost should inspect the workspace with read-only tools and produce a structured implementation plan. Use **Implement plan** on the plan card to switch to Agent and continue from those steps.
- Use `@local` in the VS Code Chat view for the native local participant. `@local` uses the same Ghost tool allow/ask/deny lists, auto-accept scope, and session/forever approvals as the Ghost view. File edits and terminal commands confirm in a VS Code modal instead of the Ghost sidebar cards.
- Use `@workspace` with a keyword to search workspace files and include matching code in the prompt.
- File writes, structured edits, and terminal commands require confirmation unless already approved for the current session.
- Structured edits appear directly in the source editor. Use the `Accept Ghost edit` or `Reject Ghost edit` code lens at the top of the file, or use the approval controls in the Ghost view. Accepted edits are saved; rejected edits are restored. Selected hunks can be applied from the Ghost view.

## Workspace tools

Ghost exposes these tools to the agent:

| Tool | What it does | Approval |
| --- | --- | --- |
| `ghost_read_file` | Reads a text file inside the current workspace. | Safe workspace tool |
| `ghost_search_workspace` | Searches workspace text with a query and optional glob. | Safe workspace tool |
| `ghost_get_diagnostics` | Reads VS Code diagnostics for the workspace or one file. | Safe workspace tool |
| `ghost_git_context` | Reads bounded Git status, diff, and recent commit context. | Safe workspace tool |
| `ghost_update_task_plan` | Updates the visible request task plan. | Conversation state |
| `ghost_record_completion` | Records a completed request result. | Conversation state |
| `ghost_write_file` | Creates or replaces a text file. | Required |
| `ghost_apply_edit` | Applies reviewed, line-based edits. | Required |
| `ghost_apply_transaction` | Applies several reviewed edits as one transaction. | Required |
| `ghost_run_terminal_command` | Runs a shell command in the workspace. | Required |
| `ghost_list_directory` | Lists files and folders under a workspace path. | Safe workspace tool |

The **Context** popup shows the tools currently available to the request. The **Settings** panel has clear permission dialogs for tools and terminal environment variables. Each item can be set to **Allow**, **Ask**, or **Deny**. Deny always wins.

Large files are read in chunks. Ghost reports the line range and gives the next `startLine`/`endLine` range when more content is available. Repeated reads reuse the existing result when possible. The edit guard stops repeated and inverse edits that look like an edit loop. Overlapping follow-up edits to the same lines are allowed when the fingerprint is new. Relative and absolute paths for the same workspace file are tracked as one file.

Ghost allows up to 128 tool rounds per request. It asks whether to continue after that limit. A request also stops at 24 files, 4,000 changed lines, 1 MB of changed bytes, 32 terminal commands, or 64,000 model tokens. The counter includes reads, edits, terminal commands, directory listings, and state tools.

The main safety limits are 400 lines or 12,000 characters per file read, 1 MB for a safe file read, 200 search or diagnostic results, 50 edit hunks, 100,000 replacement characters, 10,000 edit-context characters, 120 seconds per terminal command, and 200,000 terminal-output characters. Ghost truncates tool results before they enter model context.

Tool progress is compact by default: Ghost says what it is reading, editing, or executing. Enable **Show verbose tool details** in Settings to show raw arguments, results, timings, and previews.

Tool results use a green check for success and an orange cross for failed or rejected actions. Compact failures include the short error reason.

## Settings

All VS Code settings use the `ghost` prefix. Open **Settings** and search for `Ghost`, or use the **Settings** gear in the Ghost view.

### Provider and model settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.provider` | `ollama` | Select `mlx-vlm`, `ollama`, `openai-compatible`, `opencode`, or `openrouter`. |
| `ghost.ollamaUrl` | `http://localhost:11434` | Ollama server URL. |
| `ghost.mlxUrl` | `http://localhost:8000` | MLX/VLM server URL. |
| `ghost.openaiUrl` | `http://localhost:8001/v1` | OpenAI-compatible server URL. |
| `ghost.openCodeUrl` | `http://127.0.0.1:4096` | User-managed `opencode serve` URL. Ghost does not start or stop it. |
| `ghost.openCodeUsername` | `opencode` | Basic Auth username. Store the server password with **Ghost: Set Provider API Key**. |
| `ghost.openCodeAgent` | empty | Optional OpenCode agent id; empty uses OpenCode's default. |
| `ghost.openCodeSessionReuse` | `workspace` | Reuse one OpenCode session per Ghost conversation or use `new` for every request. |
| `ghost.openaiApiKeyHeader` / `ghost.openaiApiKeyPrefix` | `Authorization` / `Bearer` | Select the API-key header format; the key stays in VS Code SecretStorage. |
| `ghost.openaiOrganization` / `ghost.openaiProject` | empty | Optional organization and project values, sent with their configurable headers. |
| `ghost.openaiProxy` / `ghost.openaiNoProxy` | empty / localhost list | Route OpenAI-compatible traffic through a proxy with host bypass rules. Proxy URLs must not contain credentials. |
| `ghost.openaiTlsRejectUnauthorized` | `true` | Verify HTTPS certificates. CA, client certificate, and key files can be configured separately. |
| `ghost.openrouterUrl` | `https://openrouter.ai/api/v1` | OpenRouter API base URL. |
| `ghost.openrouterReferer` / `ghost.openrouterTitle` | empty / `Ghost Coding Assistant` | Optional OpenRouter attribution headers. |
| `ghost.openrouterAllowFallbacks` | `true` | Let OpenRouter try another provider for the selected model when needed. |
| `ghost.openrouterRequireParameters` | `false` | Route only to providers that support all request parameters Ghost sends. |
| `ghost.openrouterDataCollection` | `allow` | OpenRouter provider data-collection preference: `allow` or `deny`. |
| `ghost.openrouterProviderOrder` | `[]` | Optional ordered provider slugs, such as `anthropic, openai`. |
| `ghost.openrouterProxy` / `ghost.openrouterNoProxy` | empty / localhost list | Route OpenRouter traffic through a proxy with host bypass rules. Proxy URLs must not contain credentials. |
| `ghost.openrouterTlsRejectUnauthorized` | `true` | Verify OpenRouter HTTPS certificates. CA and client certificate files can be configured separately. |
| `ghost.chatModel` | `qwen2.5-coder:7b` | Model used for chat and agent requests. |
| `ghost.autocompleteModel` | `qwen2.5-coder:1.5b` | Fast model used for inline completion. |
| `ghost.enableInlineCompletions` | `true` | Enable or disable inline code completion. |

### Stable coding profile

Set `ghost.modelProfile` to `coding`, `balanced`, or `creative`. A profile overrides the matching generation settings for the request. Leave it empty to use the individual settings below. Profiles can be selected independently for chat, agent, vision, and autocomplete models.

| Profile | Temperature | Top P | Top K | Min P | Repeat penalty | Context | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `coding` | `0.2` | `0.9` | `20` | `0.05` | `1.1` | `16,384` | `2,048` |
| `balanced` | `0.3` | `0.9` | `20` | `0.05` | `1.05` | `8,192` | `1,024` |
| `creative` | `0.8` | `0.95` | `40` | `0.02` | `1.02` | `8,192` | `2,048` |

### Provider capability matrix

Ghost adapts requests to the selected provider. Streaming is supported by all built-in adapters. FIM is available only when the configured client exposes a FIM endpoint.

| Provider | Tools | JSON mode | Vision | FIM | Sampling controls |
| --- | --- | --- | --- | --- | --- |
| Ollama | Yes | Yes | Yes | Client-dependent | Temperature, Top P, Top K, Min P, presence penalty, repeat penalty |
| MLX/VLM | No | No | Yes | No | Temperature, Top P, presence penalty |
| OpenAI-compatible | Yes | Yes | No | Client-dependent | Temperature, Top P, presence penalty |
| OpenRouter | Model-dependent | Model-dependent | Model-dependent | No | Model-dependent; metadata comes from the OpenRouter catalog |
| OpenCode | OpenCode-owned | OpenCode-owned | No | No | OpenCode model configuration |

OpenAI-compatible servers can still chat when they do not implement native tools. MLX/VLM is the built-in vision path and has no native tool calling, so Agent and Plan modes are unreliable there; keep Ask mode or switch to Ollama / OpenAI-compatible when you need workspace tools. Unsupported sampling fields are not sent as native provider controls; server-specific behavior can differ.

### OpenRouter setup

Choose **OpenRouter** in the provider selector, enter an OpenRouter API key with **Ghost: Set Provider API Key**, then refresh models. Ghost keeps the key in VS Code SecretStorage. OpenRouter model ids are preserved exactly, including provider slugs, `:free` variants, and presets.

OpenRouter uses its OpenAI-compatible streaming API. Ghost reads the model catalog to show context limits, output limits, vision/tool support, and input/output prices. Pricing is shown per million tokens. OpenRouter requests are remote: workspace context, prompts, attachments, and tool schemas leave the local machine. Use the routing controls to choose fallback behavior, provider order, parameter requirements, and data collection preferences.

Ghost sends `HTTP-Referer` and `X-OpenRouter-Title` only when configured. See the [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [models API](https://openrouter.ai/docs/guides/overview/models), and [provider routing guide](https://openrouter.ai/docs/guides/routing/provider-selection).

### OpenCode setup

Start OpenCode yourself in the workspace or point Ghost at an existing server:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

Set `ghost.provider` to `opencode`. Ghost checks `/global/health`, requires a compatible OpenCode 1.x server, discovers `provider/model` ids, routes every request to the selected workspace root, and stores only the selected session id in VS Code workspace storage. Use **Ghost: New OpenCode Session**, **Ghost: Select OpenCode Session**, or **Ghost: Delete Current OpenCode Session** to manage it.

OpenCode allows most tools by default. Before each delegated request, Ghost creates these safe global defaults at `~/.config/opencode/opencode.json` when the file is missing and verifies the effective permissions:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "external_directory": "deny"
  }
}
```

Ghost does not update OpenCode through `PATCH /config`, because OpenCode can save that API update as a project-local `opencode.json`. If the server was already running when Ghost created the global file, restart `opencode serve` so it loads the global permissions.

Ghost answers OpenCode permission requests with one-request approvals only, applies its allow/ask/deny lists, rejects external-workspace paths, aborts the OpenCode session when Stop is pressed, and checks the final session diff. Ask, Plan, and Explain modes reject edit and shell permissions. Plan buffers OpenCode's final response and converts its structured plan marker into the normal Ghost plan card. OpenCode performs its own edits, so Ghost's source-editor staged hunk preview is not used on this provider. Configure `OPENCODE_SERVER_PASSWORD` on the server and store the same password in VS Code SecretStorage when authentication is needed. Ghost refuses to send that password over non-loopback HTTP; use HTTPS for a remote server. Inline completion remains on Ollama or a FIM-capable OpenAI-compatible provider.

### Response settings

For parameter names, provider differences, and tuning examples, see [OLLAMA_PARAMETERS.md](OLLAMA_PARAMETERS.md).

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
| `ghost.mode` | `agent` | Choose `ask`, `edit`, `agent`, `plan`, or `explain`. Plan inspects with read-only tools and records implementation steps. Agent implements approved workspace changes; file writes still need approval. |

### Agent permissions

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.toolAllowlist` | All tools | Tools Ghost may use automatically. Tools not listed ask for approval. |
| `ghost.toolAsklist` | `[]` | Tools Ghost must ask about before use. |
| `ghost.toolDenylist` | `[]` | Tools Ghost must never use. Deny rules override allow and ask rules, including Copilot and other clients that invoke Ghost's registered Language Model tools. |
| `ghost.terminalEnvironmentAllowlist` | Safe common variables | Environment variables passed to approved terminal commands without asking. |
| `ghost.terminalEnvironmentAsklist` | `[]` | Environment variables passed only after terminal approval. |
| `ghost.fileEditApproval` | `confirm` | Legacy mirror of `ghost.autoAcceptScope`. Prefer the scope setting. `auto` means request-scoped auto-accept, not always. |

File-edit auto-accept scopes are `confirm`, `one-edit`, `current-file`, `request`, `session`, `workspace`, and `always`. `one-edit` accepts one edit; `current-file` stays on the first file; `request` lasts for the current request; `session` lasts for the Ghost session; `workspace` applies to this workspace; `always` applies file edits without asking. Terminal and other dangerous tools still require their own approval. Deny rules always win. Language Model tools honor the same allow/ask/deny lists; `request`, `workspace`, and `always` can skip their confirmation prompts. `session`, `one-edit`, and `current-file` still ask outside the Ghost view because those scopes are Ghost-session state.

### Persistence and diagnostics

| Setting | Default | Purpose |
| --- | --- | --- |
| `ghost.enableConversationPersistence` | `true` | Save conversations and preferences in VS Code storage. |
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

`ghost.enableConversationPersistence` is on by default. When enabled, Ghost saves conversations and preferences in VS Code storage, not in the project files. Global state stores prompt history, presets, display preferences, and provider UI preferences. Workspace state stores conversations and the active conversation. State is schema-versioned, bounded, compacted, and migrated; unchanged autosave writes are skipped. Common credentials and secrets are redacted before storage, export, diagnostics, display, and clipboard copies.

Ghost has no telemetry service. Requests are sent only to the provider URL selected in Ghost. If you use a remote OpenAI-compatible or MLX endpoint, the interface marks the connection as external.

## FAQ

### Which model should I install?

For local Ollama, install `qwen2.5-coder:7b` for chat and agent work and `qwen2.5-coder:1.5b` for inline completion:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:1.5b
```

Choose the `coding` profile for predictable edits, `balanced` for the normal defaults, or `creative` for varied explanations. See [OLLAMA_PARAMETERS.md](OLLAMA_PARAMETERS.md) for generation tuning.

### What URL should I use?

Use the server base URL for Ollama, normally `http://localhost:11434`. Use the MLX/VLM server URL, normally `http://localhost:8000`. OpenAI-compatible servers usually use a URL ending in `/v1`, such as `http://localhost:8001/v1`; do not add `/v1` twice. The selected compatibility profile may choose a different path for Anthropic, Gemini, Azure OpenAI, or a custom server.

### Can I send images?

Yes, attach an image when the selected provider reports vision support. The built-in MLX/VLM provider is the vision path. Ghost accepts up to 8 attachments, with images limited to 700 KB each. Images are sent with the request and are not saved in conversation history. Providers without vision support reject or omit image context; switch provider or remove the image.

### What does auto-accept do?

Auto-accept controls file edits only. `one-edit`, `current-file`, `request`, `session`, `workspace`, and `always` widen the approval scope; `confirm` asks every time. Terminal commands and other dangerous tools still need approval. Deny rules override allow and ask rules. Use the emergency stop or change the scope back to `confirm` if Ghost starts making unwanted edits.

### What should I do when a tool fails?

Read the error detail. Ghost keeps going after a failed read, search, or directory listing so the model can list the tree and try another path. A denied or blocked mutation, a cancelled tool, or a failed file edit still stops the request. For a missing file, list the workspace and use the real path. For a failed edit, read the current file again and send smaller, non-overlapping hunks. For a blocked command, check tool permissions and terminal environment permissions. Rejected or failed changes are not silently treated as successful.

### Why did Ghost say the context is full?

Lower `ghost.maxContextTokens`, choose less automatic context, remove unused attachments, or start a new conversation. Ghost compacts older results and keeps the current request, files, diffs, and errors when possible. Large files, tool output, and long history still consume the model context; the provider may also have a smaller native limit.

### Where does Ghost use disk space?

With persistence off, conversations stay in memory. With persistence on, Ghost stores bounded conversations, prompt history, presets, and preferences in VS Code storage, not in project files. Reset or clear the interface to remove Ghost state. Provider model files are managed separately by Ollama, MLX, or the remote server; removing Ghost history does not remove downloaded models. Attachments are request data and are not retained in history.

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
- `Ghost: New OpenCode Session`
- `Ghost: Select OpenCode Session`
- `Ghost: Rename Current OpenCode Session`
- `Ghost: Fork Current OpenCode Session`
- `Ghost: Delete Current OpenCode Session`
- `Ghost: Select OpenCode Agent`

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

### OpenCode request is rejected before it starts

Check that `opencode serve` is reachable, uses a compatible 1.x version, and sees the selected workspace. OpenCode is permissive by default, so its effective `permission.edit` and `permission.bash` rules must be `ask` or `deny`, and `permission.external_directory` must be `ask` or `deny`. Save dirty editor files before Agent or Edit mode. When Basic Auth is enabled, run **Ghost: Set Provider API Key** and enter the OpenCode server password.

### A file edit fails

Read the file again before retrying. Make sure the path is inside the open workspace and that unsaved editor changes are accounted for. An edit can fail when its old text, expected content, hash, line range, or context is stale; when hunks overlap or are malformed; when it is a no-op; or when the edit-loop guard sees a repeated or inverse change. Retry with a fresh read and smaller hunks. For a staged edit, use **Open Diff**, then **Accept Ghost edit**, **Reject Ghost edit**, or **Restore**. A failed transaction rolls back its changes; inspect the first reported conflict before retrying. If the tool is blocked, check the allowlist, asklist, denylist, and approval scope.

## License

MIT. See [LICENSE](LICENSE).

## Links

- [Issues and feature requests](https://github.com/MickyBalladelli/Ghost/issues)
- [Architecture guide](docs/architecture.md)
- [Provider adapter guide](docs/provider-adapter.md)
- [Tool protocol guide](docs/tool-protocol.md)
- [Release guide](docs/release.md)
- [Configuration reference](docs/configuration.md)
