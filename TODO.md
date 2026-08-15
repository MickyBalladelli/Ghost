# TODO: Build "GhostPilot AI" VS Code Extension

**Extension Name:** GhostPilot AI (`ghostpilot-ai`)
**Objective:** Create a privacy-first, fully local AI coding assistant for Visual Studio Code that provides inline code completions, a sidebar chat agent, workspace file context, and agentic tool execution (terminal commands & file editing) using Ollama / vLLM.

---

## 📋 Phase 1: Project Setup & Environment

- [x] **1.1 Scaffold Extension Project**
  - [x] Install `yo` and `generator-code` globally (`npm i -g yo generator-code`).
  - [x] Run `yo code` and configure:
    - Type: **New Extension (TypeScript)**
    - Name: `GhostPilot AI`
    - Identifier: `ghostpilot-ai`
    - Description: `Local, offline Copilot & Codex alternative powered by Ollama/vLLM`
    - Package manager: `npm` or `pnpm`
    - do not commit to git
    - for every feature and every time you build a vsix file, update the version in package.json.
  
- [x] **1.2 Install Project Dependencies**
  - [x] Core dependencies:
    ```bash
    npm install node-fetch@2 @types/node-fetch@2
    ```
  - [x] Dev dependencies:
    ```bash
    npm install --save-dev @types/vscode typescript eslint @vscode/test-electron
    ```

- [x] **1.3 Configure `package.json` Manifest**
  - [x] Add extension categories: `["AI", "Programming Languages", "Other"]`.
  - [x] Set minimum VS Code engine target: `"vscode": "^1.125.0"` (required by the language-model tool APIs).
  - [x] Add configuration settings under `contributes.configuration`:
    - [x] `ghostpilot.ollamaUrl` (default: `"http://localhost:11434"`)
    - [x] `ghostpilot.chatModel` (default: `"qwen2.5-coder:7b"`)
    - [x] `ghostpilot.autocompleteModel` (default: `"qwen2.5-coder:1.5b"`)
    - [x] `ghostpilot.maxContextTokens` (default: `8192`)
    - [x] `ghostpilot.enableInlineCompletions` (default: `true`)
  - [x] Register Chat Participant under `contributes.chatParticipants`:
    - [x] ID: `ghostpilot.agent`
    - [x] Name: `local`
    - [x] Description: `Local AI Agent (Ollama)`
    - [x] `isSticky`: `true` (stable Chat Participant API)
  - [x] Register commands under `contributes.commands`:
    - [x] `ghostpilot.checkOllamaStatus` -> "GhostPilot: Check Ollama Connection"
    - [x] `ghostpilot.toggleInline` -> "GhostPilot: Toggle Autocomplete"


### Update to Phase 1.3 (`package.json` Manifest Configuration)

- [x] **1.3.1 Add MLX Backend Settings**
  - [x] Add `ghostpilot.provider` setting (enum: `["ollama", "mlx-vlm", "openai-compatible"]`, default: `"ollama"`).
  - [x] Add `ghostpilot.mlxUrl` setting (default: `"http://localhost:8000"`).

---

### New Section: Phase 2.3 & 2.4 (MLX VLM Backend Integration)

- [x] **2.3 Implement MLX VLM Server Client (`src/services/mlxClient.ts`)**
  - [x] Create API adapter specifically targeting the `mlx_vlm.server` OpenAI-compatible endpoints (`http://localhost:8000/v1`).
  - [x] Implement health check ping to `/v1/models` or root endpoint to verify server active status.
  - [x] Handle MLX vision-language input formatting (support encoding active editor image assets or screenshots if vision context is passed).
  - [x] Implement response streaming transformer to convert MLX server Server-Sent Events (SSE) into standard token chunks.

- [x] **2.4 Dynamic Provider Switching Logic**
  - [x] Update `src/services/llmFactory.ts` to route requests based on `ghostpilot.provider` (dispatching to either `ollamaClient` or `mlxClient`).
  - [x] Add auto-detection fallback: if MLX server is detected on port 8000, automatically suggest switching provider to `mlx-vlm`.
---

## 🔌 Phase 2: Local LLM Infrastructure & API Client

