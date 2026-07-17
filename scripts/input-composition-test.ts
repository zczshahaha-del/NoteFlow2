import assert from "node:assert/strict";
import { shouldSubmitChatInput } from "../src/utils/inputComposition.ts";

assert.equal(shouldSubmitChatInput({ key: "Enter", shiftKey: false }, true), false);
assert.equal(
  shouldSubmitChatInput({ key: "Enter", shiftKey: false, isComposing: true }, false),
  false
);
assert.equal(
  shouldSubmitChatInput({ key: "Enter", shiftKey: false, keyCode: 229 }, false),
  false
);
assert.equal(shouldSubmitChatInput({ key: "Enter", shiftKey: true }, false), false);
assert.equal(shouldSubmitChatInput({ key: "a", shiftKey: false }, false), false);
assert.equal(shouldSubmitChatInput({ key: "Enter", shiftKey: false }, false), true);

console.log(JSON.stringify({ ok: true, cases: 6 }));
