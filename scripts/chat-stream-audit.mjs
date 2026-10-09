// Read-only diagnostic: real AIPanel, Markdown renderer and SSE reader;
// synthetic selector snapshots/fetch only. All actual network is blocked.
// Counts redundant parsing; timing is a local fixture measurement, not a live
// device/network benchmark. Does not change app code, accounts or conversations.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const component = repo + '/src/components/AIPanel.tsx';
const markdown = repo + '/src/utils/chatMarkdown.ts';
const cssName = readdirSync(repo + '/dist/assets').find(name => /^index-.*\.css$/.test(name));
const css = readFileSync(repo + '/dist/assets/' + cssName, 'utf8');
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from ${JSON.stringify(component)};
import {askAIStream} from ${JSON.stringify(repo + '/src/services/aiStream.ts')};
const root=createRoot(document.getElementById('root'));
const noop=()=>{};
const audit={messages:[],loading:false,metrics:[],scrolls:0,arrivals:[],callbacks:[],requests:[],longTasks:[],frames:[],running:false};
const scrollTo=Element.prototype.scrollTo;
Element.prototype.scrollTo=function(...args){if(this.classList.contains('ai-message-list')&&window.audit)window.audit.scrolls++;return scrollTo.apply(this,args)};
const chat={chatMessages:[],chatLoading:false,chatSessions:[],chatSessionsLoading:false,newChatSession:noop,switchChatSession:noop,renameChatSession:noop,deleteChatSession:noop,sendMessage:noop,stopGeneration:noop,chatSelection:null,clearChatSelection:noop};
const editor={activeEditPreview:null,createEditPreviewRequest:noop,applyEditPreviewRequest:noop,cancelEditPreviewRequest:noop,focusChatSource:noop};
const draft={centerMode:'note',activeDraftContext:null,pendingCheckpoint:null,setActiveDraftContext:noop,closeDraft:noop,openPendingEditPreview:noop,openPendingDraft:noop,requestDraftCommand:noop};
const agent={agentSessionId:null,agentTask:null,agentRunHistory:[],agentTaskDetailOpen:false};
const workspace={selectedFileId:null,treeData:[],reloadWorkspace:noop};
window.audit={...audit,chat,editor,draft,agent,workspace};
const a=window.audit;
a.render=()=>{chat.chatMessages=a.messages;chat.chatLoading=a.loading;root.render(React.createElement(Panel))};
const sample=(i)=>'## 合成历史 '+i+'\\n\\n'+('这是一段用于诊断的历史回答，**重要概念**和示例都来自合成数据。\\n\\n').repeat(8)+'| 名称 | 说明 |\\n| --- | --- |\\n| 缓存 | 保存常用数据 |\\n\\n'+String.fromCharCode(96,96,96)+'python\\n'+('def read_cache(key):\\n    return store.get(key) # 合成例子\\n').repeat(6)+String.fromCharCode(96,96,96)+'\\n';
a.setup=(count)=>{a.messages=[];for(let i=0;i<count;i++){a.messages.push({id:'u-'+i,role:'user',text:'合成问题 '+i},{id:'h-'+i,role:'assistant',text:sample(i)})}a.messages.push({id:'current',role:'assistant',text:''});a.loading=true;a.render()};
try{new PerformanceObserver(list=>{if(a.running)a.longTasks.push(...list.getEntries().map(e=>e.duration))}).observe({type:'longtask',buffered:false})}catch{}
let lastFrame=0;const frame=(t)=>{if(a.running&&lastFrame)a.frames.push(t-lastFrame);lastFrame=t;requestAnimationFrame(frame)};requestAnimationFrame(frame);
window.fetch=async(url)=>{a.requests.push(String(url));if(!String(url).endsWith('/api/agent/chat'))throw new Error('unexpected synthetic fetch');let sent=0;const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){const timer=setInterval(()=>{if(sent===30){clearInterval(timer);controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));controller.close();return}const delta='流式内容 '+sent+'，';a.arrivals.push({time:performance.now(),delta});controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:delta}}]})+'\\n\\n'));sent++},25)}}),{headers:{'Content-Type':'text/event-stream'}})};
a.run=async()=>{a.metrics=[];a.scrolls=0;a.arrivals=[];a.callbacks=[];a.longTasks=[];a.frames=[];a.running=true;const start=performance.now();await askAIStream({question:'合成流式诊断',history:[],onDelta(delta){a.callbacks.push({time:performance.now(),delta});a.messages=a.messages.map(m=>m.id==='current'?{...m,text:m.text+delta}:m);a.render()}});await new Promise(resolve=>setTimeout(resolve,100));a.running=false;a.elapsed=performance.now()-start;return true};
a.render();`;
const result = await build({root:repo,configFile:false,logLevel:'silent',plugins:[{
  name:'isolated-chat-diagnostic',enforce:'pre',
  resolveId(id,importer){if(id==='virtual:chat-audit')return '\0chat-audit';if(importer===component&&id==='../store/selectors')return '\0chat-audit-selectors'},
  load(id){if(id==='\0chat-audit')return entry;if(id==='\0chat-audit-selectors')return 'export const useChatSlice=()=>window.audit.chat;export const useEditorSlice=()=>window.audit.editor;export const useDraftSlice=()=>window.audit.draft;export const useAgentSlice=()=>window.audit.agent;export const useWorkspaceSlice=()=>window.audit.workspace;'},
  transform(source,id){if(id===markdown)return source.replace('export function renderChatMarkdown(', 'function originalRenderChatMarkdown(')+'\nexport function renderChatMarkdown(text,count=0,options){const start=performance.now();const html=originalRenderChatMarkdown(text,count,options);window.audit?.metrics.push({historical:text.startsWith("## 合成历史"),ms:performance.now()-start});return html;}';}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:chat-audit'}}});
const chunks=result.output.filter(item=>item.type==='chunk');
assert.equal(chunks.length,1);
const source=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const errors=[],requests=[],reports=[];
try{
  const context=await browser.newContext({viewport:{width:600,height:850}});
  await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'#root{width:500px;height:800px;display:flex}#root>aside{flex:1;min-width:0}</style></head><body><div id="root"></div><script type="module">'+source+'</script></body></html>');
  await page.waitForFunction(()=>Boolean(window.audit));
  for(const count of [0,10,30]){
    await page.evaluate(count=>window.audit.setup(count),count);
    await page.waitForTimeout(700);
    await page.evaluate(()=>{const list=document.querySelector('.ai-message-list');list.scrollTo({top:list.scrollHeight,behavior:'instant'});list.dispatchEvent(new Event('scroll'))});
    await page.waitForTimeout(100);
    await page.evaluate(()=>window.audit.run());
    const report=await page.evaluate(count=>{const a=window.audit;const sorted=a.metrics.map(m=>m.ms).sort((a,b)=>a-b);const gaps=a.callbacks.slice(1).map((c,i)=>c.time-a.callbacks[i].time);const lag=a.callbacks.map((c,i)=>c.time-a.arrivals[i].time);return {historyAnswers:count,incomingChunks:a.arrivals.length,callbacks:a.callbacks.length,markdownCalls:a.metrics.length,historicalMarkdownCalls:a.metrics.filter(m=>m.historical).length,totalMarkdownMs:Math.round(a.metrics.reduce((sum,m)=>sum+m.ms,0)),p95SingleMarkdownMs:sorted[Math.floor(sorted.length*.95)]||0,scrollCalls:a.scrolls,maxFrameGapMs:Math.round(Math.max(0,...a.frames)),framesOver50ms:a.frames.filter(g=>g>50).length,longTasks:a.longTasks.map(x=>Math.round(x)),maxCallbackGapMs:Math.round(Math.max(0,...gaps)),maxParserDeliveryLagMs:Math.round(Math.max(0,...lag)),renderedText:document.querySelectorAll('.chat-markdown').length,elapsedMs:Math.round(a.elapsed)}} ,count);
    assert.equal(report.callbacks,30);assert.equal(report.incomingChunks,30);reports.push(report);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,networkBlocked:true,synthetic:true,productionComponent:true,productionStreamReader:true,reports,errors},null,2));
  await context.close();
}finally{await browser.close()}
