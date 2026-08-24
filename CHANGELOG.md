# Changelog

All notable changes to this extension are documented here.
## 1.2.9 - 2026-08-24


## 1.2.8 - 2026-08-23
- Tell OpenCode to use its edit or write tools for file changes instead of bash.

## 1.2.7 - 2026-08-22
- Tell OpenCode to use its edit or write tools for file changes instead of bash.
- Fix conversation deletion in the VS Code webview by using an in-app confirmation dialog.
- Preserve structured OpenCode session errors so Ghost does not replace the provider's real cause with a generic failure.
- Preserve the message-pane position when an approval card is replaced after a tool decision.
- Add a read-only Plan workflow with structured task plans and an Implement plan handoff to Agent.
- Show and answer OpenCode question-tool prompts with selectable options and custom answers.
- Treat OpenCode tool errors as failed requests and preserve their error detail.
- Keep the message pane still when approval updates arrive while the user is scrolled up.
- Restore the message pane position after approval markup updates reset the scroll container.
- Explain when Ghost, rather than the user, automatically blocks an OpenCode permission.
- Update approval cards in place without rebuilding the message pane.
- Avoid optimistic approval redraws until the provider returns the real tool result.
- Build the restored result pane once on reload so it performs one downward scroll without bouncing.
- Keep the result pane at the bottom when submitting a new request instead of exposing its temporary top position.
- Scope reused OpenCode sessions to each Ghost conversation so new chats do not inherit unrelated provider context.
- Bind cached conversation state to a project fingerprint so opening Ghost in another project starts with that project's history only.


## 1.2.6 - 2026-08-22

- Raise the default agent request time limit from 60 to 180 minutes.


## 1.2.5 - 2026-08-22

- Store Ghost's OpenCode safety defaults in the global `~/.config/opencode/opencode.json` instead of the project root.
- Stop patching OpenCode's project config API, which could recreate a workspace-local `opencode.json`.
- Keep the Provider selector wide enough and wrap Refresh models in narrow layouts.
- Order the workflow menu as Agent, Ask, Edit, Explain.
- Place Search, Up, and Down beside Send in the composer footer.
- Shorten the Agent workflow label and reduce the workflow selector width.
- Give Send an icon and make the composer action buttons matching squares.
- Round the composer search icon.
- Restore prompt history from older conversation messages and keep Search available when history is empty.
- Restore the immediate webview conversation snapshot after VS Code refreshes.
- Add the root `update-version.sh` helper for patch version bumps.
- Separate inline completion from chat workflow modes and add an Enable inline completion setting.
- Move the chat workflow selector into the composer footer beside Send.


## 1.2.3 - 2026-08-2
- Keep the viewport in place after approving a tool, and focus only a later pending approval instead of jumping to an older card.
- Remember completed first-run setup globally, independent of conversation-history persistence, so the setup dialog stays dismissed across projects and reloads.
- Restore saved conversations on reload, keep autosave enabled by default, and support history search, rename, duplicate, branch, and delete management.
- Give the model selector extra width for long model names.
- Keep the active request's latest message scrolled into view.
- Raise the default agent request time limit to 60 minutes.
- Sort OpenCode free models before other models and show pricing metadata on hover.
- Replace the asymmetric settings gear path with a symmetric round gear.
- Save the settings gear as a standalone SVG for easy viewing.
- Put Settings beside the provider collapse button, move Refresh models beside Provider, and remove Quick switch.
- Replace the model dropdown with an accessible searchable combobox that filters models while typing and supports mouse, arrow-key, and Enter selection.
- Keep a healthy OpenCode session running when its long-lived message HTTP call closes or times out, wait for the session idle event, and recover the final assistant response instead of failing with `fetch failed`.


## 1.2.2 - 2026-08-22

- Settings update for OpenCode
- Keep response text, progress, tools, approvals, results, and plan updates in chronological order so the newest request activity stays at the bottom.
- Attach completion evidence to its request and distinguish completed tasks, unfinished work, unverified changes, completed responses, and stopped requests.
- Finish Ghost requests when OpenCode reports an active session has become idle, recover the persisted final answer if the message HTTP call stays open, and explicitly close the event reader.
- Prevent the settings gear from being clipped in the provider control strip.
- Show only settings OpenCode can use, expose its username, agent, session reuse, and password controls, and stop sending unsupported sampling/profile options to OpenCode requests.

