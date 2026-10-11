import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('', { url: 'http://noteflow.test/' });
globalThis.localStorage = dom.window.localStorage;
globalThis.window = dom.window;
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const { saveLocalSnapshot, loadLocalSnapshot, saveLocalNoteContent } = await vite.ssrLoadModule('/src/store/persistence.ts');
  const snapshot = {
    treeData: [{ id: 'folder', type: 'folder', name: '合成目录', children: [
      { id: 'a', type: 'file', name: 'A.md', content: '旧内容' },
      { id: 'b', type: 'file', name: 'B.md', content: '另一篇' },
    ] }], fileContents: { a: '旧内容', b: '另一篇' }, selectedFileId: 'a',
  };
  saveLocalSnapshot('one', snapshot);
  assert.deepEqual(loadLocalSnapshot('one'), snapshot, 'Legacy baseline remains compatible');
  const writes = [];
  const original = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = function(key, value) { writes.push({ key, bytes: value.length }); return original.call(this, key, value); };
  for (let n = 1; n <= 17; n++) saveLocalNoteContent('one', 'a', '新输入'.repeat(n));
  assert.equal(writes.length, 17);
  assert(writes.every(w => w.key === 'noteflow:one:note-draft:a'));
  assert.equal(loadLocalSnapshot('one').fileContents.a, '新输入'.repeat(17));
  assert.equal(loadLocalSnapshot('one').treeData[0].children[0].content, '新输入'.repeat(17));
  assert.equal(loadLocalSnapshot('one').treeData[0].children[0].indexStatus, 'outdated');
  assert.equal(loadLocalSnapshot('one').fileContents.b, '另一篇');
  saveLocalNoteContent('one', 'a', '');
  assert.equal(loadLocalSnapshot('one').fileContents.a, '', 'Empty note survives reload');
  saveLocalSnapshot('two', snapshot); saveLocalNoteContent('two', 'a', '另一个账号');
  assert.equal(loadLocalSnapshot('one').fileContents.a, '');
  assert.equal(loadLocalSnapshot('two').fileContents.a, '另一个账号');
  const compacted = loadLocalSnapshot('one'); saveLocalSnapshot('one', compacted);
  assert.equal(localStorage.getItem('noteflow:one:note-draft:a'), null);
  assert.equal(loadLocalSnapshot('one').fileContents.a, '');
  assert.equal(loadLocalSnapshot('two').fileContents.a, '另一个账号');
  saveLocalNoteContent('one', 'a', '保留的最后输入');
  dom.window.Storage.prototype.setItem = function() { throw new Error('Synthetic quota'); };
  assert.equal(saveLocalNoteContent('one', 'a', '未写入'), false);
  saveLocalSnapshot('one', snapshot);
  assert.equal(loadLocalSnapshot('one').fileContents.a, '保留的最后输入', 'Failed compaction retains journal');
  dom.window.Storage.prototype.setItem = original;
  saveLocalSnapshot('one', { treeData: [], fileContents: {}, selectedFileId: null });
  assert.equal(localStorage.getItem('noteflow:one:note-draft:a'), null, 'Delete compacts obsolete drafts');
  saveLocalNoteContent('one', 'a', '孤立缓存');
  assert.deepEqual(loadLocalSnapshot('one').fileContents, {}, 'Orphan drafts cannot resurrect deleted notes');
  localStorage.setItem('noteflow:two:note-draft:a', '{malformed');
  assert.equal(loadLocalSnapshot('two').fileContents.a, '旧内容', 'Corrupt journal falls back to baseline');
  const store = readFileSync(new URL('../src/store/index.tsx', import.meta.url), 'utf8');
  const action = store.slice(store.indexOf('  updateFileContent: (id, content) =>'), store.indexOf('  sendMessage: async'));
  assert(action.includes('saveLocalNoteContent(userId, id, content)'));
  assert(!action.includes('persistLocalCurrentState()'));
  const provider = store.slice(store.indexOf('export function AppProvider('));
  assert(!provider.includes('saveLocalSnapshot('), 'Provider must not duplicate whole snapshots on input');
  const { useAppStore, AppProvider } = await vite.ssrLoadModule('/src/store/index.tsx');
  saveLocalSnapshot('runtime', snapshot);
  useAppStore.setState({ ...snapshot, hydratedUserId: 'runtime', serverSyncReady: false });
  const runtimeWrites = [];
  dom.window.Storage.prototype.setItem = function(key, value) { runtimeWrites.push(key); return original.call(this, key, value); };
  for (let n = 1; n <= 17; n++) useAppStore.getState().updateFileContent('a', '运行输入'.repeat(n));
  assert.equal(runtimeWrites.length, 17, 'Actual store action writes once per edit');
  assert(runtimeWrites.every(key => key === 'noteflow:runtime:note-draft:a'));
  assert.equal(loadLocalSnapshot('runtime').fileContents.a, '运行输入'.repeat(17));
  // Exercise the real provider too: its rollback safety subscription must not
  // turn a journal write back into a full snapshot on every character.
  Object.assign(globalThis, { document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: () => new Promise(() => {}) });
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{onLine:false,userAgent:'NoteFlow synthetic test'}});
  useAppStore.setState({ hydrate() {} });
  const React = await import('react'), { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async()=>root.render(React.createElement(AppProvider,{userId:'runtime'},React.createElement('p',null,'合成正文'))));
  runtimeWrites.length=0;
  await React.act(async()=>{for(let n=1;n<=17;n++)useAppStore.getState().updateFileContent('a','挂载后输入'.repeat(n));});
  assert.equal(runtimeWrites.length,17,'Mounted provider must not duplicate input writes');
  assert(runtimeWrites.every(key=>key==='noteflow:runtime:note-draft:a'));
  window.dispatchEvent(new dom.window.Event('pagehide'));
  assert.equal(localStorage.getItem('noteflow:runtime:note-draft:a'),null);
  assert.equal(JSON.parse(localStorage.getItem('noteflow:runtime:file-contents')).a,'挂载后输入'.repeat(17),'Legacy baseline is current when leaving / rolling back');
  await React.act(async()=>useAppStore.setState({treeData:[{...snapshot.treeData[0],name:'回滚后的目录'}]}));
  assert.equal(loadLocalSnapshot('runtime').treeData[0].name,'回滚后的目录','Unmanaged metadata / rollback changes still persist');
  assert.equal(loadLocalSnapshot('runtime').fileContents.a,'挂载后输入'.repeat(17));
  await React.act(async()=>root.unmount());
  container.remove();
  dom.window.Storage.prototype.setItem = original;
  console.log(JSON.stringify({ ok: true, typedCharacters: 17, writes: writes.slice(0, 17).length, writesOtherNotes: false,
    actualStore: true, legacy: true, reload: true, empty: true, accountIsolation: true, compaction: true, quotaRecovery: true, deletion: true, corruptFallback: true }));
} finally { await vite.close(); dom.window.close(); }
