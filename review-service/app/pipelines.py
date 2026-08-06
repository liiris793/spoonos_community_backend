from collections import defaultdict
from typing import Any

from .llm import LlmReviewer
from .rules import (
    activity_rule_check,
    duplicate_flags,
    is_http_url,
    normalize_text,
    parse_x_status_url,
    urls_in,
)
from .schemas import (
    ActivityPrecheckRequest,
    ActivityPrecheckResponse,
    ActivityUserResult,
    MessageDecision,
    PrecheckResponse,
    SubmissionPrecheckRequest,
)


PIPELINES_BY_TASK = {
    "T001": "daily_activity_v1",
    "T005": "proposal_v1",
    "T006": "shared_content_v1",
    "T012": "social_interaction_v1",
    "T022": "social_interaction_v1",
}


def _response(
    *, score: int, recommendation: str, flags: list[str], missing: list[str],
    questions: list[str], rule_result: dict[str, Any], ai_result: dict[str, Any]
) -> PrecheckResponse:
    return PrecheckResponse(
        score=max(0, min(100, score)),
        recommendation=recommendation,
        flags=list(dict.fromkeys(flags)),
        missingItems=list(dict.fromkeys(missing)),
        reviewQuestions=list(dict.fromkeys(questions)),
        ruleResult=rule_result,
        aiResult=ai_result,
    )


async def precheck_submission(
    request: SubmissionPrecheckRequest, llm: LlmReviewer
) -> PrecheckResponse:
    pipeline = request.task.precheckPipeline or PIPELINES_BY_TASK.get(request.task.id, "generic_v1")
    if pipeline == "proposal_v1":
        return await _proposal(request, llm)
    if pipeline == "shared_content_v1":
        return await _shared_content(request, llm)
    if pipeline == "social_interaction_v1":
        return await _social_interaction(request, llm)
    return await _generic(request, llm)


async def _proposal(request: SubmissionPrecheckRequest, llm: LlmReviewer) -> PrecheckResponse:
    text = normalize_text(request.submission.summary)
    flags = duplicate_flags(text, request.recentSubmissionTexts)
    missing: list[str] = []
    if len(text) < 100:
        missing.append("A specific problem, proposed solution, and expected impact")
        flags.append("proposal_too_short")
    evidence = request.submission.proofUrl or request.submission.attachmentUrl
    if not evidence and len(text) < 250:
        missing.append("Supporting evidence or a sufficiently detailed explanation")
    ai = await llm.review(
        system=(
            "You pre-review a community product proposal. Judge specificity, reproducibility, "
            "feasibility, user impact, and whether it appears generic or fabricated. Do not decide "
            "the final reward. Return JSON: score 0-100, recommendation pass|review|revision, "
            "reason, flags[], missing_items[], review_questions[]."
        ),
        payload={"task": request.task.model_dump(), "proposal": text, "evidence": evidence},
    )
    return _merge_rule_ai(flags, missing, ai, default_score=60)


async def _shared_content(request: SubmissionPrecheckRequest, llm: LlmReviewer) -> PrecheckResponse:
    text = normalize_text(request.submission.summary)
    sources = [u for u in [request.submission.proofUrl, *urls_in(text)] if is_http_url(u)]
    flags = duplicate_flags(text, request.recentSubmissionTexts)
    missing: list[str] = []
    if not sources:
        missing.append("Original source URL")
        flags.append("missing_source_url")
    own_view = normalize_text(text)
    for url in urls_in(own_view):
        own_view = own_view.replace(url, "")
    if len(own_view) < 80:
        missing.append("Your own explanation of why the content matters")
        flags.append("insufficient_personal_analysis")
    ai = await llm.review(
        system=(
            "You pre-review shared AI or technical content. Judge topic relevance, factual "
            "coherence, source-to-summary consistency, original personal insight, and community "
            "value. Flag generic AI-written filler. Return JSON: score 0-100, recommendation "
            "pass|review|revision, reason, flags[], missing_items[], review_questions[]."
        ),
        payload={"task": request.task.model_dump(), "summary": text, "source_urls": sources},
    )
    return _merge_rule_ai(flags, missing, ai, default_score=60)


async def _social_interaction(request: SubmissionPrecheckRequest, llm: LlmReviewer) -> PrecheckResponse:
    proof = request.submission.proofUrl or str(request.submission.structuredData.get("postUrl", ""))
    parsed = parse_x_status_url(proof)
    flags: list[str] = []
    missing: list[str] = []
    if not parsed:
        missing.append("A valid X post or reply URL")
        flags.append("invalid_x_url")
    elif request.task.targetAccounts and parsed[0] not in {
        item.lstrip("@").lower() for item in request.task.targetAccounts
    }:
        flags.append("target_account_not_verified_from_url")
    interaction_text = normalize_text(request.submission.summary)
    if len(interaction_text) < 30:
        missing.append("A short explanation or the text of your interaction")
    flags.append("x_identity_and_action_require_manual_or_api_verification")
    ai = await llm.review(
        system=(
            "You pre-review an X social interaction. Assess whether the supplied interaction text "
            "is specific, relevant, and adds a real opinion rather than generic praise. Never claim "
            "that a like, repost, author identity, or ownership was verified unless explicit API "
            "data is present. Return JSON: score 0-100, recommendation pass|review|revision, "
            "reason, flags[], missing_items[], review_questions[]."
        ),
        payload={"task": request.task.model_dump(), "proof_url": proof, "interaction_text": interaction_text},
    )
    return _merge_rule_ai(flags, missing, ai, default_score=50, force_review=True)


