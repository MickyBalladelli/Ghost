# Ollama generation parameters in Ghost

Ghost sends generation parameters with every chat and inline-completion request. A Modelfile is not required. Use a Modelfile only when you want Ollama itself to keep a model-specific default outside Ghost.

Official references:

- [Ollama Modelfile parameters](https://docs.ollama.com/modelfile)
- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)

## Ghost generation profiles

Ghost's normal generation defaults are:

```text
temperature=0.3
top_p=0.9
top_k=20
min_p=0.05
presence_penalty=0
repeat_penalty=1.05
```

The built-in `coding` profile is more deterministic and uses:

```text
temperature=0.2
top_p=0.9
top_k=20
min_p=0.05
presence_penalty=0
repeat_penalty=1.1
max_context_tokens=16384
max_tokens=2048
```

`balanced` keeps the normal sampling values and uses `max_context_tokens=8192` and `max_tokens=1024`. `creative` uses `temperature=0.8`, `top_p=0.95`, `top_k=40`, `min_p=0.02`, `repeat_penalty=1.02`, `max_context_tokens=8192`, and `max_tokens=2048`. Select a profile with `ghost.modelProfile`.

## Ghost settings

| Ghost setting | Default | Native Ollama key | Meaning |
| --- | ---: | --- | --- |
| `ghost.temperature` | `0.3` | `temperature` | Controls randomness. Lower values focus on likely output. Higher values add variety and risk less reliable tool calls. Range: `0` to `2`. |
| `ghost.topP` | `0.9` | `top_p` | Keeps the smallest group of likely tokens whose combined probability reaches this value. Lower values are more focused. Range: `0` to `1`. |
| `ghost.topK` | `20` | `top_k` | Limits each next token to the K most likely choices. Lower values are more conservative. `0` disables the limit. |
| `ghost.minP` | `0.05` | `min_p` | Removes tokens whose probability is below this fraction of the most likely token. `0` disables the filter. |
| `ghost.presencePenalty` | `0` | `presence_penalty` | Penalizes tokens that already appeared. Keep this at `0` for code because repeated identifiers are normal. |
| `ghost.repeatPenalty` | `1.05` | `repeat_penalty` | Penalizes repeated text. `1` disables it. Values above `1` apply a stronger penalty; values below `1` allow more repetition. |

Ghost also maps response length to `num_predict` when a finite response length is selected:

| Ghost response length | Ollama `num_predict` |
| --- | ---: |
| `short` | `512` |
| `balanced` | `1024` |
| `long` | `2048` |
| `unlimited` | Not sent; Ollama decides the limit. |

## How the values interact

Sampling filters are applied together. Do not make every value extremely low:

- Temperature changes the overall randomness.
- Top K sets a hard count of allowed candidates.
- Top P sets a probability-mass limit among the candidates.
- Min P removes candidates too far below the best candidate.
- Repeat penalty discourages repeated text.
- Presence penalty discourages reuse of tokens or topics.

For coding, keep presence penalty at `0`. Code needs to repeat names, keywords, imports, and syntax. Use repeat penalty lightly. Strong penalties can damage exact code.

Top K, Top P, and Min P overlap. Start with the default profile and change one value at a time. A low temperature plus very low Top P, Top K, and Min P can make output too rigid or incomplete.

## Provider behavior

Ghost only sends a setting when the selected request format supports it. This is the complete generation mapping:

| Ghost setting | Ollama | MLX/VLM | OpenAI-compatible chat | Anthropic | Gemini | Custom HTTP |
| --- | --- | --- | --- | --- | --- | --- |
| `temperature` | `temperature` | `temperature` | `temperature` | `temperature` | `temperature` | Template value `temperature` |
| `topP` | `top_p` | `top_p` | `top_p` | `top_p` | `topP` | Template value `topP` |
| `topK` | `top_k` | Not sent | Not sent | Not sent | Not sent | Not available in template |
| `minP` | `min_p` | Not sent | Not sent | Not sent | Not sent | Not available in template |
| `presencePenalty` | `presence_penalty` | `presence_penalty` | `presence_penalty` | Not sent | Not sent | Not available in template |
| `repeatPenalty` | `repeat_penalty` | Not sent | Not sent | Not sent | Not sent | Not available in template |
| `seed` | `seed` | `seed` | `seed` | Not sent | `seed` | Template value `seed` |
| `stopSequences` | `stop` | `stop` | `stop` | `stop_sequences` | `stopSequences` | Template value `stop` |
| `contextWindow` | `num_ctx` | Not sent | Not sent | Not sent | Not sent | Template value `contextWindow` |
| `grammar` | `grammar` | `grammar` | Not sent | Not sent | Not sent | Template value `grammar` |
| response output limit | `num_predict` | `max_tokens` | `max_tokens` | `max_tokens` | `maxOutputTokens` | Template value `maxTokens` |

The custom HTTP provider sends only the fields included in `ghost.openaiCustomRequestTemplate`; its template receives the values named above. The default template includes model, messages, stream, temperature, top P, and max tokens only. Server support can still vary, especially for OpenAI-compatible profiles.

### Native Ollama

Ghost sends all six sampling values in the native `options` object:

```json
{
  "options": {
    "temperature": 0.3,
    "top_p": 0.9,
    "top_k": 20,
    "min_p": 0.05,
    "presence_penalty": 0,
    "repeat_penalty": 1.05
  }
}
```

The same values are sent for native Ollama inline completion requests.

### OpenAI-compatible servers

Ghost sends the standard fields supported by the OpenAI-compatible path:

```json
{
  "temperature": 0.3,
  "top_p": 0.9,
  "presence_penalty": 0
}
```

`top_k`, `min_p`, and `repeat_penalty` are Ollama-specific and are not sent on this path. The server may have its own equivalent settings.

### MLX/VLM

Ghost sends `temperature`, `top_p`, and `presence_penalty` to the MLX/VLM OpenAI-compatible endpoint. `top_k`, `min_p`, and `repeat_penalty` are not part of that request format. MLX does not expose native tool calling, so Agent mode is unreliable; use Ollama or an OpenAI-compatible server when the request needs file tools.

## Modelfile defaults

Ghost's settings are per-request settings. To make Ollama use defaults for a model in every client, create a derived model:

```text
FROM qwen2.5-coder:7b

PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER top_k 20
PARAMETER min_p 0.05
PARAMETER repeat_penalty 1.05
```

Then create it with:

```sh
ollama create qwen2.5-coder-coding -f Modelfile
```

Keep Ghost's values and the Modelfile values aligned if other clients also use the derived model. Ghost's per-request values take precedence for requests sent by Ghost.

## Tuning guide

### More deterministic tool use

```text
temperature=0.1
top_p=0.85
top_k=10
min_p=0.05
presence_penalty=0
repeat_penalty=1.05
```

Use this when the model invents tool calls, emits malformed JSON, or wanders. It can make explanations and code suggestions too rigid.

### More varied explanations

```text
temperature=0.5
top_p=0.95
top_k=40
min_p=0.0
presence_penalty=0
repeat_penalty=1.05
```

Use this for brainstorming or explanations. For file edits and agent work, return to the default coding profile.

### Repetition or looping

Raise `repeat_penalty` gradually, for example from `1.05` to `1.1` or `1.15`. Do not use a large penalty on code unless necessary. Also check whether the model is receiving the full tool result and enough context.

### Incomplete answers

Raise `temperature` slightly or relax `top_p`, `top_k`, or `min_p`. Also check `ghost.responseLength` and `ghost.maxContextTokens`; sampling values cannot fix an output-token or context limit.
