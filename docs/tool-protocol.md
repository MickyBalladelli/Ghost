# Ghost tool protocol

Ghost tools are model-facing JSON calls executed by the extension host. The model may propose a tool call, but the host owns parsing, schema validation, workspace policy, approval, execution, output limits, and recovery. Never trust a model-provided path, command, diff, or status without validating it again.

## Tool call shape

The parser in `src/agent/toolCallParser.ts` accepts a direct object, a nested `tool_call`, `toolCall`, or `function` object, and fenced or surrounding explanatory text. Canonical calls look like:

```json
{
  "tool": "ghost_read_file",
  "arguments": {
    "path": "src/index.ts",
    "mode": "lines",
    "startLine": 1,
    "endLine": 120
  }
}
```

The parser normalizes safe aliases such as `read_file` → `ghost_read_file`, `ghostreadfile` → `ghost_read_file`, `filePath` → `path`, `contents` → `content`, and `cmd` → `command`. Aliases are an input compatibility feature; generated calls should use canonical names and fields.

Malformed JSON, unknown tools, truncated JSON, explanatory-only output, and empty output are separate parse states. `LocalToolCallStreamAssembler` stops at a complete object, suggests a split for very large arguments, and rejects streamed arguments above the policy maximum of 200,000 characters.

## Tool catalog

| Tool | Required input | Main limits and behavior | Approval |
| --- | --- | --- | --- |
| `ghost_read_file` | `path` | Head/tail/line/byte/symbol/match modes; line count max 400; output and safe-read limits apply | Safe by default |
| `ghost_search_workspace` | `query` | Query max 1,000 chars; max 200 results | Safe by default |
| `ghost_get_diagnostics` | None | Optional path/severity; max 200 results | Safe by default |
| `ghost_git_context` | `operation` | `status`, `diff`, `stagedDiff`, `branch`, or `history`; max 200 entries | Safe by default |
| `ghost_update_task_plan` | `steps` | 1–50 steps; bounded IDs, titles, evidence | Conversation state tool |
| `ghost_record_completion` | Four arrays | Each array has 0–100 strings; bounded string lengths | Conversation state tool |
| `ghost_write_file` | `path`, `content` | Full replacement; content may be empty; path must resolve inside a workspace | Approval-controlled |
| `ghost_apply_edit` | `path`, `hunks` | 1–50 sorted, non-overlapping hunks; expected content or per-hunk context required | Approval-controlled |
| `ghost_apply_transaction` | `edits` | 2–50 unique paths; each edit has exactly `content` or `hunks` | Approval-controlled |
| `ghost_run_terminal_command` | `command` | Workspace `cwd` only; command timeout and output ring limits apply | Approval-controlled |
| `ghost_list_directory` | `path` | Recursive pagination, cursor, page size 1–100, depth 0–10 | Safe by default |

The complete allowlist is `LOCAL_TOOL_NAMES` in `src/agent/toolCallParser.ts`. New tools must be added to the parser allowlist, schema validator, local executor, system/tool descriptions, approval policy, result limits, and tests together.

## Schema validation

`validateLocalToolCall()` runs before execution. Validation is deny-by-default:

1. The argument value must be an object.
2. Unknown fields are rejected.
3. Required strings must be non-empty and within their maximum length.
4. Paths are resolved through `resolveWorkspacePath()` and must stay inside a workspace root.
5. Booleans, integers, enums, arrays, and nested objects are checked by type and bounds.
6. Edit and transaction hunks are checked for line bounds, context types, SHA-256 format, and required conflict context.

Validation errors are returned as bounded tool results telling the model which field to correct. Validation never performs a partial write. The executor repeats validation even when a call arrived through another host path.

### Edit schema

Each hunk contains:

```json
{
  "startLine": 10,
  "endLine": 12,
  "replacement": "new text",
  "oldText": "current text",
  "oldHash": "optional 64-character SHA-256",
  "beforeContext": "optional nearby text",
  "afterContext": "optional nearby text"
}
```

Every hunk must provide `oldText`, `oldHash`, `beforeContext`, `afterContext`, or a complete `expectedContent` on the edit. Replacement content is bounded at 100,000 characters and each context field at 10,000 characters. Hunk ranges are one-based, sorted, and non-overlapping.

## Workspace and approval policy

`src/ui/ghostApprovalPolicy.ts` identifies file-edit tools, conversation-state tools, and tools that require approval. `GhostViewProvider` adds the configured allowlist, asklist, denylist, auto-accept scope, unsaved-editor checks, and request cancellation.

The effective decision is:

```text
invalid path/schema ───────────────► reject before approval
denylist or workspace violation ───► blocked
cancelled request ──────────────────► cancelled
safe tool with no ask policy ───────► run
file edit within auto-accept scope ─► run with expected snapshot
terminal/write/edit requiring ask ──► show approval and optional diff
```

