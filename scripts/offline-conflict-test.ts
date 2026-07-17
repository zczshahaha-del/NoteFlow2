import assert from "node:assert/strict";
import { hasRemoteConflict } from "../src/services/offlineQueue.ts";

assert.equal(hasRemoteConflict("2026-01-01T00:00:00", "2026-01-01T00:00:00", "远端", "本地"), false);
assert.equal(hasRemoteConflict("2026-01-01T00:00:00", "2026-01-02T00:00:00", "远端", "本地"), true);
assert.equal(hasRemoteConflict("2026-01-01T00:00:00", "2026-01-02T00:00:00", "相同", "相同"), false);
assert.equal(hasRemoteConflict(null, "2026-01-02T00:00:00", "远端", "本地"), false);

console.log(JSON.stringify({ ok: true, conflictDetected: true }));
