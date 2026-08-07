import asyncio

from app.llm import LlmReviewer
from app.pipelines import precheck_activity, precheck_submission
from app.schemas import ActivityPrecheckRequest, SubmissionPrecheckRequest


def test_shared_content_requires_source_and_personal_analysis(monkeypatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    request = SubmissionPrecheckRequest.model_validate({
        "task": {"id": "T006", "title": "Share", "precheckPipeline": "shared_content_v1"},
        "submission": {"id": "sub-1", "summary": "Interesting news"},
    })
    result = asyncio.run(precheck_submission(request, LlmReviewer()))
    assert result.recommendation == "revision"
    assert "missing_source_url" in result.flags


def test_activity_precheck_is_manual_without_ai(monkeypatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    request = ActivityPrecheckRequest.model_validate({
        "seasonId": "season-2",
        "activityDate": "2026-07-30",
        "threshold": 1,
        "basePoints": 20,
        "topicDefinition": "SpoonOS, AI agents, product usage",
        "messages": [{
            "messageId": "m1", "userId": "u1", "channelId": "c1",
            "content": "I tested the Arena retry workflow and found the error state helpful.",
            "createdAtUtc": "2026-07-30T10:00:00.000Z",
        }],
    })
    result = asyncio.run(precheck_activity(request, LlmReviewer()))
    assert result.users[0].recommendation == "review"
    assert result.users[0].rulePassedMessages == 1


class _FakeLlm:
    """Mimics LlmReviewer.review returning decisions under an arbitrary key."""

    def __init__(self, payload_key: str, id_key: str) -> None:
        self._payload_key = payload_key
        self._id_key = id_key

    async def review(self, *, system: str, payload: dict) -> dict:
        return {
            self._payload_key: [{
                self._id_key: payload["messages"][0]["message_id"],
                "status": "valid",
                "relevance_score": 80,
                "quality_score": 70,
                "reason": "relevant",
            }]
        }


def _activity_request(content: str) -> ActivityPrecheckRequest:
    return ActivityPrecheckRequest.model_validate({
        "seasonId": "season-2",
        "activityDate": "2026-07-30",
        "threshold": 1,
        "basePoints": 20,
        "topicDefinition": "SpoonOS, AI agents, product usage",
        "messages": [{
            "messageId": "m1", "userId": "u1", "channelId": "c1",
            "content": content,
            "createdAtUtc": "2026-07-30T10:00:00.000Z",
        }],
    })


def test_activity_ai_decisions_parsed_from_messages_key() -> None:
    # Agnes wraps decisions under "messages" (not "items"/"evaluations").
    result = asyncio.run(precheck_activity(_activity_request("real use case"), _FakeLlm("messages", "message_id")))
    assert result.users[0].aiValidMessages == 1
    assert result.users[0].recommendation == "pass"


def test_activity_ai_decisions_parsed_from_messageId_field() -> None:
    # Some providers use camelCase messageId.
    result = asyncio.run(precheck_activity(_activity_request("real use case"), _FakeLlm("items", "messageId")))
    assert result.users[0].aiValidMessages == 1
    assert result.users[0].recommendation == "pass"

