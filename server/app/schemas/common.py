from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ApiErrorDetail(BaseModel):
    code: str = Field(description="Stable machine-readable error code")
    message: str = Field(description="Human-readable error message")
    details: Optional[Any] = Field(default=None, description="Optional validation or diagnostic details")


class ApiErrorEnvelope(BaseModel):
    error: ApiErrorDetail
    requestId: str = Field(description="Request correlation identifier")


API_ERROR_RESPONSES = {
    400: {"model": ApiErrorEnvelope, "description": "Bad request"},
    401: {"model": ApiErrorEnvelope, "description": "Authentication required"},
    403: {"model": ApiErrorEnvelope, "description": "Forbidden"},
    404: {"model": ApiErrorEnvelope, "description": "Resource not found"},
    409: {"model": ApiErrorEnvelope, "description": "State or version conflict"},
    422: {"model": ApiErrorEnvelope, "description": "Request validation failed"},
    429: {"model": ApiErrorEnvelope, "description": "Rate limit exceeded"},
    500: {"model": ApiErrorEnvelope, "description": "Internal server error"},
    502: {"model": ApiErrorEnvelope, "description": "Upstream service error"},
    503: {"model": ApiErrorEnvelope, "description": "Service unavailable"},
}
