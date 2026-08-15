# TODO: Build "GhostPilot AI" VS Code Extension

**Extension Name:** LocalPilot AI (`localpilot-ai`)  
**Objective:** Create a privacy-first, fully local AI coding assistant for Visual Studio Code that provides inline code completions, a sidebar chat agent, workspace file context, and agentic tool execution (terminal commands & file editing) using Ollama / vLLM.

---

## 📋 Phase 1: Project Setup & Environment

- [x] **1.1 Scaffold Extension Project**
  - [ ] Install `yo` and `generator-code` globally (`npm i -g yo generator-code`).
  - [x] Run `yo code` and configure:
    - Type: **New Extension (TypeScript)**
    - Name: `LocalPilot AI`
    - Identifier: `localpilot-ai`
    - Description: `Local, offline Copilot & Codex alternative powered by Ollama/vLLM`
    - Enable Git: `Yes`
    - Package manager: `npm` or `pnpm`
  - [x] Initialize Git repository and commit baseline files.

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
  - [x] Set minimum VS Code engine target: `"vscode": "^1.90.0"`.
  - [x] Add configuration settings under `contributes.configuration`:
    - [x] `localpilot.ollamaUrl` (default: `"http://localhost:11434"`)
    - [x] `localpilot.chatModel` (default: `"qwen2.5-coder:7b"`)
    - [x] `localpilot.autocompleteModel` (default: `"qwen2.5-coder:1.5b"`)
    - [x] `localpilot.maxContextTokens` (default: `8192`)
    - [x] `localpilot.enableInlineCompletions` (default: `true`)
  - [x] Register Chat Participant under `contributes.chatParticipants`:
    - [x] ID: `localpilot.agent`
    - [x] Name: `local`
    - [x] Description: `Local AI Agent (Ollama)`
    - [x] `isDefault`: `true`
  - [x] Register commands under `contributes.commands`:
    - [x] `localpilot.checkOllamaStatus` -> "LocalPilot: Check Ollama Connection"
    - [x] `localpilot.toggleInline` -> "LocalPilot: Toggle Autocomplete"


### Update to Phase 1.3 (`package.json` Manifest Configuration)

- [x] **1.3.1 Add MLX Backend Settings**
  - [x] Add `localpilot.provider` setting (enum: `["ollama", "mlx-vlm", "openai-compatible"]`, default: `"ollama"`).
  - [x] Add `localpilot.mlxUrl` setting (default: `"http://localhost:8000"`).

---

### New Section: Phase 2.3 & 2.4 (MLX VLM Backend Integration)

- [x] **2.3 Implement MLX VLM Server Client (`src/services/mlxClient.ts`)**
  - [x] Create API adapter specifically targeting the `mlx_vlm.server` OpenAI-compatible endpoints (`http://localhost:8000/v1`).
  - [x] Implement health check ping to `/v1/models` or root endpoint to verify server active status.
  - [x] Handle MLX vision-language input formatting (support encoding active editor image assets or screenshots if vision context is passed).
  - [x] Implement response streaming transformer to convert MLX server Server-Sent Events (SSE) into standard token chunks.

- [x] **2.4 Dynamic Provider Switching Logic**
  - [x] Update `src/services/llmFactory.ts` to route requests based on `localpilot.provider` (dispatching to either `ollamaClient` or `mlxClient`).
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

- [ ] **2.2 Settings & Configuration Manager**
  - [ ] Create `src/config.ts` to manage reading/updating settings via `vscode.workspace.getConfiguration('localpilot')`.
  - [ ] Implement event listener for configuration changes (`vscode.workspace.onDidChangeConfiguration`).

---

## ⚡ Phase 3: Copilot-Style Inline Code Completion

- [ ] **3.1 Create Inline Completion Provider**
  - [ ] Create `src/providers/inlineCompletionProvider.ts`.
  - [ ] Implement `vscode.InlineCompletionItemProvider`:
    - Extract prefix text (lines above cursor) and suffix text (lines below cursor).
    - Implement debouncing (e.g., 250ms–400ms delay) to avoid over-querying local GPU.
    - Format prompt using FIM tags (e.g., `<PRE>`, `<SUF>`, `<MID>` for Qwen/StarCoder GGUFs).
    - Call `fetchFimCompletion` using the lightweight fast model (`qwen2.5-coder:1.5b`).
    - Return `vscode.InlineCompletionItem` with the predicted continuation code.

- [ ] **3.2 Register Inline Provider in Extension Activation**
  - [ ] Register provider for all languages: `vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)`.
  - [ ] Add command to enable/disable autocompletion dynamically from status bar.

