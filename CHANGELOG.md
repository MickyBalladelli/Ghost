# Changelog

All notable changes to this extension are documented here.

## 1.1.19 - 2026-08-18

- Add a provider/model quick switcher with connection diagnostics, refresh, and copy controls.
- Add searchable settings sections for Generation, Provider, Agent Safety, Appearance, Persistence, and Advanced options.
- Add built-in Coding, Balanced, and Creative model profiles with effective-value display and restore defaults.
- Add a first-run setup flow with provider checks, model discovery, capability notes, and an optional test request.
- Improve accessibility with VS Code theme variables, forced-colors styling, reduced-motion handling, screen-reader status updates, and modal keyboard focus trapping.
- Reuse visible message elements during refreshes and centralize generated markdown markup through safe DOM fragments.
- Add copy controls for paths, errors, commands, diagnostics, and code, with secret redaction before clipboard writes.
- Add shared provider HTTP transport diagnostics with keep-alive agents, timeout, abort, and retry handling for local and profiled providers.
- Cache workspace context, file reads, directory listings, model discovery, and provider health with event-based invalidation.
- Prioritize active files, diagnostics, unsaved changed files, attachments, user-mentioned files, and workspace search matches in model context.
- Use tokenizer-aware context packing and report the approximate number of omitted tokens when context is compacted.
- Cache inline completions with document, cursor, prompt, model, provider, and generation settings in a bounded LRU cache.
- Abort obsolete inline provider calls and same-conversation agent requests when newer prompts or settings replace them.
- Tune inline completions with adaptive debounce, minimum prefix checks, bounded suffix context, and a separate timeout setting.
- Batch adjacent webview response chunks per animation frame before updating message markup.
- Keep conversation rendering bounded to a recent message window and lazily render older Markdown/code as it enters view.
- Keep terminal output in a bounded tail ring and report omitted output with timeout and exit metadata.
- Bound persisted conversations and message text, and skip unchanged autosave writes.
- Dispose webview timers, animation frames, observers, queued stream work, and active requests during unload.
- Make the result-area “Ghost is thinking…” placeholder light grey.
- Record local request timing counters for context, provider wait, first token, tools, approvals, and verification when debug logging is enabled.
- Add off-by-default local log levels, secret redaction before writing, and Command Palette actions to open or clear Ghost Logs.
- Profile activation time locally and lazy-load provider clients and model diagnostics until their commands are used.
- Move shared webview state and protocol types into a dedicated module to make the webview split incremental and behavior-neutral.
- Extract conversation creation and prompt-history operations into a runtime webview store loaded before the UI.
- Split webview protocol, settings, history, rendering, tool timeline, composer, and modal helpers into separate runtime modules.
- Extract persisted-state shapes and bounded storage compaction into a dedicated UI persistence module.
- Extract tool approval policy, file-edit classification, and auto-accept scope rules into a dedicated module.
- Extract provider cache-key and model-capability state helpers into a dedicated module.
- Split Ghost view request registry, import/export helpers, and webview lifecycle state into dedicated modules.
- Share the extension-message protocol type with the webview and remove its duplicated local message union.
- Centralize file mutation validation, change creation, conflict checks, atomic writes, and readback verification for all file tools.
- Add provider-neutral chat request, message, tool, response, vision, and stream types; keep MLX names as deprecated compatibility aliases only.
- Add one Ghost state store for request lifecycle, conversations, settings, approvals, provider status, and persistence snapshots with state-change subscriptions.
- Add webview/extension protocol version negotiation, legacy v1 compatibility, and persisted/message migration hooks.
- Replace the giant webview shell HTML template with a safe DOM builder and sanitize generated Markdown fragments before insertion.
- Add shared typed tool results with status, exit codes, changed files, output bytes, truncation, warnings, and retryability metadata.

## 1.1.17 - 2026-08-18