File approvals can be once, current file, request, session, workspace, or always according to settings. Session and workspace approvals are host state, not model state. A pending approval stores the request ID, conversation ID, tool call ID, original call, expected snapshots, and a single resolver. `ApprovalRaceGuard` prevents two UI actions from executing the same decision.

Before execution, the host may create a diff preview and reads the expected file snapshots. If an editor has unsaved changes, the edit is rejected so disk content is not silently overwritten. Approval never makes an invalid or stale call valid; arguments are validated again after an edit dialog changes them.

## Execution and result contract

`LocalToolExecutor.execute()` returns a `ToolResult`, not an arbitrary string:

```ts
interface ToolResult {
  status: 'success' | 'no-op' | 'blocked' | 'denied' | 'cancelled' | 'failed'
  text: string
  exitCode?: number
  changedFiles: string[]
  bytes: number
  truncated: boolean
  warnings: string[]
  retryable: boolean
}
```

The result status is based on the structured executor outcome and bounded text. Errors become `failed` results with a retryability flag. Cancellation becomes `cancelled`; denied and policy-blocked actions do not report changed files. No-op edits report `no-op` and do not advance edit history as a successful change.

## Output truncation

`limitToolResultText()` applies per-tool character limits after execution and before the result is returned to the model. The current limits are:

| Tool group | Limit |
| --- | ---: |
| Read, search | 16,000 chars |
| Diagnostics, task plan, completion, directory | 12,000 chars |
| Write | 8,000 chars |
| Apply edit | 12,000 chars |
| Transaction | 16,000 chars |
| Git, terminal | 24,000 chars |

Truncated output includes the original UTF-8 byte count, a continuation instruction, a head, and a tail. The model must use the continuation hint instead of repeating the same request. File reads include line/byte range metadata and a next-chunk hint. Directory listings use a cursor and page size.

Terminal output is independently bounded by the terminal policy and retained as a tail ring while a process runs. Exit code and timeout metadata are preserved in the result.

## Budgets and retries

The request policy limits tool-enabled work to a minimum output budget of 4,096 model tokens, 128 tool rounds, 24 files, 4,000 changed lines, 1 MB changed bytes, 32 terminal commands, and 64,000 model tokens. Budget prompts ask the user to continue or stop when a limit is reached; the host does not silently break the request.

Provider connectivity failures may retry according to provider retry policy. Tool argument failures have bounded corrective retries. Stale edits may request a fresh read and rebase a limited number of times. Failed, denied, blocked, cancelled, and no-op results are sent back with their status so the agent can stop or choose a safe recovery.

The edit loop guard stops an identical, inverse, alternating, or overlapping edit to the same normalized path. Exact repeated file reads reuse the previous result during one request, preventing a model loop from consuming more budget.

## File edits and transactions

`fileMutationWorkflow.ts` centralizes path validation, snapshots, expected-content checks, diff application, atomic writes, and verification. `transactionWorkflow.ts` prepares every edit before writing any file, rejects duplicate paths, applies changed files one by one, verifies all results, and restores already-applied files if a later write fails.

The edit path is:

```text
parse → validate → resolve workspace path → read snapshot
  → approval/diff → compare expected content
  → apply in reverse hunk order → atomic write
  → read back and verify → report changed files
```

An edit that finds no change is a no-op. A stale snapshot produces a retryable conflict. A failed atomic write cleans temporary and backup files and restores the original content when necessary. A transaction rollback refuses to overwrite a file that changed during rollback.

## Adding or changing a tool

1. Define the canonical name and argument shape.
2. Add strict validation with bounds and workspace-path checks.
3. Add execution through `LocalToolExecutor` or the appropriate registered VS Code language-model tool.
4. Classify approval, policy, changed files, cancellation, and retryability.
5. Apply result limits and a useful continuation hint.
6. Add parser, schema, execution, failure, and integration tests.
7. Add a regression fixture when the change fixes a real failure.
8. Update the system tool description and this document.

Never use a terminal command to create or edit workspace files. File mutation must go through the reviewed file tools so expected snapshots, approval, atomic writes, and verification remain in force.

## Test map

- `toolCallParser.test.ts`: direct, nested, fenced, aliased, malformed, truncated, duplicate, and output-only model replies.
- `editWorkflow.test.ts` and `editSafety.test.ts`: hunk validation, hashes, context, overlap, loops, stale files, rollback, and approval races.
- `fileTools.test.ts`: bounded reads, UTF-8/CRLF, binary data, pagination, large files, and no-op writes.
- `fakeProviderIntegration.test.ts`: read → approve → edit → verify, provider retry, cancellation, empty output, and context compaction.
- `regressionFixtures.test.ts`: named real-failure cases under `src/test/fixtures/regressions/`.
- `budgetPolicy.test.ts` and `propertyFuzz.test.ts`: safety boundaries and malformed input invariants.
