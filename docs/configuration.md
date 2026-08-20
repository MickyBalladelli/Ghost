# Ghost configuration reference

<!-- Generated from package.json by `npm run docs:config`. Do not edit by hand. -->

Package version: `1.1.83`.

Defaults and descriptions below come from the VS Code extension manifest. The generator checks every manifest default against `DEFAULT_GHOST_SETTINGS` in `src/config.ts` and fails when they drift.

## Provider

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghost.ollamaUrl` | string | `http://localhost:11434` | Ollama server URL. |
| `ghost.openaiUrl` | string | `http://localhost:8001/v1` | OpenAI-compatible model server URL. |
| `ghost.openaiProfile` | string; one of `generic`, `anthropic`, `gemini`, `azure-openai`, `lm-studio`, `llama-cpp`, `vllm`, `litellm`, `custom` | `generic` | Compatibility profile used by the OpenAI-compatible provider. |
| `ghost.openaiApiVersion` | string | `2024-10-21` | Azure OpenAI API version. |
| `ghost.openaiCustomModelsPath` | string | `/v1/models` | Custom HTTP model discovery path. |
| `ghost.openaiCustomChatPath` | string | `/v1/chat/completions` | Custom HTTP chat request path. Supports {{model}} in the path. |
| `ghost.openaiCustomRequestTemplate` | string | `{"model":"{{model}}","messages":"{{messages}}","stream":"{{stream}}","temperature":"{{temperature}}","top_p":"{{topP}}","max_tokens":"{{maxTokens}}"}` | Custom HTTP JSON request template. Exact placeholders become typed JSON values. |
| `ghost.openaiCustomResponseFormat` | string; one of `openai-sse`, `json` | `openai-sse` | Custom HTTP response format. |
| `ghost.openaiApiKeyHeader` | string | `Authorization` | Header name used for the provider API key. The key value remains in VS Code SecretStorage. |
| `ghost.openaiApiKeyPrefix` | string | `Bearer` | Optional prefix for the provider API key header, such as Bearer. |
| `ghost.openaiOrganizationHeader` | string | `OpenAI-Organization` | Header name used for the optional organization identifier. |
| `ghost.openaiOrganization` | string | empty | Optional organization identifier sent to the OpenAI-compatible server. |
| `ghost.openaiProjectHeader` | string | `OpenAI-Project` | Header name used for the optional project identifier. |
| `ghost.openaiProject` | string | empty | Optional project identifier sent to the OpenAI-compatible server. |
| `ghost.openaiProxy` | string | empty | Optional HTTP or HTTPS proxy for OpenAI-compatible requests. Do not put credentials in this URL. |
| `ghost.openaiNoProxy` | string | `localhost,127.0.0.1,::1` | Comma- or space-separated hosts that bypass the OpenAI-compatible proxy. |
| `ghost.openaiTlsRejectUnauthorized` | boolean | `true` | Verify OpenAI-compatible HTTPS certificates. Disable only for a trusted development endpoint. |
| `ghost.openaiTlsCaFile` | string | empty | Optional path to a PEM CA file for OpenAI-compatible HTTPS. |
| `ghost.openaiTlsCertFile` | string | empty | Optional path to a client certificate PEM file for OpenAI-compatible HTTPS. |
| `ghost.openaiTlsKeyFile` | string | empty | Optional path to a client private key PEM file for OpenAI-compatible HTTPS. |
| `ghost.providerRequestTimeoutMinutes` | integer; min 1; max 1440 | `30` | Maximum minutes to wait for one chat request to return from the local model provider. |
| `ghost.provider` | string; one of `ollama`, `mlx-vlm`, `openai-compatible` | `ollama` | Ghost model provider. See the [provider parameter guide](https://github.com/MickyBalladelli/Ghost/blob/main/OLLAMA_PARAMETERS.md) for the settings each provider uses. |
| `ghost.mlxUrl` | string | `http://localhost:8000` | MLX VLM server URL. |

## Models and generation

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghost.chatModel` | string | `qwen2.5-coder:7b` | Model used for chat requests. |
| `ghost.autocompleteModel` | string | `qwen2.5-coder:1.5b` | Model used for inline code completions. |
| `ghost.inlineCompletionTimeoutMs` | integer; min 1000; max 120000 | `30000` | Maximum milliseconds to wait for one inline completion. |
| `ghost.seed` | integer; min 0 | not set | Optional deterministic generation seed when the provider supports it. |
| `ghost.stopSequences` | array | `[]` | Sequences that stop generation when the provider supports them. |
| `ghost.contextWindow` | integer; min 1 | not set | Optional provider context window. Ollama sends this as num_ctx. |
| `ghost.grammar` | string | empty | Optional provider grammar constraint, when supported. |
| `ghost.jsonMode` | boolean | `false` | Request JSON object responses from providers that support JSON mode when native tools are not active. |
| `ghost.modelProfile` | string | empty | Active named model profile. Leave empty to use the normal Ghost settings. |
| `ghost.modelAliases` | object | `{}` | Map friendly model aliases to provider model IDs, for example {"fast": "qwen2.5-coder:1.5b"}. |
| `ghost.modelProfiles` | object | `{}` | Named model profiles. Each profile can select different chat, agent, vision, and autocomplete models plus generation settings. |
| `ghost.maxContextTokens` | integer; min 1 | `8192` | Maximum number of context tokens sent to the model. |
| `ghost.enableInlineCompletions` | boolean | `true` | Enable Ghost inline code completions. |
| `ghost.temperature` | number; min 0; max 2 | `0.3` | Sampling temperature for chat responses. |
| `ghost.topP` | number; min 0; max 1 | `0.9` | Nucleus sampling: keep tokens within this cumulative probability. |
| `ghost.topK` | number; min 0 | `20` | Keep only the top K likely tokens. Lower values are more focused. |
| `ghost.minP` | number; min 0; max 1 | `0.05` | Discard tokens below this probability relative to the most likely token. |
| `ghost.presencePenalty` | number; min -2; max 2 | `0` | Penalize tokens that already appeared. Positive values encourage new topics. |
| `ghost.repeatPenalty` | number; min 0; max 3 | `1.05` | Penalize repeated text. Values above 1 penalize repetition more strongly. |
| `ghost.responseLength` | string; one of `short`, `balanced`, `long`, `unlimited` | `balanced` | Default response length for the Ghost interface. |

## Agent safety

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghost.requestTimeLimitMinutes` | integer; min 1; max 1440 | `120` | Maximum minutes a local Ghost request may run before its safety budget stops it. |
| `ghost.mode` | string; one of `ask`, `edit`, `agent`, `explain`, `inline` | `agent` | Default workflow mode for the Ghost interface. |
| `ghost.fileEditApproval` | string; one of `confirm`, `auto` | `confirm` | Default approval behavior for Ghost file writes and structured edits. |
| `ghost.autoAcceptScope` | string; one of `confirm`, `one-edit`, `current-file`, `request`, `session`, `workspace`, `always` | `confirm` | Scope for automatic file-edit approval. Terminal and other dangerous tools always require explicit approval. |

## Persistence and diagnostics

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghost.enableConversationPersistence` | boolean | `false` | Persist Ghost conversations and preferences in VS Code storage. Disable to keep chat history in memory only. |
| `ghost.enableDebugLogging` | boolean | `false` | Legacy setting. Use ghost.logLevel instead. |
| `ghost.logLevel` | string; one of `off`, `error`, `warn`, `info`, `debug` | `off` | Local-only Ghost log level. Logs appear in the Ghost Logs output channel and never include detected secrets. |

## Advanced

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ghost.settingsSchemaVersion` | integer | `2` | Internal Ghost settings schema version. Ghost migrates older settings automatically. |
| `ghost.toolAllowlist` | array | `["ghost_read_file","ghost_search_workspace","ghost_get_diagnostics","ghost_git_context","ghost_update_task_plan","ghost_record_completion","ghost_write_file","ghost_apply_edit","ghost_apply_transaction","ghost_run_terminal_command","ghost_list_directory"]` | Tools Ghost may use automatically. Tools not allowed here ask for approval unless denied. |
| `ghost.toolAsklist` | array | `[]` | Tools Ghost must ask about before use. Deny rules override this list. |
| `ghost.toolDenylist` | array | `[]` | Tools Ghost must never use. Deny rules override allow and ask rules. |
| `ghost.terminalEnvironmentAllowlist` | array | `["PATH","HOME","USER","USERNAME","SHELL","ComSpec","SystemRoot","TMPDIR","TMP","TEMP","LANG","LC_ALL","TERM","CI","PWD"]` | Environment variables Ghost passes to approved terminal commands without asking. Secret-looking names are always excluded. |
| `ghost.terminalEnvironmentAsklist` | array | `[]` | Environment variables Ghost passes to approved terminal commands after asking. Secret-looking names are always excluded. |
