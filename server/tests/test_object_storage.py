from __future__ import annotations

import asyncio
import tempfile
import unittest

from app.services.object_storage import LocalObjectStorage


class LocalObjectStorageTest(unittest.TestCase):
    def test_put_get_delete_and_path_guard(self) -> None:
        async def scenario() -> None:
            with tempfile.TemporaryDirectory() as root:
                storage = LocalObjectStorage(root)
                stored = await storage.put("user/attachment.txt", b"NoteFlow")
                self.assertEqual(stored.size, 8)
                self.assertEqual(len(stored.sha256), 64)
                self.assertEqual(await storage.get(stored.key), b"NoteFlow")
                await storage.delete(stored.key)
                with self.assertRaises(FileNotFoundError):
                    await storage.get(stored.key)
                with self.assertRaises(ValueError):
                    await storage.put("../escape.txt", b"blocked")

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
