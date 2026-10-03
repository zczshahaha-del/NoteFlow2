// Actual draft component in development StrictMode, fresh synthetic state,
// mocked services only. No localhost, account, model or database access.
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://isolated.invalid/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
  Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.fetch = async () => { throw new Error('unexpected network request'); };
const { createRoot } = await import('react-dom/client');
const requests = [], writes = [], listeners = new Set();
let context = null;
const emit = () => listeners.forEach(listener => listener());
const state = {
  centerMode: 'note', draftSeed: 'MCP', draftCommand: null,
  pendingCheckpoint: { id: 'synthetic', checkpointType: 'draft_workspace', payload: { seed: 'MCP' } },
  consumeDraftCommand() { state.draftCommand = null; emit(); },
  setActiveDraftContext(value) { context = value; },
  closeDraft() {}, dismissDraftWorkspace() {},
};
const workspace = { treeData: [], reloadWorkspace() {} };
globalThis.draftLifecycle = {
  state, workspace, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  generate(params) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const request = { params, resolve, reject };
    requests.push(request);
    if (params.signal.aborted) reject(new DOMException('aborted', 'AbortError'));
    else params.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    return promise;
  },
  async create(payload) {
    writes.push(structuredClone(payload));
    return { ...payload, id: 'synthetic-draft', status: 'outline_ready', assembledContent: '', bodyInstruction: '',
      sections: payload.sections.map((section, index) => ({ ...section, id: 's' + index, content: '' })) };
  },
};
const vite = await createServer({
  appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  plugins: [{ name: 'isolated-draft-lifecycle', enforce: 'pre',
    resolveId(id, importer) {
      if (!importer?.endsWith('/AIDraftWorkspace.tsx')) return;
      if (id === '../store/selectors') return '\0draft-lifecycle-store';
      if (id === '../services/aiStream') return '\0draft-lifecycle-stream';
      if (id === '../services/drafts') return '\0draft-lifecycle-services';
      if (id === '../services/agent') return '\0draft-lifecycle-agent';
      if (id === '../services/memories') return '\0draft-lifecycle-memory';
    },
    load(id) {
      if (id === '\0draft-lifecycle-store') return `import {useReducer,useEffect} from 'react';
        export const useDraftSlice=()=>{const [,render]=useReducer(x=>x+1,0);useEffect(()=>globalThis.draftLifecycle.subscribe(render),[]);return {...globalThis.draftLifecycle.state}};
        export const useWorkspaceSlice=()=>globalThis.draftLifecycle.workspace;`;
      if (id === '\0draft-lifecycle-stream') return 'export const generateNoteStream=p=>globalThis.draftLifecycle.generate(p);';
      if (id === '\0draft-lifecycle-agent') return 'export const bindAgentCheckpoint=async()=>null;export const resolveAgentCheckpoint=async()=>null;';
      if (id === '\0draft-lifecycle-memory') return 'export const isMemoryEnabled=()=>false;';
      if (id === '\0draft-lifecycle-services') return [
        'export const createNoteDraft=p=>globalThis.draftLifecycle.create(p);',
        ...['assembleNoteDraft','cancelNoteDraft','confirmDraftSection','createDraftSection','deleteDraftSection',
          'generateAllDraftSections','generateDraftSection','getNoteDraft','restoreDraftSection','saveDraftToNotes',
          'stopAllDraftSections','updateNoteDraft','updateDraftSection']
          .map(name => `export const ${name}=()=>{throw new Error('unexpected service: ${name}')};`),
      ].join('\n');
    },
  }],
});
let root;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
const command = async action => {
  await act(async () => { state.draftCommand = { id: 'synthetic-command', action, seed: state.draftSeed, feedback: '' }; emit(); });
  await flush();
};
const complete = async request => {
  await act(async () => { request.params.onDelta('## MCP 基础\n\n- 协议与工具\n## 实践'); request.resolve(); });
  await flush();
};
try {
  const { default: Draft } = await vite.ssrLoadModule('/src/components/AIDraftWorkspace.tsx');
  const mount = async strict => {
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Draft)) : React.createElement(Draft)));
    await flush();
  };
  await mount(true);
  assert.equal(requests.length, 1, 'StrictMode must launch exactly one surviving request');
  assert.equal(requests[0].params.signal.aborted, false, 'StrictMode cleanup must not cancel the surviving request');
  assert.equal(context.busy, true);
  await complete(requests[0]);
  assert.equal(writes.length, 1); assert.equal(writes[0].topic, 'MCP');
  assert.equal(context.stage, 'outline_ready'); assert.equal(context.totalSections, 2); assert.equal(context.busy, false);
  await act(async () => root.unmount()); root = null;

  requests.length = 0; writes.length = 0;
  await mount(false);
  assert.equal(requests.length, 1); assert.equal(requests[0].params.signal.aborted, false);
  await command('stop');
  assert.equal(requests[0].params.signal.aborted, true);
  assert.equal(context.busy, false); assert.equal(context.stage, 'failed', 'stopped outline must offer existing retry');
  await command('generate_outline');
  assert.equal(requests.length, 2); assert.equal(context.busy, true);
  await act(async () => requests[1].reject(new Error('synthetic provider failure')));
  assert.equal(context.stage, 'failed'); assert.equal(context.busy, false);
  await command('generate_outline');
  assert.equal(requests.length, 3);
  const old = requests[2];
  await act(async () => { state.draftSeed = 'HTTP'; state.pendingCheckpoint = null; emit(); });
  await flush();
  assert.equal(old.params.signal.aborted, true);
  assert.equal(requests.length, 4); assert.equal(requests[3].params.topic, 'HTTP');
  await act(async () => old.params.onDelta('## stale outline'));
  assert.equal(context.topic, 'HTTP'); assert.equal(context.busy, true); assert.equal(writes.length, 0);
  await complete(requests[3]);
  assert.equal(writes.length, 1); assert.equal(writes[0].topic, 'HTTP');
  assert.equal(context.stage, 'outline_ready'); assert.equal(context.busy, false);
  await act(async () => root.unmount()); root = null;

  // A retry command present at first mount must not compete with auto-start.
  requests.length = 0; writes.length = 0;
  state.draftCommand = { id: 'initial-retry', action: 'generate_outline', seed: 'HTTP', feedback: '' };
  await mount(true);
  assert.equal(requests.length, 1); assert.equal(requests[0].params.signal.aborted, false);
  await act(async () => requests[0].resolve());
  assert.equal(writes.length, 0); assert.equal(context.stage, 'failed', 'empty outline must expose retry');
  await command('generate_outline');
  assert.equal(requests.length, 2);
  await act(async () => requests[1].reject(new DOMException('unexpected abort', 'AbortError')));
  assert.equal(context.stage, 'failed', 'transport abort not requested by us must not stay configuring');
  await command('generate_outline');
  assert.equal(requests.length, 3);
  await act(async () => root.unmount()); root = null;
  assert.equal(requests[2].params.signal.aborted, true); assert.equal(writes.length, 0);
  await act(async () => requests[2].params.onDelta('## late after unmount'));
  assert.equal(writes.length, 0);

  requests.length = 0; writes.length = 0;
  root = createRoot(document.getElementById('root'));
  act(() => root.render(React.createElement(Draft)));
  act(() => root.unmount()); root = null;
  await flush(); assert.equal(requests.length, 0); assert.equal(writes.length, 0);
  console.log('draft lifecycle: StrictMode, normal mount, initial retry, stop, failure/retry, empty outline, transport abort, seed switch, stale callback, unmount passed (synthetic services, no network)');
} finally {
  if (root) await act(async () => root.unmount());
  await vite.close(); dom.window.close(); delete globalThis.draftLifecycle;
}
