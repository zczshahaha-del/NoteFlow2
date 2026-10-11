// Actual Zustand action, synthetic pending reads; never access a real account/API.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise(resolve => requests.push({ url: String(input), method: init?.method ?? 'GET', resolve }));
const baseline = process.env.NOTEFLOW_OPEN_RACE_BASE_REF;
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  plugins: baseline ? [{ name: 'committed-open-race-baseline', enforce: 'pre',
    load(id) { if (id.endsWith('/src/store/index.tsx')) return execFileSync('git', ['show', baseline + ':src/store/index.tsx'], { encoding: 'utf8' }); }
  }] : [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  const { findFileById } = await vite.ssrLoadModule('/src/workspaceTree.ts');
  const note = (id, content) => ({ id, title: id, categoryId: null, summary: null, tags: [], content,
    contentHash: 'synthetic-' + content, isPinned: false, isFavorite: false, indexStatus: 'indexed',
    createdAt: null, updatedAt: null, deletedAt: null });
  const reset = () => {
    requests.length = 0;
    store.setState({ hydratedUserId: 'synthetic-one', selectedFileId: 'a', serverSyncReady: false,
      treeData: ['a', 'b'].map(id => ({ id, name: id + '.md', type: 'file', content: '缓存-' + id })),
      fileContents: { a: '缓存-a', b: '缓存-b' }, noteSaveState: { status: 'saved' }, noteOpenError: null });
  };
  const reply = async (request, id, content, status = 200) => {
    request.resolve(new Response(JSON.stringify(status === 200 ? { note: note(id, content) } : { error: '合成失败' }),
      { status, headers: { 'Content-Type': 'application/json' } }));
    await tick();
  };
  reset(); store.getState().setSelectedFileId('a'); await tick();
  store.getState().updateFileContent('a', '刚输入的正文');
  await reply(requests[0], 'a', '旧服务器正文');
  assert.equal(store.getState().fileContents.a, '刚输入的正文', 'Late open read cannot overwrite typing');
  assert.equal(findFileById(store.getState().treeData, 'a').content, '刚输入的正文');
  assert.equal(store.getState().noteSaveState.status, 'unsaved');

  reset(); store.getState().updateFileContent('a', '返回笔记前的未保存正文');
  store.getState().setSelectedFileId('a'); await tick();
  await reply(requests[0], 'a', '旧服务器正文');
  assert.equal(store.getState().fileContents.a, '返回笔记前的未保存正文', 'Reopening must keep an existing local edit too');
  for(let n=0;n<100 && !requests.some(r=>r.method==='PUT');n++)await new Promise(resolve=>setTimeout(resolve,10));
  const saveRequest=requests.find(r=>r.method==='PUT');assert(saveRequest,'Autosave still runs');
  await reply(saveRequest,'a','返回笔记前的未保存正文');
  assert.equal(store.getState().noteSaveState.status,'saved');
  store.getState().setSelectedFileId('a'); await tick();
  await reply(requests.at(-1),'a','保存后的远端更新');
  assert.equal(store.getState().fileContents.a,'保存后的远端更新','Successful save releases protection for later clean refresh');

  reset(); store.getState().updateFileContent('a','保存请求中的正文');
  for(let n=0;n<100 && !requests.some(r=>r.method==='PUT');n++)await new Promise(resolve=>setTimeout(resolve,10));
  const olderSave=requests.find(r=>r.method==='PUT');assert(olderSave);
  store.getState().updateFileContent('a','保存途中又输入的正文');
  await reply(olderSave,'a','保存请求中的正文');
  store.getState().setSelectedFileId('a'); await tick();
  await reply(requests.at(-1),'a','保存请求中的正文');
  assert.equal(store.getState().fileContents.a,'保存途中又输入的正文','An older successful save cannot release newer local input protection');

  reset(); store.getState().setSelectedFileId('a'); await tick(); const first = requests[0];
  store.getState().setSelectedFileId('a'); await tick(); const second = requests[1];
  await reply(second, 'a', '较新的响应'); await reply(first, 'a', '较旧的响应');
  assert.equal(store.getState().fileContents.a, '较新的响应', 'Newest open owns the result');

  reset(); store.getState().setSelectedFileId('a'); await tick(); const oldFailure = requests[0];
  store.getState().setSelectedFileId('a'); await tick(); await reply(requests[1], 'a', '读取成功');
  await reply(oldFailure, 'a', '', 503);
  assert.equal(store.getState().noteOpenError, null, 'Old failure cannot replace a newer success');

  reset(); store.getState().setSelectedFileId('a'); await tick();
  store.setState({ hydratedUserId: 'synthetic-two' }); await reply(requests[0], 'a', '其他账号旧响应');
  assert.equal(store.getState().fileContents.a, '缓存-a');

  reset(); store.getState().setSelectedFileId('a'); await tick();
  store.setState({ treeData: [], fileContents: {}, selectedFileId: null });
  await reply(requests[0], 'a', '已删除笔记');
  assert.deepEqual(store.getState().fileContents, {}, 'Late response cannot resurrect a removed note');

  reset(); store.getState().setSelectedFileId('a'); await tick();
  store.setState({ selectedFileId: 'b' }); await reply(requests[0], 'a', '干净缓存更新');
  assert.equal(store.getState().fileContents.a, '干净缓存更新');
  assert.equal(store.getState().selectedFileId, 'b', 'Background refresh cannot change selection');
  console.log(JSON.stringify({ ok: true, cases: 9, actualStore: true, syntheticOnly: true }));
} finally { await vite.close(); dom.window.close(); }
