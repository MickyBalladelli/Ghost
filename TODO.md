# Ghost TODO

Roadmap from the full project review. Order matters: protect user files first, then make the agent reliable, then improve speed, UX, and provider support.

## Priority guide

- **P0**: protect files, secrets, and requests. Do first.
- **P1**: reliability and core workflow. Do before adding many features.
- **P2**: quality, speed, accessibility, and maintainability.
- **P3**: future providers and larger product features.

## P0 — safety and trust

- [x] Add atomic writes: write to a temporary file, flush, then rename. Keep a backup and restore it when verification fails.
- [x] Detect disk changes between read, approval, and apply. Refuse stale edits and offer refresh/rebase instead of overwriting user work.
- [x] Make structured edits context-aware. Include old text, a content hash, or nearby anchor lines, not only line numbers.
- [x] Detect no-op, undo/reapply, alternating, and overlapping edits. Stop the request when the model oscillates on one file.
- [x] Replace the current edit-count guard with a request budget for files, changed lines, bytes, commands, time, and model tokens. Show the limit and why Ghost stopped.
- [x] Add one transaction for a multi-file change: preview one combined diff, apply atomically, verify, and roll back the group on failure.
- [x] Add an explicit verification phase after edits. Run only relevant checks, report their exit status, and do not claim success without evidence.
- [x] Add a clear stopped state: failed tool, invalid model response, cancellation, timeout, approval rejection, context limit, and budget limit must look different.
- [x] Give every failed tool result an actionable retry path and preserve the last valid arguments.
- [x] Audit all terminal commands before execution. Classify destructive commands, writes, network use, package installation, and privilege changes.
- [x] Replace the raw `process.env` terminal environment with a masked, configurable allowlist. Never expose API keys or secret variables to the model.
- [x] Add command timeout, output limit, cancellation, and process-tree cleanup for Windows, macOS, and Linux.
- [x] Add symlink and realpath boundary checks in `src/tools/workspacePath.ts`; test traversal, symlinks, multi-root workspaces, and missing roots.
- [x] Store provider API keys in VS Code SecretStorage. Do not put credentials in settings, URLs, exports, logs, or conversation persistence.
- [x] Redact secrets before model context, webview display, diagnostics, persistence, and export. Expand `src/privacy/redact.ts` for URLs, headers, cookies, cloud keys, and common private-key formats.
- [x] Validate every webview message through one protocol decoder. Check origin/source, schema, request ownership, payload size, and unknown message types.
- [x] Add a warning and scope selector for auto-accept: one edit, current file, request, session, workspace, or always. Make dangerous tools never auto-accepted by default.
- [x] Add undo for every applied edit and a visible recovery path after a failed verification.
- [x] Add a privacy page that explains local providers, external providers, terminal access, storage, export, and redaction.

## P1 — make the agent finish work reliably

- [x] Add a context-budget manager in `src/agent/chatParticipant.ts`. Estimate tokens, reserve output space, compact old tool results, and preserve current files, diffs, errors, and the user request.
- [x] Replace the global `MAX_TOOL_RESULT_CHARACTERS` cap with per-tool limits and structured truncation. Return `head`, `tail`, byte count, and a continuation hint.
- [x] Add a first-class search tool using ripgrep. Return structured file, line, and match data so the model does not use terminal commands for ordinary searching.
- [x] Add read modes for `head`, `tail`, line range, byte range, symbol range, and matching lines. Include encoding, line endings, size, and content hash.
- [x] Detect binary, generated, vendored, ignored, and very large files before reading. Explain the reason and offer a safe alternative.
- [x] Add directory pagination and depth/entry limits instead of returning one large text listing.
- [x] Add a diagnostics tool for compiler errors, Problems panel errors, and diagnostics for a selected file.
- [x] Add optional Git context: status, diff, staged diff, branch, and recent file history. Never include unrelated or ignored files by default.
- [x] Detect unsaved editor changes and let the model read the editor buffer or disk explicitly. Prevent disk edits from silently clobbering unsaved text.
- [ ] Add a task plan object with checked steps, current step, blocked reason, and completion evidence. Persist it in the conversation.
- [ ] Require the model to answer a final structured completion record: changed files, checks run, failures, and remaining work.
- [ ] Add a “continue from last state” action that sends the last failed tool, current file state, and remaining plan without replaying the whole conversation.
- [ ] Add request-level cancellation to every provider, tool, file operation, timer, and pending approval.
- [ ] Add bounded retry policies per failure class. Do not retry invalid arguments forever; retry network disconnects with backoff and jitter.
- [ ] Make empty output, explanatory-only output, malformed JSON, truncated JSON, and unknown tool names separate parser states.
- [ ] Add tool-call streaming support so long tool arguments are assembled safely instead of waiting for a large final text block.
- [ ] Add JSON Schema validation and repair feedback for every tool call. Return the exact missing or invalid field.
- [ ] Add a safe “split this edit” recovery that asks for smaller hunks/files when output approaches the provider limit.
- [ ] Add a no-tool detection message that clearly says why Ghost cannot complete an edit and offers retry/regenerate.
- [ ] Make model-generated paths relative in the prompt where possible, then resolve and validate them host-side. Keep absolute paths accepted for compatibility.
- [ ] Add a per-request event log with timestamps and status transitions. Keep it bounded and redact it before display/export.

