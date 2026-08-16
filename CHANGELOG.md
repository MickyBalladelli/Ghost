# Changelog

All notable changes to this extension are documented here.

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
