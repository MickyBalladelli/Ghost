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

- [ ] **`create-vsix.sh` is the source of version drift.** The script runs `npm version patch` and does not update `CHANGELOG.md`, `README.md` (“Current release: `1.1.19`”), or `docs/release.md` (still `1.1.19`). `package.json` is `1.1.96` while the latest changelog heading is behind and README is 77 patches stale. `scripts/checkReleaseConsistency.js` would fail today. Stop auto-bumping in the local install helper, or make the bump update README + changelog in the same step. Run `npm run release:check` before every publish.

- [ ] **Release docs claim CI that does not exist.** `docs/release.md` and `docs/dependency-policy.md` describe `.github/workflows/ci.yml`, a Linux/macOS/Windows host-test matrix, Dependabot, and `npm audit` on every PR. There is **no** `.github/` directory. Either add the workflow the docs describe, or stop claiming it.

---

## P1 — Ability to execute (agent actually finishes workspace work)

Ghost already has strong edit safety (workspace jail, hunk context, rebase, atomic writes, approval). The remaining execution problems are mostly “the loop gives up” and “the model is asked to do too much with too little context.”

- [ ] **Shrink the default system prompt.** `SYSTEM_PROMPT` in `src/agent/chatParticipant.ts` concatenates the full tool catalog, JSON-escaping rules, path rules, diagnostics, git, task-plan, and completion-record instructions on every request. Local 7B models spend a large fraction of an 8k window on instructions. Split into a short always-on prompt plus tool schemas only when native tools are off; keep per-tool details in `GHOST_NATIVE_TOOL_DEFINITIONS`.

- [ ] **Stop reserving 4096 output tokens from an 8192 context by default.** `MIN_TOOL_CALL_TOKENS` in `src/ghostPolicy.ts` / `budgetPolicy.ts` forces a 4096-token output reserve whenever tools are on. `ContextBudgetManager` then has ~4k for system + files + history, so compaction fires early and the model loses the file it just read. Scale the reserve from `maxContextTokens` (for example 25%, min 1024, max 4096) or from the model profile’s `maxTokens`.

- [ ] **`describesWorkspaceChange()` is far too broad.** The regex matches `add`, `change`, `fix`, `update`, `create`, `write`, … in almost any coding sentence. Combined with default `ghost.mode = agent`, Ghost then *demands* a tool call when the model only explained something (`expectsWorkspaceTool`). That causes extra retries, false “you must edit the workspace” loops, and wasted budget. Match explicit edit intent (or the active mode), not those verbs in isolation. Add tests; there are none today.

- [ ] **Native Ollama tool schemas are weaker than the real validators.** `GHOST_NATIVE_TOOL_DEFINITIONS` marks `ghost_apply_edit` hunks as `{ additionalProperties: true }` and omits `oldText` / `oldHash` / context, `allowSpecialFile`, byte ranges, and several read modes. Models that use native tools then fail `validateLocalToolCall` / `parseGhostEdit`. Mirror `package.json` `languageModelTools` and `src/agent/toolSchema.ts` so the model is asked for the same shape that execution requires.

- [ ] **JSON-in-the-reply remains the fallback for too many models.** Native tool calling is enabled for every Ollama model and for generic OpenAI-chat profiles, even when the model cannot emit tool calls. Small coder models dump truncated JSON, hit `splitEdit` / `malformed-json` retries, then stop. Detect tool support from model metadata when Ollama provides it; otherwise keep the JSON protocol but add a one-tool-per-turn reminder only after a parse failure.

- [ ] **Do not stop on no-op edits during stale-edit recovery except when the change is already present.** The no-op path already special-cases `staleEditRecoveryPaths`. Extend that: if the requested replacement is already in the file, treat it as success and continue (or finish), instead of `Ghost stopped because it found no changes`.

- [ ] **Task-plan + completion-record tools compete with real work.** Small models burn rounds on `ghost_update_task_plan` / `ghost_record_completion` instead of reading and editing. Keep them, but make the prompt say they are optional bookkeeping, never a substitute for a file tool, and do not require `ghost_record_completion` before the final answer unless files actually changed.