## 1.2.1 - 2026-08-21

- Show OpenCode permission requests as readable inline Ghost approval cards, with once or session scope, instead of intrusive raw-JSON dialogs.
- Add project-level OpenCode permission defaults for guarded edits, shell commands, and external directories.
- Create safe OpenCode project permissions automatically when a user's workspace has no `opencode.json`.
- Apply and verify OpenCode permission defaults through the live project config API so newly created config works without restarting the server.
- Keep unchanged provider polls from redrawing the webview, preserving text selection and input focus.
- Poll provider health every 2 seconds while Ghost is open, detecting both reconnection and disconnection.
- Fix OpenCode model discovery in the provider controls. OpenCode models no longer fall back to the model selected for another provider.
- Add OpenCode 1.x as a delegated-agent provider through a user-managed `opencode serve`: typed health/model/agent/session APIs, Basic Auth in SecretStorage, serialized workspace-scoped session reuse, SSE permission handling, streamed tool progress, final diff checks, cancellation/abort, and new/select/rename/fork/delete session commands.
- Guard OpenCode with Ghost workspace containment and allow/ask/deny policy. OpenCode requests require `edit`, `bash`, and `external_directory` to be guarded, reject mutations in Ask/Explain mode, and never start or stop the user's server. Document the decision not to ship the opposite-direction MCP bridge.
- Add fast tests for conversational prompts, agent stop policy, terminal audit/cwd jail, and the one-edit plus failed-read regressions. Move endpoint, redaction, and tool-result-limit helpers into `test:fast`. Document the first-run VS Code download for host tests.
- Extract Ghost webview CSS to `src/webview/ghostWebview.css` and keep the CSP nonce on the stylesheet link.
- Share protocol unions and tool names through `ghostProtocolTypes.ts` so the webview uses `autoAcceptScope` as the real setting.
- Remove leftover Hello World. Rename provider health to `ghost.checkProviderStatus` with a `checkOllamaStatus` alias. Register Accept/Reject staged-edit commands.
- Drop unused ESLint and migrate HTTP transport from `node-fetch@2` to native fetch, keeping proxy/TLS agents.
- Watch both the extension host and webview, including CSS copy. Trim implied `activationEvents`.
- Resolve listing, search, git, and relative paths against the owning multi-root folder.
- Harden staged-edit restore against dirty/external changes, label transaction previews as text-only, and distinguish agent time-limit stops from provider HTTP timeouts.
- Default the webview tool allowlist to Ghost's tools before host state arrives.

- Shrink the always-on agent system prompt and keep JSON tool schemas for models without native tools.
- Scale the tool output reserve from context size (25%, min 1024, max 4096) instead of reserving 4096 tokens on every 8k model.
- Demand workspace tools only for explicit edit intent, not isolated verbs like add or change.
- Mirror native Ollama tool schemas to the validators, including hunk context and read modes.
- Enable Ollama native tools only when model metadata reports tool support; remind one-tool-per-turn after a parse failure.
- Treat no-op edits as success when the replacement is already in the file, and keep the agent loop running.
- Mark task-plan and completion-record tools as optional bookkeeping, required only after files actually changed.
- Invalidate reused file reads when the editor version or disk mtime changes.
- Explain Ask vs Edit vs Agent and write approvals in first-run setup.
- Do not exit the agent loop after streamed prose when the same turn still has a tool call.
- Document that Agent mode is unreliable on MLX/VLM because that provider has no native tool calling.
- Stop claiming a GitHub Actions matrix, Dependabot, and `.github/workflows/ci.yml` in release docs. Local compile, tests, `npm run package`, and Marketplace verification are the release gates.
- Stop `create-vsix.sh` from bumping the patch version on every local install. Packaging now uses the current `package.json` version, syncs README/`docs/release.md` on `npm version`, and runs `release:check` after `npm run package`.
- Skip inline completion for MLX/VLM instead of sending FIM requests to Ollama.
- Track edit-loop state by the canonical workspace path so `src/app.ts` and the absolute file are the same file.
- Allow overlapping follow-up edits to the same lines when the fingerprint is new. Repeated and inverse hunks still stop the request.
- Keep the agent running after a failed read, search, or directory listing so it can list the tree and try another path. Denied, blocked, cancelled, and failed file edits still stop the request.
- Enforce Ghost tool allow/ask/deny on registered Language Model tools, so Deny blocks Copilot and other clients as well as the Ghost view.
- Apply Ghost tool permissions, denylist, and auto-accept policy to the `@local` chat participant.
- Auto-accept one edit only for the next file mutation, then ask again.
- Keep Session auto-accept in memory for the current Ghost session instead of treating a stored `session` setting as always-on.
- Match Current file auto-accept across relative, `./`, and absolute paths for the same workspace file.
- Migrate leftover `fileEditApproval: auto` to request-scoped auto-accept instead of always.
- Add a current, prioritized `TODO.md` from a full-project review of quality, agent execution, bugs, tests, and release process.

