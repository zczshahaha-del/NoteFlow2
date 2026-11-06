"""Versioned, repository-local prompt text with explicit input variables."""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

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


@cache
def _load_manifest() -> dict[str, str]:
    return json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))


@cache
def _load(name: str) -> PromptTemplate:
    if not NAME.fullmatch(name):
        raise ValueError(f"Invalid prompt name: {name!r}")
    version = _load_manifest().get(name, "")
    if not VERSION.fullmatch(version):
        raise ValueError(f"Prompt has no valid active version: {name}")
    raw = (ROOT / f"{name}.{version}.md").read_bytes()
    template = raw.decode("utf-8")
    return PromptTemplate(version, template, hashlib.sha256(raw).hexdigest(), frozenset(VARIABLE.findall(template)))


def render_prompt(name: str, **variables: str) -> str:
    template = _load(name)
    missing = sorted(template.variables - variables.keys())
    unexpected = sorted(variables.keys() - template.variables)
    if missing or unexpected:
        raise ValueError(f"Prompt variables for {name}: missing={missing}, unexpected={unexpected}")
    result = VARIABLE.sub(lambda match: variables[match[1]], template.text)
    structured_log(logger, logging.INFO, "prompt.rendered", prompt_name=name,
                   prompt_version=template.version, prompt_digest=template.digest)
    return result