- [x] **2.1 Implement Ollama / OpenAI-Compatible API Wrapper**
  - [x] Create `src/services/ollamaClient.ts`.
  - [x] Implement `checkHealth(baseUrl: string): Promise<boolean>` to test Ollama connectivity.
  - [x] Implement `listModels(baseUrl: string): Promise<string[]>` to fetch available local models.
  - [x] Implement `streamChatCompletion`:
    - [x] Support standard `/v1/chat/completions` or Ollama's native `/api/chat`.
    - [x] Accept system prompt, message history, temperature, and stream flags.
    - [x] Yield chunks as `AsyncGenerator<string>`.
  - [x] Implement `fetchFimCompletion` (Fill-In-the-Middle) for inline code autocompletion.

- [x] **2.2 Settings & Configuration Manager**
  - [x] Create `src/config.ts` to manage reading/updating settings via `vscode.workspace.getConfiguration('ghostpilot')`.
  - [x] Implement event listener for configuration changes (`vscode.workspace.onDidChangeConfiguration`).

---

## ⚡ Phase 3: Copilot-Style Inline Code Completion

- [x] **3.1 Create Inline Completion Provider**
  - [x] Create `src/providers/inlineCompletionProvider.ts`.
  - [x] Implement `vscode.InlineCompletionItemProvider`:
    - [x] Extract prefix text (lines above cursor) and suffix text (lines below cursor).
    - [x] Implement debouncing (e.g., 250ms–400ms delay) to avoid over-querying local GPU.
    - [x] Format prompt using FIM tags (e.g., `<PRE>`, `<SUF>`, `<MID>` for Qwen/StarCoder GGUFs).
    - [x] Call `fetchFimCompletion` using the lightweight fast model (`qwen2.5-coder:1.5b`).
    - [x] Return `vscode.InlineCompletionItem` with the predicted continuation code.

- [x] **3.2 Register Inline Provider in Extension Activation**
  - [x] Register provider for all languages: `vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)`.
  - [x] Add command to enable/disable autocompletion dynamically from status bar.

---

## 💬 Phase 4: Native Chat Agent & Context Injection

- [x] **4.1 Implement Chat Participant Handler**
  - [x] Create `src/agent/chatParticipant.ts`.
  - [x] Implement `vscode.ChatRequestHandler` callback:
    - [x] Parse user's prompt from `request.prompt`.
    - [x] Extract active text editor context (active file name, selected text or full file).
    - [x] Gather workspace context (open tabs, terminal output if applicable).
  - [x] Stream model response directly to VS Code native chat panel via `stream.markdown()`.
  - [x] Support cancellation tokens (`token.isCancellationRequested`).

- [x] **4.2 Context Mentions & Attachments**
  - [x] Support `@workspace` references by searching files matching user keywords.
  - [x] Pass file attachments from `request.references` into model prompt context.

---

## 🛠️ Phase 5: Agentic Tool Calling (Codex/Claude Computer Use Style)

- [x] **5.1 Define Language Model Tools in Manifest**
  - [x] Add `contributes.languageModelTools` in `package.json`:
    - [x] `ghostpilot_read_file`: Reads full content of a file in workspace.
    - [x] `ghostpilot_write_file`: Creates or replaces file content.
    - [x] `ghostpilot_run_terminal_command`: Executes bash/powershell command in workspace terminal.
    - [x] `ghostpilot_list_directory`: Lists workspace file hierarchy.

- [x] **5.2 Implement Tool Execution Services**
  - [x] Create `src/tools/fileTools.ts` for file read/write operations using `vscode.workspace.fs`.
  - [x] Create `src/tools/terminalTools.ts` for running shell commands safely.
  - [x] Register tools using `vscode.lm.registerTool(...)`.

- [x] **5.3 Implement Tool Calling Loop for Local Models**
  - [x] In `src/agent/chatParticipant.ts`, construct system prompt defining JSON function signatures.
  - [x] Parse JSON tool call requests emitted by local model (e.g., `qwen2.5-coder` tool call output).
  - [x] Execute requested tool with user confirmation modal for destructive operations (e.g., running shell commands or modifying files).
  - [x] Feed tool results back into local model and request next stream step.