async def _generic(request: SubmissionPrecheckRequest, llm: LlmReviewer) -> PrecheckResponse:
    text = normalize_text(request.submission.summary)
    flags = duplicate_flags(text, request.recentSubmissionTexts)
    missing = [] if len(text) >= 40 else ["A more detailed completion summary"]
    if missing:
        flags.append("summary_too_short")
    ai = await llm.review(
        system=(
            "Pre-review this task submission against the supplied task requirements. Return JSON: "
            "score 0-100, recommendation pass|review|revision, reason, flags[], missing_items[], "
            "review_questions[]. Do not make the final reward decision."
        ),
        payload={"task": request.task.model_dump(), "submission": request.submission.model_dump()},
    )
    return _merge_rule_ai(flags, missing, ai, default_score=55)


def _merge_rule_ai(
    flags: list[str], missing: list[str], ai: dict[str, Any], default_score: int,
    force_review: bool = False,
) -> PrecheckResponse:
    ai_status = ai.get("status")
    if ai_status in {"skipped", "error"}:
        flags.append("ai_unavailable" if ai_status == "error" else "ai_not_configured")
    score = int(ai.get("score", default_score))
    recommendation = str(ai.get("recommendation", "review"))
    if recommendation not in {"pass", "review", "revision"}:
        recommendation = "review"
    if missing or any(flag in {"exact_duplicate", "near_duplicate"} for flag in flags):
        recommendation = "revision"
    elif force_review or ai_status in {"skipped", "error"}:
        recommendation = "review"
    questions = list(ai.get("review_questions", []))
    if ai_status in {"skipped", "error"}:
        questions.append("AI analysis was unavailable; verify this submission manually.")
    return _response(
        score=score,
        recommendation=recommendation,
        flags=flags + list(ai.get("flags", [])),
        missing=missing + list(ai.get("missing_items", [])),
        questions=questions,
        rule_result={"passed": not missing and not flags, "flags": flags},
        ai_result=ai,
    )


async def precheck_activity(
    request: ActivityPrecheckRequest, llm: LlmReviewer
) -> ActivityPrecheckResponse:
    grouped: dict[str, list] = defaultdict(list)
    for message in request.messages:
        grouped[message.userId].append(message)

    users: list[ActivityUserResult] = []
    for user_id, messages in grouped.items():
        decisions: list[MessageDecision] = []
        passed = []
        seen: set[str] = set()
        for message in messages:
            ok, flags = activity_rule_check(message.content)
            normalized = normalize_text(message.content).lower()
            if normalized in seen:
                ok = False
                flags.append("duplicate_message")
            seen.add(normalized)
            if ok:
                passed.append(message)
            decisions.append(
                MessageDecision(
                    messageId=message.messageId,
                    ruleStatus="pass" if ok else "fail",
                    ruleFlags=flags,
                    reason="Passed deterministic filters" if ok else ", ".join(flags),
                )
            )

        ai = await llm.review(
            system=(
                "You evaluate Discord messages for daily meaningful community participation. "
                "For every message, judge relevance to the supplied topic, substantive value, and "
                "whether it looks like generic filler. Return JSON with items: [{message_id, "
                "status: valid|invalid|uncertain, relevance_score:0-100, quality_score:0-100, "
                "reason}]. Evaluate only the messages provided."
            ),
            payload={
                "topic_definition": request.topicDefinition,
                "review_criteria": request.reviewCriteria,
                "disqualifiers": request.disqualifiers,
                "positive_examples": request.positiveExamples,
                "negative_examples": request.negativeExamples,
                "messages": [{"message_id": m.messageId, "content": m.content} for m in passed],
            },
        ) if passed else {"items": []}
        ai_map = {str(item.get("message_id")): item for item in ai.get("items", [])}
        ai_enabled = ai.get("status") not in {"skipped", "error"}
        valid_count = 0
        for decision in decisions:
            if decision.ruleStatus == "fail":
                continue
            item = ai_map.get(decision.messageId)
            if item:
                status = str(item.get("status", "uncertain"))
                if status not in {"valid", "invalid", "uncertain"}:
                    status = "uncertain"
                decision.aiStatus = status
                decision.relevanceScore = int(item.get("relevance_score", 50))
                decision.qualityScore = int(item.get("quality_score", 50))
                decision.reason = str(item.get("reason", ""))[:500]
                if status == "valid":
                    valid_count += 1
            else:
                decision.aiStatus = "skipped" if not ai_enabled else "uncertain"
                decision.reason = (
                    "AI was not configured; manual topic review required."
                    if not ai_enabled else "AI returned no decision; manual review required."
                )

        flags: list[str] = []
        if not ai_enabled and passed:
            flags.append("ai_not_configured")
        count_for_threshold = valid_count if ai_enabled else len(passed)
        if count_for_threshold < request.threshold:
            flags.append("daily_threshold_not_met")
        recommendation = (
            "pass" if ai_enabled and valid_count >= request.threshold
            else "revision" if len(passed) < request.threshold
            else "review"
        )
        users.append(
            ActivityUserResult(
                userId=user_id,
                candidateMessages=len(messages),
                rulePassedMessages=len(passed),
                aiValidMessages=valid_count,
                suggestedPoints=request.basePoints if recommendation == "pass" else 0,
                recommendation=recommendation,
                flags=flags,
                reviewQuestions=[
                    "Confirm that at least five messages are relevant and substantive before approval."
                ],
                messages=decisions,
            )
        )
    return ActivityPrecheckResponse(activityDate=request.activityDate, users=users)
