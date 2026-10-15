// Actual store + SSE reader, synthetic responses only; no account or model access.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('', { url: 'http://noteflow.test/' });
Object.assign(globalThis, { window: dom.window, localStorage: dom.window.localStorage });
const requests = [], replies = [];
const encode = events => events.map(event => 'data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\n\n').join('');
const session = intent => ({ type: 'agent_session', sessionId: 'session-a', runId: 'run-a', intent });
const delta = content => ({ choices: [{ delta: { content } }] });
const done = { type: 'agent_done', sessionId: 'session-a', runId: 'run-a', status: 'completed' };
const stream = events => new Response(encode(events), { headers: { 'Content-Type': 'text/event-stream' } });
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/api/agent/chat')) {
    requests.push(JSON.parse(init.body));
    assert(replies.length, 'Each request needs an explicit synthetic response');
    return replies.shift()();
  }
  assert(!init?.method || init.method === 'GET', 'No note/memory/checkpoint mutation during retry');
  return new Response(JSON.stringify({ sessions: [], runs: [], settings: { memoryEnabled: true } }), { headers: { 'Content-Type': 'application/json' } });
};
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const until = async predicate => { for (let i=0;i<100;i++) { if (predicate()) return; await tick(); } assert.fail('Synthetic request did not settle'); };
try {
  const { useAppStore: store } = await vite.ssrLoadModule('/src/store/index.tsx');
  const seed = () => store.setState({ agentSessionId: 'session-a', agentTask: null, pendingCheckpoint: null,
    chatLoading: false, chatMessages: [], activeDraftContext: null, activeEditPreview: null,
    selectedFileId: 'note-a', treeData: [{ id: 'note-a', name: '原笔记.md', type: 'file', content: '原正文' }],
    fileContents: { 'note-a': '原正文' }, chatSelection: null, centerMode: 'note', noteSaveState: { status: 'saved' } });
  const last = () => store.getState().chatMessages.slice(-1)[0];
  seed();
  replies.push(() => stream([session('general_chat'), delta('已收到的部分回答')]));
  await store.getState().sendMessage('原问题', { selectedText: '原选中文字', contextScope: 'selection' });
  assert.equal(last().streamState, 'failed', 'EOF without completion must be recoverable');
  assert.equal(last().text, '已收到的部分回答');
  const id = last().id, count = store.getState().chatMessages.length;
  store.setState({ selectedFileId: 'note-b', treeData: [{ id:'note-b', name:'另一篇.md',type:'file',content:'不同正文' }], fileContents: { 'note-b':'不同正文' } });
  let controller;
  replies.push(() => new Response(new ReadableStream({ start(c) { controller=c; } }), { headers:{'Content-Type':'text/event-stream'} }));
  store.getState().retryChatReply(id); store.getState().retryChatReply(id);
  await until(() => Boolean(controller));
  assert.equal(requests.length, 2, 'Double click creates only one request');
  assert.equal(last().text, '已收到的部分回答', 'Keep partial reply while waiting');
  assert.equal(last().id, id);assert.equal(store.getState().chatMessages.length, count, 'No duplicated question');
  assert.equal(requests[1].retryAnswerOnly, true);
  for(const key of ['question','mode','documentTitle','documentContent','pageState','history','memoryEnabled']) assert.deepEqual(requests[1][key],requests[0][key],key+' must retain original context');
  controller.enqueue(new TextEncoder().encode(encode([session('general_chat'),delta('重新生成的回答'),done,'[DONE]'])));controller.close();
  await until(() => !store.getState().chatLoading);
  assert.equal(last().text, '重新生成的回答');assert.equal(last().streamState,'completed');assert.equal(last().errorText,undefined);
  const beforeCompleted = requests.length;store.getState().retryChatReply(id);assert.equal(requests.length,beforeCompleted);

  seed();replies.push(() => new Response('服务暂时不可用',{status:503}));
  await store.getState().sendMessage('首字前失败');assert.equal(last().text,'');assert.equal(last().streamState,'failed');assert(last().replyRequest);
  replies.push(() => new Response('仍不可用',{status:503}));store.getState().retryChatReply(last().id);await until(()=>!store.getState().chatLoading);assert.equal(last().streamState,'failed');

  seed();replies.push(()=>stream([session('general_chat'),delta('保留正文'),{type:'agent_error',message:'网络错误'},delta('网络错误'),{...done,status:'failed'}]));
  await store.getState().sendMessage('事件错误');assert.equal(last().text,'保留正文');assert.equal(last().errorText,'网络错误');
  store.setState({ chatMessages:store.getState().chatMessages.map(m=>({...m,streamState:'stopped'})) });
  const beforeStopped=requests.length;store.getState().retryChatReply(last().id);assert.equal(requests.length,beforeStopped,'User stop is not an error');

  seed();replies.push(()=>stream([session('note_draft_create'),{type:'agent_error',message:'任务失败'},'[DONE]']));
  await store.getState().sendMessage('创建笔记');assert.equal(last().retryBlocked,true);
  const beforeTask=requests.length;store.getState().retryChatReply(last().id);assert.equal(requests.length,beforeTask,'Do not replay writing tasks');

  seed();replies.push(()=>stream([session('general_chat'),delta('部分内容')]));await store.getState().sendMessage('普通问题');
  const beforeCheckpoint=requests.length;store.setState({ pendingCheckpoint:{ id:'waiting' } });store.getState().retryChatReply(last().id);assert.equal(requests.length,beforeCheckpoint);
  store.setState({pendingCheckpoint:null});
  replies.push(()=>stream([session('general_chat'),{type:'tool_action',toolName:'note_draft_tool',action:'open_draft_workspace',payload:{seed:'不得执行'}}]));
  store.getState().retryChatReply(last().id);await until(()=>!store.getState().chatLoading);assert.equal(store.getState().activeDraftContext,null);assert.equal(last().retryBlocked,true);assert.equal(last().text,'部分内容');
  console.log(JSON.stringify({ok:true,actualStoreAndSSE:true,syntheticOnly:true,checks:['partial EOF','original snapshot','duplicate click','successful replacement','503 and retry failure','agent error','manual stop','writing task guard','checkpoint guard','unexpected tool guard']}));
} finally { await vite.close();dom.window.close(); }
