# Ghost interface architecture

## Runtime shape

Ghost has two parts:

1. The VS Code extension host owns provider requests, workspace context, persistence, tools, approvals, and file operations.
2. The webview owns the chat screen, conversation selection, composer controls, rendering, and short-lived UI state.

The webview and extension host communicate with versioned messages from `src/ui/ghostProtocol.ts`. Every request carries a request ID and conversation ID. Stream events carry increasing sequence numbers so stale or duplicate events can be ignored.

```text
Webview composer
    │ submit / settings / approval
    ▼
GhostViewProvider
    ├── context collection
    ├── request lifecycle and cancellation
    ├── persistence and redaction
    ├── tool approval and edit recovery
    ▼
Agent controller
    ├── Ollama / OpenAI-compatible client
    └── MLX VLM client
    │ streamed progress, text, tools, errors
    ▼
Webview conversation renderer
```

## Request lifecycle

Requests move through preparing, connecting, thinking, streaming, waiting-for-approval, and a terminal completed, cancelled, or failed state. `src/ui/requestState.ts` is the shared transition policy used by the host and unit-tested independently.

Provider streams tolerate incomplete JSON/SSE records and stop safely on invalid UTF-8. Recoverable provider failures retry with bounded backoff. The webview stores recoverable state before reload and marks interrupted requests as failed instead of leaving them active forever.

## Tools and edits

Read and directory tools can run under the workspace policy. File writes, structured edits, and terminal commands require approval unless already approved for the session. Structured edits produce a diff preview, check expected file content before applying, and retain enough information to restore an applied change.

## Persistence and privacy

Persistence is opt-in. Global storage holds preferences, presets, and prompt history. Workspace storage holds conversations and the active conversation ID. State is schema-versioned and migrated before use. Secrets are redacted before storage, export, diagnostics, and display.

## Testing map

- `src/test/suite/protocol.test.ts`: webview message validation and size limits.
- `src/test/suite/requestState.test.ts`: request state transitions.
- `src/test/suite/persistenceModel.test.ts`: prompt history and storage migration.
- `src/test/suite/ollamaClient.test.ts` and `providerResilience.test.ts`: stream parsing, endpoint fallback, disconnects, empty responses, and invalid UTF-8.
- `src/test/suite/toolCallParser.test.ts` and `editWorkflow.test.ts`: tool calls and reviewed edits.
- `src/test/suite/webviewIntegration.test.ts`: accessible webview markup, multiline requests, attachments, lifecycle events, and duplicate request protection.

Run `npm run compile` for a type check. Run `npm test` in a VS Code-capable environment for the extension-host suite.