## P1 — provider abstraction and LLM compatibility

- [ ] Define a provider adapter interface with `chat`, `stream`, `listModels`, `health`, `capabilities`, error normalization, and cancellation.
- [ ] Define a model capability record: context window, output limit, tools, JSON mode, vision, FIM, streaming, sampling parameters, and native API.
- [ ] Separate provider-neutral generation settings from Ollama, OpenAI, MLX, and future wire-format options.
- [ ] Move request construction into small provider-specific builders and test each request body independently.
- [ ] Support both OpenAI `/v1/chat/completions` and `/v1/responses`, including streamed tool-call deltas.
- [ ] Add configurable authentication headers, API key name, organization/project headers, proxy, TLS, and no-proxy settings for OpenAI-compatible servers.
- [ ] Add adapters or tested compatibility profiles for Anthropic, Google/Gemini, Azure OpenAI, LM Studio, llama.cpp/llama-server, vLLM, and LiteLLM.
- [ ] Keep an extension point for local HTTP servers with custom model discovery and request templates.
- [ ] Make endpoint joining robust for trailing slashes, `/v1`, native Ollama routes, IPv6, and reverse proxies.
- [ ] Add shared timeout, retry, status parsing, rate-limit handling, and normalized provider errors.
- [ ] Cache model discovery and health checks with a manual refresh button. Do not fall back silently to a different model.
- [ ] Show model metadata and capabilities in settings. Explain when Top K, Min P, penalties, vision, tools, or FIM are ignored.
- [ ] Add model aliases and per-model profiles so chat, agent, vision, and autocomplete can use different settings.
- [ ] Add support for provider-native tool calling and JSON/schema mode before relying on text parsing.
- [ ] Add grammar/JSON constraints, seed, stop sequences, context window, and max output settings where the provider supports them.
- [ ] Add an adapter contract test suite using fake providers. Every new LLM adapter must pass the same stream, error, tool, cancellation, and capability tests.
- [ ] Keep image messages behind a capability check and unify MLX/VLM image handling with the generic chat path.
- [ ] Generalize FIM beyond Ollama with an explicit `supportsFIM` capability and endpoint mapping.

## P1 — user experience

- [ ] Show simple live progress by default: “Reading file…”, “Running command…”, “Applying edit…”, “Checking result…”. Keep verbose arguments/results behind a setting.
- [ ] Add a request summary card with changed files, commands, elapsed time, model, provider, tokens, and final status.
- [ ] Group repeated tool calls and show a compact expandable timeline instead of many duplicate blocks.
- [ ] Add Cancel, Retry, Continue, Regenerate, and Open Diff actions to the stopped/failed card.
- [ ] Show the actual reason when Ghost stops: approval denied, tool failure, model stopped, context full, budget reached, or verification failed.
- [ ] Improve approval cards with diff statistics, file names, hunk navigation, keyboard shortcuts, focus management, and accessible labels.
- [ ] Add “approve all pending files” plus separate scopes for this request, session, workspace, and one file.
- [ ] Make “Edit Arguments” open an editable form populated with the original arguments, validate it, and send it back through the same approval flow.
- [ ] Add a visible auto-accept indicator and an easy emergency stop that disables auto-accept for the current request.
- [ ] Add conversation search, message search, bookmarks, rename, duplicate/branch conversation, and lazy loading for old messages.
- [ ] Keep prompt history per conversation with deduplication, search, configurable size, keyboard hints, and reliable previous/next navigation.
- [ ] Autosave composer drafts and show whether prompt history/conversation persistence is enabled.
- [ ] Add slash commands or prompt presets for explain, fix, test, review, refactor, and summarize.
- [ ] Add file/folder mention autocomplete, drag-and-drop files, paste-image support, and clear attachment limits.
- [ ] Add a workspace selector for multi-root workspaces and show which root each file belongs to.
- [ ] Add a model/provider quick switcher and a visible connection/model status with refresh and copyable diagnostic details.
- [ ] Add a settings search and split settings into Provider, Generation, Agent Safety, Appearance, Persistence, and Advanced sections.
- [ ] Add stable coding, balanced, and creative generation profiles. Show the effective values and restore defaults per setting.
- [ ] Add a first-run setup flow that checks the provider, lists models, tests one request, and explains missing capabilities.
- [ ] Use VS Code theme variables consistently. Add high-contrast, reduced-motion, keyboard-only, and screen-reader checks.
- [ ] Replace unsafe or expensive whole-message rendering with safe DOM updates and a central markdown/syntax rendering policy.
- [ ] Add copy buttons for code, paths, errors, commands, and diagnostics. Do not copy hidden secrets.