- Add a shared fill-in-the-middle provider contract with capability checks and provider endpoint routing.
- Route supported generation controls through FIM requests for Ollama and OpenAI-compatible providers.
- Show short live tool progress by default, with detailed arguments and results behind verbose tool progress.
- Apply the character-sweep animation to every active requested or running tool action.
- Add a final request summary card with changed files, commands, elapsed time, model, provider, tokens, and status.
- Group repeated tool calls into compact expandable timelines.
- Add visible recovery actions for active, stopped, and failed requests, including Open Diff.
- Show the detailed stop message and recovery hint in stopped request cards.
- Improve approval cards with diff statistics, file names, hunk navigation, keyboard shortcuts, focus management, and accessible labels.
- Add approve-all-pending-files plus request, session, workspace, and single-file approval scopes.
- Replace the Edit Arguments prompt with a validated JSON editor modal.
- Show the active auto-accept scope and add an emergency pause for the current request.
- Add message search results, bookmarks, conversation duplication/branching, and lazy loading for older messages.
- Add searchable per-conversation prompt history with configurable retention and keyboard guidance.
- Autosave composer drafts and show whether local conversation persistence is enabled.
- Add /test, /review, and /refactor slash commands with workflow-specific prompts.
- Add pasted-image attachments, visible attachment limits, and removable attachment chips.
- Add a multi-root workspace selector and root labels for open files and active context.
- Recover missing relative file paths when exactly one matching filename exists in the workspace.

## 1.1.16 - 2026-08-18

- Preserve valid provider output when local servers return complete message/content fields instead of streaming delta fields.
- Add a shared fake-provider contract suite covering text streams, native tool events, fallback streams, errors, cancellation, and capabilities.
- Add provider-aware grammar, seed, stop sequence, context window, and output-token settings.
- Expose the new generation values to model profiles and custom HTTP request templates.
- Route image attachments through capability-checked multimodal chat messages for vision-capable providers.

## 1.1.15 - 2026-08-18

- Make three characters light up together during the thinking-label sweep.
- Add native tool definitions and structured tool-call streaming for Ollama and OpenAI-compatible providers, with text parsing fallback.
- Add provider request support for JSON object and JSON schema response formats.
- Add the `ghost.jsonMode` setting for providers that support JSON mode.

## 1.1.14 - 2026-08-18

- Keep animated label width stable with a fixed-width font and one reserved cell per character.

## 1.1.13 - 2026-08-18

- Improve the result-area thinking animation: normal-weight text, one bold highlighted character, softer glow, and cleaner timing.
- Use a fixed-width font and character cells so bold highlights do not change the label width.

## 1.1.12 - 2026-08-18

- Make result-area and active tool labels highlight exactly one character at a time from left to right and back, while keeping the bottom status animation separate.
- Remove the thinking placeholder when a request is cancelled or otherwise finished without a response.
- Keep the result-area thinking text normal-weight except for the single highlighted character.

## 1.1.11 - 2026-08-18

- Animate thinking and activity labels with a character-by-character light sweep in the result area, status footer, and active tool labels.

## 1.1.10 - 2026-08-18

- Show model context/output limits, provider capabilities, sampling support, and ignored settings beside the model selector.
- Add model aliases, selectable named profiles, and role-specific model/generation settings for chat, agent, vision, and autocomplete.
- Animate the “Ghost is thinking” status label while a response is being generated.
- Raise the default local request time budget to 120 minutes and make it configurable with `ghost.requestTimeLimitMinutes`.
- Ask whether to Continue or Stop when any request budget limit is reached instead of ending silently.

## 1.1.8 - 2026-08-18

- Cache provider health and model discovery for 30 seconds.
- Add a manual Refresh models action that forces a fresh provider check.
- Reuse repeated identical file reads instead of stopping the request as an invalid model response.

## 1.1.6 - 2026-08-18

- Stops repeated identical file reads instead of looping on the same file range.

## 1.1.5 - 2026-08-18

- Fixed workspace search when VS Code starts with a reduced PATH and cannot find ripgrep by command name.
- Added a clear error when ripgrep is not installed or cannot be located.

## 1.1.4 - 2026-08-18

- Fixed global tool permission changes being hidden by stale workspace-specific deny rules.
- Blocked-tool messages now identify the denied tool and explain how to change its policy.

## 1.1.3 - 2026-08-18

- Replaced raw tool and terminal environment permission fields with clear Allow, Ask, and Deny dialogs.
- Added tool and terminal environment ask policies, with clearer setting descriptions.
- Treats tools missing from an older allowlist as Ask instead of Deny.
- Added shared endpoint normalization for trailing slashes, `/v1` paths, native Ollama routes, IPv6 hosts, and reverse-proxy prefixes.
- Added shared provider request timeouts, bounded retries, Retry-After parsing, rate-limit metadata, and normalized HTTP errors.
- Read progress now shows requested or actual file line and byte ranges instead of hiding chunk details behind the filename.

## 1.0.98 - 2026-08-18

- Added a Custom HTTP provider profile with configurable model discovery, chat paths, JSON request templates, and response formats.

