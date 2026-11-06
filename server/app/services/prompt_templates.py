"""Versioned, repository-local prompt text with explicit input variables."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from functools import cache, lru_cache
from pathlib import Path

from app.config import cfg
from app.observability.context import structured_log

ROOT = Path(__file__).resolve().parents[1] / "prompt_templates"
VARIABLE = re.compile(r"\{\{([a-z][a-z0-9_]*)\}\}")
NAME = re.compile(r"[a-z][a-z0-9_-]*/[a-z][a-z0-9_-]*")
VERSION = re.compile(r"v[1-9][0-9]*")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PromptTemplate:
    version: str
    text: str
    digest: str
    variables: frozenset[str]


@lru_cache(maxsize=16)
def _load_manifest(root: Path) -> dict[str, str]:
    manifest = json.loads((root / "versions.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not all(
        isinstance(name, str) and NAME.fullmatch(name)
        and isinstance(version, str) and VERSION.fullmatch(version)
        for name, version in manifest.items()
    ):
        raise ValueError("Invalid prompt release manifest")
    return manifest


def _read_template(root: Path, name: str, version: str) -> PromptTemplate:
    raw = (root / f"{name}.{version}.md").read_bytes()
    template = raw.decode("utf-8")
    return PromptTemplate(version, template, hashlib.sha256(raw).hexdigest(), frozenset(VARIABLE.findall(template)))


@cache
def _built_in(name: str) -> PromptTemplate:
    version = _load_manifest(ROOT).get(name)
    if version is None:
        raise ValueError(f"Unknown prompt: {name!r}")
    return _read_template(ROOT, name, version)


@lru_cache(maxsize=8)
def _load_release(root: Path, release: str) -> dict[str, PromptTemplate]:
    if not VERSION.fullmatch(release):
        raise ValueError("Invalid prompt release name")
    directory = root / release
    manifest = _load_manifest(directory)
    if manifest.keys() != _load_manifest(ROOT).keys():
        raise ValueError("Prompt release must contain every registered template")
    templates = {}
    for name, version in manifest.items():
        template = _read_template(directory, name, version)
        if template.variables != _built_in(name).variables:
            raise ValueError(f"Prompt variables changed for {name}")
        templates[name] = template
    return templates


def activate_prompt_release(root: Path, release: str) -> None:
    """Validate a version directory before atomically switching readers."""
    _load_release(root, release)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=root, prefix=".active-", delete=False) as file:
        temporary = Path(file.name)
        file.write(release + "\n")
    try:
        temporary.chmod(0o644)
        os.replace(temporary, root / "active")
    finally:
        temporary.unlink(missing_ok=True)


def render_prompt(name: str, **variables: str) -> str:
    template = _built_in(name)
    release = None
    if cfg.PROMPT_RELEASE_ROOT:
        root = Path(cfg.PROMPT_RELEASE_ROOT)
        try:
            selected = (root / "active").read_text(encoding="utf-8").strip()
            template = _load_release(root, selected)[name]
            release = selected
        except (OSError, ValueError) as exc:
            structured_log(logger, logging.WARNING, "prompt.release_fallback", error=type(exc).__name__)
    missing = sorted(template.variables - variables.keys())
    unexpected = sorted(variables.keys() - template.variables)
    if missing or unexpected:
        raise ValueError(f"Prompt variables for {name}: missing={missing}, unexpected={unexpected}")
    result = VARIABLE.sub(lambda match: variables[match[1]], template.text)
    structured_log(logger, logging.INFO, "prompt.rendered", prompt_name=name,
                   prompt_version=template.version, prompt_digest=template.digest,
                   **({"prompt_release": release} if release else {}))
    return result
