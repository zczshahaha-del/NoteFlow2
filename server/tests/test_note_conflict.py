from __future__ import annotations

import unittest
from datetime import datetime

from app.routers.notes import _has_note_version_conflict


class NoteConflictTest(unittest.TestCase):
    def test_same_version_is_safe_to_update(self) -> None:
        current = datetime(2026, 7, 15, 10, 30, 0)
        self.assertFalse(_has_note_version_conflict(current.isoformat(), current))

    def test_remote_change_is_detected(self) -> None:
        current = datetime(2026, 7, 15, 10, 31, 0)
        self.assertTrue(_has_note_version_conflict("2026-07-15T10:30:00", current))

    def test_legacy_client_without_version_remains_compatible(self) -> None:
        self.assertFalse(_has_note_version_conflict(None, datetime.utcnow()))


if __name__ == "__main__":
    unittest.main()
