import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise(resolve => requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null, resolve }));
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const take = async method => { for (let n = 0; n < 100; n++) { const r = requests.find(r => r.method === method && !r.used); if (r) { r.used = true; return r; } await tick(); } assert.fail('Missing synthetic request'); };
const reply = async (r, data, status = 200) => { r.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })); await tick(); };
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  store.setState({ hydratedUserId: 'operations', treeData: [], fileContents: {}, workspaceIssues: [], workspaceError: null });
  store.getState().addNode(null, { id: 'folder', type: 'folder', name: '本地文件夹', children: [] });
  await reply(await take('POST'), { error: '合成创建失败' }, 503);
  assert.equal(store.getState().workspaceIssues.length, 1, 'Failure exposes a retryable issue');
  const issue = store.getState().workspaceIssues[0];
  store.getState().retryWorkspaceOperation(issue.id);store.getState().retryWorkspaceOperation(issue.id);
  await reply(await take('GET'), { categories: [] });
  const retry = await take('POST');assert.equal(requests.filter(r => r.method === 'POST').length, 2, 'Double retry is locked');
  await reply(retry, { category: { id: 'folder' } });
  assert.equal(store.getState().workspaceIssues.length, 0);assert.equal(store.getState().treeData[0].name, '本地文件夹');

  store.getState().updateNodeName('folder', '新名');const old = await take('PUT');
  store.getState().updateNodeName('folder', '更新名');const newer = await take('PUT');
  await reply(newer, { category: { id: 'folder' } });await reply(old, { error: '旧失败' }, 503);
  assert.equal(store.getState().workspaceIssues.length, 0, 'Superseded failure is ignored');

  store.getState().deleteNode('folder');await reply(await take('DELETE'), { error: '删除失败' }, 503);
  assert.equal(store.getState().workspaceIssues.length, 1);
  store.getState().retryWorkspaceOperation(store.getState().workspaceIssues[0].id);
  await reply(await take('DELETE'), {});assert.equal(store.getState().workspaceIssues.length, 0);
  store.getState().addNode(null, { id: 'committed', type: 'folder', name: '响应丢失', children: [] });
  await reply(await take('POST'), { error: '合成丢失响应' }, 503);
  store.getState().retryWorkspaceOperation(store.getState().workspaceIssues[0].id);
  await reply(await take('GET'), { categories: [{ id: 'committed', name: '响应丢失' }] });
  const confirmExisting = await take('PUT');assert.equal(confirmExisting.url, '/api/categories/committed');
  await reply(confirmExisting, { category: { id: 'committed' } });
  assert.equal(requests.filter(r => r.method === 'POST' && r.body.id === 'committed').length, 1, 'Lost response retry reuses the existing category');

  store.getState().addNode(null, { id: 'draft', type: 'file', name: '草稿.md', content: '' });
  await reply(await take('POST'), { error: '创建未同步' }, 503);
  store.setState({ selectedFileId: 'draft' });store.getState().updateFileContent('draft', '重试保留输入');
  store.getState().retryWorkspaceOperation(store.getState().workspaceIssues[0].id);
  const createRetry = await take('POST');assert.equal(createRetry.body.content, '重试保留输入');assert(createRetry.body.idempotencyKey);
  await reply(createRetry, { note: { id: 'draft', title: '草稿', content: '重试保留输入', tags: [], indexStatus: 'indexed' } });
  assert.equal(store.getState().fileContents.draft, '重试保留输入');assert.equal(store.getState().noteSaveState.status, 'saved');
  assert.equal(store.getState().workspaceIssues.length, 0);
  console.log(JSON.stringify({ ok: true, cases: 5, syntheticOnly: true }));
} finally { await vite.close(); dom.window.close(); }
