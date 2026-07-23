from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(command: list[str], *, binary: bool = False, input_data=None):
    return subprocess.run(
        command,
        cwd=ROOT,
        input=input_data,
        capture_output=True,
        text=not binary,
        check=True,
    )


def create_backup(output_dir: Path, *, container: str, database: str, user: str) -> dict:
    output_dir.mkdir(parents=True, exist_ok=False)
    dump_path = output_dir / "noteflow-postgres.dump"
    dump = _run(
        ["docker", "exec", container, "pg_dump", "-U", user, "-d", database, "-Fc", "--no-owner"],
        binary=True,
    )
    dump_path.write_bytes(dump.stdout)

    attachment_root = ROOT / "server" / "data" / "attachments"
    attachment_path = output_dir / "attachments.tar.gz"
    with tarfile.open(attachment_path, "w:gz") as archive:
        if attachment_root.exists():
            archive.add(attachment_root, arcname="attachments")

    config_path = output_dir / "config-schema.json"
    config_files = [ROOT / ".env.example", ROOT / "server" / ".env.example"]
    config_schema = {
        "note": "Only variable names and example-file hashes are backed up; runtime secret values are excluded.",
        "files": [],
    }
    for path in config_files:
        keys = []
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                keys.append(stripped.split("=", 1)[0])
        config_schema["files"].append(
            {"path": str(path.relative_to(ROOT)), "sha256": _sha256(path), "keys": sorted(set(keys))}
        )
    config_path.write_text(json.dumps(config_schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    files = [dump_path, attachment_path, config_path]
    manifest = {
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "database": database,
        "container": container,
        "files": [
            {"name": path.name, "bytes": path.stat().st_size, "sha256": _sha256(path)} for path in files
        ],
        "containsRuntimeSecrets": False,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a verified NoteFlow PostgreSQL/attachment/config-schema backup")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--container", default="noteflow-postgres")
    parser.add_argument("--database", default="noteflow")
    parser.add_argument("--user", default="noteflow")
    args = parser.parse_args()
    manifest = create_backup(args.output.resolve(), container=args.container, database=args.database, user=args.user)
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
