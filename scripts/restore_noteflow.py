from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_backup(backup_dir: Path) -> dict:
    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    for item in manifest["files"]:
        path = backup_dir / item["name"]
        if not path.is_file() or path.stat().st_size != item["bytes"] or _sha256(path) != item["sha256"]:
            raise RuntimeError(f"backup checksum mismatch: {item['name']}")
    if manifest.get("containsRuntimeSecrets") is not False:
        raise RuntimeError("backup manifest does not guarantee secret exclusion")
    return manifest


def restore_database(
    backup_dir: Path, *, container: str, target_database: str, user: str, create: bool,
) -> None:
    if not re.fullmatch(r"noteflow_(?:drill|restore)_[a-z0-9_]+", target_database):
        raise ValueError("target database must be an isolated noteflow_drill_* or noteflow_restore_* database")
    verify_backup(backup_dir)
    if create:
        subprocess.run(
            ["docker", "exec", container, "createdb", "-U", user, target_database],
            cwd=ROOT, check=True, capture_output=True,
        )
    dump = (backup_dir / "noteflow-postgres.dump").read_bytes()
    subprocess.run(
        ["docker", "exec", "-i", container, "pg_restore", "-U", user, "-d", target_database, "--no-owner"],
        cwd=ROOT, input=dump, check=True, capture_output=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore a NoteFlow backup into an isolated database")
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--target-database", required=True)
    parser.add_argument("--container", default="noteflow-postgres")
    parser.add_argument("--user", default="noteflow")
    parser.add_argument("--create", action="store_true")
    args = parser.parse_args()
    restore_database(
        args.backup.resolve(), container=args.container, target_database=args.target_database,
        user=args.user, create=args.create,
    )
    print(json.dumps({"restored": True, "targetDatabase": args.target_database}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
