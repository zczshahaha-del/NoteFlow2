import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const dom = new JSDOM("", { url: "http://noteflow.test/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init = {}) => new Promise(resolve => requests.push({
  url: String(input), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, resolve,
}));
const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const request = async (suffix, method) => {
  for (let n = 0; n < 100; n++) {
    const found = requests.find(item => !item.used && item.url.endsWith(suffix) && (!method || item.method === method));
    if (found) { found.used = true; return found; }
    await tick();
  }
  assert.fail(`Missing request ${method ?? ""} ${suffix}`);
};
const reply = (req, data, status = 200) => req.resolve(new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
}));
const preview = (id, content = "原预览", updatedAt = "2026-10-20T00:00:00.123456+00:00") => ({
  id, noteId: "note", targetType: "section", sectionId: "section", oldContent: "正式笔记原文",
  newContent: content, instruction: "完善", changeSummary: [], status: "preview", createdAt: updatedAt,
  updatedAt, appliedAt: null, cancelledAt: null,
});
const note = { id: "note", title: "测试", content: "正式笔记原文", tags: [], categoryId: null,
  isPinned: false, isFavorite: false, indexStatus: "indexed" };

try {
  const { useAppStore: store } = await vite.ssrLoadModule("/src/store/index.tsx");
  const initial = store.getInitialState();
  const seed = id => {
    store.setState({ ...initial, hydratedUserId: "draft-store-test", activeEditPreview: preview(id), centerMode: "edit",
      selectedFileId: "note", fileContents: { note: note.content }, treeData: [{ id: "note", name: "测试.md", type: "file", content: note.content }],
      noteSaveState: { status: "saved" }, noteSaveStates: { note: { status: "saved" } } }, true);
  };
  seed("unchanged");
  store.getState().updateEditPreviewDraft("原预览");
  await store.getState().flushEditPreviewDraft();
  assert.deepEqual(store.getState().editPreviewDrafts, {}, "Focusing an unchanged preview creates no manual revision");

  seed("queue");
  store.getState().updateEditPreviewDraft("一版");
  const firstFlush = store.getState().flushEditPreviewDraft();
  const first = await request("/queue/content", "PATCH");
  assert.equal(first.body.expectedUpdatedAt, "2026-10-20T00:00:00.123456+00:00", "CAS timestamp is sent exactly, without Date conversion");
  store.getState().updateEditPreviewDraft("二版");
  const secondFlush = store.getState().flushEditPreviewDraft();
  await tick();
  assert.equal(requests.filter(item => item.url.endsWith("/queue/content")).length, 1, "One pending request per preview");
  reply(first, { preview: preview("queue", "一版", "version-two") });
  const second = await request("/queue/content", "PATCH");
  assert.equal(store.getState().editPreviewDrafts.queue.content, "二版", "A late response cannot erase typing");
  assert.equal(second.body.expectedUpdatedAt, "version-two");
  assert.equal(second.body.newContent, "二版");
  reply(second, { preview: preview("queue", "二版", "version-three") });
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(store.getState().editPreviewDrafts.queue.status, "saved");
  assert.equal(store.getState().fileContents.note, "正式笔记原文", "Manual save never writes formal note content");

  const { currentEditPreviewDraft } = await vite.ssrLoadModule("/src/store/editPreviewDrafts.ts");
  store.setState({ activeEditPreview: preview("queue", "其他位置更新后的稿件", "reopened-version") });
  assert.equal(currentEditPreviewDraft(store.getState().activeEditPreview, store.getState().editPreviewDrafts.queue), undefined,
    "A clean cached draft must not cover the fresh server version on reopen");
  store.getState().updateEditPreviewDraft("基于新服务器版本继续手改");
  const reopened = store.getState().flushEditPreviewDraft();
  const reopenedSave = await request("/queue/content", "PATCH");
  assert.equal(reopenedSave.body.expectedUpdatedAt, "reopened-version");
  reply(reopenedSave, { preview: preview("queue", "基于新服务器版本继续手改", "reopened-saved") });
  await reopened;

  seed("failure");
  store.getState().updateEditPreviewDraft("");
  const failed = store.getState().flushEditPreviewDraft().then(() => null, error => error);
  reply(await request("/failure/content", "PATCH"), { detail: "合成网络故障" }, 503);
  assert.match((await failed).message, /合成网络故障/);
  assert.equal(store.getState().editPreviewDrafts.failure.content, "", "Empty manual content survives failure");
  assert.equal(store.getState().editPreviewDrafts.failure.status, "error");
  const retry = store.getState().flushEditPreviewDraft();
  reply(await request("/failure/content", "PATCH"), { preview: preview("failure", "", "saved-empty") });
  await retry;

  seed("conflict");
  store.getState().updateEditPreviewDraft("不能丢失的手动稿");
  const conflict = store.getState().reviseEditPreviewRequest("继续扩写");
  reply(await request("/conflict/content", "PATCH"), { detail: "版本已经变化" }, 409);
  assert.equal(await conflict, false);
  assert.equal(store.getState().editPreviewDrafts.conflict.content, "不能丢失的手动稿");
  assert.match(store.getState().editPreviewError, /手动稿仍保留/);
  assert(!requests.some(item => item.url.endsWith("/conflict/revise")), "Conflict blocks AI from using an older server draft");

  seed("old");
  store.getState().updateEditPreviewDraft("旧预览手改");
  const oldFlush = store.getState().flushEditPreviewDraft();
  const old = await request("/old/content", "PATCH");
  store.setState({ activeEditPreview: preview("new", "新的预览") });
  store.getState().updateEditPreviewDraft("新的手改");
  reply(old, { preview: preview("old", "旧预览手改", "old-saved") });
  await oldFlush;
  assert.equal(store.getState().activeEditPreview.id, "new");
  assert.equal(store.getState().editPreviewDrafts.new.content, "新的手改");
  assert.equal(store.getState().editPreviewDrafts.old.status, "saved");

  seed("revise");
  store.getState().updateEditPreviewDraft("手改基线");
  const revised = store.getState().reviseEditPreviewRequest("加例子");
  const manual = await request("/revise/content", "PATCH");
  assert.equal(store.getState().chatLoading, true);
  store.getState().updateEditPreviewDraft("操作中不接受编辑");
  assert.equal(store.getState().editPreviewDrafts.revise.content, "手改基线");
  assert(!requests.some(item => item.url.endsWith("/revise/revise")));
  reply(manual, { preview: preview("revise", "手改基线", "manual-base") });
  reply(await request("/revise/revise", "POST"), { preview: preview("revise", "AI 基于手改继续", "ai-next") });
  assert.equal(await revised, true);
  assert.equal(store.getState().activeEditPreview.newContent, "AI 基于手改继续");
  assert.equal(store.getState().editPreviewDrafts.revise, undefined);

  seed("restore");
  store.getState().updateEditPreviewDraft("恢复前手动稿");
  const restore = store.getState().restoreEditPreviewRevisionRequest("revision-one");
  reply(await request("/restore/content", "PATCH"), { preview: preview("restore", "恢复前手动稿", "restore-base") });
  const restoreReq = await request("/restore/restore-revision", "POST");
  assert.equal(restoreReq.body.revisionId, "revision-one");
  reply(restoreReq, { preview: preview("restore", "历史稿", "restored") });
  await restore;
  assert.equal(store.getState().activeEditPreview.newContent, "历史稿");

  seed("apply");
  store.getState().updateEditPreviewDraft("将应用的手动稿");
  const applying = store.getState().applyEditPreviewRequest();
  const saveBeforeApply = await request("/apply/content", "PATCH");
  assert(!requests.some(item => item.url.endsWith("/apply/apply")));
  reply(saveBeforeApply, { preview: preview("apply", "将应用的手动稿", "apply-base") });
  const applyReq = await request("/apply/apply", "POST");
  reply(applyReq, { preview: { ...preview("apply", "将应用的手动稿"), status: "applied" }, note: { ...note, content: "将应用的手动稿" }, job: {} });
  await applying;
  assert.equal(store.getState().fileContents.note, "将应用的手动稿");
  assert.equal(store.getState().editPreviewDrafts.apply, undefined);

  seed("cancel");
  store.getState().updateEditPreviewDraft("放弃前的手动稿");
  const cancelling = store.getState().cancelEditPreviewRequest();
  reply(await request("/cancel/cancel", "POST"), { detail: "取消失败" }, 503);
  await cancelling;
  assert.equal(store.getState().editPreviewDrafts.cancel.content, "放弃前的手动稿");
  const cancelAgain = store.getState().cancelEditPreviewRequest();
  reply(await request("/cancel/cancel", "POST"), { preview: { ...preview("cancel"), status: "cancelled" } });
  await cancelAgain;
  assert.equal(store.getState().editPreviewDrafts.cancel, undefined);

  seed("close");
  store.getState().updateEditPreviewDraft("关闭后仍保留");
  store.getState().closeEditPreview();
  const closeSave = await request("/close/content", "PATCH");
  reply(closeSave, { detail: "暂时离线" }, 503);
  await tick(); await tick();
  assert.equal(store.getState().activeEditPreview, null);
  assert.equal(store.getState().editPreviewDrafts.close.content, "关闭后仍保留");

  seed("account");
  store.getState().updateEditPreviewDraft("原账号手动稿");
  const accountSave = store.getState().flushEditPreviewDraft();
  const accountReq = await request("/account/content", "PATCH");
  store.getState().hydrate("another-user");
  reply(accountReq, { preview: preview("account", "原账号手动稿", "old-owner-saved") });
  await accountSave;
  assert.deepEqual(store.getState().editPreviewDrafts, {}, "Other account cannot receive previous user's draft");
  store.getState().hydrate("draft-store-test");
  assert.equal(store.getState().editPreviewDrafts.account.content, "原账号手动稿", "Signing back in retains unsaved text in memory");
  assert.equal(store.getState().editPreviewDrafts.account.status, "unsaved");

  seed("chat");
  const beforeChat = requests.length;
  store.getState().updateEditPreviewDraft("聊天也必须先保存");
  const chatting = store.getState().sendMessage("应用修改");
  const chatSave = await request("/chat/content", "PATCH");
  assert(!requests.some(item => item.url.endsWith("/api/agent/chat")), "Agent stream cannot run before manual flush");
  reply(chatSave, { detail: "手动保存失败" }, 503);
  await chatting;
  assert(!requests.slice(beforeChat).some(item => item.url.endsWith("/api/agent/chat") || item.url.endsWith("/chat/apply") || item.url.endsWith("/chat/revise")), "Manual save failure stops the agent and every preview write");
  assert.equal(store.getState().editPreviewDrafts.chat.content, "聊天也必须先保存");

  for (const action of ["apply_preview", "revise_preview"]) {
    const targetId = `chat-tool-${action}`;
    seed(targetId);
    store.getState().updateEditPreviewDraft("聊天工具目标的手动稿");
    store.setState({ activeEditPreview: preview("chat-visible") });
    const toolChat = store.getState().sendMessage("处理之前的修改稿");
    const stream = await request("/api/agent/chat", "POST");
    stream.resolve(new Response(`data: ${JSON.stringify({ type: "tool_action", toolName: "note_edit_tool", action, payload: { editPreviewId: targetId, noteId: "note", instruction: "加例子" } })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { "Content-Type": "text/event-stream" },
    }));
    const targetSave = await request(`/${targetId}/content`, "PATCH");
    const operation = action === "apply_preview" ? "apply" : "revise";
    assert(!requests.some(item => item.url.endsWith(`/${targetId}/${operation}`)), "Explicit tool target also flushes, even when another preview is visible");
    reply(targetSave, { preview: preview(targetId, "聊天工具目标的手动稿", "tool-manual-saved") });
    const toolRequest = await request(`/${targetId}/${operation}`, "POST");
    reply(toolRequest, action === "apply_preview"
      ? { preview: { ...preview(targetId, "聊天工具目标的手动稿"), status: "applied" }, note: { ...note, content: "聊天工具目标的手动稿" }, job: {} }
      : { preview: preview(targetId, "聊天工具调整结果", "tool-revised") });
    await toolChat;
    assert.equal(store.getState().activeEditPreview.id, "chat-visible", "Background tool response cannot replace another visible preview");
    assert.equal(store.getState().centerMode, "edit");
    assert.equal(store.getState().editPreviewDrafts[targetId], undefined);
  }

  seed("uncertain");
  store.getState().updateEditPreviewDraft("可能已保存到服务端");
  const uncertain = store.getState().flushEditPreviewDraft().catch(() => undefined);
  reply(await request("/uncertain/content", "PATCH"), { detail: "回包丢失" }, 503);
  await uncertain;
  store.getState().updateEditPreviewDraft("原预览");
  assert.equal(store.getState().editPreviewDrafts.uncertain.status, "unsaved", "Returning to old content cannot claim saved after an uncertain write");
  const verify = store.getState().flushEditPreviewDraft();
  reply(await request("/uncertain/content", "PATCH"), { preview: preview("uncertain", "原预览", "verified") });
  await verify;

  seed("late-ai");
  const lateAi = store.getState().reviseEditPreviewRequest("扩写");
  const aiRequest = await request("/late-ai/revise", "POST");
  store.setState({ activeEditPreview: preview("other-preview"), centerMode: "edit" });
  reply(aiRequest, { preview: preview("late-ai", "迟到的 AI 结果", "late-ai-finished") });
  await lateAi;
  assert.equal(store.getState().activeEditPreview.id, "other-preview");
  assert.equal(store.getState().centerMode, "edit");

  seed("flush-then-switch");
  store.getState().updateEditPreviewDraft("先保存再切换");
  const switched = store.getState().applyEditPreviewRequest();
  const beforeSwitch = await request("/flush-then-switch/content", "PATCH");
  store.setState({ activeEditPreview: preview("switched-preview"), centerMode: "edit" });
  reply(beforeSwitch, { preview: preview("flush-then-switch", "先保存再切换", "safe-saved") });
  await switched;
  assert(!requests.some(item => item.url.endsWith("/flush-then-switch/apply")), "Switching before the write starts aborts old apply intent");
  assert.equal(store.getState().activeEditPreview.id, "switched-preview");
  console.log(JSON.stringify({ ok: true, cases: 18, actualStore: true, syntheticOnly: true }));
} finally {
  await vite.close();
  dom.window.close();
}
