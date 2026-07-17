from __future__ import annotations

import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.schemas.common import API_ERROR_RESPONSES
from app.services.observability import install_observability, metrics_snapshot


class ApiContractTest(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI(responses=API_ERROR_RESPONSES)
        install_observability(app)

        @app.get("/conflict")
        async def conflict():
            raise HTTPException(status_code=409, detail="version changed")

        @app.get("/ok")
        async def ok():
            return {"ok": True}

        self.client = TestClient(app)
        self.app = app

    def test_http_errors_use_stable_error_envelope(self) -> None:
        response = self.client.get("/conflict", headers={"X-Request-Id": "test-request-1"})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], {"code": "CONFLICT", "message": "version changed"})
        self.assertEqual(response.json()["requestId"], "test-request-1")
        self.assertEqual(response.headers["x-request-id"], "test-request-1")

    def test_security_headers_and_metrics_are_recorded(self) -> None:
        response = self.client.get("/ok")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])
        snapshot = metrics_snapshot()
        self.assertGreaterEqual(snapshot["routes"]["GET /ok"]["requests"], 1)

    def test_openapi_documents_shared_error_envelope(self) -> None:
        schema = self.app.openapi()
        conflict_response = schema["paths"]["/conflict"]["get"]["responses"]["409"]

        self.assertEqual(
            conflict_response["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/ApiErrorEnvelope",
        )
        self.assertIn("ApiErrorDetail", schema["components"]["schemas"])


if __name__ == "__main__":
    unittest.main()
