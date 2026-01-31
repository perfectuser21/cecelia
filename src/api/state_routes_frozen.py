"""Frozen Brain state routes - all return 410 Gone.

These endpoints have been migrated to the Node.js Brain service (port 5221).
This file exists to provide clear error messages during the transition period.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/brain", tags=["brain-frozen"])

GONE_BODY = {
    "error": "Gone",
    "message": "This endpoint has moved to Node.js Brain (port 5221). "
    "Use the Node.js Brain API directly or via Core proxy.",
}

GONE_PATHS = [
    # Focus
    ("GET", "/focus"),
    ("GET", "/focus/summary"),
    ("POST", "/focus/set"),
    ("POST", "/focus/clear"),
    # Tick
    ("GET", "/tick/status"),
    ("POST", "/tick/enable"),
    ("POST", "/tick/disable"),
    ("POST", "/tick"),
    # Goals
    ("GET", "/goals"),
    ("GET", "/goals/summary"),
    ("GET", "/goals/{goal_id}"),
    ("GET", "/goals/{goal_id}/key-results"),
    ("DELETE", "/goals/{goal_id}"),
    ("POST", "/goals/{goal_id}/recalculate"),
    # Actions
    ("POST", "/action/{action_name}"),
    # Queue
    ("GET", "/queue"),
    ("POST", "/queue/init"),
    ("GET", "/queue/next"),
    ("POST", "/queue/start"),
    ("POST", "/queue/complete"),
    ("POST", "/queue/fail"),
    ("POST", "/queue/retry"),
    ("DELETE", "/queue"),
    ("GET", "/queue/summary"),
]


async def _gone(request: Request):
    return JSONResponse(status_code=410, content=GONE_BODY)


for method, path in GONE_PATHS:
    router.add_api_route(path, _gone, methods=[method], include_in_schema=False)
