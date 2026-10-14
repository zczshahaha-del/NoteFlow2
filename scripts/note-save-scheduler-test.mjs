import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise(resolve => requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null, resolve }));
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = async (id, method = 'PUT') => { for (let n = 0; n < 120; n++) { const r = requests.find(r => r.url.endsWith('/' + id) && r.method === method && !r.used); if (r) { r.used = true; return r; } await wait(10); } assert.fail(`Missing ${method} ${id}`); };
const reply = async (r, content, status = 200) => {
  const id = r.url.split('/').at(-1);
  r.resolve(new Response(JSON.stringify(status === 200 ? { note: { id, title: id, content, contentHash: 'hash', tags: [], categoryId: null, isPinned: false, isFavorite: false, indexStatus: 'indexed' } } : { error: '合成保存失败' }), { status, headers: { 'Content-Type': 'application/json' } }));
  await wait(0);
};
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  const seed = ids => store.setState({ hydratedUserId: 'save-test', selectedFileId: ids[0],
    treeData: ids.map(id => ({ id, name: id + '.md', type: 'file', content: '旧' })), fileContents: Object.fromEntries(ids.map(id => [id, '旧'])),
    noteSaveState: { status: 'saved' }, noteSaveStates: {}, serverSyncReady: false });
  seed(['a', 'b']);store.getState().updateFileContent('a', 'A 新');store.getState().setSelectedFileId('b');
  await reply(await request('b', 'GET'), '旧');store.getState().updateFileContent('b', 'B 新');
  const saveA = await request('a');const saveB = await request('b');
  await reply(saveA, 'A 新');assert.equal(store.getState().noteSaveState.status, 'saving', 'A success must not mark B saved');
  await reply(saveB, 'B 新');assert.equal(store.getState().noteSaveState.status, 'saved');
  store.getState().setSelectedFileId('a');assert.equal(store.getState().noteSaveState.status, 'saved');
  await reply(await request('a', 'GET'), 'A 新');

  seed(['later']);store.getState().updateFileContent('later', '一版');const old = await request('later');
  store.getState().updateFileContent('later', '二版');await reply(old, '一版');
  assert.equal(store.getState().noteSaveState.status, 'unsaved');assert.equal(store.getState().fileContents.later, '二版');
  await reply(await request('later'), '二版');assert.equal(store.getState().noteSaveState.status, 'saved');

  seed(['old-failure']);store.getState().updateFileContent('old-failure', '一版');const failed = await request('old-failure');
  store.getState().updateFileContent('old-failure', '二版');await reply(failed, '', 503);
  assert.equal(store.getState().noteSaveState.status, 'unsaved', 'Old failure cannot replace newer input state');
  await reply(await request('old-failure'), '二版');

  seed(['owner']);store.getState().updateFileContent('owner', '旧账号');const owner = await request('owner');
  store.setState({ hydratedUserId: 'other', treeData: [], fileContents: {}, noteSaveState: { status: 'idle' } });
  await reply(owner, '旧账号');assert.deepEqual(store.getState().fileContents, {});assert.equal(store.getState().noteSaveState.status, 'idle');
  seed(['deleted']);store.getState().updateFileContent('deleted', '不要上传');store.getState().deleteNode('deleted');
  await wait(750);assert(!requests.some(r => r.method === 'PUT' && r.url.endsWith('/deleted')), 'Delete cancels only its own scheduled save');
  console.log(JSON.stringify({ ok: true, cases: 5, actualStore: true, syntheticOnly: true }));
} finally { await vite.close(); dom.window.close(); }
