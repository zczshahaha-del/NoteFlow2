from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime


_CREDENTIAL_RE = re.compile(
    r"(?:密码|口令|验证码|cvv|pin码|私钥|助记词|secret|password|passwd|api[_ -]?key|access[_ -]?token|"
    r"bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)",
    re.I,
)
_FINANCIAL_RE = re.compile(r"(?:银行卡|信用卡|借记卡|银行账号|支付密码|卡号).{0,20}\d{8,}", re.I)
_MEDICAL_RE = re.compile(r"(?:病历号|诊断证明|处方编号|医保卡号|住院号|检验报告编号)", re.I)
_THIRD_PARTY_RE = re.compile(
    r"(?:我(?:朋友|同学|同事|室友|对象|家人|父母|爸爸|妈妈)|他|她|别人|客户).{0,20}"
    r"(?:叫|喜欢|住在|电话|邮箱|身份证|患有|得了)",
    re.I,
)
_TEMPORARY_RE = re.compile(r"(?:只限这次|仅这次|这次|今天|本轮|当前对话|临时|先暂时)", re.I)


@dataclass(frozen=True)
class MemoryPolicyDecision:
    allowed: bool
    status: str
    reason: str
    sensitivity: str = "normal"


def classify_memory_content(content: str) -> MemoryPolicyDecision:
    text = (content or "").strip()
    if not text:
        return MemoryPolicyDecision(False, "rejected", "empty")
    if _CREDENTIAL_RE.search(text):
        return MemoryPolicyDecision(False, "rejected", "credential_or_secret", "secret")
    if _FINANCIAL_RE.search(text):
        return MemoryPolicyDecision(False, "rejected", "financial_identifier", "high")
    if _MEDICAL_RE.search(text):
        return MemoryPolicyDecision(False, "rejected", "medical_record_identifier", "high")
    if _THIRD_PARTY_RE.search(text):
        return MemoryPolicyDecision(False, "rejected", "third_party_personal_data", "high")
    if _TEMPORARY_RE.search(text):
        return MemoryPolicyDecision(False, "rejected", "temporary_instruction")
    return MemoryPolicyDecision(True, "active", "allowed")


def memory_is_eligible(memory, *, now: datetime | None = None) -> bool:
    if memory is None or memory.status != "active" or memory.deleted_at is not None:
        return False
    current = now or datetime.utcnow()
    if memory.expires_at is not None and memory.expires_at <= current:
        return False
    return classify_memory_content(memory.content).allowed


def filter_eligible_memories(memories: list, *, limit: int = 6) -> list:
    safe_limit = max(3, min(8, int(limit)))
    return [memory for memory in memories if memory_is_eligible(memory)][:safe_limit]
