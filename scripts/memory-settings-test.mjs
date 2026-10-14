import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [];
globalThis.fetch = (input, init) => new Promise((resolve, reject) => requests.push({ url: String(input), method: init?.method ?? 'GET', resolve, reject }));
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const take = async method => { for (let n = 0; n < 100; n++) { const r = requests.find(r => r.method === method && !r.used); if (r) { r.used = true; return r; } await tick(); } assert.fail('Missing synthetic request'); };
const response = enabled => new Response(JSON.stringify({ settings: { memoryEnabled: enabled, preferences: {}, createdAt: null, updatedAt: null } }), { headers: { 'Content-Type': 'application/json' } });
try {
  const service = await vite.ssrLoadModule('/src/services/memories.ts');
  const expectEnabled = enabled => { assert.equal(service.isMemoryEnabled(), enabled);assert.equal(localStorage.getItem('noteflow-memory-enabled'), String(enabled)); };
  service.setMemoryEnabledLocal(true);
  const failure = service.setMemoryEnabled(false);const rejected = assert.rejects(failure);
  (await take('PUT')).resolve(new Response(JSON.stringify({ error: '合成失败' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await rejected;expectEnabled(true);

  const network = service.setMemoryEnabled(false);const networkRejected = assert.rejects(network);
  (await take('PUT')).reject(new TypeError('Synthetic network'));await networkRejected;expectEnabled(true);
  const malformed = service.setMemoryEnabled(false);const malformedRejected = assert.rejects(malformed);
  (await take('PUT')).resolve(new Response('{broken', { headers: { 'Content-Type': 'application/json' } }));await malformedRejected;expectEnabled(true);

  const first = service.setMemoryEnabled(false);const firstRequest = await take('PUT');
  const second = service.setMemoryEnabled(true);const secondRejected = assert.rejects(second);
  assert.equal(requests.filter(r => r.method === 'PUT').length, 4, 'Writes serialize to preserve server order');
  firstRequest.resolve(response(false));await first;expectEnabled(true);
  (await take('PUT')).resolve(new Response(JSON.stringify({ error: '第二次失败' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await secondRejected;expectEnabled(false);

  service.setMemoryEnabledLocal(true);
  const read = service.loadMemorySettings();const oldRead = await take('GET');
  const write = service.setMemoryEnabled(false);(await take('PUT')).resolve(response(false));await write;
  oldRead.resolve(response(true));const readResult = await read;expectEnabled(false);assert.equal(readResult.memoryEnabled, false);

  service.setMemoryEnabledLocal(true);
  const inFlight = service.setMemoryEnabled(false);const pendingWrite = await take('PUT');
  const pendingRead = service.loadMemorySettings();(await take('GET')).resolve(response(true));
  assert.equal((await pendingRead).memoryEnabled, false);expectEnabled(false);
  pendingWrite.resolve(response(false));await inFlight;

  service.setMemoryEnabledLocal(true);
  const oldContext = service.setMemoryEnabled(false);const oldContextRejected = assert.rejects(oldContext);
  const oldContextRequest = await take('PUT');service.setMemoryEnabledLocal(true);
  oldContextRequest.resolve(response(false));await oldContextRejected;expectEnabled(true);

  const invalid = service.setMemoryEnabled(false);const invalidRejected = assert.rejects(invalid);
  (await take('PUT')).resolve(new Response(JSON.stringify({ settings: { memoryEnabled: 'false' } }), { headers: { 'Content-Type': 'application/json' } }));
  await invalidRejected;expectEnabled(true);
  console.log(JSON.stringify({ ok: true, cases: 8, syntheticOnly: true, failures: ['HTTP', 'network', 'JSON', 'invalid-shape'], serialized: true, staleRead: true, contextOwnership: true }));
} finally { await vite.close(); dom.window.close(); }
