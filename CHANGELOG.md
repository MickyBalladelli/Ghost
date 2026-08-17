# Changelog

All notable changes to this extension are documented here.

## 1.0.85 - 2026-08-17

- Added realpath and symlink boundary checks for workspace paths, including multi-root and missing-root handling.
- Added password-prompted provider API keys in VS Code SecretStorage for Ollama, MLX/VLM, and OpenAI-compatible requests.
- Kept provider credentials out of settings, webviews, URLs, logs, exports, and persisted conversations.
- Expanded secret redaction for model context, webview messages, diagnostics, persistence, and exports, including URLs, headers, cookies, cloud keys, JWTs, and private keys.

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
