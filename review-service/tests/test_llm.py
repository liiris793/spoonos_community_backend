import asyncio

import httpx

from app.llm import LlmReviewer


def test_accepts_openai_environment_aliases(monkeypatch) -> None:
    for name in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-token")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://apihub.agnes-ai.com/v1")
    monkeypatch.setenv("OPENAI_MODEL", "agnes-2.0-flash")

    reviewer = LlmReviewer()
    assert reviewer.enabled
    assert reviewer.endpoint == "https://apihub.agnes-ai.com/v1/chat/completions"
    assert reviewer.model == "agnes-2.0-flash"


def test_llm_variables_take_priority(monkeypatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "preferred-token")
    monkeypatch.setenv("OPENAI_API_KEY", "alias-token")
    monkeypatch.setenv("LLM_MODEL", "preferred-model")
    monkeypatch.setenv("OPENAI_MODEL", "alias-model")
    reviewer = LlmReviewer()
    assert reviewer.api_key == "preferred-token"
    assert reviewer.model == "preferred-model"


def test_parses_markdown_wrapped_json() -> None:
    parsed = LlmReviewer._parse_json_content(
        '```json\n{"score": 88, "recommendation": "pass"}\n```'
    )
    assert parsed["score"] == 88


def test_accepts_full_chat_completions_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://example.com/v1/chat/completions")
    reviewer = LlmReviewer()
    assert reviewer.endpoint == "https://example.com/v1/chat/completions"


def test_retries_without_json_mode_when_provider_rejects_it(monkeypatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "test-token")
    reviewer = LlmReviewer()
    requests: list[dict] = []

    async def fake_post(_client, request):
        requests.append(request)
        http_request = httpx.Request("POST", reviewer.endpoint)
        if len(requests) == 1:
            return httpx.Response(400, request=http_request, text="unsupported response_format")
        return httpx.Response(
            200,
            request=http_request,
            json={
                "choices": [{
                    "message": {
                        "content": '{"score": 80, "recommendation": "review"}'
                    }
                }]
            },
        )

    monkeypatch.setattr(reviewer, "_post", fake_post)
    result = asyncio.run(reviewer.review(system="Review", payload={"value": 1}))
    assert len(requests) == 2
    assert "response_format" in requests[0]
    assert "response_format" not in requests[1]
    assert result["_provider"]["compatibilityMode"] is True