## 1.0.97 - 2026-08-18

- Added provider profiles and adapters for Anthropic, Google Gemini, Azure OpenAI, LM Studio, llama.cpp, vLLM, and LiteLLM.
- Added provider-specific model discovery, authentication, streaming, and endpoint defaults.

## 1.0.96 - 2026-08-18

- Included proxy transport dependencies in the VSIX so Ghost can activate.

## 1.0.94 - 2026-08-18

- Fixed file reads after directory scans by preserving workspace-relative nested paths and resolving a unique missing basename to its discovered file.
- Added configurable OpenAI-compatible API-key headers, organization/project headers, proxy and no-proxy routing, TLS verification, and client certificate files.

## 1.0.93 - 2026-08-18

- Fixed streamed local tool calls being displayed as text when a model added a short explanation before the JSON call.
- Added field-level JSON Schema validation and bounded repair feedback for every local tool call.
- Added bounded recovery for oversized streamed edit calls, asking for smaller hunks or one file at a time before execution.
- Added clear no-tool failure reasons and always-visible Retry and Regenerate actions for failed replies.
- Added workspace-relative model paths with host-side workspace validation while preserving absolute path compatibility.
- Added bounded, redacted per-request event logs with timestamps and status transitions for display and export.
- Added a shared provider adapter contract for chat, streaming, model discovery, health, capabilities, cancellation, and normalized errors.
- Added model capability records covering context/output limits, tools, JSON mode, vision, FIM, streaming, sampling, and native API.
- Separated shared generation settings from provider-specific request field names for chat and FIM requests.
- Moved MLX, Ollama, OpenAI-compatible, and FIM payload construction into independently testable provider builders.
- Added OpenAI Responses API fallback and streamed function-call argument assembly alongside chat completions.

## 1.0.92 - 2026-08-18

- Fixed internal task-plan and completion-record tools being blocked by older workspace tool allowlists.
- Added bounded incremental tool-call assembly that stops at complete JSON and keeps long tool arguments out of visible chat output.
- Added distinct parser states and retry feedback for empty, explanatory-only, malformed, truncated, and unknown-tool model responses.
- Added centralized bounded retry policies, jittered provider reconnect delays, and a two-attempt cap for manual failed-tool retries.
- Strengthened request cancellation across file writes, verification, transactions, approval dialogs, timers, and tool execution.
- Added a Continue action for failed requests that sends the last failed tool, fresh current file state, and remaining task plan without replaying the conversation.

## 1.0.91 - 2026-08-17

- Fixed Ghost continuing to request more tools after a workspace edit completed and verification finished.
- Added required structured completion records for changed files, checks run, failures, and remaining work, with a persisted conversation summary.
- Added `ghost_update_task_plan` to persist checked steps, the current step, blockers, and completion evidence in each conversation.
- Added explicit editor-buffer or disk read sources, paused ambiguous dirty-file reads, and blocked file edits that could overwrite unsaved editor changes.
- Added read-only `ghost_git_context` for non-ignored workspace status, selected-file diffs, staged diffs, branch details, and recent file history.
- Added `ghost_get_diagnostics` for workspace, active-file, and selected-file Problems-panel diagnostics with severity filters and bounded results.
- Added bounded directory pages with continuation cursors, recursive depth limits, and entry limits for large workspace trees.

## 1.0.90 - 2026-08-17

- Finished stale-edit recovery cleanly when the requested change was already present, instead of showing a failed tool after successful verification.

## 1.0.89 - 2026-08-17

- Refreshed provider health and model controls when the webview finishes loading, preventing the initial live Ollama status from being lost before the message listener is ready.

## 1.0.88 - 2026-08-17

- Prevented false Ollama-offline indicators when model discovery fails, checks race, or a non-network request error occurs; health checks now have a longer window and stale results are ignored.
- Added Ollama root-endpoint health fallback so a live server is not marked offline when `/api/tags` is unavailable.

## 1.0.87 - 2026-08-17

- Blocked binary, generated, vendored, ignored, and over-1 MiB files before model reads, with safe search or bounded-read alternatives.
- Added safe read modes for head, tail, line, byte, symbol, and matching-line views with UTF-8 metadata, line endings, size, line count, and SHA-256 content hashes.

## 1.0.86 - 2026-08-17