- [ ] **Read-result cache should invalidate on file change, not only on a later edit tool.** `completedReadCalls` is keyed by path+options and reused even if the user saved the file in the editor. Changelog 1.1.89 already forces fresh reads in some inspection paths; make the cache honor editor version / mtime, or drop it after any document-change event for that path.

- [ ] **Default mode is Agent.** That is reasonable for a coding assistant, but first-run users can be surprised by write/terminal approvals. Keep Agent as default, and make the first-run setup state clearly: Ask vs Edit vs Agent, and that file writes need approval.

- [ ] **The agent loop can exit after streamed prose and skip the next tool.** In `src/agent/chatParticipant.ts`, after a successful workspace change the loop returns as soon as a turn streamed any text (`turn.streamed && successfulWorkspaceChange`). A short “done” sentence then prevents a follow-up read, diagnostic check, or `ghost_record_completion`. Only exit on cancellation, an explicit stop reason, or a turn that is both streamed **and** classified as a final non-tool answer after the completion policy is satisfied.

- [ ] **MLX has no native tool calling.** `providerAdapter.ts` reports `supportsTools: false` for MLX/VLM, so agent work depends on JSON-in-text parsing. Document that Agent mode is unreliable on MLX, keep the JSON parser resilient, and prefer Ollama/OpenAI-compatible when the user enables tools.

---

## P2 — Quality and maintainability

- [ ] **Split the two god objects.** `src/webview/ghostWebview.ts` (~4650 lines) and `src/ui/ghostView.ts` (~4480 lines) own protocol handling, settings, approvals, HTML/CSS, history, and rendering. Continue the existing split (`ghostWebviewShell`, `ghostStateStore`, `ghostApprovalPolicy`, …) until `ghostView.ts` is host orchestration only and the webview has no 4k-line module. Extract the inline CSS in `getHtml()` to a real stylesheet under `src/webview/` (nonce remains).

- [ ] **Deduplicate the protocol types.** `src/ui/ghostProtocol.ts` and `src/webview/ghostWebviewTypes.ts` both describe messages, settings, and auto-accept scopes. `fileEditApproval` is `'confirm' | 'auto'` on the host and `AutoAcceptScope` in the webview. One generated or shared module would prevent the dual-setting mapping in `ghostView.ts` (`fileEditApproval` ↔ `autoAcceptScope`).

- [ ] **Remove leftover Hello World.** `ghost.helloWorld` is still registered in `package.json` and `src/extension.ts`. It only shows “Ghost is ready.” Drop the command, activation event, and handler.

- [ ] **Rename `ghost.checkOllamaStatus`.** The command id still says Ollama; the title is “Check Provider Connection.” Rename the id (with a compatibility alias if needed) and update the chat participant description, which still says “Local AI Agent (Ollama)” for MLX and OpenAI-compatible users.

- [ ] **Wire up ESLint or remove it.** `eslint` is a `devDependency` with **no** config and **no** `lint` script. Add `eslint.config.js` + `npm run lint`, or drop the unused dependency. Same review for `@types/node-fetch` living in `dependencies` instead of `devDependencies`.

- [ ] **Move off `node-fetch@2` when practical.** The extension already targets Node 20 / VS Code 1.125, which have native `fetch` and `AbortSignal`. `node-fetch@2` plus three allowlisted copies in `.vscodeignore` inflate the VSIX. Migrate transport to native fetch (keep proxy/TLS agents) and shrink the package.

- [ ] **`npm run watch` does not rebuild the webview.** `package.json` `watch` is `tsc -watch -p ./` only. UI changes need `tsc -p tsconfig.webview.json` and `scripts/copyWebviewBuild.js`. Add a compound watch (extension + webview copy) so F5 development does not serve a stale UI.

- [ ] **Multi-root workspaces use only folder[0].** `getWorkspaceRoot()` in `src/tools/workspacePath.ts` ignores additional folders. `resolveWorkspacePath()` already searches all folders for containment; listing, search, and git context should use the folder that owns the path, not always the first.

- [ ] **Trim redundant `activationEvents`.** Modern VS Code activates from `contributes.commands` / views / chat. The long `onCommand:*` and `onLanguageModelTool:*` list in `package.json` is mostly leftover, including Hello World. Do **not** add more `onCommand` entries for API-key commands; they already activate via `contributes.commands`.

