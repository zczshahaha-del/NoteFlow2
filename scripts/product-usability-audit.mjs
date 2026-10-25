// Isolated product audit: synthetic inputs only; all fetch calls are intercepted.
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5173', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, localStorage: dom.window.localStorage, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } });
let interceptedCalls = 0;
const offlineFetch = async () => { interceptedCalls++; return new Response('Bad Gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }); };
globalThis.fetch = window.fetch = offlineFetch;
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: projectRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, watch: null, hmr: false } });
const report = { auditCompleted: false, productFixed: false, actualNetworkRequests: 0, synthetic: true };
const root = createRoot(document.getElementById('root'));
try {
    const { default: Login } = await vite.ssrLoadModule('/src/components/LoginPage.tsx');
    await act(async () => root.render(React.createElement(Login, { onSignIn: async () => { }, onEmailCodeSignIn: async () => { }, onSignUp: async () => { } })));
    const set = async (value) => act(async () => { const input = document.querySelector('input[name=email]'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await set('audit');
    report.invalidEmail = { submitDisabled: document.querySelector('button[type=submit]').disabled, visibleFeedback: document.querySelector('.auth-feedback').textContent };
    await set('audit@example.invalid');
    await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    report.failedSend = { interceptedCalls, feedback: document.querySelector('.auth-feedback').textContent, resendDisabled: document.querySelector('.auth-send').disabled, resendLabel: document.querySelector('.auth-send').textContent, step: document.querySelector('form').dataset.step };
    await act(async () => root.render(React.createElement(Login, { key: 'pending-auth', onSignIn: () => new Promise(() => { }), onEmailCodeSignIn: async () => { }, onSignUp: async () => { } })));
    await act(async () => Array.from(document.querySelectorAll('button')).find(n => n.getAttribute('aria-label') === '使用密码登录').click());
    await set('audit@example.invalid');
    await act(async () => { const input = document.querySelector('input[name=password]'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-password'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    report.pendingAuthentication = { busy: document.querySelector('form').getAttribute('aria-busy'), controls: Array.from(document.querySelectorAll('button')).map(n => ({ name: n.getAttribute('aria-label') || n.textContent, disabled: n.disabled })), hasCancel: Array.from(document.querySelectorAll('button')).some(n => /取消|停止/.test(n.textContent)) };
    const { createKnowledgeJsonBlob } = await vite.ssrLoadModule('/src/utils/exportKnowledgeZip.ts');
    const { parseKnowledgeImport } = await vite.ssrLoadModule('/src/utils/importKnowledge.ts');
    const tree = [{ id: 'folder-synthetic', type: 'folder', name: '合成目录', children: [{ id: 'note-synthetic', type: 'file', name: '合成笔记.md', tags: ['test'], favorite: true, pinned: true, createdAt: '2026-01-01T00:00:00Z', content: '合成正文' }] }];
    const blob = createKnowledgeJsonBlob(tree, { 'note-synthetic': '合成正文' });
    const payload = JSON.parse(await blob.text());
    const records = await parseKnowledgeImport(new File([blob], 'synthetic-backup.json', { type: 'application/json' }));
    report.backup = { topLevelKeys: Object.keys(payload), importedRecords: records, importedRecordKeys: Object.keys(records[0]), folderStructurePreserved: records.some(x => x.type === 'folder'), favoritePreserved: 'favorite' in records[0], pinnedPreserved: 'pinned' in records[0], timestampPreserved: 'createdAt' in records[0] };
    const { searchSnippetText } = await vite.ssrLoadModule('/src/utils/searchSnippetText.ts');
    report.searchSnippet = { source: '...与环境管理** 训练环境必须精简。', rendered: searchSnippetText('...与环境管理** 训练环境必须精简。') };
    report.auditCompleted = true;
    console.log(JSON.stringify(report, null, 2));
}
finally {
    await act(async () => root.unmount());
    await vite.close();
    dom.window.close();
}