- Retried stale edit conflicts by refreshing current file context and rebasing instead of stopping after a successful earlier tool step.
- Added one bounded webview message decoder with strict source/version checks, payload limits, field schemas, and unknown-type rejection.
- Enforced request and conversation ownership for cancellation and failed-tool retry actions.
- Added warned auto-accept scopes for one edit, current file, request, session, workspace, or always; terminal and other dangerous tools still require explicit approval.
- Added verified undo for applied writes, structured edits, and multi-file transactions, including removal of newly created files.
- Added an in-app privacy page covering providers, keys, workspace and terminal access, storage, exports, and redaction.
- Added context budgeting with token estimates, reserved output space, old-history compaction, and preservation of current requests, files, diffs, and errors.
- Replaced the global tool-result cap with per-tool limits and structured head/tail, byte-count, and continuation output.
- Added a first-class fixed-string ripgrep workspace search tool with structured file, line, column, and match results.

## 1.0.85 - 2026-08-17

- Added realpath and symlink boundary checks for workspace paths, including multi-root and missing-root handling.
- Added password-prompted provider API keys in VS Code SecretStorage for Ollama, MLX/VLM, and OpenAI-compatible requests.
- Kept provider credentials out of settings, webviews, URLs, logs, exports, and persisted conversations.
- Expanded secret redaction for model context, webview messages, diagnostics, persistence, and exports, including URLs, headers, cookies, cloud keys, JWTs, and private keys.
- Accepted common top-level and aliased tool arguments, and safely resolved relative workspace paths for simple file-creation requests.

## 1.0.84 - 2026-08-17

- Added atomic file writes with temporary-file verification, backups, and restore on failed verification.
- Refused stale file edits when disk content changes between reading, approval, and applying.
- Added refresh and rebase guidance for stale edits, including auto-accepted and staged editor changes.
- Added old-text, SHA-256, and nearby-context validation for structured edit hunks.
- Stopped no-op, repeated, undo/reapply, alternating, and overlapping edit loops per file.
- Replaced the per-file edit cap with request budgets for files, changed lines, bytes, commands, time, and estimated model tokens.
- Reported the budget category and usage when Ghost stops.
- Added `ghost_apply_transaction` for combined multi-file previews, baseline checks, verification, and group rollback on failure.
- Added explicit post-edit readback verification and reported verification status in file tool results.
- Added distinct stopped states for tool failure, invalid model output, cancellation, timeout, approval rejection, context limits, and request budgets.
- Added separate rejected and failed statuses to tool progress, with retry guidance after failed tools.
- Added a Retry tool action that reuses the last valid tool arguments through a fresh approval flow.
- Added shared terminal command auditing for file writes, destructive actions, network access, package installs, and privilege changes.
- Blocked terminal file-writing commands and showed audit classifications before other terminal commands run.
- Hardened terminal timeout, output-limit, cancellation, and cross-platform process-tree cleanup.
- Replaced the raw terminal environment with a configurable safe allowlist and masked environment values from command output.
- Always excluded secret-looking environment variable names, including keys, tokens, passwords, credentials, and private values.

## 1.0.83 - 2026-08-17

- Added `TODO.md` with a prioritized roadmap for safety, reliability, UX, performance, provider support, testing, and release quality.
- Added “Apply to all files” approval for the current session.
- Added Confirm or Auto-accept as the default file-edit behavior.
- Blocked terminal redirection and script-based file writes so failed file edits retry through Ghost file tools.
- Made agent and edit mode retry when the model describes a file change without calling a workspace tool.
- Made direct fix and edit requests require a workspace tool even when Ask mode is selected.
- Increased the per-request shared tool-call limit from 32 to 512.
- Recovered malformed multiline `ghost_apply_edit` calls and retried truncated tool JSON instead of showing it as the answer.
- Retried empty provider responses before stopping a workspace request.
- Added configurable temperature, Top P, Top K, Min P, presence penalty, and repeat penalty settings with value tooltips.
- Sent supported generation settings to Ollama, OpenAI-compatible, MLX/VLM, and inline completion requests.
- Made compact tool progress the default, with an option to show verbose tool arguments, results, timings, and previews.
- Repaired raw multiline JSON tool calls so compact `ghostapplyedit` calls continue executing instead of stopping as plain text.
- Changed generation defaults to the stable coding profile: temperature `0.3`, top P `0.9`, top K `20`, min P `0.05`, presence penalty `0`, and repeat penalty `1.05`.
- Added `OLLAMA_PARAMETERS.md` with parameter meanings, provider mappings, Modelfile examples, and tuning guidance.
- Added concise failure reasons to compact tool progress; successful commands remain short.
- Added chunked large-file reads, no-op edit detection, repeated-edit detection, and an eight-edit per-file safety limit.
- Reduced the per-batch tool-call limit from 512 to 128 so looping requests stop sooner.
- Increased tool-enabled response capacity to 4096 tokens and instructed Ghost to split large edits, preventing truncated JSON tool calls.
- Added green success and orange failure icons to compact tool progress.

