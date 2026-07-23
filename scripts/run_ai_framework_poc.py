from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "noteflow-ai-poc:step3"


def _run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and run the isolated NoteFlow AI framework PoC")
    parser.add_argument("--postgres-url", default="")
    parser.add_argument("--network", default="")
    args = parser.parse_args()

    _run(["docker", "build", "-f", "server/poc/Dockerfile", "-t", IMAGE, "server"])
    command = ["docker", "run", "--rm"]
    if args.network:
        command.extend(["--network", args.network])
    command.extend([IMAGE, "python", "/poc/check_ai_frameworks.py"])
    if args.postgres_url:
        command.extend(["--postgres-url", args.postgres_url])
    _run(command)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