## P1 — speed and resource use

- [ ] Add a shared HTTP transport for Ollama, MLX, OpenAI-compatible, and future adapters with keep-alive, timeout, abort, retry, and connection diagnostics.
- [ ] Cache workspace context, file reads, directory listings, model lists, and provider health. Invalidate caches on relevant VS Code events.
- [ ] Make context selection relevance-based: active file, diagnostics, changed files, search matches, and user-mentioned files first.
- [ ] Add a tokenizer-aware context packer instead of character-only limits. Report how much context was omitted.
- [ ] Cache inline completions by document version, position, prefix, suffix, language, model, and settings.
- [ ] Cancel obsolete inline requests and agent requests immediately when the document, prompt, provider, or request changes.
- [ ] Add adaptive inline debounce, minimum prefix length, suffix limits, and separate completion timeout/model settings.
- [ ] Batch webview stream updates with `requestAnimationFrame`; do not rebuild the entire message DOM for each token or event.
- [ ] Virtualize long conversations and keep old markdown/code rendering lazy.
- [ ] Stream terminal output into a bounded ring buffer. Prefer a structured tail plus exit metadata over accumulating 200,000 characters first.
- [ ] Bound persistence size and write incrementally. Compress or archive old conversations and handle storage failures visibly.
- [ ] Dispose render targets, event listeners, timers, child processes, and provider streams on request completion and extension deactivation.
- [ ] Add internal timing counters for context preparation, provider wait, first token, tool execution, approval wait, and verification. Keep telemetry local and opt-in if ever added.
- [ ] Reduce debug logging by default and redact before writing logs. Add log levels and a clear log location/cleanup action.
- [ ] Profile startup and lazy-load nonessential commands, diagnostics, model discovery, and webview assets.

## P2 — architecture and maintainability

- [ ] Split `src/webview/ghostWebview.ts` into protocol client, conversation store, settings store, history, rendering, tool timeline, composer, and modal modules.
- [ ] Split `src/ui/ghostView.ts` into request orchestration, persistence, approvals, provider state, import/export, and webview lifecycle services.
- [ ] Share or generate protocol types between `src/ui/ghostProtocol.ts` and the webview. Remove duplicated local message declarations.
- [ ] Centralize file validation, read/write/edit execution, diff creation, and conflict handling instead of duplicating logic between `fileTools.ts` and `localToolExecutor.ts`.
- [ ] Keep provider-neutral types separate from `MlxChatOptions`; avoid using one provider’s request shape as the shared contract.
- [ ] Introduce an event/state store with one owner for request state, conversation state, settings, approvals, and persistence.
- [ ] Add protocol version negotiation and migrations for webview/extension changes.
- [ ] Replace giant `innerHTML` templates with small safe render functions or DOM builders. Centralize escaping and markdown sanitization.
- [ ] Add typed result objects for tools: status, exit code, changed files, bytes, truncation, warnings, and retryability.
- [ ] Make constants such as tool rounds, edit limits, output limits, timeouts, and context limits configurable or grouped in one policy module.
- [ ] Define error classes and error codes shared by providers, tools, persistence, approvals, and UI.
- [ ] Add settings schema versioning and migrations before adding more configuration.
- [ ] Add dependency injection for providers, filesystem, clock, process runner, storage, and webview messaging so core behavior can be tested without VS Code.
- [ ] Add `dispose` methods and ownership rules for every long-lived resource.

## P2 — testing and quality

