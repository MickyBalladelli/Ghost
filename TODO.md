# Ghost TODO

Prioritized follow-up from a full-project review of Ghost `1.1.96`. Historical Phase 1–9 work lives in [`archives/TODO1-historical.md`](archives/TODO1-historical.md) and is complete.

Use this list as the active backlog. Check items off as they land, and keep `CHANGELOG.md`, `README.md`, and `package.json` on the same version.

---

## P0 — Bugs that change user-visible behavior

These are concrete defects. Fix them before adding features.

- [x] **`one-edit` auto-accept never expires.** `shouldAutoAcceptFileEdit()` now consumes the first accepted mutation, then asks again and reverts the stored scope to `confirm`. Stored `session` is in-memory Ghost-session state: leftover `session` values from a previous window are treated as `confirm` until the user selects Session again. Unit tests live in `src/test/suite/ghostApprovalPolicy.test.ts`.

- [x] **`current-file` auto-accept compares raw path strings.** `current-file` now stores a canonical workspace path from `resolveWorkspacePath()` and matches relative, `./`, and absolute forms of the same file. Tests cover this in `src/test/suite/ghostApprovalPolicy.test.ts`.

- [x] **Legacy `fileEditApproval: auto` migrates to `always`.** Leftover `fileEditApproval: auto` with `autoAcceptScope: confirm` now migrates to `request`. Runtime settings no longer promote that pair to `always`. `fileEditApproval` is only a confirm/auto mirror of `autoAcceptScope`. An explicit `always` scope is left unchanged.

- [x] **`@local` chat bypasses Ghost approval policy.** `createChatParticipant()` now passes `GhostViewProvider.approveChatTool()`. Native Chat uses the same allow/ask/deny lists, auto-accept scopes, and session/workspace/forever memory as the Ghost view. Interactive approvals use a VS Code modal (Approve now / session / forever) instead of sidebar cards and editor staging.

- [x] **Registered Language Model tools ignore Ghost denylist/allowlist.** `prepareInvocation` and `invoke` on registered LM tools now use `resolveLanguageModelToolPermission()`. Deny blocks the tool before it runs. Allow/ask lists control VS Code confirmation. Persisted `request` / `workspace` / `always` auto-accept can skip file-edit confirmation; `session` / `one-edit` / `current-file` still ask outside the Ghost view.

- [x] **A failed inspection tool aborts the whole request.** Inspection failures (`ghost_read_file`, search, list, diagnostics, git context) no longer stop the agent. Path-recovery hints use `GHOST_RETRY_POLICIES.failedTool` (two retries), then Ghost continues so the model can list the tree or try another path. The request still stops on denied/blocked tools, cancellation, user rejection, or a failed file mutation.

- [x] **Overlapping-edit guard blocks legitimate follow-up edits.** `getEditLoopReason()` still stops repeated fingerprints and inverse hunks. Overlapping ranges with a new fingerprint are allowed, so a refinement of line 12 after editing lines 10–20 can proceed. Hunks inside a single `ghost_apply_edit` must still be sorted and non-overlapping.

- [x] **Edit-loop state is keyed by the model’s raw path.** `getCanonicalEditPaths()` now stores loop, signature, stale-recovery, and budget file keys from `resolveWorkspacePath()`. Relative, `./`, and absolute forms of the same file share one history.

- [x] **Inline completion ignores the MLX provider.** `shouldFetchInlineFim()` now returns empty completions when the autocomplete provider is `mlx-vlm` (or an OpenAI-compatible profile without FIM). Ghost no longer sends those FIM requests to `ghost.ollamaUrl`.

- [x] **`create-vsix.sh` is the source of version drift.** The local install helper no longer runs `npm version patch`. `npm version` syncs the README and `docs/release.md` markers; `npm run package` runs `release:check`. README, changelog, and the release guide now match `package.json` `1.1.96`.

- [x] **Release docs claim CI that does not exist.** `docs/release.md`, `docs/dependency-policy.md`, and `PUBLISH.md` now describe local release gates only. They no longer claim `.github/workflows/ci.yml`, a host-test matrix, or Dependabot.

---

## P1 — Ability to execute (agent actually finishes workspace work)

Ghost already has strong edit safety (workspace jail, hunk context, rebase, atomic writes, approval). The remaining execution problems are mostly “the loop gives up” and “the model is asked to do too much with too little context.”

