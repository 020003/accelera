# ollama-metrics (patched)

Transparent Prometheus metrics proxy for Ollama, forked from
[NorskHelsenett/ollama-metrics](https://github.com/NorskHelsenett/ollama-metrics).

## Patch Summary

The upstream proxy only counts tokens for `/api/generate` and `/api/chat`
(Ollama-native endpoints). This patched version adds:

1. **`/v1/chat/completions` and `/v1/completions` support** — parses the
   OpenAI-compatible `usage` field (`prompt_tokens`, `completion_tokens`)
   from both streaming (SSE) and non-streaming JSON responses.
2. **Automatic `stream_options` injection** — for streaming `/v1/` requests,
   the proxy injects `stream_options.include_usage=true` into the request body
   so Ollama returns token counts in the final SSE chunk, even when the client
   did not request it.
3. **Dockerfile fixes** — corrected binary name mismatch in `COPY` stage and
   bumped Go build image to `golang:1.24-alpine`.

## Architecture

```
Client → :11434 (ollama-metrics proxy) → :11435 (Ollama)
                    │
                    ├── Prometheus /metrics endpoint
                    ├── Token counting (all API formats)
                    └── Loaded model / RAM tracking
```

## Building

```bash
docker build -t ollama-metrics:patched .
```

## Deploying

```bash
docker run -d \
  --name ollama-metrics \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -e OLLAMA_HOST=http://host.docker.internal:11435 \
  -e PORT=8080 \
  -p 11434:8080 \
  ollama-metrics:patched
```

> **Prerequisite**: Ollama must be configured to listen on port 11435 instead of
> 11434, so the proxy can occupy 11434 transparently.

## Exposed Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `ollama_generated_tokens_total` | Counter | `model` | Total generated (completion) tokens |
| `ollama_prompt_tokens_total` | Counter | `model` | Total prompt (input) tokens |
| `ollama_request_duration_seconds` | Histogram | `endpoint`, `model` | Request duration |
| `ollama_time_per_token_seconds` | Histogram | `model` | Time per generated token |
| `ollama_loaded_models` | Gauge | — | Number of currently loaded models |
| `ollama_model_info` | Gauge | `model`, `id`, `processor` | Loaded model metadata |
| `ollama_model_ram_usage_megabytes` | Gauge | `model` | VRAM usage per loaded model |