## 1.1.95 - 2026-08-21

- Start idle eye wandering one second after pointer movement stops.
- Show elapsed time for each tool section and grouped tool calls.

## 1.1.94 - 2026-08-21

- Reduce the default Ghost and provider request timeout to 15 minutes.
- Keep the provider timeout active while consuming streaming response bodies.

## 1.1.93 - 2026-08-21

- Stop repeated edit and task-plan loops after the workspace change is already complete.

## 1.1.92 - 2026-08-20

- Preserve successful workspace changes when the model emits invalid follow-up tool arguments.

## 1.1.90 - 2026-08-20

- Rebase multi-hunk edits by exact text, context, and nearest line position.

## 1.1.89 - 2026-08-20

- Force fresh workspace reads during tool inspection and edit validation.

## 1.1.88 - 2026-08-20

- Improve stale edit recovery, exact-text rebasing, and failed tool status reporting.

## 1.1.87 - 2026-08-20

- Recover stale edits with correctly labeled tool results and report only successfully changed files.

## 1.1.86 - 2026-08-20

- Render tool and progress logs before the assistant conclusion.
- Keep workspace tools enabled for short confirmations of pending edit tasks.

## 1.1.85 - 2026-08-20

- Preserve bounded conversation history between Ghost prompts so short follow-ups like "yes" retain context.

## 1.1.84 - 2026-08-20

- Remove the duplicate tool-result copy action so each tool message shows only one copy control.

## 1.1.83 - 2026-08-20

- Make local provider chat timeout configurable, defaulting to 30 minutes instead of the previous hard-coded 5-minute limit.

## 1.1.82 - 2026-08-20

- Add idle eye wandering when the pointer leaves the webview.

## 1.1.79 - 2026-08-20

- Restore pointer-following eyes using the new Ghost icon face.
- Halve result-area status and task-plan icon sizes while keeping the top and bottom Ghost icons unchanged.

## 1.1.78 - 2026-08-20

- Keep live progress and approval sections in one current block, preventing stale approval cards from appearing before newer progress output or after session approval.
- Hide Send while a request is running so Stop is the only visible composer action.
- Accept valid edits from CRLF files without converting their line endings.
- Rebase an edit when its exact old text moved to one unambiguous line range.
- Reduce tool approval choices to Approve now, Approve for session, and Approve forever; persist forever approvals.
- Show a retried tool group as successful when its latest attempt succeeds.
- Continue workspace work after displaying an unfinished task plan.
- Make task and tool status icons easier to see.
- Increase status icon size and contrast.
- Double status icon size again for clear visibility.
- Double the Ghost logo size in the top header.
- Keep the Ghost eyes still instead of following the pointer.
- Remove the duplicate CSS eyes layered over the logo image.

## 1.1.64 - 2026-08-19

- Keep “Ghost is thinking…” after the assistant output and approval section.

## 1.1.62 - 2026-08-19

- Keep partial tool JSON and pre-tool planning text out of the visible response while streamed tool calls are being assembled.
- Place approval and tool-progress sections after assistant output so new output and approval stay at the bottom.