- [ ] Add fast pure unit tests for settings defaults/migrations, endpoint normalization, capability mapping, redaction, workspace paths, edit application, and tool result limits.
- [ ] Add tests for chunked reads, line ranges, UTF-8/CRLF files, binary detection, large files, directory pagination, and no-op writes.
- [ ] Add tests for edit conflicts, stale hashes, overlapping hunks, repeated edits, oscillating edits, multi-file rollback, and approval races.
- [ ] Add tests for malformed compact names, raw multiline JSON, truncated JSON, multiple tool calls, unknown tools, invalid schemas, and output-only model replies.
- [ ] Add tests that verify the 4096-token minimum tool budget and the 128-call safety boundary without making live provider requests.
- [ ] Add OpenAI-compatible, native Ollama, MLX, and image request fixtures. Assert unsupported parameters are omitted, not merely ignored by the server.
- [ ] Add fake-provider integration tests for read → edit → approve → verify, failure → retry, cancellation, empty output, and context compaction.
- [ ] Add webview tests for keyboard navigation, focus traps, approval controls, failure colors/icons, live regions, history restore, and reduced motion.
- [ ] Add property/fuzz tests for tool JSON parsing, edit hunks, protocol messages, redaction, and endpoint handling.
- [ ] Add accessibility checks for every modal, button, status update, contrast mode, and keyboard path.
- [ ] Separate fast tests from VS Code extension-host tests. Make CI run the fast suite on every change.
- [ ] Add CI for compile, unit/integration tests, packaging, VSIX install smoke test, and supported OS versions.
- [ ] Add dependency security checks and a policy for updating TypeScript, VS Code types, `node-fetch`, `vsce`, and test tooling.
- [ ] Add regression fixtures from real failures: malformed shader edits, missing files, provider-empty output, failed apply, truncated tool arguments, and repeated same-file edits.

## P2 — docs and release hygiene

- [ ] Expand `docs/architecture.md` with state ownership, request sequence diagrams, approval sequence, provider sequence, persistence schema, and failure recovery.
- [ ] Add `docs/provider-adapter.md` describing capabilities, request builders, streaming, errors, authentication, and how to add a provider.
- [ ] Add `docs/tool-protocol.md` describing schemas, validation, approval, retries, truncation, edits, and verification.
- [ ] Add `docs/release.md` with version, changelog, compile, package, install, smoke-test, publish, and rollback steps.
- [ ] Update `README.md` with the current stable coding profile, provider capability matrix, tool limits, approval scopes, persistence/privacy behavior, and troubleshooting for failed edits.
- [ ] Link `OLLAMA_PARAMETERS.md` from the settings and README. Document which settings each provider really uses.
- [ ] Add a user FAQ for model setup, OpenAI-compatible URLs, MLX/VLM images, auto-accept, tool failures, context limits, and disk usage.
- [ ] Add configuration reference generated from `package.json` so descriptions/defaults cannot drift from `src/config.ts`.
- [ ] Fix stale examples in `PUBLISH.md` (name, publisher, version, Marketplace ID, and old commands).
- [ ] Replace the hardcoded `ghost-1.0.14.vsix` package output with the current package version.
- [ ] Add a release check that package.json, package-lock.json, changelog, README, and VSIX version agree.
- [ ] Keep only intentional release artifacts. Move old local VSIX files to `./Trash` or stop tracking them; do not let every build grow the repository.
- [ ] Decide whether `archives/TODO1.md` is historical. Archive it clearly or merge useful items into this file.
- [ ] Add `.editorconfig` and audit `.gitignore`, `.vscodeignore`, line endings, generated output, logs, caches, and local model files.
- [ ] Add dependency update automation and a documented review cadence.
- [ ] Add issue templates for provider bugs, failed edits, security reports, and performance reports.

## P3 — future product capabilities

- [ ] Add conversation branching and compare two model/provider answers.
- [ ] Add background indexing with explicit workspace consent, ignore rules, and an on-disk index that can be deleted.
- [ ] Add semantic symbol/file retrieval while keeping exact search available and transparent.
- [ ] Add project-specific instructions with safe precedence: workspace config, folder config, file language, conversation, then user prompt.
- [ ] Add configurable tool packs and third-party tools behind permissions and capability discovery.
- [ ] Add local-only mode that disables external endpoints, persistence, telemetry, and network-capable commands.
- [ ] Add remote/container/WSL/SSH workspace awareness so paths, shells, providers, and terminals run in the correct environment.
- [ ] Add multimodal context for screenshots, diagrams, PDFs, and selected editor regions when the model supports vision.
- [ ] Add structured code review mode with inline comments, severity, confidence, and diff-aware findings.
- [ ] Add test-generation and test-running mode with a clear command allowlist.
- [ ] Add patch export/import in unified diff format and optional Git apply integration.
- [ ] Add per-workspace policy files for allowed tools, ignored paths, provider restrictions, and approval defaults.
- [ ] Add optional local evaluation harness with repeatable tasks, fake repositories, latency, tool-call accuracy, edit success rate, and regression scoring.

## Done means

- [ ] Every file mutation is reviewable, conflict-safe, undoable, and verified.
- [ ] Every provider reports capabilities and gives a useful error when a feature is unsupported.
- [ ] Long requests stay within a measured context and tool budget without silently losing the user’s task.
- [ ] The UI says what Ghost is doing, what failed, and what the user can do next.
- [ ] Tests cover the failure cases that caused the current tool/edit bugs.
- [ ] Docs, settings, package metadata, changelog, and release artifacts agree.