- [x] **Shrink the default system prompt.** `SYSTEM_PROMPT` in `src/agent/chatParticipant.ts` concatenates the full tool catalog, JSON-escaping rules, path rules, diagnostics, git, task-plan, and completion-record instructions on every request. Local 7B models spend a large fraction of an 8k window on instructions. Split into a short always-on prompt plus tool schemas only when native tools are off; keep per-tool details in `GHOST_NATIVE_TOOL_DEFINITIONS`.

- [x] **Stop reserving 4096 output tokens from an 8192 context by default.** `MIN_TOOL_CALL_TOKENS` in `src/ghostPolicy.ts` / `budgetPolicy.ts` forces a 4096-token output reserve whenever tools are on. `ContextBudgetManager` then has ~4k for system + files + history, so compaction fires early and the model loses the file it just read. Scale the reserve from `maxContextTokens` (for example 25%, min 1024, max 4096) or from the model profile’s `maxTokens`.

- [x] **`describesWorkspaceChange()` is far too broad.** The regex matches `add`, `change`, `fix`, `update`, `create`, `write`, … in almost any coding sentence. Combined with default `ghost.mode = agent`, Ghost then *demands* a tool call when the model only explained something (`expectsWorkspaceTool`). That causes extra retries, false “you must edit the workspace” loops, and wasted budget. Match explicit edit intent (or the active mode), not those verbs in isolation. Add tests; there are none today.

- [x] **Native Ollama tool schemas are weaker than the real validators.** `GHOST_NATIVE_TOOL_DEFINITIONS` marks `ghost_apply_edit` hunks as `{ additionalProperties: true }` and omits `oldText` / `oldHash` / context, `allowSpecialFile`, byte ranges, and several read modes. Models that use native tools then fail `validateLocalToolCall` / `parseGhostEdit`. Mirror `package.json` `languageModelTools` and `src/agent/toolSchema.ts` so the model is asked for the same shape that execution requires.

- [x] **JSON-in-the-reply remains the fallback for too many models.** Native tool calling is enabled for every Ollama model and for generic OpenAI-chat profiles, even when the model cannot emit tool calls. Small coder models dump truncated JSON, hit `splitEdit` / `malformed-json` retries, then stop. Detect tool support from model metadata when Ollama provides it; otherwise keep the JSON protocol but add a one-tool-per-turn reminder only after a parse failure.

- [x] **Do not stop on no-op edits during stale-edit recovery except when the change is already present.** The no-op path already special-cases `staleEditRecoveryPaths`. Extend that: if the requested replacement is already in the file, treat it as success and continue (or finish), instead of `Ghost stopped because it found no changes`.

- [x] **Task-plan + completion-record tools compete with real work.** Small models burn rounds on `ghost_update_task_plan` / `ghost_record_completion` instead of reading and editing. Keep them, but make the prompt say they are optional bookkeeping, never a substitute for a file tool, and do not require `ghost_record_completion` before the final answer unless files actually changed.

- [x] **Read-result cache should invalidate on file change, not only on a later edit tool.** `completedReadCalls` is keyed by path+options and reused even if the user saved the file in the editor. Changelog 1.1.89 already forces fresh reads in some inspection paths; make the cache honor editor version / mtime, or drop it after any document-change event for that path.

- [x] **Default mode is Agent.** That is reasonable for a coding assistant, but first-run users can be surprised by write/terminal approvals. Keep Agent as default, and make the first-run setup state clearly: Ask vs Edit vs Agent, and that file writes need approval.

- [x] **The agent loop can exit after streamed prose and skip the next tool.** In `src/agent/chatParticipant.ts`, after a successful workspace change the loop returns as soon as a turn streamed any text (`turn.streamed && successfulWorkspaceChange`). A short “done” sentence then prevents a follow-up read, diagnostic check, or `ghost_record_completion`. Only exit on cancellation, an explicit stop reason, or a turn that is both streamed **and** classified as a final non-tool answer after the completion policy is satisfied.

- [x] **MLX has no native tool calling.** `providerAdapter.ts` reports `supportsTools: false` for MLX/VLM, so agent work depends on JSON-in-text parsing. Document that Agent mode is unreliable on MLX, keep the JSON parser resilient, and prefer Ollama/OpenAI-compatible when the user enables tools.

---

## P2 — Quality and maintainability

- [x] **Split the two god objects.** Extracted webview CSS (`src/webview/ghostWebview.css`) with CSP nonce on the stylesheet link, and moved HTML assembly to `ghostWebviewHtml.ts`. `ghostView.ts` is ~2540 lines. `ghostWebview.ts` remains large (~4650); keep shrinking it when touching the UI.

