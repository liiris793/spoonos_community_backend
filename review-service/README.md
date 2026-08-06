# SpoonOS pre-review service

This Python/uv service performs deterministic checks first, then optionally asks an OpenAI-compatible model for review advice. It never awards points.

```bash
cd review-service
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env
```

Check it with `curl http://127.0.0.1:8000/health`. Set the Bot's `PRECHECK_SERVICE_URL=http://127.0.0.1:8000` and use the same optional service token on both sides.

`LLM_API_KEY` is optional. Without it, Python rules still run and every AI-dependent result is marked for human review.

The service also accepts `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`OPENAI_MODEL`, and `OPENAI_TIMEOUT_SECONDS`. `LLM_*` takes priority when both
groups are set. For Agnes, use:

```dotenv
OPENAI_BASE_URL=https://apihub.agnes-ai.com/v1
OPENAI_API_KEY=your-token
OPENAI_MODEL=agnes-2.0-flash
```

The client first requests JSON mode. If an OpenAI-compatible provider rejects
`response_format` or `temperature`, it automatically retries with a minimal
Chat Completions request and parses plain JSON or a Markdown JSON code block.
