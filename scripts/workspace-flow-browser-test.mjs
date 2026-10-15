// Actual App, editor, library, AI panel and store. Only auth/hydration/HTTP are
// synthetic. Instrumentation belongs to this offline bundle, never production.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const path = name => fileURLToPath(new URL('../src/' + name, import.meta.url));
const baselineRef = process.env.NOTEFLOW_FLOW_BASE_REF;
const baseline = Boolean(baselineRef);
const previousFiles = new Set(['App.tsx','components/AIPanel.tsx','components/DirectoryTree.tsx','store/selectors/index.ts'].map(path));
const readSource = id => baselineRef && previousFiles.has(id)
  ? execFileSync('git',['show',baselineRef+':src/'+id.slice(path('').length)],{encoding:'utf8'}) : readFileSync(id,'utf8');
const css = readdirSync(new URL('../dist/assets/', import.meta.url)).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL('../dist/assets/' + n, import.meta.url), 'utf8')).join('\n');
const content = id => `# ${id} 合成长笔记\n\n` + Array.from({length:80}, (_, i) => `## ${id} 章节 ${i+1}\n\n${'连续阅读、选择和编辑不能丢失位置与内容。'.repeat(8)}\n\n${i%4===0?'```go\nfunc example() { println("colors") }\n```\n\n':''}`).join('');
const sourceA = content('Alpha'), sourceB = content('Beta');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import App from ${JSON.stringify(path('App.tsx'))};import{useAppStore}from ${JSON.stringify(path('store/index.tsx'))};
const contents={Alpha:${JSON.stringify(sourceA)},Beta:${JSON.stringify(sourceB)}};
const stats=()=>({app:0,chat:0,library:0,rows:0,editor:0,serialize:0,highlight:0,historyParses:0});
const api={store:useAppStore,editor:null,stats:stats(),calls:[],reset(){this.stats=stats()},streaming:false};window.flowTest=api;
const nodes=Array.from({length:120},(_,i)=>({id:i===0?'Alpha':i===1?'Beta':'extra-'+i,name:i===0?'Alpha.md':i===1?'Beta.md':'合成笔记 '+i+'.md',type:'file',indexStatus:'indexed'}));
const note=id=>({id,title:id+'.md',content:contents[id]||'',categoryId:null,summary:null,tags:[],contentHash:'synthetic',isPinned:false,isFavorite:false,indexStatus:'indexed',createdAt:null,updatedAt:null,deletedAt:null});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
window.fetch=async(input,init={})=>{const url=String(input);api.calls.push({url,method:init.method||'GET'});
 const id=url.match(/\\/api\\/notes\\/([^/]+)/)?.[1];
 if(url.endsWith('/outline'))return response({sections:[]});
 if(id){if(init.method==='PUT')contents[id]=JSON.parse(init.body).content;return response({note:note(id)})}
 throw Error('Unexpected synthetic API '+url)};