- [x] **Deduplicate the protocol types.** `src/ui/ghostProtocol.ts` and `src/webview/ghostWebviewTypes.ts` both describe messages, settings, and auto-accept scopes. `fileEditApproval` is `'confirm' | 'auto'` on the host and `AutoAcceptScope` in the webview. One generated or shared module would prevent the dual-setting mapping in `ghostView.ts` (`fileEditApproval` ↔ `autoAcceptScope`).

- [x] **Remove leftover Hello World.** `ghost.helloWorld` is still registered in `package.json` and `src/extension.ts`. It only shows “Ghost is ready.” Drop the command, activation event, and handler.

- [x] **Rename `ghost.checkOllamaStatus`.** The command id still says Ollama; the title is “Check Provider Connection.” Rename the id (with a compatibility alias if needed) and update the chat participant description, which still says “Local AI Agent (Ollama)” for MLX and OpenAI-compatible users.

- [x] **Wire up ESLint or remove it.** `eslint` is a `devDependency` with **no** config and **no** `lint` script. Add `eslint.config.js` + `npm run lint`, or drop the unused dependency. Same review for `@types/node-fetch` living in `dependencies` instead of `devDependencies`.

- [x] **Move off `node-fetch@2` when practical.** The extension already targets Node 20 / VS Code 1.125, which have native `fetch` and `AbortSignal`. `node-fetch@2` plus three allowlisted copies in `.vscodeignore` inflate the VSIX. Migrate transport to native fetch (keep proxy/TLS agents) and shrink the package.

- [x] **`npm run watch` does not rebuild the webview.** `package.json` `watch` is `tsc -watch -p ./` only. UI changes need `tsc -p tsconfig.webview.json` and `scripts/copyWebviewBuild.js`. Add a compound watch (extension + webview copy) so F5 development does not serve a stale UI.

- [x] **Multi-root workspaces use only folder[0].** `getWorkspaceRoot()` in `src/tools/workspacePath.ts` ignores additional folders. `resolveWorkspacePath()` already searches all folders for containment; listing, search, and git context should use the folder that owns the path, not always the first.

- [x] **Trim redundant `activationEvents`.** Modern VS Code activates from `contributes.commands` / views / chat. The long `onCommand:*` and `onLanguageModelTool:*` list in `package.json` is mostly leftover, including Hello World. Do **not** add more `onCommand` entries for API-key commands; they already activate via `contributes.commands`.

- [x] **Staged edit preview can race the real buffer.** `getDiffPreview()` in `src/ui/ghostView.ts` applies the proposed text with `vscode.workspace.applyEdit` so the user can review in the source editor (this is intentional). Reject/restore exists, but an external save or overlapping user edit during the wait can make restore wrong. Transactions only get a text preview (`prepareFileTransaction`) and skip `alreadyApplied` verification in `LocalToolExecutor`. Harden restore against dirty/external changes, and give multi-file transactions the same staging or a clear “text preview only” label.

- [x] **Accept/Reject Ghost edit commands are unregistered in the manifest.** `ghost.acceptEditPreview` and `ghost.rejectEditPreview` are registered only in `GhostViewProvider` for CodeLens. Add them to `contributes.commands` so keybindings and the Command Palette can find them.

- [x] **Webview defaults `toolAllowlist` to `[]`.** Before the host `controls-state` arrives, `src/webview/ghostWebview.ts` treats every tool as Ask. Default to `GHOST_TOOL_NAMES` (or a loading state) so the Context popup is not wrong on first paint.

- [x] **Provider timeout vs request time-limit are easy to confuse.** `providerRequestTimeoutMinutes` and `requestTimeLimitMinutes` both default to 15 minutes. The Ghost view can report “provider did not respond” when the agent safety budget expired during tool rounds (`src/ui/ghostView.ts`). Label them separately in Settings and use a stop reason that names the limit that fired.

---

## P3 — Testing

Fast tests (`npm run test:fast`) never load VS Code. Host tests (`npm run test:host`) cover filesystem and webview integration. Several high-risk units have no dedicated coverage.

- [x] Add **fast** tests for remaining auto-accept path canonicalization (`current-file` relative vs absolute). `one-edit` consumption, `confirm`, emergency pause, and session-active checks are covered in `ghostApprovalPolicy.test.ts`.

- [x] Add **fast** tests for `describesWorkspaceChange` / `isLikelyConversationalPrompt` so Ask-mode explanations are not forced into tool retries.

- [x] Add **fast** tests for the chat-participant stop policy: inspection tool failure continues; mutation failure after retries stops; overlapping non-identical edits continue after a fresh read.

- [x] Move `src/test/suite/coreHelpers.test.ts` pieces that do not need `vscode` (endpoint join, redaction, settings migration, tool-result limits) into the fast suite so they run on every `test:fast`.

