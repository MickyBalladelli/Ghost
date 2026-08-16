# Changelog

All notable changes to this extension are documented here.

## 1.0.43 - 2026-08-16

- Added Agent mode guidance so Ghost uses workspace tools to inspect files and implement requested changes instead of only describing them. File edits and terminal commands still require approval.
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
