// Read-only product audit: actual store, synthetic notes, every fetch intercepted.
// Exit 0 means the diagnostic ran, NOT that reported product risks are fixed.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise(resolve => requests.push({
  url: String(input), method: init?.method ?? 'GET',
  body: init?.body ? JSON.parse(init.body) : null, resolve,
}));
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async predicate => {
  for (let n = 0; n < 120; n++) { if (predicate()) return; await wait(10); }
  assert(predicate(), 'Synthetic request did not start');
};
const reply = async (request, data) => {
  assert(request, 'Expected synthetic request');
  request.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  await wait(0);
};
const note = (id, content) => ({ id, title: id, categoryId: null, summary: null, tags: [], content,
  contentHash: 'synthetic-' + content, isPinned: false, isFavorite: false, indexStatus: 'indexed',
  createdAt: null, updatedAt: null, deletedAt: null });
const findings = [];
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  const reset = ids => {
    requests.length = 0;
    store.setState({ hydratedUserId: 'synthetic-audit', selectedFileId: ids[0] ?? null,
      treeData: ids.map(id => ({ id, name: id + '.md', type: 'file', content: '缓存-' + id })),
      fileContents: Object.fromEntries(ids.map(id => [id, '缓存-' + id])),
      noteSaveState: { status: 'saved' }, workspaceError: null, serverSyncReady: false });
  };

  reset([]);
  store.getState().addNode(null, { id: 'new', type: 'file', name: 'new.md', content: '' });
  await waitFor(() => requests.some(r => r.method === 'POST'));
  store.getState().updateFileContent('new', '新建后立即输入');
  await reply(requests.find(r => r.method === 'POST'), { note: note('new', '') });
  findings.push({ scenario: 'late-create-vs-typing', riskConfirmed: store.getState().fileContents.new !== '新建后立即输入',
    expected: '新建后立即输入', observed: store.getState().fileContents.new });
  await wait(750); // Let this scenario's autosave timer finish before the next one.

  reset(['timer-a', 'timer-b']);
  store.getState().updateFileContent('timer-a', 'A 的新正文');
  store.getState().setSelectedFileId('timer-b');
  await waitFor(() => requests.some(r => r.method === 'GET'));
  await reply(requests.find(r => r.method === 'GET'), { note: note('timer-b', '缓存-timer-b') });
  store.getState().updateFileContent('timer-b', 'B 的新正文');
  await waitFor(() => requests.some(r => r.method === 'PUT'));
  await wait(50);
  const saves = requests.filter(r => r.method === 'PUT');
  findings.push({ scenario: 'rapid-note-switch-cancels-save', riskConfirmed: !saves.some(r => r.url.endsWith('/timer-a')),
    putNoteIds: saves.map(r => r.url.split('/').at(-1)), localAKept: store.getState().fileContents['timer-a'] === 'A 的新正文' });
  for (const request of saves) await reply(request, { note: note(request.url.split('/').at(-1), request.body.content) });

  reset(['status-a', 'status-b']);
  store.getState().updateFileContent('status-a', 'A 已发送');
  await waitFor(() => requests.some(r => r.method === 'PUT'));
  const saveA = requests.find(r => r.method === 'PUT');
  store.getState().setSelectedFileId('status-b');
  await waitFor(() => requests.some(r => r.method === 'GET'));
  await reply(requests.find(r => r.method === 'GET'), { note: note('status-b', '缓存-status-b') });
  store.getState().updateFileContent('status-b', 'B 还没发送');
  assert.equal(store.getState().noteSaveState.status, 'unsaved');
  await reply(saveA, { note: note('status-a', 'A 已发送') });
  findings.push({ scenario: 'other-note-save-status', riskConfirmed: store.getState().noteSaveState.status === 'saved',
    selected: store.getState().selectedFileId, status: store.getState().noteSaveState.status,
    bPutStarted: requests.some(r => r.method === 'PUT' && r.url.endsWith('/status-b')) });
  await waitFor(() => requests.some(r => r.method === 'PUT' && r.url.endsWith('/status-b')));
  const saveB = requests.find(r => r.method === 'PUT' && r.url.endsWith('/status-b'));
  await reply(saveB, { note: note('status-b', saveB.body.content) });

  reset(['refresh']);
  store.getState().reloadWorkspace();
  await waitFor(() => requests.some(r => r.url === '/api/categories'));
  await reply(requests.find(r => r.url === '/api/categories'), { categories: [] });
  await waitFor(() => requests.some(r => r.url === '/api/notes?includeDeleted=true'));
  store.getState().updateFileContent('refresh', '刷新请求期间输入');
  await reply(requests.find(r => r.url === '/api/notes?includeDeleted=true'), { notes: [note('refresh', '旧远端正文')] });
  await wait(20);
  findings.push({ scenario: 'workspace-refresh-vs-typing', riskConfirmed: store.getState().fileContents.refresh !== '刷新请求期间输入',
    expected: '刷新请求期间输入', observed: store.getState().fileContents.refresh });
  for (const request of requests.filter(r => r.method === 'DELETE')) await reply(request, {});
  await wait(750);

  requests.length = 0;
  const memories = await vite.ssrLoadModule('/src/services/memories.ts');
  memories.setMemoryEnabledLocal(true);
  const failedSetting = memories.setMemoryEnabled(false);
  const settingResult = failedSetting.then(() => false, () => true);
  await waitFor(() => requests.some(r => r.url === '/api/settings'));
  requests.find(r => r.url === '/api/settings').resolve(new Response(JSON.stringify({ error: '合成设置失败' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  }));
  assert.equal(await settingResult, true, 'Synthetic settings write must fail');
  findings.push({ scenario: 'failed-memory-toggle-cache', riskConfirmed: memories.isMemoryEnabled() !== true,
    expectedEnabled: true, observedEnabled: memories.isMemoryEnabled(),
    persistedEnabled: localStorage.getItem('noteflow-memory-enabled') });

  console.log(JSON.stringify({ auditCompleted: true, mutatesProduct: false, allProbedRisksAbsent: findings.every(finding => !finding.riskConfirmed), actualStore: true,
    syntheticOnly: true, realNetworkRequests: 0, findings }, null, 2));
} finally { await vite.close(); dom.window.close(); }
