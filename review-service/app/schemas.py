from typing import Any, Literal

from pydantic import BaseModel, Field


Recommendation = Literal["pass", "review", "revision"]


class TaskPayload(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    basePoints: int = 0
    precheckPipeline: str | None = None
    requirements: list[str] = Field(default_factory=list)
    reviewCriteria: list[str] = Field(default_factory=list)
    requiredEvidence: list[str] = Field(default_factory=list)
    disqualifiers: list[str] = Field(default_factory=list)
    topicDefinition: str | None = None
    positiveExamples: list[str] = Field(default_factory=list)
    negativeExamples: list[str] = Field(default_factory=list)
    targetAccounts: list[str] = Field(default_factory=list)
    targetPostIds: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class SubmissionPayload(BaseModel):
    id: str
    summary: str = ""
    proofUrl: str | None = None
    attachmentUrl: str | None = None
    structuredData: dict[str, Any] = Field(default_factory=dict)


class SubmissionPrecheckRequest(BaseModel):
    version: str = "1"
    task: TaskPayload
    submission: SubmissionPayload
    recentSubmissionTexts: list[str] = Field(default_factory=list)


class PrecheckResponse(BaseModel):
    pluginId: str = "ai_webhook_precheck"
    score: int = 50
    recommendation: Recommendation = "review"
    flags: list[str] = Field(default_factory=list)
    missingItems: list[str] = Field(default_factory=list)
    reviewQuestions: list[str] = Field(default_factory=list)
    ruleResult: dict[str, Any] = Field(default_factory=dict)
    aiResult: dict[str, Any] = Field(default_factory=dict)


class ActivityMessage(BaseModel):
    messageId: str
    userId: str
    channelId: str
    content: str
    createdAtUtc: str
    replyToMessageId: str | None = None


class ActivityPrecheckRequest(BaseModel):
    seasonId: str
    activityDate: str
    threshold: int = 5
    basePoints: int = 0
    topicDefinition: str = ""
    reviewCriteria: list[str] = Field(default_factory=list)
    disqualifiers: list[str] = Field(default_factory=list)
    positiveExamples: list[str] = Field(default_factory=list)
    negativeExamples: list[str] = Field(default_factory=list)
    messages: list[ActivityMessage]


class MessageDecision(BaseModel):
    messageId: str
    ruleStatus: Literal["pass", "fail"]
    ruleFlags: list[str] = Field(default_factory=list)
    aiStatus: Literal["valid", "invalid", "uncertain", "skipped"] = "skipped"
    relevanceScore: int | None = None
    qualityScore: int | None = None
    reason: str = ""


class ActivityUserResult(BaseModel):
    userId: str
    candidateMessages: int
    rulePassedMessages: int
    aiValidMessages: int
    suggestedPoints: int
    recommendation: Recommendation
    flags: list[str] = Field(default_factory=list)
    reviewQuestions: list[str] = Field(default_factory=list)
    messages: list[MessageDecision]


class ActivityPrecheckResponse(BaseModel):
    activityDate: str
    users: list[ActivityUserResult]
