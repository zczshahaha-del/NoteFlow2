import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://chat-fixture.invalid/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
const requests = [], streams = [];
globalThis.fetch = window.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  if (String(url) === '/api/agent/chat') {
    let closed = false;
    const body = new ReadableStream({ start(controller) {
      const fixture = {
        push(data) { controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(data) + '\n\n')); },
        close() { closed = true; controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); },
      };
      streams.push(fixture);
      init.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.error(new DOMException('Synthetic abort', 'AbortError')); } }, { once: true });
    } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  assert.ok(/^\/api\/(agent\/runs|chat-sessions)/.test(String(url)), 'all service calls must use controlled synthetic endpoints');
  return new Response(JSON.stringify({ runs: [], sessions: [], task: null }), { headers: { 'Content-Type': 'application/json' } });
};
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
try {
  const { ChatTextPresentation, advanceChatGlyphs } = await vite.ssrLoadModule('/src/utils/chatTextPresentation.ts');
  const clusters = ['中', '👩🏽‍💻', '🇨🇳', 'e\u0301', '👨‍👩‍👧‍👦', '文'];
  const unicode = clusters.join('');
  assert.equal(advanceChatGlyphs(unicode, 0, 0), 0);
  let offset = 0;
  for (const glyph of clusters) { offset = advanceChatGlyphs(unicode, offset, 1); assert.equal(unicode.slice(0, offset), clusters.slice(0, clusters.indexOf(glyph) + 1).join('')); }
  const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  try {
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    const fallback = await vite.ssrLoadModule('/src/utils/chatTextPresentation.ts?fallback');
    let end = 0;
    for (const glyph of clusters) { end = fallback.advanceChatGlyphs(unicode, end, 1); assert.equal(unicode.slice(0, end), clusters.slice(0, clusters.indexOf(glyph) + 1).join('')); }
  } finally {
    if (segmenterDescriptor) Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor);
    else delete Intl.Segmenter;
  }

  const full = '这是用于模拟整段数据到达的内容。'.repeat(30) + unicode;
  const queue = new ChatTextPresentation('', 0);
  queue.update(full, 'completed', 0);
  assert.equal(queue.text, '这'); assert.equal(queue.pending, true);
  const lengths = [];
  for (let time = 16; time <= 900; time += 16) { queue.step(time); lengths.push(queue.text.length); assert.ok(full.startsWith(queue.text)); }
  queue.step(900);
  assert.ok(new Set(lengths).size > 12, 'a single complete chunk must be revealed across many frames');
  assert.equal(queue.text, full); assert.equal(queue.pending, false);
  assert.ok(lengths.every((value, index) => index === 0 || value >= lengths[index - 1]));

  const live = new ChatTextPresentation('', 0);
  live.update('实时内容', 'streaming', 0); live.step(16);
  const before = live.text;
  live.update('实时内容持续追加。', 'streaming', 20); live.step(32);
  assert.ok(live.text.startsWith(before));
  live.update('引用校验后的正文', 'streaming', 40);
  assert.equal(live.text, '引用校验后的正文', 'canonical replacement must not continue stale text');
  live.update('引用校验后的正文还有尾部', 'streaming', 50); live.finish();
  assert.equal(live.text, '引用校验后的正文还有尾部'); assert.equal(live.pending, false);
  for (const status of ['stopped', 'failed', undefined]) {
    const q = new ChatTextPresentation('', 0); q.update(full, 'streaming', 0); q.update(full, status, 20);
    assert.equal(q.text, full); assert.equal(q.pending, false);
  }
  const history = new ChatTextPresentation(full, 0); history.update(full, 'completed', 0);
  assert.equal(history.pending, false, 'mounting existing history must not replay');
  const delayed = new ChatTextPresentation('', 0); delayed.update(full, 'completed', 0); delayed.step(5000);
  assert.equal(delayed.text, full, 'suspended frames must not leave an expired tail');

  const { useAppStore } = await vite.ssrLoadModule('/src/store/index.tsx');
  const initial = useAppStore.getInitialState();
  useAppStore.setState(initial, true);
  const messageStarted = Date.now();
  let operation = useAppStore.getState().sendMessage('合成完整输出');
  while (streams.length < 1) await tick();
  const messageTimes = useAppStore.getState().chatMessages.map(message => message.createdAt);
  assert.equal(messageTimes.length, 2);
  assert.ok(messageTimes.every(time => Date.parse(time) >= messageStarted && Date.parse(time) <= Date.now()), 'both local message roles record real creation times');
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'streaming');
  streams[0].push({ choices: [{ delta: { content: full } }] }); await tick();
  assert.equal(useAppStore.getState().chatMessages.at(-1).text, full, 'raw store is never paced or truncated');
  streams[0].close(); await operation;
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'completed');
  assert.equal(useAppStore.getState().chatLoading, false);
  assert.deepEqual(useAppStore.getState().chatMessages.map(message => message.createdAt), messageTimes, 'stream updates never rewrite the original creation times');

  operation = useAppStore.getState().sendMessage('合成停止输出');
  while (streams.length < 2) await tick();
  const second = requests.filter(item => item.url === '/api/agent/chat')[1].body;
  assert.equal(second.history.at(-1).text, full);
  assert.ok(second.history.every(message => Object.keys(message).sort().join(',') === 'role,text'), 'client presentation metadata must stay off wire');
  streams[1].push({ choices: [{ delta: { content: '已收到的部分' } }] }); await tick();
  useAppStore.getState().stopGeneration(); await operation;
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'stopped');
  assert.equal(useAppStore.getState().chatMessages.at(-1).text, '已收到的部分');

  operation = useAppStore.getState().sendMessage('合成失败输出');
  while (streams.length < 3) await tick();
  streams[2].push({ type: 'stream_error', message: '合成错误，请重试' }); await operation;
  streams[2].close();
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'failed');
  assert.equal(useAppStore.getState().chatMessages.at(-1).text, '合成错误，请重试');
  assert.equal(useAppStore.getState().chatLoading, false);
  operation = useAppStore.getState().sendMessage('合成 Agent 失败');
  while (streams.length < 4) await tick();
  streams[3].push({ type: 'agent_error', status: 'failed', message: '合成 Agent 错误' }); await tick();
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'failed');
  streams[3].push({ choices: [{ delta: { content: '合成 Agent 错误正文' } }] });
  streams[3].push({ type: 'agent_done', sessionId: 'synthetic-session', runId: 'synthetic-run', status: 'failed' });
  streams[3].close(); await operation;
  assert.equal(useAppStore.getState().chatMessages.at(-1).streamState, 'failed', 'normal transport finish cannot relabel a failed Agent reply');
  assert.equal(useAppStore.getState().chatMessages.at(-1).text, '合成 Agent 错误正文');
  await tick(); useAppStore.setState(initial, true);
  console.log(JSON.stringify({ ok: true, networkMocked: true, deterministicPresentation: true, unicode: true, completionBoundMs: 900, rawStoreIntact: true, canonicalReplacement: true, stop: true, failure: true, historyWire: true }));
} finally { await vite.close(); dom.window.close(); }
