from __future__ import annotations

import unittest

from fastapi import HTTPException

from app import database as db
from app.deps import CurrentUser, _user_rate_windows, redis_rate_limit


class RateLimitMessageTest(unittest.IsolatedAsyncioTestCase):
    async def test_ai_limit_returns_localized_retry_message(self) -> None:
        previous_redis = db.redis_client
        db.redis_client = None
        _user_rate_windows.clear()
        limiter = redis_rate_limit("localized-test", 1, 60)
        user = CurrentUser(id="rate-test-user", email="test@example.com", display_name="Test")

        try:
            self.assertIs(await limiter(None, user), user)
            with self.assertRaises(HTTPException) as raised:
                await limiter(None, user)
        finally:
            db.redis_client = previous_redis
            _user_rate_windows.clear()

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail, "AI 请求较多，请稍等十几秒后重试。")
        self.assertEqual(raised.exception.headers, {"Retry-After": "60"})


if __name__ == "__main__":
    unittest.main()
