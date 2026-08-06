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
