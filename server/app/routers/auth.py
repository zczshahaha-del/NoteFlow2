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
from app.models.db import EmailLoginCode, User, UserSession
from app.services.email_auth import (
    deliver_email_code,
    generate_email_code,
    hash_email_code,
    verify_email_code,
)
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
    emailVerified: bool


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
    code: str
    newPassword: str


class PasswordResetRequestResponse(BaseModel):
    ok: bool = True
    message: str


class EmailCodeRequest(BaseModel):
    email: str


class EmailCodeConfirm(BaseModel):
    email: str
    code: str


class EmailCodeRequestResponse(BaseModel):
    ok: bool = True
    message: str
    developmentCode: Optional[str] = None


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
        user=AuthUserOut(
            id=user.id,
            email=user.email,
            displayName=user.display_name,
            emailVerified=user.email_verified_at is not None,
        ),
        sessionExpiresAt=auth_session.expires_at.isoformat(),
    )


async def _issue_email_code(
    *,
    email: str,
    purpose: str,
    request: Request,
    user_id: Optional[str] = None,
) -> EmailCodeRequestResponse:
    now = datetime.utcnow()
    recent_after = now - timedelta(seconds=cfg.EMAIL_CODE_RESEND_SECONDS)
    code = generate_email_code()
    record = EmailLoginCode(
        id=random_id(),
        user_id=user_id,
        email=email,
        purpose=purpose,
        code_hash=hash_email_code(email, code, purpose, user_id),
        requested_ip=_client_ip(request),
        expires_at=now + timedelta(minutes=cfg.EMAIL_CODE_TTL_MINUTES),
    )

    async with AsyncSessionLocal() as session:
        user_condition = (
            EmailLoginCode.user_id == user_id
            if user_id is not None
            else EmailLoginCode.user_id.is_(None)
        )
        recent_result = await session.execute(
            select(EmailLoginCode)
            .where(
                EmailLoginCode.email == email,
                EmailLoginCode.purpose == purpose,
                user_condition,
                EmailLoginCode.created_at > recent_after,
                EmailLoginCode.used_at.is_(None),
            )
            .order_by(EmailLoginCode.created_at.desc())
            .limit(1)
        )
        if recent_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=429,
                detail=f"验证码发送较频繁，请等待 {cfg.EMAIL_CODE_RESEND_SECONDS} 秒后重试。",
            )
        active_result = await session.execute(
            select(EmailLoginCode).where(
                EmailLoginCode.email == email,
                EmailLoginCode.purpose == purpose,
                user_condition,
                EmailLoginCode.used_at.is_(None),
            )
        )
        for previous in active_result.scalars().all():
            previous.used_at = now
        session.add(record)
        await session.commit()

    try:
        delivered = await deliver_email_code(email, code, purpose)
    except Exception:
        delivered = False
    if delivered:
        return EmailCodeRequestResponse(message="验证码已发送，请检查邮箱。")
    if cfg.ENVIRONMENT != "production":
        return EmailCodeRequestResponse(
            message="开发环境验证码已生成。",
            developmentCode=code,
        )

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(EmailLoginCode).where(EmailLoginCode.id == record.id))
        failed_record = result.scalar_one_or_none()
        if failed_record is not None:
            failed_record.used_at = datetime.utcnow()
            await session.commit()
    raise HTTPException(status_code=503, detail="验证码暂时无法发送，请稍后重试。")


async def _consume_email_code(
    *,
    email: str,
    code: str,
    purpose: str,
    session,
    user_id: Optional[str] = None,
) -> None:
    now = datetime.utcnow()
    user_condition = (
        EmailLoginCode.user_id == user_id
        if user_id is not None
        else EmailLoginCode.user_id.is_(None)
    )
    result = await session.execute(
        select(EmailLoginCode)
        .where(
            EmailLoginCode.email == email,
            EmailLoginCode.purpose == purpose,
            user_condition,
            EmailLoginCode.used_at.is_(None),
            EmailLoginCode.expires_at > now,
        )
        .order_by(EmailLoginCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    record = result.scalar_one_or_none()
    if record is None or record.attempt_count >= cfg.EMAIL_CODE_MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="验证码无效或已过期。")
    if not verify_email_code(email, code, purpose, record.code_hash, user_id):
        record.attempt_count += 1
        if record.attempt_count >= cfg.EMAIL_CODE_MAX_ATTEMPTS:
            record.used_at = now
        await session.commit()
        raise HTTPException(status_code=400, detail="验证码不正确，请重新输入。")
    record.used_at = now


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
        if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
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


@router.post(
    "/email-code/request",
    response_model=EmailCodeRequestResponse,
    response_model_exclude_none=True,
    dependencies=[Depends(public_rate_limit("email-code", 6, 300))],
)
async def request_email_login_code(payload: EmailCodeRequest, request: Request):
    email = normalize_email(payload.email)
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请输入有效邮箱地址。")
    return await _issue_email_code(email=email, purpose="login", request=request)


@router.post(
    "/email-code/confirm",
    response_model=AuthResponse,
    dependencies=[Depends(public_rate_limit("email-code-confirm", 12, 300))],
)
async def confirm_email_login_code(
    payload: EmailCodeConfirm,
    request: Request,
    response: Response,
):
    email = normalize_email(payload.email)
    code = payload.code.strip()
    if not is_valid_email(email) or len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=400, detail="邮箱或验证码格式不正确。")
    now = datetime.utcnow()

    async with AsyncSessionLocal() as session:
        await _consume_email_code(
            email=email,
            code=code,
            purpose="login",
            session=session,
        )
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(
                id=random_id(),
                email=email,
                email_verified_at=now,
                display_name=email.split("@", 1)[0],
                password_hash=None,
            )
            session.add(user)
        elif user.email_verified_at is None:
            user.email_verified_at = now
        auth_session = _new_session(user.id, request)
        session.add(auth_session)
        await session.commit()

    _set_auth_cookie(
        response,
        create_token(user.id, user.email, user.display_name, auth_session.id),
    )
    return _auth_response(user, auth_session)