- [x] Cover terminal audit + cwd jail (`src/tools/terminalTools.ts`) without spawning a real shell where possible.

- [x] Add a regression fixture for the `one-edit` and “failed read aborts request” bugs once fixed.

- [x] Host tests still need a real VS Code download via `@vscode/test-electron`. Document the first-run cost in `docs/release.md` and cache `.vscode-test` in CI when CI exists.

---

## P4 — Docs, release, and developer experience

- [ ] **Align versions.** After the next real release: `package.json` == lockfile == README “Current release” == latest `CHANGELOG.md` heading == examples in `docs/release.md`. Changelog currently skips several patch numbers (`1.1.91`, `1.1.81`, `1.1.80`, …); that is fine historically, but stop shipping silent `npm version patch` bumps.

- [ ] **Add GitHub Actions** if automated gates are wanted later: `npm ci`, `compile`, `test:fast`, `security:audit`, `vsce package`, `release:check`, and host tests on Linux (xvfb), macOS, and Windows. Do not auto-publish from every push. Release docs currently describe local gates only.

- [x] Keep **Dependabot** (or equivalent) if the dependency policy stays as written; otherwise rewrite `docs/dependency-policy.md`. The policy now describes local `npm ci` / `security:audit` checks and does not claim Dependabot or GitHub Actions.

- [ ] First-run / README: README still documents `1.1.19` behavior in places that have since changed (timeouts, log level vs `enableDebugLogging`, auto-accept scopes). After the version sync, re-read Highlights, Settings, and Troubleshooting against `package.json`.

- [ ] `PUBLISH.md` vs `docs/release.md` overlap. Keep one canonical release guide and link the other.

---

## P5 — Product improvements (after P0–P2)

- [ ] **Language-aware inline completion.** FIM is registered for `{ pattern: '**' }`, including markdown, JSON, and settings. Limit to programming language ids, or skip when the line prefix is too short in non-code files.

- [ ] **Better token accounting.** `tokenizeContext()` is a word/punctuation split, not tokenizer-accurate. Wrong budgets cause either truncation or oversized Ollama `num_ctx`. Optionally use a cheap byte/4 estimate or a small encoding library.

- [ ] **Provider model discovery UX.** Missing-model errors should offer “Refresh models” and, for Ollama, the pull command already in the README. Status bar click already checks health; include the selected model name.

- [ ] **Cancel vs Stop vs emergency auto-accept pause.** The composer hides Send while running (good). Make Stop also reject in-flight approvals without leaving a stuck “Waiting for approval” card (changelog 1.1.78 addressed some of this; verify with a host test).

- [ ] **Ask / Explain modes should not include write tools in the native tool list.** Even if the Context panel has tools on, Ask/Explain can expose read/search/diagnostics only, which reduces accidental edit JSON from small models.

- [ ] **Accessibility follow-ups** only if audit tests start failing: keep live regions, high-contrast, and reduced-motion as regression gates.

---

## Suggested order of work

1. Optional GitHub Actions if automated gates are wanted.
2. Keep shrinking `ghostWebview.ts` if it grows back toward a 4k-line module.

Do not treat this file as a feature dump. If an item is not pulling its weight against “the agent completes a real edit,” drop it.

---

## P6 — OpenCode integration