## 1.1.61 - 2026-08-19

- Continue workspace requests when the model streams a planning sentence instead of calling a tool, so Ghost can recover and request the required file operation.

## 1.1.60 - 2026-08-19

- Add clear collapse/expand buttons for the provider controls and provider settings areas, with a top-aligned chevron toggle.
- Align Provider, Model, and Profile labels above their controls and allow provider status text to wrap fully.
- Stack the Provider, Model, and Profile fields vertically.
- Wrap those label/select groups together, keeping them on one row when space allows.

## 1.1.53 - 2026-08-19

- Reject incomplete symbol and matching-file reads before execution, so Ghost can repair the tool call instead of stopping.

## 1.1.52 - 2026-08-19

- Refresh models after the provider setting is applied and select a model returned by the new provider.

## 1.1.51 - 2026-08-19

- Restore the three provider choices whenever the controls render.

## 1.1.50 - 2026-08-19

- Retry missing workspace paths with relative-path guidance instead of stopping the request.
- Keep directory tool results and continuation paths workspace-relative.
- Remove the duplicate active-request action card; use the bottom Stop control.

## 1.1.47 - 2026-08-18

- Keep the conversation pinned to the latest message during streaming updates.
- Keep successful completion records from appearing as failed when their checks mention errors.
- Show completion records only for successfully completed workspace tasks.
- Clear cached file reads before retrying a stale edit so rebase recovery reads current workspace content.

- Allow slow local models up to five minutes to start returning provider output before timing out.

## 1.1.46 - 2026-08-18

- Keep message action buttons out of the conversation rerender lookup so final replies cannot be replaced by Branch or Edit buttons.

## 1.1.44 - 2026-08-18

- Keep startup persistence from replacing state while a request is active.
- Refresh message action buttons during live response updates.
- Disable automatic conversation restoration so live messages are never replaced by saved state.
- Ignore unmarked reset or clear messages so Ghost cannot silently remove conversation content.

## 1.1.43 - 2026-08-18

- Prevent a delayed startup persistence snapshot from replacing a live conversation and clearing a visible reply.
- Keep startup persistence from replacing state while a request is active.
- Refresh message action buttons during live response updates.

## 1.1.42 - 2026-08-18

- Detect hidden or whitespace-only provider output before accepting a reply.
- Use a small no-tools request for ordinary conversation such as greetings.
- Do not show a fallback completion record for ordinary chat replies.
- Preserve visible assistant output during completion and rerender updates.
- Keep completion records below the conversation output.
- Ignore late empty persistence snapshots so completed test output cannot be wiped.
- Do not save or replace conversation state when finishing first-run setup.
- Do not write an empty webview state on every render when persistence is disabled.
- Never replace a live transcript with an empty startup persistence snapshot.
- Make the Send button use the same submit path as Enter.

## 1.1.28 - 2026-08-18

- Make the initial model test a tool-free chat check without a completion-record warning.
- Create a clean completion record when a completed response omits the bookkeeping tool call.
- Show the initial test reply in the conversation before reopening setup.
- Add a Ghost: Open setup command for reopening setup after closing it.
- Keep the completion tool out of ordinary chat so simple questions receive a normal reply.
- Retry once when a conversational model turn returns no visible text.
- Detect hidden or whitespace-only provider output before accepting a reply.

## 1.1.27 - 2026-08-18

- Keep Stop and Send inside the prompt composer on narrow panels.

## 1.1.26 - 2026-08-18

- Show discovered model names as readable, non-interactive text in first-run setup.

## 1.1.25 - 2026-08-18

- Keep extension-host output CommonJS while compiling webview files as browser JavaScript.

## 1.1.23 - 2026-08-18

- Compile webview scripts as browser JavaScript instead of CommonJS so the Ghost panel can start after VSIX installation.

## 1.1.21 - 2026-08-18

- Keep activation working when VS Code has not refreshed newly registered settings during a VSIX update.

## 1.1.19 - 2026-08-18

