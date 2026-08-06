import json
import os
import re
from typing import Any

import httpx


def _env(*names: str, default: str = "") -> str:
    """Return the first non-empty environment variable in priority order."""
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


class LlmReviewer:
    def __init__(self) -> None:
        # LLM_* remains the preferred service-specific naming. OPENAI_* aliases
        # make OpenAI-compatible providers such as Agnes work without renaming.
        self.api_key = _env("LLM_API_KEY", "OPENAI_API_KEY")
        self.base_url = _env(
            "LLM_BASE_URL",
            "OPENAI_BASE_URL",
            default="https://api.openai.com/v1",
        ).rstrip("/")
        self.model = _env("LLM_MODEL", "OPENAI_MODEL", default="gpt-4.1-mini")
        self.timeout = float(
            _env("LLM_TIMEOUT_SECONDS", "OPENAI_TIMEOUT_SECONDS", default="30")
        )

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    @property
    def endpoint(self) -> str:
        # Also accept a full endpoint for providers that document it that way.
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"

    async def review(self, *, system: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled:
            return {
                "status": "skipped",
                "reason": "LLM_API_KEY or OPENAI_API_KEY is not configured",
            }

        messages = [
            {
                "role": "system",
                "content": (
                    f"{system}\nReturn one valid JSON object only. "
                    "Do not wrap it in Markdown or add explanatory text."
                ),
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        strict_request = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": messages,
        }
        compatibility_request = {
            "model": self.model,
            "messages": messages,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await self._post(client, strict_request)
                compatibility_mode = False
                # Some OpenAI-compatible providers accept chat completions but
                # reject response_format or temperature. Retry without both.
                if response.status_code in {400, 404, 415, 422}:
                    response = await self._post(client, compatibility_request)
                    compatibility_mode = True
                response.raise_for_status()

            body = response.json()
            content = body["choices"][0]["message"]["content"]
            parsed = self._parse_json_content(content)
            parsed.setdefault("_provider", {})
            if isinstance(parsed["_provider"], dict):
                parsed["_provider"].update(
                    {
                        "model": self.model,
                        "compatibilityMode": compatibility_mode,
                    }
                )
            return parsed
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.replace("\n", " ")[:240]
            return {
                "status": "error",
                "reason": f"LLM HTTP {exc.response.status_code}: {detail}",
            }
        except Exception as exc:  # AI failure must never stop manual review.
            return {"status": "error", "reason": str(exc)[:300]}

    async def _post(
        self, client: httpx.AsyncClient, request: dict[str, Any]
    ) -> httpx.Response:
        return await client.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=request,
        )

    @staticmethod
    def _parse_json_content(content: Any) -> dict[str, Any]:
        if isinstance(content, dict):
            return content
        if not isinstance(content, str):
            raise ValueError("LLM response content is not text or a JSON object")
        text = content.strip()
        fence = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.I | re.S)
        if fence:
            text = fence.group(1).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("LLM did not return a JSON object")
            parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("LLM returned JSON, but it was not an object")
        return parsed
