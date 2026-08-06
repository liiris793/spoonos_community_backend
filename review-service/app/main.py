import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .llm import LlmReviewer
from .pipelines import precheck_activity, precheck_submission
from .schemas import (
    ActivityPrecheckRequest,
    ActivityPrecheckResponse,
    PrecheckResponse,
    SubmissionPrecheckRequest,
)


app = FastAPI(title="SpoonOS Pre-review Service", version="0.1.0")
llm = LlmReviewer()


def authorize(authorization: str | None = Header(default=None)) -> None:
    token = os.getenv("PRECHECK_SERVICE_TOKEN", "").strip()
    if token and authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Invalid service token")


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "aiEnabled": llm.enabled}


@app.post("/precheck", response_model=PrecheckResponse, dependencies=[Depends(authorize)])
async def submission_precheck(request: SubmissionPrecheckRequest) -> PrecheckResponse:
    return await precheck_submission(request, llm)


@app.post(
    "/activity/precheck",
    response_model=ActivityPrecheckResponse,
    dependencies=[Depends(authorize)],
)
async def activity_precheck(request: ActivityPrecheckRequest) -> ActivityPrecheckResponse:
    return await precheck_activity(request, llm)