- Add a provider/model quick switcher with connection diagnostics, refresh, and copy controls.
- Add searchable settings sections for Generation, Provider, Agent Safety, Appearance, Persistence, and Advanced options.
- Add built-in Coding, Balanced, and Creative model profiles with effective-value display and restore defaults.
- Add a first-run setup flow with provider checks, model discovery, capability notes, and an optional test request.
- Improve accessibility with VS Code theme variables, forced-colors styling, reduced-motion handling, screen-reader status updates, and modal keyboard focus trapping.
- Add accessibility contract checks for modal semantics, button names, live status regions, contrast mode, focus styling, and keyboard paths.
- Separate plain-Node fast tests from VS Code extension-host tests, with CI running compile and fast tests on every push and pull request.
- Expand CI with VS Code host tests on Linux, macOS, and Windows, plus VSIX packaging, install smoke testing, and artifact upload.
- Add dependency security auditing, grouped weekly Dependabot updates, and review policy for compiler, provider, packaging, and test tooling dependencies.
- Add named regression fixtures for malformed shader edits, missing files, empty provider output, failed applies, truncated tool arguments, and repeated edits.
- Expand architecture documentation with state ownership, request/approval/provider sequence diagrams, persistence schema, and failure recovery paths.
- Add provider adapter documentation for capabilities, request builders, streaming, errors, authentication, and new provider integration.
- Add tool protocol documentation for schemas, validation, approvals, retries, truncation, edits, transactions, and verification.
- Add release documentation covering versioning, changelog updates, checks, packaging, VSIX smoke tests, publishing, and rollback.
- Update README with current model profiles, provider capabilities, tool limits, approval scopes, persistence/privacy behavior, and failed-edit troubleshooting.
- Link the Ollama parameter guide from README, VS Code settings, and the Ghost settings panel, with provider-specific generation mappings.
- Add a user FAQ for model setup, provider URLs, images, auto-accept, tool failures, context limits, and disk usage.
- Add a generated configuration reference and drift check for package.json and src/config.ts defaults.
- Refresh PUBLISH.md with the current extension identity, Marketplace ID, versioned artifact, and release commands.
- Make local VSIX build and publish helpers derive the artifact name and version from package.json.
- Add a release consistency check for package metadata, README, changelog, and embedded VSIX manifests.
- Archive old root VSIX artifacts before package builds so release outputs do not accumulate.
- Mark the original TODO1 checklist as historical and move it to `archives/TODO1-historical.md`.
- Add editor and line-ending rules, plus ignore coverage for generated output, logs, caches, secrets, archives, and local model files.
- Add dependency review automation and a weekly, monthly, quarterly, and security-update review cadence.
- Add GitHub issue templates for provider bugs, failed edits, security reports, and performance reports.
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
- Group tool, agent, provider, persistence, protocol, and context limits in one shared policy module.
- Add shared Ghost error codes and error classes across provider, tool, persistence, approval, and UI boundaries.
- Add file-tool tests for chunked reads, line ranges, UTF-8/CRLF files, binary detection, large files, directory pagination, and no-op writes.
- Add edit-safety tests for stale conflicts, edit loops, multi-file rollback, and approval races.
- Add parser tests for malformed and truncated tool calls, multiple calls, unknown names, invalid schemas, and output-only replies.
- Add pure tests for the 4096-token tool budget minimum and 128-call safety boundary.
- Add provider request fixtures for OpenAI-compatible, Ollama, MLX, and image payloads with unsupported fields omitted.
- Add fake-provider integration tests for file edits, retries, cancellation, empty output, and context compaction.
- Add webview accessibility tests for focus traps, approval shortcuts, status presentation, live regions, history, and reduced motion.
- Add deterministic property and fuzz coverage for tool parsing, edits, protocol messages, redaction, and endpoints.
- Add Ghost settings schema versioning with activation-time migrations for legacy approval and debug settings.
- Add injectable runtime dependencies for clocks, process runners, filesystems, storage, webview messaging, and local tool execution.
- Add disposal ownership for Ghost state, request orchestration, provider transports, provider clients, secrets, workspace caches, and view lifecycle.
- Add fast helper tests for settings migrations, endpoints, provider capabilities, redaction, workspace paths, edits, and tool-result limits.

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
