from __future__ import annotations

import unittest

from app.services.password_reset import generate_reset_token, hash_reset_token
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


if __name__ == "__main__":
    unittest.main()
