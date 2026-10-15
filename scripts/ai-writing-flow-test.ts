import assert from "node:assert/strict";
import { draftConversationIndex, draftWritingStage, updateDraftConversation } from "../src/utils/aiWritingFlow.ts";
import type { ChatMessage } from "../src/types.ts";

for (const [status, busy, error, hasBody, expected] of [
  [undefined, "outline", "", false, "configuring"],
  [undefined, "idle", "stopped", false, "failed"],
  ["outline_ready", "idle", "", false, "outline_ready"],
  ["outline_ready", "idle", "", true, "reviewing"],
  ["outline_ready", "section", "", true, "generating"],
  ["generating", "idle", "network", true, "generating"],
  ["outline_ready", "assemble", "", true, "assembling"],
  ["assembled", "save", "", true, "saving"],
  ["assembled", "idle", "save failure", true, "assembled"],
  ["outline_ready", "idle", "cancel failure", true, "reviewing"],
  ["failed", "idle", "section failure", true, "failed"],
] as const) assert.equal(draftWritingStage(status, busy, error, hasBody), expected);

const card = (id: string, metadata = {}): ChatMessage => ({ id, role: "assistant", text: "", draftCard: { seed: "same", ...metadata } });
const messages = [card("old", { draftId: "old" }), card("active", { checkpointId: "cp", draftId: "new" }), card("unbound"), card("saved", { status: "resolved" })];
const owner = { checkpointId: "cp", draftId: "new", seed: "same" };
assert.equal(draftConversationIndex(messages, owner), 1, "bound identity takes priority over a newer unbound seed");
const next = updateDraftConversation(messages, owner, { status: "resolved" });
assert.equal(next[1].draftCard?.status, "resolved");
assert.equal(next[0], messages[0]); assert.equal(next[2], messages[2]); assert.equal(next[3], messages[3]);
assert.equal(messages[1].draftCard?.status, undefined, "do not mutate existing conversation");
assert.equal(updateDraftConversation(messages, owner, { draftId: "new" }), messages, "unchanged binding does not rerender history");
assert.equal(draftConversationIndex([card("old", { checkpointId: "other" })], owner), -1);
assert.equal(draftConversationIndex([card("first"), card("last")], { seed: "same" }), 1);
console.log("AI writing flow: 11 real-state mappings; card identity, terminal history, immutability and unchanged binding passed");
