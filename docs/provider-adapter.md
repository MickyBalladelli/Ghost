# Provider adapter guide

Ghost hides provider wire formats behind one adapter contract. The agent and inline completion code should depend on `ProviderAdapter` or provider-neutral types from `src/services/chatTypes.ts`, not on Ollama, MLX, or OpenAI response shapes.

## Runtime layers

```text
Chat participant / inline completion
             │ ChatRequestOptions
             ▼
        LlmFactory
             │ resolves provider, client, adapter, and model
             ▼
      ProviderAdapter
             │ common chat, stream, events, FIM, models, health
             ▼
       ProviderClient
             │ provider-specific HTTP and stream parsing
             ▼
 Ollama / MLX / OpenAI-compatible server
```

- `src/services/llmFactory.ts` selects the configured provider, caches adapters, selects an available model, and disposes clients.
- `src/services/providerAdapter.ts` defines the common interface, capability defaults, and error normalization.
- `src/services/ollamaClient.ts`, `src/services/mlxClient.ts`, and `src/services/profiledProviderClient.ts` implement provider clients.
- `src/services/providerRequestBuilders.ts` creates provider-specific request bodies.
- `src/services/providerTransport.ts` and `src/services/providerRequest.ts` own timeout, abort, retry, proxy, and HTTP diagnostics.

## Adapter contract

`ProviderClient` is the minimum client dependency:

```ts
interface ProviderClient {
  checkHealth(timeoutMs?: number): Promise<boolean>
  listModels?(signal?: AbortSignal): Promise<string[]>
  streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string>
  streamChatEvents?(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent>
  fetchFimCompletion?(options: FimCompletionOptions): Promise<string>
  dispose?(): void
}
```

`createProviderAdapter(provider, client)` exposes the stable contract used by callers:

```ts
interface ProviderAdapter {
  provider: ProviderId
  capabilities(model?: string): ModelCapabilityRecord
  chat(options: ChatRequestOptions): Promise<string>
  stream(options: ChatRequestOptions): AsyncGenerator<string>
  streamEvents(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent>
  fim(options: FimCompletionOptions): Promise<string>
  listModels(signal?: AbortSignal): Promise<string[]>
  health(timeoutMs?: number, signal?: AbortSignal): Promise<boolean>
  normalizeError(error: unknown): ProviderError
}
```

The adapter catches client failures and converts them to `ProviderError`. Optional client methods have safe defaults: missing model discovery returns an empty list, missing event streaming falls back to text chunks, and missing FIM support produces a non-retryable invalid-request error.

## Provider capabilities

Capability values are defaults in `providerAdapter.ts`. A client without `fetchFimCompletion` automatically reports `supportsFIM: false`.

| Provider | Native API | Tools | JSON mode | Vision | FIM | Sampling |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `ollama` | Ollama | Yes | Yes | Yes | Client-dependent | temperature, top P/K, min P, presence, repeat |
| `mlx-vlm` | MLX OpenAI-compatible chat | No | No | Yes | No | temperature, top P, presence |
| `openai-compatible` | OpenAI chat completions | Yes | Yes | No by default | Client-dependent | temperature, top P, presence |

All providers default to a 32,768-token context window, an 8,192-token output limit, and streaming enabled. Model metadata can refine the displayed capability record, but a request builder must still omit unsupported fields.

## Provider-neutral request types

Use `ChatRequestOptions` for chat and `FimCompletionOptions` for fill-in-the-middle. Messages use common roles and content parts:

- text content is a string or typed text part;
- image content uses an image URL/data URL with optional detail;
- tools use the common function definition shape;
- generation settings use camelCase names such as `topP`, `maxTokens`, and `contextWindow`.

The agent decides whether tools, JSON output, images, or FIM are needed from the capability record. If the selected provider does not support a requested feature, fail with a clear user-facing error before sending an invalid request.

## Request builders

`providerRequestBuilders.ts` is the only place where common generation fields become wire fields.

| Common field | Ollama | MLX | OpenAI chat | OpenAI Responses |
| --- | --- | --- | --- | --- |
| `topP` | `options.top_p` | `top_p` | `top_p` | `top_p` |
| `topK` | `options.top_k` | omitted | omitted | omitted |
| `minP` | `options.min_p` | omitted | omitted | omitted |
| `presencePenalty` | `options.presence_penalty` | `presence_penalty` | `presence_penalty` | omitted |
| `repeatPenalty` | `options.repeat_penalty` | omitted | omitted | omitted |
| `maxTokens` | `options.num_predict` | `max_tokens` | `max_tokens` | `max_output_tokens` |
| `contextWindow` | `options.num_ctx` | provider-specific/default | provider-specific/default | provider-specific/default |