## 1.0.67 - 2026-08-16

- Improved recovery of truncated or malformed Ollama file-write tool calls.
- Instructed models to emit tool calls without planning text before them.

## 1.0.66 - 2026-08-16

- Recovered malformed Ollama `ghost_write_file` JSON with raw multiline content so valid write requests execute instead of appearing as text.
- Strengthened the tool-call prompt to require escaped JSON strings.

## 1.0.65 - 2026-08-16

- Added Ctrl-N for a new conversation and Up/Down prompt history navigation.
- Saved prompt history per conversation, restored the latest prompt when reopening one, and added Previous/Next prompt buttons.

## 1.0.64 - 2026-08-16

- Made approved staged edits verify and persist the real workspace file after the approval click.
- Clarified file-tool approval button labels.

## 1.0.63 - 2026-08-16

- Routed the Ollama provider through Ollama's native API so agent file edits execute reliably.
- Kept OpenAI-compatible chat and completion requests on the explicit OpenAI API path.
- Routed inline completion through the native Ollama API.

## 1.0.58 - 2026-08-16

- Reworked file edit previews to stage changes directly in the real source editor instead of opening temporary `Ghost edit:` documents.
- Added `Accept Ghost edit` and `Reject Ghost edit` code lenses, safe save/reject handling, selected-hunk approval, and restore support.
- Improved local tool-call parsing for compact names such as `ghostapplyedit` and buffered tool-enabled responses so explanatory text cannot leak tool calls into the result.
- Added version-aware `publish.sh` VSIX publishing and documented the local build and publishing workflow.
- Improved the Settings panel with fixed Save/Close controls, scrollable content, prompt preset saving, and clearer global/workspace settings behavior.
- Refreshed the interface controls with Settings, History, and red delete icons, plus neutral context chips that do not resemble approval prompts.
- Updated the README with current editing, settings, persistence, UI, and publishing documentation.

## 1.0.43 - 2026-08-16

- Added Agent mode guidance so Ghost uses workspace tools to inspect files and implement requested changes instead of only describing them. File edits and terminal commands still require approval.
- Buffered Agent and Edit model turns so explanatory text before a JSON tool call cannot prevent Ghost from applying the requested change.
- Added validation and retry guidance for incomplete file and terminal tool calls, including missing paths and commands.
- Added shared pre-execution validation so malformed tool calls cannot reach file or terminal executors.
- Added executor-level fallback validation so missing tool arguments return a retryable result instead of a failed tool error.
- Made Agent mode the default workflow mode so requested code changes are implemented after approval.
- Reworked conversation history into a top-bar popup with search, conversation selection, rename, delete, and new conversation actions.
- Removed the conversation sidebar so the response area uses the full width.
- Kept the composer and status area fixed while only the response area scrolls.
- Added tool and open-file context tooltips with their full lists.
- Added the Ghost icon to the header and thinking status indicator.
- Added a fixed animated composer border with a traveling color blip while Ghost is working.
- Added animated Ghost status feedback and reduced-motion support.
- Replaced the empty response placeholder with “Ghost is thinking…”.
- Refreshed the README with badges, features, settings, privacy notes, tools, troubleshooting, and installation guidance.
- Added `PUBLISH.md` with Marketplace publisher setup, VSIX packaging, release, versioning, and CI publishing steps.
- Updated `package.json` for Marketplace publishing with the `MickyBalladelli` publisher, `Ghost Coding Assistant` display name, author metadata, and GitHub repository metadata.

## 1.0.12 - 2026-08-15

- Added versioned webview contract, request-state, persistence, tool, edit, provider, and extension-host tests.
- Added malformed stream, invalid UTF-8, retry, duplicate request, attachment, and multiline request coverage.
- Documented the interface, customization, privacy, troubleshooting, architecture, and clean-host release checks.

## 1.0.0 - 2026-08-15

- Added local Ollama and OpenAI-compatible model clients.
- Added MLX VLM provider support and provider detection.
- Added inline completion and the `@local` chat agent.
- Added workspace context, attachments, and local agent tools.
- Added provider settings, status bar diagnostics, tests, and VSIX packaging.
