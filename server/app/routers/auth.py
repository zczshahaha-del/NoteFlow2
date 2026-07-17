from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import cfg
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, auth_token_from_request, get_current_user, public_rate_limit
from app.models.db import PasswordResetToken, User, UserSession
from app.services.password_reset import deliver_reset_token, generate_reset_token, hash_reset_token
from app.utils import (
    create_token,
    decode_token,
    hash_password,
    is_valid_email,
    normalize_email,
    password_needs_rehash,
    random_id,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthPayload(BaseModel):
    email: str
    password: str
    displayName: Optional[str] = None


class AuthUserOut(BaseModel):
    id: str
    email: str
    displayName: str


class AuthResponse(BaseModel):
    user: AuthUserOut
    sessionExpiresAt: str


class SessionOut(BaseModel):
    id: str
    current: bool
    userAgent: Optional[str]
    ipAddress: Optional[str]
    createdAt: str
    lastSeenAt: str
    expiresAt: str


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    email: str
    token: str
    newPassword: str


class PasswordResetRequestResponse(BaseModel):
    ok: bool = True
    message: str
    developmentToken: Optional[str] = None


def _client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded[:64]
    return request.client.host[:64] if request.client else None


def _new_session(user_id: str, request: Request) -> UserSession:
    now = datetime.utcnow()
    return UserSession(
        id=random_id(),
        user_id=user_id,
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        ip_address=_client_ip(request),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=max(1, cfg.AUTH_SESSION_TTL_DAYS)),
    )


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=cfg.AUTH_COOKIE_NAME,
        value=token,
        max_age=max(1, cfg.AUTH_SESSION_TTL_DAYS) * 24 * 60 * 60,
        httponly=True,
        secure=cfg.AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=cfg.AUTH_COOKIE_NAME,
        httponly=True,
        secure=cfg.AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _bearer_token_from_request(request: Request) -> Optional[str]:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


async def _active_session_from_payload(payload: Optional[dict]) -> Optional[tuple[User, UserSession]]:
    session_id = payload.get("sid") if payload else None
    if not session_id:
        return None

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User, UserSession)
            .join(UserSession, UserSession.user_id == User.id)
            .where(
                User.id == payload["sub"],
                UserSession.id == session_id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.utcnow(),
            )
        )
        row = result.one_or_none()
        if row is None:
            return None
        user, auth_session = row
        auth_session.last_seen_at = datetime.utcnow()
        await session.commit()
        return user, auth_session


async def _active_cookie_session(request: Request) -> Optional[tuple[User, UserSession]]:
    token = request.cookies.get(cfg.AUTH_COOKIE_NAME)
    if not token:
        return None
    return await _active_session_from_payload(decode_token(token, allow_expired=True))


def _auth_response(user: User, auth_session: UserSession) -> AuthResponse:
    return AuthResponse(
        user=AuthUserOut(id=user.id, email=user.email, displayName=user.display_name),
        sessionExpiresAt=auth_session.expires_at.isoformat(),
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    dependencies=[Depends(public_rate_limit("register", 8, 300))],
)
async def register(payload: AuthPayload, request: Request, response: Response):
    email = normalize_email(payload.email)
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="email is invalid")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")

    display_name = (payload.displayName or "").strip() or email.split("@")[0]
    user = User(
        id=random_id(),
        email=email,
        display_name=display_name,
        password_hash=hash_password(payload.password),
    )
    auth_session = _new_session(user.id, request)

    async with AsyncSessionLocal() as session:
        session.add(user)
        session.add(auth_session)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status_code=409, detail="email already exists")

    _set_auth_cookie(
        response,
        create_token(user.id, user.email, user.display_name, auth_session.id),
    )
    return _auth_response(user, auth_session)


@router.post(
    "/login",
    response_model=AuthResponse,
    dependencies=[Depends(public_rate_limit("login", cfg.LOGIN_RATE_LIMIT, 300))],
)
async def login(payload: AuthPayload, request: Request, response: Response):
    email = normalize_email(payload.email)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="邮箱或密码不正确")

        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(payload.password)
        auth_session = _new_session(user.id, request)
        session.add(auth_session)
        await session.commit()

    _set_auth_cookie(
        response,
        create_token(user.id, user.email, user.display_name, auth_session.id),
    )
    return _auth_response(user, auth_session)


@router.post("/refresh", response_model=AuthResponse)
async def refresh_session(request: Request, response: Response):
    token = auth_token_from_request(request)
    payload = decode_token(token, allow_expired=True) if token else None
    session_id = payload.get("sid") if payload else None
    if not payload or not session_id:
        _clear_auth_cookie(response)
        raise HTTPException(status_code=401, detail="session cannot be refreshed")

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.id == session_id,
                UserSession.user_id == payload["sub"],
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.utcnow(),
            )
        )
        row = result.one_or_none()
        if row is None:
            _clear_auth_cookie(response)
            raise HTTPException(status_code=401, detail="session has expired or been revoked")
        auth_session, user = row
        auth_session.last_seen_at = datetime.utcnow()
        await session.commit()

    _set_auth_cookie(
        response,
        create_token(user.id, user.email, user.display_name, auth_session.id),
    )
    return _auth_response(user, auth_session)