OpenCode is not another OpenAI-compatible chat endpoint. Its headless server exposes a versioned OpenAPI/HTTP API for projects, providers, sessions, messages, permissions, diffs, and SSE events. Its MCP integration is a separate path. Start with the [OpenCode server API](https://opencode.ai/docs/server/) and [MCP server docs](https://opencode.ai/v2/docs/mcp-servers/), then pin the tested OpenCode API version.

- [ ] **Choose the integration direction and ownership model.** Decide whether Ghost delegates model/agent work to a user-managed `opencode serve`, OpenCode calls Ghost tools through MCP, or both are supported. Define which product owns sessions, prompts, tool execution, file mutations, approvals, terminal commands, and cancellation. Do not silently start or kill a user’s OpenCode process.

- [ ] **Write the compatibility contract.** Record the minimum OpenCode version, supported server/API revisions, supported providers and agents, unsupported features, multi-root behavior, and the upgrade policy. Add a capability handshake so an API drift becomes a clear “unsupported OpenCode version” message instead of a malformed request.

- [ ] **Add OpenCode settings and secrets.** Add an opt-in provider/integration mode, server URL (defaulting to loopback only), project-directory selection, request/event timeouts, session reuse policy, and optional auto-discovery. Store HTTP Basic Auth credentials in `SecretStorage`; never put passwords in URLs, settings sync, telemetry, errors, or logs.

- [ ] **Implement a typed OpenCode client.** Generate or hand-maintain narrow types from `/doc`; centralize URL joining, `directory`/project-root routing, auth headers, retries, cancellation, response-size limits, SSE parsing, and normalized errors. Reuse the existing provider transport policies where safe, but keep OpenCode session errors distinct from model-provider errors.

- [ ] **Add connection and discovery UX.** Use `/global/health`, `/project/current`, `/config/providers`, `/provider`, and `/agent` to test the server, show its version, discover available models/agents, and explain auth, wrong project root, offline, and incompatible-version failures. Add a command and status state without renaming the existing generic provider commands again.

- [ ] **Map Ghost workspaces to OpenCode projects.** Resolve the owning folder for multi-root workspaces, send the correct project directory on every request, prevent a session from silently crossing workspace roots, and verify that OpenCode’s working directory is inside the selected Ghost workspace before allowing edits or shell commands.

- [ ] **Map prompts and context deliberately.** Define how Ghost modes, system instructions, current file, selection, history, attachments, model aliases, context limits, and tool enablement map to OpenCode message fields. Avoid duplicating the same file contents in Ghost and OpenCode context; redact secrets before transmission.

- [ ] **Implement session lifecycle.** Create, list, select, rename, resume, fork, abort, and delete sessions through the OpenCode API. Persist only a workspace-scoped session ID and metadata, recover from deleted or stale sessions, and make concurrent requests serialize or use separate sessions. Add a clear “new session” action.

- [ ] **Implement streaming and tool-event translation.** Subscribe to `/event` SSE, correlate `session`, message, part, tool, permission, and error events, render incremental text and tool progress in the Ghost webview, tolerate reconnects and duplicate events, and close subscriptions on cancellation and disposal. Preserve the final diff and token/usage data when available.

- [ ] **Bridge approvals and safety policy.** Map OpenCode permission requests to Ghost’s allow/ask/deny lists and auto-accept scopes. Never let an OpenCode-side approval bypass Ghost’s workspace jail, terminal audit, staged-edit flow, or emergency pause. Define which side answers a permission request and translate “always/session/once/reject” without weakening either policy.

- [ ] **Handle edits, diffs, and external changes safely.** Decide whether OpenCode edits files directly or returns proposed patches. If it edits directly, detect editor-version/mtime races, refresh Ghost read caches, verify workspace containment, and surface `/session/:id/diff` before claiming success. Reuse Ghost’s atomic/staged mutation rules where Ghost owns the write.

- [ ] **Add cancellation, timeout, and recovery behavior.** Connect Ghost Stop/cancel to `/session/:id/abort` and the active HTTP/SSE abort signal. Distinguish provider timeout, OpenCode server timeout, agent budget, permission wait, disconnect, and user cancellation; recover or mark the session consistently after each case.

- [ ] **Decide and implement the OpenCode-to-Ghost MCP bridge, if selected.** Expose a local or remote MCP server with Ghost’s read, search, diagnostics, git, edit, terminal, task-plan, and completion tools; use MCP tool schemas that match the real validators; namespace tool names; and document whether tools are direct or Code Mode. Do not expose VS Code-only UI state as an executable tool.

- [ ] **Give the MCP bridge a safe lifecycle.** Define stdio/HTTP transport, workspace-root routing, one-client vs multi-client behavior, authentication, shutdown, reconnects, backpressure, request limits, and whether the extension owns the child process. Require explicit opt-in before binding beyond loopback or exposing file and terminal tools.

- [ ] **Test the integration without a live user server.** Add fast contract tests for URL/auth/redaction, OpenAPI decoding, SSE ordering/reconnects, session mapping, project containment, permission translation, cancellation, and API-version rejection. Add a disposable fake OpenCode server for end-to-end Ghost view and `@local` chat tests, plus an MCP conformance test if that bridge is shipped.

- [ ] **Document setup and support boundaries.** Add OpenCode installation/configuration examples, `opencode serve` instructions, loopback and Basic Auth security notes, model/agent selection, session behavior, troubleshooting, privacy/data-flow notes, and a migration path when OpenCode changes its API. Link the canonical docs instead of copying volatile endpoint details into README prose.

- [ ] **Add release gates.** Include OpenCode contract tests, MCP validation, secret-redaction checks, package inclusion checks, and manual smoke steps in `docs/release.md`; update README, configuration reference, and `CHANGELOG.md` with the release that first ships the integration.
