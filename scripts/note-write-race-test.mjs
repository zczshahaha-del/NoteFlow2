// Real store actions, synthetic notes and delayed fetch. No real API traffic.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise(resolve => requests.push({ url: String(input), method: init?.method ?? 'GET', resolve }));
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const request = async (url, method = 'GET') => {
  for (let n = 0; n < 100; n++) { const r = requests.find(r => r.url === url && r.method === method && !r.used); if (r) { r.used = true; return r; } await tick(); }
  assert.fail(`Missing synthetic request: ${method} ${url}`);
};
const reply = async (r, data) => { r.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); await tick(); };
const record = (id, content) => ({ id, title: id, categoryId: null, summary: null, tags: [], content, contentHash: 'hash-' + content,
  isPinned: false, isFavorite: false, indexStatus: 'indexed', createdAt: null, updatedAt: null, deletedAt: null });
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  const seed = ids => store.setState({ hydratedUserId: 'write-race', serverSyncReady: false, selectedFileId: ids[0] ?? null,
    treeData: ids.map(id => ({ id, type: 'file', name: id + '.md', content: '缓存-' + id })),
    fileContents: Object.fromEntries(ids.map(id => [id, '缓存-' + id])), noteSaveState: { status: 'saved' } });
  seed([]);
  store.getState().addNode(null, { id: 'new', type: 'file', name: 'new.md', content: '' });
  const creation = await request('/api/notes', 'POST');
  store.getState().updateFileContent('new', '立即输入');
  await reply(creation, { note: record('new', '') });
  assert.equal(store.getState().fileContents.new, '立即输入', 'Late creation must retain typing');
  assert.equal(store.getState().treeData[0].content, '立即输入');
  assert.equal(store.getState().treeData[0].indexStatus, 'outdated');

  seed(['a', 'b']);
  store.getState().reloadWorkspace();
  await reply(await request('/api/categories'), { categories: [] });
  const refresh = await request('/api/notes?includeDeleted=true');
  store.getState().updateFileContent('a', '刷新期间输入');
  store.getState().setSelectedFileId('b');
  await reply(await request('/api/notes/b'), { note: record('b', '缓存-b') });
  await reply(refresh, { notes: [record('a', '旧内容'), record('b', '干净远端更新')] });
  assert.equal(store.getState().fileContents.a, '刷新期间输入', 'Refresh must merge dirty content');
  assert.equal(store.getState().fileContents.b, '干净远端更新', 'Clean notes still refresh');
  assert.equal(store.getState().selectedFileId, 'b', 'Refresh must not undo navigation');

  store.getState().reloadWorkspace();
  await reply(await request('/api/categories'), { categories: [] });
  const stale = await request('/api/notes?includeDeleted=true');
  store.setState({ hydratedUserId: 'other', treeData: [], fileContents: {}, selectedFileId: null });
  await reply(stale, { notes: [record('a', '另一个账号旧响应')] });
  assert.deepEqual(store.getState().fileContents, {}, 'No old-user workspace response');

  seed(['deleted']);store.getState().reloadWorkspace();
  await reply(await request('/api/categories'), { categories: [] });
  const beforeDelete = await request('/api/notes?includeDeleted=true');
  store.getState().deleteNode('deleted');
  await reply(beforeDelete, { notes: [record('deleted', '已删除')] });
  assert.equal(store.getState().fileContents.deleted, undefined, 'Refresh cannot resurrect a local deletion');

  seed([]);store.getState().addNode(null, { id: 'late', type: 'file', name: 'late.md', content: '' });
  const late = await request('/api/notes', 'POST');
  store.setState({ hydratedUserId: 'other', treeData: [], fileContents: {}, selectedFileId: null });
  await reply(late, { note: record('late', '旧账号') });
  assert.deepEqual(store.getState().fileContents, {}, 'No old-user creation response');
  console.log(JSON.stringify({ ok: true, actualStore: true, syntheticOnly: true, cases: 5 }));
} finally { await vite.close(); dom.window.close(); }