@router.post("/migrate-legacy-token", response_model=AuthResponse)
async def migrate_legacy_token(
    request: Request,
    response: Response,
):
    current = await _active_cookie_session(request)
    if current is not None:
        user_record, auth_session = current
        _set_auth_cookie(
            response,
            create_token(
                user_record.id,
                user_record.email,
                user_record.display_name,
                auth_session.id,
            ),
        )
        return _auth_response(user_record, auth_session)

    legacy_payload = decode_token(_bearer_token_from_request(request) or "")
    if legacy_payload is None:
        raise HTTPException(status_code=401, detail="authentication required")

    current = await _active_session_from_payload(legacy_payload)
    if current is not None:
        user_record, auth_session = current
    else:
        if legacy_payload.get("sid"):
            raise HTTPException(status_code=401, detail="session has been revoked or expired")

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User).where(User.id == legacy_payload["sub"]))
            user_record = result.scalar_one_or_none()
            if user_record is None:
                raise HTTPException(status_code=401, detail="legacy session user no longer exists")
            auth_session = _new_session(user_record.id, request)
            session.add(auth_session)
            await session.commit()

    _set_auth_cookie(
        response,
        create_token(
            user_record.id,
            user_record.email,
            user_record.display_name,
            auth_session.id,
        ),
    )
    return _auth_response(user_record, auth_session)


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = auth_token_from_request(request)
    payload = decode_token(token, allow_expired=True) if token else None
    session_id = payload.get("sid") if payload else None
    if session_id:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(UserSession).where(UserSession.id == session_id)
            )
            auth_session = result.scalar_one_or_none()
            if auth_session and auth_session.revoked_at is None:
                auth_session.revoked_at = datetime.utcnow()
                await session.commit()
    _clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return {
        "user": {"id": user.id, "email": user.email, "displayName": user.display_name},
        "sessionId": user.session_id,
    }


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(UserSession)
            .where(
                UserSession.user_id == user.id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.utcnow(),
            )
            .order_by(UserSession.last_seen_at.desc())
        )
        sessions = result.scalars().all()
    return [
        SessionOut(
            id=item.id,
            current=item.id == user.session_id,
            userAgent=item.user_agent,
            ipAddress=item.ip_address,
            createdAt=item.created_at.isoformat(),
            lastSeenAt=item.last_seen_at.isoformat(),
            expiresAt=item.expires_at.isoformat(),
        )
        for item in sessions
    ]


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: str,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(UserSession).where(
                UserSession.id == session_id,
                UserSession.user_id == user.id,
            )
        )
        auth_session = result.scalar_one_or_none()
        if auth_session is None:
            raise HTTPException(status_code=404, detail="session not found")
        if auth_session.revoked_at is None:
            auth_session.revoked_at = datetime.utcnow()
            await session.commit()
    if session_id == user.session_id:
        _clear_auth_cookie(response)
    return {"ok": True, "currentSessionRevoked": session_id == user.session_id}


@router.post(
    "/password-reset/request",
    response_model=PasswordResetRequestResponse,
    response_model_exclude_none=True,
    dependencies=[Depends(public_rate_limit("password-reset", 6, 300))],
)
async def request_password_reset(payload: PasswordResetRequest, request: Request):
    email = normalize_email(payload.email)
    generic_message = "如果账号存在，重置说明会发送到已配置的通知渠道。"
    development_token: Optional[str] = None

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            token, token_hash = generate_reset_token()
            session.add(
                PasswordResetToken(
                    id=random_id(),
                    user_id=user.id,
                    token_hash=token_hash,
                    requested_ip=_client_ip(request),
                    expires_at=datetime.utcnow() + timedelta(minutes=max(5, cfg.PASSWORD_RESET_TTL_MINUTES)),
                )
            )
            await session.commit()
            try:
                delivered = await deliver_reset_token(user.email, token)
            except Exception:
                delivered = False
            if not delivered and cfg.ENVIRONMENT != "production":
                development_token = token

    return PasswordResetRequestResponse(
        message=generic_message,
        developmentToken=development_token,
    )


@router.post(
    "/password-reset/confirm",
    dependencies=[Depends(public_rate_limit("password-reset-confirm", 10, 300))],
)
async def confirm_password_reset(payload: PasswordResetConfirm, response: Response):
    if len(payload.newPassword) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    email = normalize_email(payload.email)
    token_hash = hash_reset_token(payload.token)
    now = datetime.utcnow()

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(PasswordResetToken, User)
            .join(User, User.id == PasswordResetToken.user_id)
            .where(
                User.email == email,
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        row = result.one_or_none()
        if row is None:
            raise HTTPException(status_code=400, detail="password reset token is invalid or expired")
        reset_record, user = row
        user.password_hash = hash_password(payload.newPassword)
        reset_record.used_at = now
        session_result = await session.execute(
            select(UserSession).where(
                UserSession.user_id == user.id,
                UserSession.revoked_at.is_(None),
            )
        )
        for auth_session in session_result.scalars().all():
            auth_session.revoked_at = now
        await session.commit()

    _clear_auth_cookie(response)
    return {"ok": True, "message": "密码已更新，请重新登录。"}
