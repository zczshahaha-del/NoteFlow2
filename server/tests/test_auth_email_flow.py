"""Real route/SQL/cookie checks against a fresh in-memory DB; no app data/mail."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import deps
from app.config import cfg
from app.models.db import EmailLoginCode, User, UserSession
from app.routers import auth
from app.services.email_auth import hash_email_code
from app.utils import create_token, hash_password, verify_password


class EmailFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            for table in (User.__table__, UserSession.__table__, EmailLoginCode.__table__):
                await conn.run_sync(table.create)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.patches = [
            patch.object(auth, "AsyncSessionLocal", self.sessions),
            patch.object(deps, "AsyncSessionLocal", self.sessions),
            patch.object(cfg, "JWT_SECRET", "synthetic-email-flow-test-secret-only"),
            patch.object(cfg, "ENVIRONMENT", "development"),
            patch.object(cfg, "AUTH_COOKIE_SECURE", False),
            patch.object(auth, "generate_email_code", return_value="314159"),
            patch.object(auth, "deliver_email_code", return_value=False),
            patch.object(deps.db, "redis_client", None),
        ]
        for item in self.patches:
            item.start()
        deps._public_rate_windows.clear()
        app = FastAPI()
        app.include_router(auth.router, prefix="/api")
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()
        await self.engine.dispose()

    async def seed(self, verified=False, password=True):
        user = User(id="original-user", email="owner@example.com", display_name="原用户名",
                    password_hash=hash_password("previous-password") if password else None,
                    email_verified_at=datetime.utcnow() if verified else None)
        old = UserSession(id="previous-session", user_id=user.id,
                          expires_at=datetime.utcnow() + timedelta(days=1))
        async with self.sessions() as db:
            db.add_all([user, old])
            await db.commit()
        return user

    async def code(self, purpose="register", email="owner@example.com", code="314159", **kwargs):
        async with self.sessions() as db:
            record = EmailLoginCode(id="code-" + purpose, email=email, purpose=purpose,
                                    code_hash=hash_email_code(email, code, purpose, kwargs.get("user_id")),
                                    expires_at=datetime.utcnow() + timedelta(minutes=5), **kwargs)
            db.add(record)
            await db.commit()

    async def confirm(self, purpose="register", code="314159"):
        return await self.client.post("/api/auth/register" if purpose == "register" else "/api/auth/email-code/confirm",
                                      json={"email": "owner@example.com", "code": code})

    async def test_registration_requires_code_not_password_and_creates_only_after_proof(self):
        response = await self.client.post("/api/auth/register", json={"email": "owner@example.com", "password": "ignored-password"})
        self.assertEqual(response.status_code, 422)
        response = await self.client.post("/api/auth/email-code/request", json={"email": "owner@example.com", "purpose": "register"})
        self.assertEqual(response.status_code, 200)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(User)), 0)
            record = await db.scalar(select(EmailLoginCode))
            self.assertEqual(record.purpose, "register")
            self.assertNotEqual(record.code_hash, "314159")
        response = await self.confirm()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["user"]["emailVerified"])
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        async with self.sessions() as db:
            user = await db.scalar(select(User))
            self.assertIsNone(user.password_hash)
        self.assertEqual((await self.client.get("/api/auth/me")).status_code, 200)
        self.assertEqual((await self.confirm()).status_code, 400, "code cannot be replayed")

    async def test_login_does_not_auto_register_and_purposes_are_isolated(self):
        await self.code()
        self.assertEqual((await self.confirm("login")).status_code, 400)
        await self.code("login")
        self.assertEqual((await self.confirm("login")).status_code, 404)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(User)), 0)
        self.assertEqual((await self.confirm()).status_code, 200)

    async def test_claim_preserves_user_and_revokes_untrusted_password_and_sessions(self):
        user = await self.seed()
        legacy = create_token(user.id, user.email, user.display_name)
        old = create_token(user.id, user.email, user.display_name, "previous-session")
        await self.code("login")
        response = await self.confirm("login")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["id"], user.id)
        self.assertEqual(response.json()["user"]["displayName"], "原用户名")
        async with self.sessions() as db:
            current = await db.get(User, user.id)
            self.assertIsNone(current.password_hash)
            self.assertIsNotNone((await db.get(UserSession, "previous-session")).revoked_at)
            self.assertEqual(await db.scalar(select(func.count()).select_from(User)), 1)
        for token in (legacy, old):
            self.assertEqual((await self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})).status_code, 401)
        self.client.cookies.clear()
        self.assertEqual((await self.client.post("/api/auth/migrate-legacy-token", headers={"Authorization": "Bearer " + legacy})).status_code, 401)
        self.assertEqual((await self.client.post("/api/auth/login", json={"email": user.email, "password": "previous-password"})).status_code, 401)

    async def test_register_claims_unverified_identity_but_never_overwrites_verified_account(self):
        await self.seed()
        await self.code()
        response = await self.confirm()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["id"], "original-user")
        # Fresh purpose-bound code, now the account is verified.
        async with self.sessions() as db:
            existing = await db.get(EmailLoginCode, "code-register")
            existing.used_at = None
            await db.commit()
        self.assertEqual((await self.confirm()).status_code, 409)

    async def test_bad_expired_and_exhausted_codes_cannot_register(self):
        await self.code()
        for _ in range(cfg.EMAIL_CODE_MAX_ATTEMPTS):
            self.assertEqual((await self.confirm(code="999999")).status_code, 400)
        self.assertEqual((await self.confirm()).status_code, 400)
        async with self.sessions() as db:
            code = await db.get(EmailLoginCode, "code-register")
            self.assertIsNotNone(code.used_at)
            code.used_at = None
            code.attempt_count = 0
            code.expires_at = datetime.utcnow() - timedelta(seconds=1)
            await db.commit()
        self.assertEqual((await self.confirm()).status_code, 400)

    async def test_passwordless_account_can_set_password_with_email_reset_and_sign_in(self):
        user = await self.seed(verified=True, password=False)
        await self.code("reset_password", user_id=user.id)
        response = await self.client.post("/api/auth/password-reset/confirm", json={
            "email": user.email, "code": "314159", "newPassword": "new-password-123"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self.client.post("/api/auth/login", json={"email": user.email, "password": "new-password-123"})).status_code, 200)
        async with self.sessions() as db:
            self.assertTrue(verify_password("new-password-123", (await db.get(User, user.id)).password_hash))

    async def test_verified_login_preserves_existing_password_and_other_sessions(self):
        user = await self.seed(verified=True)
        await self.code("login")
        self.assertEqual((await self.confirm("login")).status_code, 200)
        async with self.sessions() as db:
            self.assertTrue(verify_password("previous-password", (await db.get(User, user.id)).password_hash))
            self.assertIsNone((await db.get(UserSession, "previous-session")).revoked_at)

    async def test_unverified_password_reset_claims_identity_and_blocks_legacy_token(self):
        user = await self.seed()
        legacy = create_token(user.id, user.email, user.display_name)
        await self.code("reset_password", user_id=user.id)
        response = await self.client.post("/api/auth/password-reset/confirm", json={
            "email": user.email, "code": "314159", "newPassword": "new-password-123"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual((await self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + legacy})).status_code, 401)
        async with self.sessions() as db:
            self.assertIsNotNone((await db.get(User, user.id)).email_verified_at)
            self.assertIsNotNone((await db.get(UserSession, "previous-session")).revoked_at)

    async def test_resend_limits_and_invalid_purpose(self):
        url = "/api/auth/email-code/request"
        payload = {"email": "owner@example.com", "purpose": "register"}
        self.assertEqual((await self.client.post(url, json=payload)).status_code, 200)
        self.assertEqual((await self.client.post(url, json=payload)).status_code, 429)
        self.assertEqual((await self.client.post(url, json={**payload, "purpose": "invented"})).status_code, 422)

    async def test_production_delivery_failure_has_no_development_code_or_usable_record(self):
        with patch.object(cfg, "ENVIRONMENT", "production"):
            response = await self.client.post("/api/auth/email-code/request", json={"email": "owner@example.com", "purpose": "register"})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("developmentCode", response.json())
        self.assertEqual((await self.confirm()).status_code, 400)
