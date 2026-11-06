"""Validate and activate a complete NoteFlow prompt release."""
import argparse
from pathlib import Path

from app.services.prompt_templates import activate_prompt_release


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("release", help="Immutable release directory, for example v2")
    args = parser.parse_args()
    try:
        activate_prompt_release(args.root, args.release)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    print(f"Activated prompt release {args.release}")


if __name__ == "__main__":
    main()