Undefined settings are omitted. Do not add a provider-only field to `ChatRequestOptions`; add it to the selected builder and cover it with a request fixture.

Ollama messages flatten common content into `role`, `content`, and optional base64 `images`. OpenAI-compatible messages retain provider-neutral text/image content. MLX uses the OpenAI chat-completions message shape. OpenAI profiles may select chat completions, Responses, Anthropic, Gemini, Azure, LM Studio, llama.cpp, vLLM, LiteLLM, or a custom endpoint/template; profile-specific parsing stays inside `profiledProviderClient.ts`.

## Streaming and tool calls

Clients normalize wire output into text or `ChatStreamEvent` values:

- Ollama native responses are newline-delimited JSON. The parser buffers a partial line, extracts text or a function call, and stops at `done`.
- MLX and OpenAI-compatible streams use SSE. The parser buffers incomplete events, ignores keep-alives and `[DONE]`, and extracts text deltas or function calls.
- Malformed individual events are ignored when the stream can continue. Invalid UTF-8 terminates the stream safely instead of emitting corrupted text.
- A native function call is converted to the Ghost tool JSON contract before it reaches `toolCallParser.ts`.

The adapter's `stream()` is for normalized text chunks. `streamEvents()` preserves typed text and tool-call events when a client supports them, and otherwise wraps each text chunk as `{ type: 'text', text }`.

## Errors, retries, and cancellation

`normalizeProviderError()` maps failures to these codes:

| Condition | Code | Retryable |
| --- | --- | ---: |
| Abort or cancellation | `cancelled` | No |
| Timeout | `timeout` | Yes |
| Network, DNS, socket, or offline failure | `network` | Yes |
| HTTP 429 | `rate-limit` | Yes |
| HTTP 401/403 | `auth` | No |
| HTTP 400/422 | `invalid-request` | No |
| Other HTTP status | `http` | Depends on status |
| Unknown failure | `unknown` | No |

`requestWithRetry()` retries retryable statuses (408, 409, 425, 429, and 5xx) and transient network failures with bounded exponential delay. `Retry-After` and rate-limit reset headers are honored up to the policy maximum. Every request receives an abort signal and timeout. A caller cancelling the signal must stop both the HTTP request and retry backoff.

Provider errors preserve provider ID, status, retry-after metadata, and a causal error for logs. User-facing messages are bounded and redacted by the host before they reach the webview.

## Authentication and transport

Provider secrets come from VS Code secret storage. Clients add provider-specific authentication headers at request time; keys never enter `ChatRequestOptions`, persisted conversations, or webview messages. OpenAI-compatible profiles also control organization/project headers, custom API-key headers, proxy, no-proxy, and TLS certificate settings.

`ProviderHttpTransport` supplies keep-alive agents, timeout/abort handling, proxy support, and diagnostics. Keep transport concerns out of provider parsing code. A provider client should only resolve its endpoint, build its payload, call the transport, and parse its response.

## Adding a provider

1. Add a `ProviderId` and native API value in `providerAdapter.ts`.
2. Add conservative capability defaults. Mark unsupported tools, JSON, vision, FIM, and sampling fields as false.
3. Implement a `ProviderClient` with health, optional model discovery, streaming, and optional FIM.
4. Add a request builder. Omit unsupported settings instead of sending them as `null` or provider guesses.
5. Add stream parsing for complete and partial records, malformed records, `[DONE]`, empty output, and invalid UTF-8.
6. Normalize HTTP, timeout, network, authentication, cancellation, and invalid-request failures through `ProviderError`.
7. Register construction and settings in `LlmFactory`, configuration, and the provider profile map.
8. Add request fixtures, adapter contract tests, resilience tests, and a fake-provider integration path.
9. Update README provider behavior and this document. Run compile, fast tests, host tests, packaging, and VSIX smoke installation.

Do not make the agent branch on a concrete client. The adapter and capability record are the extension point.

## Tests and fixtures

- `providerAdapterContract.test.ts` checks common adapter behavior and normalized errors.
- `providerRequestFixtures.test.ts` checks Ollama, MLX, OpenAI chat, Responses, and image payloads.
- `providerResilience.test.ts` checks streams, retries, endpoint fallback, disconnects, empty responses, and invalid UTF-8.
- `fakeProviderIntegration.test.ts` checks provider output through read/edit/approval, retry, cancellation, empty output, and context compaction.

When a provider bug is fixed, add a small fixture before changing parser behavior. Keep wire payloads free of real credentials and sensitive workspace data.