---

## 🎨 Phase 6: UI & Status Bar Integration

- [x] **6.1 Status Bar Indicator**
  - [x] Create `src/ui/statusBar.ts`.
  - [x] Show status: `$(chip) GhostPilot: Ready` / `$(sync~spin) GhostPilot: Generating...` / `$(error) GhostPilot: Ollama Offline`.
  - [x] Clicking status bar item runs `ghostpilot.checkOllamaStatus` command.

- [x] **6.2 Welcome & Model Downloader Helper**
  - [x] Add diagnostic command to verify if required Ollama models are pulled (`qwen2.5-coder:7b`, `qwen2.5-coder:1.5b`).
  - [x] Provide notification toast with command suggestion: `ollama pull qwen2.5-coder:7b`.

---

## 🧪 Phase 7: Testing & Polishing

- [x] **7.1 Unit & Integration Tests**
  - [x] Write unit tests for Ollama stream parsing (`src/test/suite/ollamaClient.test.ts`).
  - [x] Write tests for FIM prompt builder and debouncer.
  - [x] Test context window truncation logic to prevent model context overflow.

- [x] **7.2 Error Handling & Edge Cases**
  - [x] Gracefully handle Ollama connection timeouts / model crashes.
  - [x] Ensure non-UTF8 binary files are ignored during context extraction.
  - [x] Implement response cancellation handling when user closes chat tab.

---

## 📦 Phase 8: Build, Packaging & Documentation

- [x] **8.1 Documentation**
  - [x] Write detailed `README.md`:
    - Prerequisites (Installing Ollama, pulling recommended models).
    - Features overview (Inline completion, @local agent, tools).
    - Key bindings & configuration reference.
  - [x] Add extension icon (`icon.png`).
  - [x] Create `CHANGELOG.md` and `LICENSE` (MIT).

- [x] **8.2 Packaging**
  - [x] Install `@vscode/vsce` globally or as dev dependency.
  - [x] Run `npm run vscode:prepublish` to verify TypeScript compilation.
  - [x] Package extension into `.vsix` file:
    ```bash
    npx vsce package --out ghostpilot-ai-1.0.0.vsix
    ```
- [x] Test local installation (`code --install-extension ghostpilot-ai-1.0.0.vsix`).

---

## 🖥️ Phase 9: Full Copilot / Codex-Style Interface

**Goal:** Replace the native-only chat experience with a customizable GhostPilot interface inside VS Code. The interface must let the user enter prompts, watch live progress, review model output, approve tool actions, and continue the conversation.

### 9.1 Choose and Register the Interface

- [x] Decide on the primary surface: a persistent `WebviewView` in the GhostPilot Activity Bar, with an optional editor `WebviewPanel` for a larger workspace.
- [x] Add an Activity Bar container and GhostPilot view contribution in `package.json`.
- [x] Add commands to open, focus, reset, export, and clear the GhostPilot interface.
- [x] Add a view icon and product styling that works in light, dark, and high-contrast VS Code themes.
- [x] Create a dedicated webview entry point and keep webview code separate from extension-host code.
- [x] Configure the webview content security policy, nonce handling, local resource roots, and message origin checks.
- [x] Keep the existing native `@local` Chat Participant working while the new interface is introduced.

### 9.2 Build the Chat UI

- [x] Create the main chat layout with header, conversation list, message area, prompt composer, and status footer.
- [x] Add a conversation sidebar with new-chat, rename, delete, and switch-conversation actions.
- [x] Add empty, loading, offline, error, and no-model-installed states.
- [x] Add a prompt text area with multiline input, placeholder text, character/token count, and auto-resizing.
- [x] Submit prompts with a Send button and `Enter`; use `Shift+Enter` for a new line.
- [x] Add Stop/Cancel while a request is running.
- [x] Add retry, edit-and-resend, copy, and regenerate actions to assistant messages.
- [x] Render Markdown safely, including fenced code blocks, tables, links, and inline formatting.
- [x] Add syntax highlighting and a Copy button to every code block.
- [x] Render streamed output incrementally without flicker or scroll jumps.
- [x] Auto-scroll while the user is at the bottom, but preserve the user’s scroll position when they read older output.
- [x] Add accessible labels, keyboard navigation, focus management, and screen-reader-friendly status messages.

