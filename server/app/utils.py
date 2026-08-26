from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import cfg


# ── Password hashing ──

ITERATIONS = 120000
_password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def _hash_password_legacy(password: str) -> str:
    salt = os.urandom(16)
    key = _pbkdf2_key(password.encode(), salt, ITERATIONS, 32)
    import base64
    return (
        f"pbkdf2_sha256${ITERATIONS}"
        f"${base64.b64encode(salt).rstrip(b'=').decode()}"
        f"${base64.b64encode(key).rstrip(b'=').decode()}"
    )


def verify_password(password: str, encoded: str) -> bool:
    if encoded.startswith("$argon2id$"):
        try:
            return _password_hasher.verify(encoded, password)
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False

    import base64
    parts = encoded.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
        salt = base64.b64decode(parts[2] + "==" )
        expected = base64.b64decode(parts[3] + "==")
    except Exception:
        return False
    actual = _pbkdf2_key(password.encode(), salt, iterations, len(expected))
    return hmac.compare_digest(expected, actual)


def password_needs_rehash(encoded: str) -> bool:
    if not encoded.startswith("$argon2id$"):
        return True
    try:
        return _password_hasher.check_needs_rehash(encoded)
    except InvalidHashError:
        return True


def _pbkdf2_key(password: bytes, salt: bytes, iterations: int, key_length: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations, dklen=key_length)


# ── JWT ──

def create_token(user_id: str, email: str, display_name: str, session_id: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "displayName": display_name,
        "iat": now,
        "exp": now + timedelta(minutes=max(5, cfg.AUTH_ACCESS_TTL_MINUTES)),
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, cfg.JWT_SECRET, algorithm="HS256")


def decode_token(token: str, *, allow_expired: bool = False) -> dict | None:
    try:
        payload = jwt.decode(
            token,
            cfg.JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_exp": not allow_expired},
        )
        if not payload.get("sub"):
            return None
        return payload
    except jwt.InvalidTokenError:
        return None


# ── ID generation ──

def random_id() -> str:
    return uuid.uuid4().hex


# ── Email / text utils ──

def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    if not email or len(email) > 255 or any(character in email for character in "\r\n\t "):
        return False
    local, separator, domain = email.rpartition("@")
    if separator != "@" or not local or not domain or len(local) > 64:
        return False
    if domain.startswith(".") or domain.endswith(".") or "." not in domain:
        return False
    return all(part and not part.startswith("-") and not part.endswith("-") for part in domain.split("."))


def is_duplicate_error(err: Exception) -> bool:
    return "duplicate" in str(err).lower()