---

## 💬 Phase 4: Native Chat Agent & Context Injection

- [ ] **4.1 Implement Chat Participant Handler**
  - [ ] Create `src/agent/chatParticipant.ts`.
  - [ ] Implement `vscode.ChatRequestHandler` callback:
    - Parse user's prompt from `request.prompt`.
    - Extract active text editor context (active file name, selected text or full file).
    - Gather workspace context (open tabs, terminal output if applicable).
  - [ ] Stream model response directly to VS Code native chat panel via `stream.markdown()`.
  - [ ] Support cancellation tokens (`token.isCancellationRequested`).

- [ ] **4.2 Context Mentions & Attachments**
  - [ ] Support `@workspace` references by searching files matching user keywords.
  - [ ] Pass file attachments from `request.references` into model prompt context.

---

## 🛠️ Phase 5: Agentic Tool Calling (Codex/Claude Computer Use Style)

- [ ] **5.1 Define Language Model Tools in Manifest**
  - [ ] Add `contributes.languageModelTools` in `package.json`:
    - `localpilot_read_file`: Reads full content of a file in workspace.
    - `localpilot_write_file`: Creates or replaces file content.
    - `localpilot_run_terminal_command`: Executes bash/powershell command in workspace terminal.
    - `localpilot_list_directory`: Lists workspace file hierarchy.

- [ ] **5.2 Implement Tool Execution Services**
  - [ ] Create `src/tools/fileTools.ts` for file read/write operations using `vscode.workspace.fs`.
  - [ ] Create `src/tools/terminalTools.ts` for running shell commands safely.
  - [ ] Register tools using `vscode.lm.registerTool(...)`.

- [ ] **5.3 Implement Tool Calling Loop for Local Models**
  - [ ] In `src/agent/chatParticipant.ts`, construct system prompt defining JSON function signatures.
  - [ ] Parse JSON tool call requests emitted by local model (e.g., `qwen2.5-coder` tool call output).
  - [ ] Execute requested tool with user confirmation modal for destructive operations (e.g., running shell commands or modifying files).
  - [ ] Feed tool results back into local model and request next stream step.

---

## 🎨 Phase 6: UI & Status Bar Integration

- [ ] **6.1 Status Bar Indicator**
  - [ ] Create `src/ui/statusBar.ts`.
  - [ ] Show status: `$(chip) LocalPilot: Ready` / `$(sync~spin) LocalPilot: Generating...` / `$(error) LocalPilot: Ollama Offline`.
  - [ ] Clicking status bar item runs `localpilot.checkOllamaStatus` command.

- [ ] **6.2 Welcome & Model Downloader Helper**
  - [ ] Add diagnostic command to verify if required Ollama models are pulled (`qwen2.5-coder:7b`, `qwen2.5-coder:1.5b`).
  - [ ] Provide notification toast with command suggestion: `ollama pull qwen2.5-coder:7b`.

---

## 🧪 Phase 7: Testing & Polishing

- [ ] **7.1 Unit & Integration Tests**
  - [ ] Write unit tests for Ollama stream parsing (`src/test/suite/ollamaClient.test.ts`).
  - [ ] Write tests for FIM prompt builder and debouncer.
  - [ ] Test context window truncation logic to prevent model context overflow.

- [ ] **7.2 Error Handling & Edge Cases**
  - [ ] Gracefully handle Ollama connection timeouts / model crashes.
  - [ ] Ensure non-UTF8 binary files are ignored during context extraction.
  - [ ] Implement response cancellation handling when user closes chat tab.

---

## 📦 Phase 8: Build, Packaging & Documentation

- [ ] **8.1 Documentation**
  - [ ] Write detailed `README.md`:
    - Prerequisites (Installing Ollama, pulling recommended models).
    - Features overview (Inline completion, @local agent, tools).
    - Key bindings & configuration reference.
  - [ ] Add extension icon (`icon.png`).
  - [ ] Create `CHANGELOG.md` and `LICENSE` (MIT).

- [ ] **8.2 Packaging**
  - [ ] Install `@vscode/vsce` globally or as dev dependency.
  - [ ] Run `npm run vscode:prepublish` to verify TypeScript compilation.
  - [ ] Package extension into `.vsix` file:
    ```bash
    npx vsce package --out localpilot-ai-1.0.0.vsix
    ```
  - [ ] Test local installation (`code --install-extension localpilot-ai-1.0.0.vsix`).