### 9.3 Add Prompt Context and Composer Controls

- [x] Add a model selector populated from the configured provider.
- [x] Add provider selection and a connection indicator for Ollama, MLX/VLM, and OpenAI-compatible endpoints.
- [x] Add temperature, max-context, and response-length controls with saved defaults.
- [x] Add a mode selector for Ask, Edit, Agent, Explain, and Inline/Completion workflows.
- [x] Add workspace, folder, file, selection, and active-editor context chips.
- [x] Add file attachment support through a file picker and drag-and-drop.
- [x] Add mention support for `@workspace`, open files, folders, and available tools.
- [x] Add a context preview/remove control so the user can inspect what will be sent.
- [x] Add prompt history navigation with Up/Down and a searchable prompt history panel.
- [x] Add slash commands for common actions such as `/clear`, `/model`, `/explain`, `/fix`, and `/summarize`.
- [x] Add reusable prompt presets and a settings screen for creating, editing, deleting, and selecting presets.
- [x] Make prompt submission explicit and never send text or files without a user action.

### 9.4 Define the Webview Message Contract

- [x] Define typed extension-to-webview and webview-to-extension message unions.
- [x] Add request IDs and conversation IDs to every prompt lifecycle message.
- [x] Support messages for submit, cancel, retry, regenerate, edit, attach, remove-context, select-model, and update-settings.
- [x] Support streamed events for request-started, thinking, text-delta, code-delta, tool-requested, tool-result, warning, error, and request-completed.
- [x] Validate every incoming message at the extension boundary before acting on it.
- [x] Handle stale, duplicated, out-of-order, and late stream events safely.
- [x] Ensure cancellation disposes network, stream, timer, and webview resources.
- [x] Add a protocol version so future UI and extension-host changes can remain compatible.

### 9.5 Implement Conversation and Request State

- [x] Create typed models for conversations, messages, message parts, attachments, tool calls, request status, and model metadata.
- [x] Track request states: idle, preparing, connecting, thinking, streaming, waiting-for-approval, completed, cancelled, and failed.
- [x] Keep user text, assistant text, reasoning/progress, tool activity, and errors as separate message parts.
- [x] Support multiple assistant messages and tool rounds in one user request.
- [x] Prevent duplicate submissions while a request is active unless the user explicitly chooses retry or regenerate.
- [x] Preserve unsent composer text when switching views or conversations.
- [x] Add request timeout, retry, and backoff behavior for recoverable provider failures.
- [x] Keep sensitive prompt and provider data out of logs by default.

### 9.6 Show Thinking and Agent Progress

- [x] Define a local-model-compatible progress protocol for models that do not expose native reasoning tokens.
- [x] Show a compact “GhostPilot is thinking…” state while context is collected and the provider connects.
- [x] Stream visible reasoning only when the provider explicitly returns it and the user enables it.
- [x] Default to showing safe progress summaries instead of raw hidden reasoning.
- [x] Show context collection steps such as reading the active file, searching the workspace, or preparing attachments.
- [x] Show elapsed time, token counts where available, current model, and estimated completion state.
- [x] Add collapsible progress details for each request.
- [x] Clearly separate model answer, tool activity, warnings, and system diagnostics.
- [x] Ensure progress indicators stop on completion, cancellation, disconnect, and error.
- [x] Provide indicators for tokens/sec

### 9.7 Integrate Tools with Approval and Results

- [x] Move tool execution into a request-scoped agent controller that the webview can observe.
- [x] Render each tool call with tool name, arguments, status, duration, and result summary.
- [x] Show a clear approval card before file writes, terminal commands, or other destructive actions.
- [x] Provide Approve once, Always approve for this session, Reject, and Edit arguments actions where safe.
- [x] Allow the user to cancel a tool call and the complete request.
- [x] Add diff preview for proposed file changes before applying them.
- [x] Add terminal output expansion, truncation, copy, and rerun controls.
- [x] Add tool allowlist/denylist settings and per-workspace approval policy.
- [x] Record tool errors as structured message parts and let the model continue when recovery is possible.
- [x] Prevent the model from bypassing approval through malformed JSON, streamed text, or alternate tool names.