- [ ] **Staged edit preview can race the real buffer.** `getDiffPreview()` in `src/ui/ghostView.ts` applies the proposed text with `vscode.workspace.applyEdit` so the user can review in the source editor (this is intentional). Reject/restore exists, but an external save or overlapping user edit during the wait can make restore wrong. Transactions only get a text preview (`prepareFileTransaction`) and skip `alreadyApplied` verification in `LocalToolExecutor`. Harden restore against dirty/external changes, and give multi-file transactions the same staging or a clear “text preview only” label.

- [ ] **Accept/Reject Ghost edit commands are unregistered in the manifest.** `ghost.acceptEditPreview` and `ghost.rejectEditPreview` are registered only in `GhostViewProvider` for CodeLens. Add them to `contributes.commands` so keybindings and the Command Palette can find them.

- [ ] **Webview defaults `toolAllowlist` to `[]`.** Before the host `controls-state` arrives, `src/webview/ghostWebview.ts` treats every tool as Ask. Default to `GHOST_TOOL_NAMES` (or a loading state) so the Context popup is not wrong on first paint.

- [ ] **Provider timeout vs request time-limit are easy to confuse.** `providerRequestTimeoutMinutes` and `requestTimeLimitMinutes` both default to 15 minutes. The Ghost view can report “provider did not respond” when the agent safety budget expired during tool rounds (`src/ui/ghostView.ts`). Label them separately in Settings and use a stop reason that names the limit that fired.

---

## P3 — Testing

Fast tests (`npm run test:fast`) never load VS Code. Host tests (`npm run test:host`) cover filesystem and webview integration. Several high-risk units have no dedicated coverage.

- [x] Add **fast** tests for remaining auto-accept path canonicalization (`current-file` relative vs absolute). `one-edit` consumption, `confirm`, emergency pause, and session-active checks are covered in `ghostApprovalPolicy.test.ts`.

- [ ] Add **fast** tests for `describesWorkspaceChange` / `isLikelyConversationalPrompt` so Ask-mode explanations are not forced into tool retries.

- [ ] Add **fast** tests for the chat-participant stop policy: inspection tool failure continues; mutation failure after retries stops; overlapping non-identical edits continue after a fresh read.

- [ ] Move `src/test/suite/coreHelpers.test.ts` pieces that do not need `vscode` (endpoint join, redaction, settings migration, tool-result limits) into the fast suite so they run on every `test:fast`.

- [ ] Cover terminal audit + cwd jail (`src/tools/terminalTools.ts`) without spawning a real shell where possible.

- [ ] Add a regression fixture for the `one-edit` and “failed read aborts request” bugs once fixed.

- [ ] Host tests still need a real VS Code download via `@vscode/test-electron`. Document the first-run cost in `docs/release.md` and cache `.vscode-test` in CI when CI exists.

---

## P4 — Docs, release, and developer experience

- [ ] **Align versions.** After the next real release: `package.json` == lockfile == README “Current release” == latest `CHANGELOG.md` heading == examples in `docs/release.md`. Changelog currently skips several patch numbers (`1.1.91`, `1.1.81`, `1.1.80`, …); that is fine historically, but stop shipping silent `npm version patch` bumps.

- [ ] **Add GitHub Actions** matching `docs/release.md`: `npm ci`, `compile`, `test:fast`, `security:audit`, `vsce package`, `release:check`, and host tests on Linux (xvfb), macOS, and Windows. Do not auto-publish from every push.

- [ ] Keep **Dependabot** (or equivalent) if the dependency policy stays as written; otherwise rewrite `docs/dependency-policy.md`.

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

1. Fix auto-accept scopes (`one-edit`, `current-file`, legacy `auto` → `always`) and add tests (`ghostApprovalPolicy.ts`).
2. Soften remaining agent stop policy (early return after streamed text) in `chatParticipant.ts`.
3. Reduce default context pressure (prompt size + 4096 output reserve).
4. Tighten `describesWorkspaceChange` and native tool schemas.
5. Remove Hello World, fix `watch`, add ESLint or drop it.
6. Stop `create-vsix.sh` from drifting versions; sync README/changelog; add CI.

Do not treat this file as a feature dump. If an item is not pulling its weight against “the agent completes a real edit,” drop it.
