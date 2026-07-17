from __future__ import annotations

from app.routers import agent
from app.routers import ai
from app.services.runtime_errors import public_error_message


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    done = agent._agent_done_event("session_1", "run_1", "failed")
    _assert(done["type"] == "agent_done", "agent done event should have stable type")
    _assert(done["status"] == "failed", "agent done event should carry status")
    _assert(done["sessionId"] == "session_1" and done["runId"] == "run_1", "agent done event should carry ids")

    error = agent._agent_error_event("session_1", "run_1", "出错了", "agent_failed")
    _assert(error["type"] == "agent_error", "agent error event should have stable type")
    _assert(error["status"] == "failed", "agent error event should carry failed status")
    _assert(error["message"] == "出错了", "agent error event should carry public message")

    stream_error = ai._stream_error_event("生成失败", "ai_stream_failed")
    _assert(stream_error["type"] == "stream_error", "stream error event should have stable type")
    _assert(stream_error["status"] == "failed", "stream error event should carry failed status")

    _assert(
        public_error_message(ValueError("DeepSeek API Key is not configured on server"))
        == "AI 服务还没有配置好，暂时不能生成回复。",
        "not configured errors should become user-facing AI config message",
    )
    _assert(
        public_error_message(RuntimeError("DeepSeek API error: {\"error\":\"bad_gateway\"}"))
        == "模型服务这次没有正常返回，请稍后重试。",
        "upstream model errors should not leak raw provider payload",
    )
    _assert(
        public_error_message(RuntimeError("sqlalchemy.exc.OperationalError: password leaked"))
        == "Agent 执行失败，请稍后重试。",
        "technical backend errors should be hidden",
    )

    print("runtime event contract checks passed")


if __name__ == "__main__":
    main()
