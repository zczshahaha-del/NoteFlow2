from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.config import cfg
from app.services.password_reset import generate_reset_token, hash_reset_token
from app.services.email_auth import generate_email_code, hash_email_code, verify_email_code
from app.services.smtp_delivery import _send_email
from app.utils import (
    _hash_password_legacy,
    create_token,
    decode_token,
    hash_password,
    password_needs_rehash,
    verify_password,
)


class AuthSecurityTest(unittest.TestCase):
    def test_new_passwords_use_argon2id(self) -> None:
        encoded = hash_password("a-long-password")

        self.assertTrue(encoded.startswith("$argon2id$"))
        self.assertTrue(verify_password("a-long-password", encoded))
        self.assertFalse(verify_password("wrong-password", encoded))
        self.assertFalse(password_needs_rehash(encoded))

    def test_legacy_pbkdf2_passwords_remain_compatible(self) -> None:
        encoded = _hash_password_legacy("legacy-password")

        self.assertTrue(encoded.startswith("pbkdf2_sha256$"))
        self.assertTrue(verify_password("legacy-password", encoded))
        self.assertFalse(verify_password("wrong-password", encoded))
        self.assertTrue(password_needs_rehash(encoded))

    def test_access_token_is_bound_to_server_session(self) -> None:
        token = create_token("user-1", "user@example.com", "User", "session-1")
        payload = decode_token(token)

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["sub"], "user-1")
        self.assertEqual(payload["sid"], "session-1")
        self.assertIn("exp", payload)

    def test_password_reset_tokens_are_random_and_only_hash_is_stored(self) -> None:
        token, digest = generate_reset_token()
        other_token, other_digest = generate_reset_token()

        self.assertNotEqual(token, other_token)
        self.assertEqual(digest, hash_reset_token(token))
        self.assertNotEqual(digest, token)
        self.assertNotEqual(digest, other_digest)
        self.assertEqual(len(digest), 64)

    def test_email_codes_are_six_digits_and_bound_to_identity_and_purpose(self) -> None:
        code = generate_email_code()
        digest = hash_email_code("user@example.com", code, "login")

        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(len(digest), 64)
        self.assertTrue(verify_email_code("user@example.com", code, "login", digest))
        self.assertFalse(verify_email_code("other@example.com", code, "login", digest))
        self.assertFalse(verify_email_code("user@example.com", code, "change_email", digest))
        self.assertFalse(verify_email_code("user@example.com", code, "reset_password", digest))
        self.assertFalse(verify_email_code("user@example.com", "000000", "login", digest))


class EmailDeliveryTest(unittest.IsolatedAsyncioTestCase):
    def test_smtp_sender_authenticates_and_sends_multipart_message(self) -> None:
        smtp = MagicMock()
        smtp_context = MagicMock()
        smtp_context.__enter__.return_value = smtp
        with (
            patch.object(cfg, "SMTP_HOST", "smtp.example.com"),
            patch.object(cfg, "SMTP_PORT", 465),
            patch.object(cfg, "SMTP_USERNAME", "sender@example.com"),
            patch.object(cfg, "SMTP_PASSWORD", "app-password"),
            patch.object(cfg, "SMTP_FROM_EMAIL", "sender@example.com"),
            patch.object(cfg, "SMTP_USE_SSL", True),
            patch.object(cfg, "SMTP_USE_TLS", False),
            patch("app.services.smtp_delivery.smtplib.SMTP_SSL", return_value=smtp_context) as smtp_ssl,
        ):
            _send_email(
                "user@example.com",
                "重置密码",
                "text body",
                "<p>html body</p>",
            )

        smtp_ssl.assert_called_once_with("smtp.example.com", 465, timeout=10)
        smtp.login.assert_called_once_with("sender@example.com", "app-password")
        message = smtp.send_message.call_args.args[0]
        self.assertEqual(message["To"], "user@example.com")
        self.assertTrue(message.is_multipart())


if __name__ == "__main__":
    unittest.main()