useAppStore.setState({treeData:[{id:'folder',type:'folder',name:'合成知识库',children:nodes}],selectedFileId:'Alpha',expandedFolderIds:new Set(['folder']),fileContents:contents,serverSyncReady:false,hydratedUserId:null,
chatMessages:Array.from({length:40},(_,i)=>({id:'history-'+i,role:'assistant',text:'## 合成历史 '+i+'\\n\\n'+('历史正文不应随着笔记输入重复处理。'.repeat(12))+'\\n\\n\`\`\`go\\nfunc history() { println("keep") }\\n\`\`\`'}))});
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`;
const result = await build({configFile:false,logLevel:'silent',plugins:[{name:'offline-continuous-flow',enforce:'pre',
 resolveId(id){if(id==='virtual:flow')return '\0flow'},
 load(id){
  if(id==='\0flow')return entry;
  if(id===path('store/selectors/index.ts')&&baselineRef)return readSource(id);
  if(id===path('App.tsx'))return readSource(id)
   .replace('export default function App() {','export default function App() { window.flowTest.stats.app++;')
   .replace('import { useAuthSession } from "./hooks/useAuthSession";','const noop=()=>{};const useAuthSession=()=>({loading:false,session:{user:{id:"synthetic",email:"test@example.invalid",displayName:"合成用户",emailVerified:true}},signIn:noop,signInWithEmailCode:noop,signUp:noop,signOut:noop,updateSession:noop});')
   .replace('<AppProvider userId={session.user.id}>','<>').replace('</AppProvider>','</>');
  if(id===path('components/AIPanel.tsx'))return readSource(id).replace('export default function AIPanel({ onCollapse }: { onCollapse?: () => void }) {','export default function AIPanel({ onCollapse }: { onCollapse?: () => void }) { window.flowTest.stats.chat++;');
  if(id===path('components/DirectoryTree.tsx'))return readSource(id).replace('  const isExpanded =','  window.flowTest.stats.rows++; const isExpanded =').replace('}: DirectoryTreeProps) {','}: DirectoryTreeProps) { window.flowTest.stats.library++;');
  if(id===path('components/NoteEditor.tsx'))return readFileSync(id,'utf8').replace('  const [titleDraft, setTitleDraft]','  window.flowTest.stats.editor++; const [titleDraft, setTitleDraft]')
   .replace('      extensions,','      extensions, onCreate: ({editor}) => { window.flowTest.editor=editor; const original=editor.getMarkdown.bind(editor); editor.getMarkdown=()=>{window.flowTest.stats.serialize++;return original()}; },');
  if(id===path('editor/codeHighlight.ts'))return readFileSync(id,'utf8').replace('  const requested = normalizeCodeLanguage(storedLanguage);','  window.flowTest.stats.highlight++; const requested = normalizeCodeLanguage(storedLanguage);');
  if(id===path('utils/chatMarkdown.ts'))return readFileSync(id,'utf8').replace('export function renderChatMarkdown(','function originalRenderChatMarkdown(')+'\nexport function renderChatMarkdown(text,...rest){if(text.startsWith("## 合成历史"))window.flowTest.stats.historyParses++;return originalRenderChatMarkdown(text,...rest)}';
 }
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:flow',output:{codeSplitting:false}}}});
const chunks=result.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>';
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-workspace-flow-')),reports=[];
async function settle(page){await page.evaluate(async()=>{for(let i=0;i<5;i++){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const a=document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity);if(!a.length)return;await Promise.all(a.map(a=>a.finished.catch(()=>{})))}})}
async function ready(page,id){await page.waitForFunction(id=>document.querySelector('.note-entry')?.dataset.ready==='true'&&document.querySelector('.tiptap')?.textContent.includes(id+' 章节 80')&&!window.flowTest.editor?.isDestroyed,id);await settle(page)}
async function phase(page,action){await settle(page);await page.evaluate(()=>{window.flowTest.reset();window.flowTasks=[];window.flowObserver=new PerformanceObserver(list=>window.flowTasks.push(...list.getEntries().map(e=>Math.round(e.duration))));window.flowObserver.observe({type:'longtask'});window.flowFrames=[];window.flowSample=true;const sample=t=>{window.flowFrames.push(t);if(window.flowSample)requestAnimationFrame(sample)};requestAnimationFrame(sample)});await action();await settle(page);return page.evaluate(()=>{window.flowSample=false;window.flowObserver.disconnect();const f=window.flowFrames;return {...window.flowTest.stats,longTasks:window.flowTasks,maxFrameGap:Math.round(Math.max(0,...f.slice(1).map((t,i)=>t-f[i])))}})}
try{
 for(const width of [1277,800,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1000}),errors=[],requests=[];
  await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(html);await ready(page,'Alpha');
  if(width<768){await page.getByRole('button',{name:'打开知识库',exact:true}).click();await settle(page)}
  const switched=await phase(page,async()=>{await page.getByRole('button',{name:'Beta',exact:true}).click();await ready(page,'Beta')});
  // Observe a whole reading/edit/AI chain without resetting the page or store.
  const reading=await phase(page,async()=>{await page.locator('.document-scroll').evaluate(async n=>{n.scrollTop=1200;for(let i=0;i<20;i++){n.scrollTop+=24;await new Promise(r=>requestAnimationFrame(r))}})});
  assert.equal(reading.serialize,0);assert.equal(reading.highlight,0);
  const body=page.locator('.tiptap.note-content');
  const original=await body.textContent();
  await page.evaluate(()=>{const e=window.flowTest.editor;const p=[...e.view.dom.querySelectorAll('p')].find(n=>{const r=n.getBoundingClientRect();return r.top>180&&r.top<500});if(!p)throw Error('No visible paragraph');const pos=e.view.posAtDOM(p,0);e.chain().focus(undefined,{scrollIntoView:false}).setTextSelection({from:pos+1,to:pos+9}).run()});
  const highlighter=page.getByRole('button',{name:'高亮',exact:true});await highlighter.waitFor();
  await highlighter.click();assert.equal(await body.textContent(),original);assert.equal(await body.locator('mark').count(),1);
  await page.keyboard.press('ControlOrMeta+z');await page.waitForFunction(()=>!document.querySelector('.tiptap mark'));
  await page.evaluate(()=>window.flowTest.editor.commands.focus('end'));await settle(page);
  const typing=await phase(page,async()=>{await page.keyboard.type('chain-edit')});
  assert((await body.textContent()).endsWith('chain-edit'));assert.equal(typing.serialize,10);assert.equal(typing.highlight,0);assert.equal(typing.historyParses,0);
  console.log(JSON.stringify({width,baseline,switched,reading,typing}));
  if(!baseline){assert.equal(typing.chat,0,'Paragraph input must not rerender idle long chat');assert.equal(typing.library,0,'Paragraph input must not rerender the library');assert.equal(typing.rows,0,'Paragraph input must not rerender every file row')}
  await page.waitForFunction(()=>window.flowTest.store.getState().noteSaveState.status==='saved');
  assert.equal(await page.getByRole('alert').count(),0,'Successful synthetic API must not hide an unverified save failure');
  const beforeOpen=await page.evaluate(()=>{const e=window.flowTest.editor;window.beforeFlowEditor=e;window.beforeFlowDoc=e.state.doc;return {selection:e.state.selection.toJSON(),scroll:document.querySelector('.document-scroll').scrollTop}});
  await page.getByRole('button',{name:'展开 AI 助手',exact:true}).click();await settle(page);
  const input=page.getByRole('textbox',{name:'消息输入框',exact:true});await input.fill('这份未发送内容要保留');
  await page.evaluate(()=>document.querySelector('textarea[aria-label="消息输入框"]').setSelectionRange(2,6));
  await page.getByRole('button',{name:'收起 AI 助手',exact:true}).click();await settle(page);
  assert.deepEqual(await page.evaluate(()=>window.flowTest.editor.state.selection.toJSON()),beforeOpen.selection);
  assert(await page.evaluate(()=>window.beforeFlowEditor===window.flowTest.editor&&window.beforeFlowDoc===window.flowTest.editor.state.doc));
  assert(await page.locator('.document-scroll').evaluate(n=>n.scrollTop>0));
  await page.getByRole('button',{name:'展开 AI 助手',exact:true}).click();await settle(page);
  assert.equal(await input.inputValue(),'这份未发送内容要保留');
  // Synthetic transport updates, not real model calls. Watch unrelated prose.
  const streaming=await phase(page,async()=>{await page.evaluate(async()=>{const s=window.flowTest.store;const prior=s.getState().chatMessages;s.setState({chatLoading:true,chatMessages:[...prior,{id:'live',role:'assistant',text:'',streamState:'streaming'}]});for(let i=0;i<20;i++){s.setState({chatMessages:[...prior,{id:'live',role:'assistant',text:'合成流式正文。'.repeat(i+1),streamState:'streaming'}]});await new Promise(r=>setTimeout(r,25))}s.setState({chatLoading:false,chatMessages:[...prior,{id:'live',role:'assistant',text:'合成流式正文。'.repeat(20),streamState:'completed'}]})});await page.waitForFunction(()=>document.querySelector('.nf-chat-message:last-of-type')?.textContent.includes('合成流式正文')||!window.flowTest.store.getState().chatLoading)});
  assert.equal(streaming.serialize,0);assert.equal(streaming.highlight,0);assert.equal(streaming.historyParses,0);
  if(!baseline){assert.equal(streaming.app,0,'Transport updates must not redraw the entire App');assert.equal(streaming.editor,0,'Transport updates must not redraw prose');assert.equal(streaming.library,0,'Transport updates must not redraw the library')}
  assert.equal(await input.inputValue(),'这份未发送内容要保留');
  await input.focus();await input.evaluate(n=>n.setSelectionRange(2,6));
  await page.evaluate(()=>{window.flowInput=document.querySelector('textarea[aria-label="消息输入框"]')});
  await page.setViewportSize({width:width===1277?959:1277,height:900});await settle(page);
  assert(await input.evaluate(n=>n===window.flowInput&&n===document.activeElement));assert.deepEqual(await input.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,6]);
  await page.getByRole('button',{name:'收起 AI 助手',exact:true}).click();await settle(page);
  // Return through the real note-open action. Cached edited content survives.
  await page.evaluate(()=>window.flowTest.store.getState().setSelectedFileId('Alpha'));await ready(page,'Alpha');
  await page.evaluate(()=>window.flowTest.store.getState().setSelectedFileId('Beta'));await ready(page,'Beta');
  assert((await body.textContent()).endsWith('chain-edit'));
  await page.waitForFunction(()=>window.flowTest.store.getState().noteSaveState.status==='saved');
  assert.equal(await page.getByRole('alert').count(),0);
  assert(await body.locator('pre span').count()>50);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(output,'chain-'+width+'.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,baseline,notes:2,headingsPerNote:80,libraryFiles:120,historyMessages:40,switched,reading,typing,streaming,highlightUndo:true,editorIdentity:true,inputSelection:true,noteReopen:true,colors:true,errors,requests});await context.close();
 }
 writeFileSync(join(output,'results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify({actualAppAndStore:true,syntheticOnly:true,baseline,output,reports},null,2));
}finally{await browser.close()}