@router.post("/email-change/request", response_model=EmailCodeRequestResponse, response_model_exclude_none=True)
async def request_email_change(
    payload: EmailCodeRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    email = normalize_email(payload.email)
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请输入有效邮箱地址。")
    async with AsyncSessionLocal() as session:
        existing_result = await session.execute(
            select(User).where(User.email == email, User.id != user.id)
        )
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该邮箱已经绑定其他账号。")
    return await _issue_email_code(
        email=email,
        purpose="change_email",
        request=request,
        user_id=user.id,
    )


@router.post("/email-change/confirm", response_model=AuthResponse)
async def confirm_email_change(
    payload: EmailCodeConfirm,
    request: Request,
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
):
    email = normalize_email(payload.email)
    code = payload.code.strip()
    if not is_valid_email(email) or len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=400, detail="邮箱或验证码格式不正确。")
    now = datetime.utcnow()

    async with AsyncSessionLocal() as session:
        await _consume_email_code(
            email=email,
            code=code,
            purpose="change_email",
            session=session,
            user_id=current_user.id,
        )
        existing_result = await session.execute(
            select(User).where(User.email == email, User.id != current_user.id)
        )
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=409, detail="该邮箱已经绑定其他账号。")
        user_result = await session.execute(select(User).where(User.id == current_user.id))
        user = user_result.scalar_one()
        user.email = email
        user.email_verified_at = now
        session_result = await session.execute(
            select(UserSession).where(
                UserSession.user_id == user.id,
                UserSession.id != current_user.session_id,
                UserSession.revoked_at.is_(None),
            )
        )
        for other_session in session_result.scalars().all():
            other_session.revoked_at = now
        auth_session = None
        if current_user.session_id:
            current_session_result = await session.execute(
                select(UserSession).where(UserSession.id == current_user.session_id)
            )
            auth_session = current_session_result.scalar_one_or_none()
        if auth_session is None:
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
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == user.id))
        user_record = result.scalar_one()
    return {
        "user": {
            "id": user_record.id,
            "email": user_record.email,
            "displayName": user_record.display_name,
            "emailVerified": user_record.email_verified_at is not None,
        },
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
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="请输入有效邮箱地址。")

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None and cfg.ENVIRONMENT != "production":
            raise HTTPException(status_code=404, detail="该邮箱还没有账号。")
    if user is None:
        return PasswordResetRequestResponse(message="如果账号存在，验证码已发送。")
    result = await _issue_email_code(
        email=user.email,
        purpose="reset_password",
        request=request,
        user_id=user.id,
    )
    return PasswordResetRequestResponse(message=result.message)


@router.post(
    "/password-reset/confirm",
    dependencies=[Depends(public_rate_limit("password-reset-confirm", 10, 300))],
)
async def confirm_password_reset(payload: PasswordResetConfirm, response: Response):
    if len(payload.newPassword) < 8:
        raise HTTPException(status_code=400, detail="新密码至少需要 8 位。")
    email = normalize_email(payload.email)
    code = payload.code.strip()
    if not is_valid_email(email) or len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=400, detail="邮箱或验证码格式不正确。")
    now = datetime.utcnow()

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=400, detail="验证码不正确或已失效。")
        await _consume_email_code(
            email=email,
            code=code,
            purpose="reset_password",
            session=session,
            user_id=user.id,
        )
        user.password_hash = hash_password(payload.newPassword)
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
