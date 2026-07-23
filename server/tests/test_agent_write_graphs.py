from __future__ import annotations

import asyncio
import importlib.metadata
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.agent.langgraph_draft import (
    DraftGraphDependencies,
    invoke_draft_graph,
    new_draft_state,
)
from app.agent.langgraph_edit import (
    EditGraphDependencies,
    invoke_edit_graph,
    new_edit_state,
)
from app.agent.rollout import runtime_circuit, select_agent_runtime
from app.services.draft_worker import (
    _PENDING_SECTION_STATUSES,
    _active_claim_tasks,
    _body_instruction,
    _job_config,
    _persist_job_config,
    cancel_active_draft_generation,
    reset_interrupted_sections,
)

LANGGRAPH_DURABLE_INTERRUPT = tuple(
    int(part) for part in importlib.metadata.version("langgraph").split(".")[:2]
) >= (1, 0)


def memory_saver():
    try:
        from langgraph.checkpoint.memory import InMemorySaver
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver as InMemorySaver
    return InMemorySaver()


class FakeDraftTools:
    def __init__(self) -> None:
        self.created = 0
        self.generated = 0
        self.saved = 0
        self.cancelled = 0

    async def outline(self, _state):
        return {"outline": "## 第一节"}

    async def create(self, _state):
        self.created += 1
        return {"draft_id": "draft-1"}

    async def sections(self, _state):
        self.generated += 1
        return {}

    async def assemble(self, _state):
        return {"assembled_content": "## 第一节\n正文"}

    async def save(self, _state):
        self.saved += 1
        return {"saved_note_id": "note-1"}

    async def cancel(self, _state):
        self.cancelled += 1
        return {}

    def dependencies(self):
        return DraftGraphDependencies(
            generate_outline=self.outline, create_draft=self.create,
            generate_sections=self.sections, assemble=self.assemble,
            save=self.save, cancel=self.cancel,
        )


class FakeEditTools:
    def __init__(self) -> None:
        self.previews = 0
        self.revisions = 0
        self.applies = 0
        self.cancels = 0

    async def resolve(self, _state):
        return {"target_type": "note", "source_content_hash": "abc"}

    async def preview(self, _state):
        self.previews += 1
        return {"preview_id": "preview-1"}

    async def revise(self, _state):
        self.revisions += 1
        return {}

    async def apply(self, _state):
        self.applies += 1
        return {}

    async def cancel(self, _state):
        self.cancels += 1
        return {}

    def dependencies(self):
        return EditGraphDependencies(
            resolve_target=self.resolve, create_preview=self.preview,
            revise_preview=self.revise, apply_preview=self.apply,
            cancel_preview=self.cancel,
        )


class DraftGraphTest(unittest.TestCase):
    @unittest.skipUnless(LANGGRAPH_DURABLE_INTERRUPT, "requires pinned langgraph >= 1.0")
    def test_outline_and_save_are_two_explicit_interrupts(self) -> None:
        async def exercise():
            saver = memory_saver()
            tools = FakeDraftTools()
            state = new_draft_state(user_id="u", topic="LangGraph", thread_id="draft-thread")
            first = await invoke_draft_graph(
                state, dependencies=tools.dependencies(), checkpointer=saver, thread_id="draft-thread",
            )
            second = await invoke_draft_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver, thread_id="draft-thread",
                resume={"action": "confirm"},
            )
            third = await invoke_draft_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver, thread_id="draft-thread",
                resume={"action": "confirm"},
            )
            final = await invoke_draft_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver, thread_id="draft-thread",
                resume={"action": "confirm"},
            )
            return tools, first, second, third, final

        tools, first, second, third, final = asyncio.run(exercise())
        self.assertIn("__interrupt__", first)
        self.assertIn("__interrupt__", second)
        self.assertIn("__interrupt__", third)
        self.assertEqual(final["status"], "saved")
        self.assertEqual(final["saved_note_id"], "note-1")
        self.assertEqual((tools.created, tools.generated, tools.saved), (1, 1, 1))

    def test_generated_worker_never_creates_formal_note(self) -> None:
        source = (Path(__file__).parents[1] / "app/services/draft_worker.py").read_text()
        self.assertNotIn("Note(", source)
        self.assertIn('draft.status = "assembled"', source)

    def test_interrupted_sections_return_to_a_restartable_state(self) -> None:
        empty = SimpleNamespace(status="generating", content="")
        completed = SimpleNamespace(status="generating", content="已经保存的正文")
        untouched = SimpleNamespace(status="confirmed", content="正文")

        reset_interrupted_sections([empty, completed, untouched])

        self.assertEqual(empty.status, "outline_only")
        self.assertEqual(completed.status, "generated")
        self.assertEqual(untouched.status, "confirmed")

    def test_active_generation_task_is_really_cancelled(self) -> None:
        async def exercise() -> tuple[bool, bool]:
            started = asyncio.Event()

            async def generating() -> None:
                started.set()
                await asyncio.Event().wait()

            task = asyncio.create_task(generating())
            _active_claim_tasks["draft-stop-test"] = task
            await started.wait()
            cancelled = await cancel_active_draft_generation("draft-stop-test")
            return cancelled, task.cancelled()

        self.assertEqual(asyncio.run(exercise()), (True, True))

    def test_body_instruction_is_read_from_draft_config(self) -> None:
        draft = SimpleNamespace(
            draft_config={"bodyInstruction": "  每章提供一个完整示例，并减少空泛概念。  "}
        )
        self.assertEqual(_body_instruction(draft), "每章提供一个完整示例，并减少空泛概念。")

    def test_revision_sections_remain_claimable_by_background_worker(self) -> None:
        self.assertIn("needs_revision", _PENDING_SECTION_STATUSES)

    def test_worker_recovers_stale_jobs_before_accepting_new_work(self) -> None:
        source = (Path(__file__).parents[1] / "app/services/draft_worker.py").read_text()
        self.assertIn("await _recover_stale_generation_jobs()", source)
        self.assertIn('job["status"] = "interrupted"', source)

    def test_worker_persists_nested_generation_job_updates(self) -> None:
        draft = SimpleNamespace(draft_config={"generationJob": {"status": "queued", "attempts": {}}})
        job = _job_config(draft)
        job["status"] = "generating"
        job["currentSectionTitle"] = "第一章"

        _persist_job_config(draft, job)

        self.assertEqual(draft.draft_config["generationJob"]["status"], "generating")
        self.assertEqual(draft.draft_config["generationJob"]["currentSectionTitle"], "第一章")