### 9.8 Add File Editing and Diff Workflow

- [x] Define a structured edit format for local models that need to modify files.
- [x] Parse edits robustly and reject incomplete, ambiguous, or out-of-workspace paths.
- [x] Show proposed changes in a VS Code diff editor before applying them.
- [x] Support apply, reject, apply selected hunks, and restore actions.
- [x] Detect external file changes between proposal and apply.
- [x] Keep an undo/recovery path for every applied change.
- [x] Link each changed file and code location back to the editor.
- [x] Show a concise change summary in the conversation.

### 9.9 Persist Conversations and User Preferences

- [x] Store conversation metadata and messages using `ExtensionContext.globalState` or a versioned local storage file.
- [x] Store workspace-specific conversations separately from global conversations.
- [x] Persist selected model, provider, mode, prompt presets, composer size, and UI preferences.
- [x] Add schema versioning and migrations for stored data.
- [x] Add conversation import/export as JSON or Markdown.
- [x] Add “delete all history” with confirmation and reliable cleanup.
- [x] Add a setting to disable conversation persistence.
- [x] Avoid persisting attachments or sensitive content unless the user explicitly chooses it.

### 9.10 Customize the Extension

- [x] Add a GhostPilot settings page or webview panel for provider, model, context, permissions, appearance, and history settings.
- [x] Allow custom system instructions with a visible reset-to-default action.
- [x] Allow custom assistant name, avatar, accent color, and compact/full layout preference.
- [x] Allow users to enable or disable thinking details, tool progress, telemetry-free diagnostics, and automatic context collection.
- [x] Allow per-workspace overrides while preserving global defaults.
- [x] Add provider-specific settings without showing irrelevant controls.
- [x] Add model discovery, refresh, and validation actions.
- [x] Add a connection test with readable failure guidance.
- [x] Add import/export for GhostPilot configuration and prompt presets.
- [x] Document which settings affect privacy, performance, context size, and tool permissions.

### 9.11 Reliability, Privacy, and Performance

- [x] Redact secrets, tokens, passwords, and common credential patterns from displayed diagnostics and optional persisted history.
- [x] Make all network requests use configured local or explicitly configured endpoints.
- [x] Add a visible indicator when external network access is enabled.
- [x] Limit message, attachment, tool-result, and rendered-Markdown sizes to keep the UI responsive.
- [x] Virtualize or paginate long conversations.
- [x] Debounce settings and model-list refreshes.
- [x] Handle webview reloads without corrupting an active request or losing recoverable state.
- [x] Handle provider disconnects, malformed SSE, invalid UTF-8, empty responses, and model crashes.
- [x] Add telemetry-free structured debug logging behind an opt-in setting.
- [x] Verify the interface works with keyboard-only use, high contrast, reduced motion, and narrow sidebar widths.

### 9.12 Testing and Documentation for the New Interface

- [ ] Add unit tests for message models, state transitions, message validation, prompt history, storage migrations, and stream event parsing.
- [ ] Add tests for cancellation, retries, duplicate events, malformed tool calls, approval decisions, and provider failures.
- [ ] Add webview tests for prompt submission, multiline input, streaming output, scrolling, attachments, settings, and conversation switching.
- [ ] Add extension-host integration tests for webview messaging and request lifecycle behavior.
- [ ] Manually verify the interface in light, dark, and high-contrast VS Code themes.
- [ ] Manually verify Ask, Edit, Agent, Explain, file attachment, workspace search, tool approval, diff review, cancellation, and retry flows.
- [ ] Update `README.md` with screenshots, interface usage, commands, customization, privacy, and troubleshooting.
- [ ] Add an architecture document describing the webview, extension host, provider clients, agent controller, and tool approval flow.
- [ ] Update `CHANGELOG.md` when the full interface is released.
- [ ] Package and install the extension, then verify the UI in a clean Extension Development Host.