class EditGraphTest(unittest.TestCase):
    @unittest.skipUnless(LANGGRAPH_DURABLE_INTERRUPT, "requires pinned langgraph >= 1.0")
    def test_preview_can_revise_then_apply_once(self) -> None:
        async def exercise():
            saver = memory_saver()
            tools = FakeEditTools()
            state = new_edit_state(
                user_id="u", note_id="n", instruction="改得清楚", thread_id="edit-thread",
            )
            first = await invoke_edit_graph(
                state, dependencies=tools.dependencies(), checkpointer=saver, thread_id="edit-thread",
            )
            revised = await invoke_edit_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver, thread_id="edit-thread",
                resume={"action": "revise", "instruction": "再短一点"},
            )
            final = await invoke_edit_graph(
                None, dependencies=tools.dependencies(), checkpointer=saver, thread_id="edit-thread",
                resume={"action": "apply"},
            )
            return tools, first, revised, final

        tools, first, revised, final = asyncio.run(exercise())
        self.assertIn("__interrupt__", first)
        self.assertIn("__interrupt__", revised)
        self.assertEqual(final["status"], "applied")
        self.assertEqual((tools.previews, tools.revisions, tools.applies), (1, 1, 1))


class CanarySelectionTest(unittest.TestCase):
    def tearDown(self) -> None:
        runtime_circuit.reset()

    def test_disabled_and_write_intents_always_use_legacy(self) -> None:
        with patch("app.agent.rollout.cfg.AGENT_RUNTIME", "legacy"), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_ENABLED", False):
            self.assertEqual(select_agent_runtime(user_id="u", intent="general_chat", mode="chat").runtime, "legacy")
        with patch("app.agent.rollout.cfg.AGENT_RUNTIME", "langgraph"), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_ENABLED", True), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_PERCENT", 100):
            self.assertEqual(select_agent_runtime(user_id="u", intent="note_edit_create", mode="chat").runtime, "legacy")

    def test_allowlist_and_circuit_breaker(self) -> None:
        with patch("app.agent.rollout.cfg.AGENT_RUNTIME", "langgraph"), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_ENABLED", True), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_PERCENT", 0), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_USER_IDS", {"internal"}), \
             patch("app.agent.rollout.cfg.LANGGRAPH_CANARY_ERROR_THRESHOLD", 1):
            self.assertEqual(select_agent_runtime(user_id="internal", intent="general_chat", mode="chat").runtime, "langgraph")
            runtime_circuit.failure("provider_failed")
            decision = select_agent_runtime(user_id="internal", intent="general_chat", mode="chat")
            self.assertEqual(decision.runtime, "legacy")
            self.assertTrue(decision.circuit_open)


if __name__ == "__main__":
    unittest.main()
