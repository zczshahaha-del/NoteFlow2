// Actual App / DirectoryTree / LibraryDrawer / store; auth, hydration and body are synthetic.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const path = name => fileURLToPath(new URL('../src/' + name, import.meta.url));
const realEditor = process.env.NOTEFLOW_MOTION_REAL_EDITOR === '1';
const longContent = '# Git 入门学习笔记\n\n' + Array.from({length:150},(_,i)=>`## 第 ${i+1} 节：长篇笔记\n\n${'正文流畅性验证，保留排版、彩色代码与阅读位置。'.repeat(12)}\n\n${'连续伸缩不能丢失输入、重建编辑器或产生重叠。'.repeat(8)}\n\n\`\`\`go\n${'func demo() { println("彩色代码") }\n'.repeat(8)}\`\`\`\n\n`).join('');
const fixtureContent = realEditor ? longContent : '合成正文';
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL(n, assets), 'utf8')).join('\n');
assert(css, 'Build production CSS first');
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import App from ${JSON.stringify(path('App.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
useAppStore.setState({treeData:[{id:'folder',type:'folder',name:'学习笔记',children:[{id:'note',type:'file',name:'Git 入门学习笔记.md'}]}],selectedFileId:'note',expandedFolderIds:new Set(['folder']),fileContents:{note:${JSON.stringify(fixtureContent)}},centerMode:'note',serverSyncReady:false,hydratedUserId:null});
window.navigationTest={store:useAppStore,retry:useAppStore.getState().retryWorkspaceOperation,retries:[]};
window.fetch=async(input)=>new Response(JSON.stringify(String(input).endsWith('/outline')?{sections:[]}:{note:{id:'note',title:'Git 入门学习笔记.md',content:${JSON.stringify(fixtureContent)},categoryId:null,summary:null,tags:[],contentHash:'synthetic',isPinned:false,isFavorite:false,indexStatus:'outdated',createdAt:null,updatedAt:null,deletedAt:null}}),{headers:{'Content-Type':'application/json'}});
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`;
const stubs = new Set(['components/AIPanel.tsx','components/AIDraftWorkspace.tsx','components/EditPreviewWorkspace.tsx'].map(path));
const result=await build({configFile:false,logLevel:'silent',plugins:[{
 name:'isolated-navigation',enforce:'pre',
 resolveId(id){if(id==='virtual:entry')return '\0entry';},
 load(id){
  if(id==='\0entry')return entry;
  if(id===path('components/AIPanel.tsx'))return `import React from 'react';export default function AI({onCollapse}){return <div><button aria-label="收起 AI 助手" onClick={onCollapse}>收起</button><textarea aria-label="合成对话输入" /></div>}`;
  if(stubs.has(id))return 'export default function Stub(){return null}';
  if(id===path('components/NoteEditor.tsx'))return realEditor ? readFileSync(id,'utf8')
   .replace('export default function NoteEditor() {','export default function NoteEditor() { window.bodyRenderCount=(window.bodyRenderCount||0)+1;')
   .replace('      extensions,','      extensions, onCreate: ({editor}) => { window.navigationTest.editor=editor; },')
   : `import React from 'react';export default function Body(){window.bodyRenderCount=(window.bodyRenderCount||0)+1;return <div className="document-editor" style={{padding:'84px 72px',width:'100%'}}><div className="document-canvas"><div className="note-page"><h1>Git 入门学习笔记</h1><p>这是隔离验证正文，不读取真实笔记。</p><button>正文操作</button></div></div></div>}`;
  if(id===path('App.tsx'))return readFileSync(id,'utf8')
   .replace('const [filePanelPinned, setFilePanelPinned] = useState(true);','const [filePanelPinned, setFilePanelPinned] = useState(true); window.navigationTest.toggleLibrary=setFilePanelPinned;')
   .replace('import { useAuthSession } from "./hooks/useAuthSession";', 'const noop = () => {}; const useAuthSession = () => ({loading:false,session:{user:{id:"synthetic",email:"test@example.invalid",displayName:"合成用户",emailVerified:true}},signIn:noop,signInWithEmailCode:noop,signUp:noop,signOut:noop,updateSession:noop});')
   .replace('<AppProvider userId={session.user.id}>','<>').replace('</AppProvider>','</>');
 }
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:entry',output:{codeSplitting:false}}}});
const chunks=result.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const script=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-library-navigation-')), reports=[];
async function settled(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});await page.waitForFunction(()=>{const n=document.querySelector('.library-navigation');return !n || n.dataset.motion===(n.dataset.open==='true'?'open':'closed');});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
async function bodyAction(page){await page.getByRole(realEditor?'textbox':'button',{name:realEditor?'文档标题':'正文操作',exact:true}).click();}
async function motionStress(page) {
 await settled(page);
 await page.evaluate(()=>{
  const editor=window.navigationTest.editor, scroll=document.querySelector('.document-scroll');
  if(scroll)scroll.scrollTop=1700;
  window.motionBefore={editor,doc:editor?.state.doc,scroll:scroll?.scrollTop};
  window.stressFrames=[];window.stressSampling=true;
  window.motionLongTasks=[];
  if(PerformanceObserver.supportedEntryTypes.includes('longtask')){window.motionObserver=new PerformanceObserver(list=>window.motionLongTasks.push(...list.getEntries().map(e=>e.duration)));window.motionObserver.observe({type:'longtask'});}
  const sample=()=>{const n=document.querySelector('.library-navigation'), b=document.querySelector('.workspace-center-layer'),s=document.querySelector('.library-navigation-surface');window.stressFrames.push({t:performance.now(),width:n.getBoundingClientRect().width,edge:n.getBoundingClientRect().right,body:b.getBoundingClientRect().left,surface:s.getBoundingClientRect().right,phase:n.dataset.motion,launcher:!!document.querySelector('.library-launcher'),resize:!!n.querySelector('.library-resize-handle')});if(window.stressSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample);
 });
 // Engine interruption test through the same React setter, not a fake native click.
 await page.evaluate(async()=>{for(let i=0;i<16;i++){window.navigationTest.toggleLibrary(i%2===1);await new Promise(r=>setTimeout(r,25));}window.navigationTest.toggleLibrary(true);});
 await settled(page);
 const result=await page.evaluate(()=>{
  window.stressSampling=false;window.motionObserver?.disconnect();
  const frames=window.stressFrames, gaps=frames.slice(1).map((n,i)=>n.t-frames[i].t), scroll=document.querySelector('.document-scroll');
  return {frames,gaps,longTasks:window.motionLongTasks,editorStable:window.motionBefore.editor===window.navigationTest.editor,docStable:window.motionBefore.doc===window.navigationTest.editor?.state.doc,scrollBefore:window.motionBefore.scroll,scrollAfter:scroll?.scrollTop,tokenCount:document.querySelectorAll('.note-content .token-keyword,.note-content .token-string,.note-content .token-function').length};
 });
 assert(result.frames.some(n=>n.phase==='opening')&&result.frames.some(n=>n.phase==='closing'),'Both reversal directions really run');
 assert(result.frames.every(n=>n.width>=0&&n.width<=260.1&&Math.abs(n.edge-n.body)<1&&n.surface<=n.edge+1),'Reversals keep geometry in bounds and never overlay the body');
 assert(result.frames.every(n=>!n.launcher || n.phase==='closed'),'Launcher is controlled by actual completion, not a fixed delay');
 assert(result.frames.every(n=>!n.resize || n.phase==='open'),'A moving edge cannot start a competing drag');
 assert.equal(await page.locator('.library-navigation').getAttribute('data-motion'),'open');
 if(realEditor){assert(result.editorStable&&result.docStable,'Motion must not recreate the editor or replace its document');assert(result.tokenCount>1000,'Production highlighter renders the long code note');assert(result.scrollAfter>0,'Motion does not reset reading to the top');}
 // Separate normal mouse/keyboard cycles from the synthetic reversal stress.
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);await page.getByRole('button',{name:'展开目录',exact:true}).press('Enter');await settled(page);}
 // Close while pointer capture is active: cleanup must not resurrect old width.
 const edge=await page.getByRole('separator',{name:'调整目录宽度'}).boundingBox();
 await page.mouse.move(edge.x+5,210);await page.mouse.down();await page.mouse.move(edge.x+40,210,{steps:4});
 await page.evaluate(()=>{window.dragExitFrames=[];window.dragExitSampling=true;const sample=()=>{const n=document.querySelector('.library-navigation').getBoundingClientRect(),s=document.querySelector('.library-navigation-surface').getBoundingClientRect();window.dragExitFrames.push({edge:n.right,surface:s.right});if(window.dragExitSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
 await page.getByRole('button',{name:'收起目录',exact:true}).press('Enter');await page.mouse.up();await settled(page);
 const dragExitFrames=await page.evaluate(()=>{window.dragExitSampling=false;return window.dragExitFrames});assert(dragExitFrames.every(n=>n.surface<=n.edge+1),'Drag cleanup cannot expose a stale-width surface over the body');
 await collapsedSurfaceCheck(page);
 assert.equal(await page.evaluate(()=>document.body.style.cursor),'');assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');
 await page.getByRole('button',{name:'展开目录',exact:true}).press('Enter');await settled(page);
 // Switch reduced motion during an owned exit, rather than only before it.
 await page.evaluate(()=>window.navigationTest.toggleLibrary(false));
 await page.emulateMedia({reducedMotion:'reduce'});await settled(page);await collapsedSurfaceCheck(page);
 await page.getByRole('button',{name:'展开目录',exact:true}).press('Enter');await settled(page);
 await page.emulateMedia({reducedMotion:'no-preference'});
 return {reversals:16,nativeCycles:3,frames:result.frames.length,maxFrameGapMs:Math.round(Math.max(...result.gaps)),longTasksOver50ms:result.longTasks.length,editorStable:result.editorStable,documentStable:result.docStable,codeTokens:result.tokenCount,scrollBefore:result.scrollBefore,scrollAfter:result.scrollAfter};
}
async function open(page){await page.locator('.library-launcher').click();await page.locator('.library-drawer[data-open="true"]').waitFor();await settled(page);}
async function headerCheck(page){
 const title=page.getByRole('heading',{name:'知识库',exact:true});
 assert.equal(await title.count(),1);
 assert.equal(await title.evaluate(n=>n.parentElement.textContent.trim()),'知识库','Library header has no note count');
 assert.equal(await title.evaluate(n=>n.parentElement.querySelector('svg')?.getAttribute('width')),'16','Book icon is retained');
 const controls=await page.evaluate(()=>['搜索全部笔记','新建','收起目录'].map(label=>{const n=document.querySelector(`.directory-tree button[aria-label="${label}"]`);const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert(controls[0].x<controls[1].x && controls[1].x<controls[2].x,'Collapse stays after search and new, at the right of the header');
 assert(controls.every(n=>Math.abs(n.y+n.height/2-controls[0].y-controls[0].height/2)<1),'All three header controls share a center line, including larger touch targets');
 assert.equal(await page.locator('.library-launcher').count(),0,'Expanded library has no separate top-left toggle');
}
async function collapsedSurfaceCheck(page) {
 const state=await page.locator('.library-navigation').evaluate(n=>({
  width:n.getBoundingClientRect().width,inert:n.inert,
  right:n.querySelector('.library-navigation-surface').getBoundingClientRect().right,
 }));
 assert.equal(state.width,0,'Closed navigation consumes no space');assert(state.inert);assert(state.right<=0,'Full surface is offscreen');
 assert.equal(await page.getByRole('button',{name:/的账号菜单$/}).count(),0,'Collapsed account is not accessible');
 assert.equal(await page.locator('.nf-account-popover[data-open="true"]').count(),0);
}
async function resizeChecks(page, panel, width) {
 const handle=page.getByRole('separator',{name:'调整目录宽度'});
 assert.equal(await handle.count(),1);
 const start=await panel.boundingBox(), hit=await handle.boundingBox();
 const maxWidth=Math.min(420,width-416), draggedWidth=Math.min(start.width+100,maxWidth);
 assert.equal(await handle.locator('span').evaluate(n=>getComputedStyle(n).opacity),'0');
 const renders=await page.evaluate(()=>window.bodyRenderCount), stored=await page.evaluate(()=>localStorage.getItem('noteflow-library-width'));
 await page.mouse.move(hit.x+5,200);await page.mouse.down();await page.mouse.move(hit.x+105,200,{steps:12});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal((await panel.boundingBox()).width,draggedWidth);
 assert.equal(await page.evaluate(()=>window.bodyRenderCount),renders,'Dragging must not rerender the document');
 assert.equal(await page.evaluate(()=>localStorage.getItem('noteflow-library-width')),stored,'Do not write storage on pointermove');
 assert.equal(await page.locator('.library-navigation').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 assert.equal(await page.locator('.note-page').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 await page.mouse.up();await settled(page);
 assert.equal(await page.evaluate(()=>Number(localStorage.getItem('noteflow-library-width'))),draggedWidth);
 const committed=(await panel.boundingBox()).width;
 const current=await handle.boundingBox();await page.mouse.move(current.x+5,200);await page.mouse.down();await page.mouse.move(current.x+65,200);
 await handle.press('Escape');await page.mouse.up();await settled(page);
 assert.equal((await panel.boundingBox()).width,committed,'Escape rolls back only the current drag');
 assert.equal(await page.evaluate(()=>Number(localStorage.getItem('noteflow-library-width'))),committed);
 await handle.press('Home');await settled(page);assert.equal((await panel.boundingBox()).width,220);
 await handle.press('End');await settled(page);assert.equal((await panel.boundingBox()).width,maxWidth);
 await handle.press('ArrowLeft');await settled(page);assert.equal((await panel.boundingBox()).width,maxWidth-16);
 const limit=await handle.boundingBox();await page.mouse.move(limit.x+5,200);await page.mouse.down();await page.mouse.move(limit.x+305,200);await page.mouse.up();await settled(page);
 assert.equal((await panel.boundingBox()).width,maxWidth,'Pointer maximum');
 const max=await handle.boundingBox();await page.mouse.move(max.x+5,200);await page.mouse.down();await page.mouse.move(100,200);await page.mouse.up();await settled(page);
 assert.equal((await panel.boundingBox()).width,220,'Pointer minimum');
 await handle.press('ArrowRight');await settled(page);assert.equal((await panel.boundingBox()).width,236);
 assert.equal(await page.evaluate(()=>document.body.style.cursor),'');assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');
}
try {
 for(const width of [1440,1277,768,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
  const html='<html><head><style>'+css+' html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module">'+script+'</script></body></html>';
  const requests=[],errors=[];await context.route('**/*',r=>{
   if(r.request().url()==='http://noteflow.test/')return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
   requests.push(r.request().url());return r.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://noteflow.test/');
  try { await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor(); }
  catch(error){console.error(JSON.stringify({width,errors,requests,body:await page.locator('body').innerText()}));throw error;}
  const motion = width>=768 ? await motionStress(page) : null;
  await page.evaluate(()=>window.navigationTest.store.setState({workspaceIssues:[{id:'test-issue',label:'移动笔记',message:'合成未同步',busy:false}],retryWorkspaceOperation:id=>window.navigationTest.retries.push(id)}));
  await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').textContent()).includes('合成未同步'));
  const feedbackBox=await page.locator('.nf-workspace-feedback').boundingBox();assert(feedbackBox.x>=0&&feedbackBox.x+feedbackBox.width<=width);
  await page.getByRole('button',{name:'重试',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.navigationTest.retries),['test-issue']);
  await page.evaluate(()=>window.navigationTest.store.setState({workspaceIssues:[{id:'test-issue',label:'移动笔记',message:'合成未同步',busy:true}]}));
  assert(await page.getByRole('button',{name:'重试中…',exact:true}).isDisabled());
  await page.evaluate(()=>window.navigationTest.store.setState({workspaceIssues:[],workspaceError:null,retryWorkspaceOperation:window.navigationTest.retry}));
  assert.equal(await page.getByRole('alert').count(),0,'Normal workspace stays free of feedback panels');
  if(width>=768){
   await headerCheck(page);
   assert.equal(await page.locator('.library-drawer:not(.ai-drawer)').count(),0,'Laptop/tablet library is never a modal drawer');
   assert.equal(await page.locator('.library-drawer-veil').count(),0,'Docked library has no veil');
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),false);
   await bodyAction(page);
   await resizeChecks(page,page.locator('.library-navigation'),width);
   await page.reload();await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor();
   assert.equal((await page.locator('.library-navigation').boundingBox()).width,236,'Saved width after reload');
   const centeredDialog=async name=>{
    const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
    const box=await dialog.boundingBox();
    assert(Math.abs(box.x+box.width/2-width/2)<1,'Modal centers in the viewport, not the transformed sidebar');
    assert(Math.abs(box.y+box.height/2-450)<1);
    assert.equal(await dialog.evaluate(n=>n.parentElement.parentElement===document.body),true,'Modal is portaled outside the moving surface');
    await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'detached'});
   };
   await page.getByRole('button',{name:'新建',exact:true}).click();
   await page.getByRole('button',{name:'新建文件夹',exact:true}).click();await centeredDialog('新建文件夹');
   await page.getByRole('button',{name:'文件操作',exact:true}).last().click();
   await page.getByRole('button',{name:'移动到',exact:true}).click();await centeredDialog('移动笔记');
   assert.equal(await page.locator('[data-account-footer] .nf-username').count(),0,'No permanent account identifier in the sidebar');
   await page.locator('.nf-account-trigger').click();await page.getByRole('dialog',{name:'账号操作'}).waitFor();
   await page.evaluate(()=>{window.avatarFrames=[];window.avatarSampling=true;const sample=()=>{const surface=document.querySelector('.library-navigation-surface'),p=surface.getBoundingClientRect(),a=document.querySelector('.nf-account-trigger').getBoundingClientRect(),nav=document.querySelector('.library-navigation').getBoundingClientRect(),body=document.querySelector('.workspace-center-layer').getBoundingClientRect(),text=document.querySelector('.note-page').getBoundingClientRect(),launcher=document.querySelector('.library-launcher'),style=launcher&&getComputedStyle(launcher),r=launcher?.getBoundingClientRect();const oldHeaderVisible=getComputedStyle(surface).visibility==='visible';const overlapping=Boolean(r&&style.visibility==='visible'&&Number(style.opacity)>0&&oldHeaderVisible&&Array.from(surface.querySelectorAll('h1,button[aria-label="搜索全部笔记"],button[aria-label="新建"],button[aria-label="收起目录"]')).some(n=>{const b=n.getBoundingClientRect();return Math.max(0,r.left,b.left)<Math.min(r.right,b.right)&&Math.max(r.top,b.top)<Math.min(r.bottom,b.bottom)}));window.avatarFrames.push({p:p.x,a:a.x,edge:nav.right,body:body.x,text:text.x,overlapping});if(window.avatarSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);
   await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'搜索全部笔记',exact:true}).waitFor();
   await page.getByRole('combobox',{name:'搜索全部笔记',exact:true}).press('Escape');await settled(page);
   assert.equal(await page.getByRole('dialog',{name:'搜索全部笔记',exact:true}).count(),0,'Global search remains available while the library is closed');
   const avatarFrames=await page.evaluate(()=>{window.avatarSampling=false;return window.avatarFrames});
   assert(avatarFrames.every(n=>!n.overlapping),'The emerging launcher must never overlap the exiting title or toolbar');
   assert(avatarFrames.some(n=>n.p<0&&n.p>-236),'Full panel animates out');
   const relative=avatarFrames[0].a-avatarFrames[0].p;
   assert(avatarFrames.every(n=>Math.abs(n.a-n.p-relative)<0.01),'Avatar travels with its panel');
   assert(avatarFrames.every(n=>Math.abs(n.edge-n.body)<1 && n.text>=n.edge),'Document and text never sit underneath the library, including intermediate closing frames');
   assert.equal(await page.getByRole('separator',{name:'调整目录宽度'}).count(),0);
   await page.evaluate(()=>{window.openingFrames=[];window.openingSampling=true;const sample=()=>{const nav=document.querySelector('.library-navigation').getBoundingClientRect(),body=document.querySelector('.workspace-center-layer').getBoundingClientRect(),text=document.querySelector('.note-page').getBoundingClientRect();window.openingFrames.push({width:nav.width,edge:nav.right,body:body.x,text:text.x});if(window.openingSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
   await page.getByRole('button',{name:'展开目录',exact:true}).press('Enter');await settled(page);
   await page.waitForFunction(()=>document.activeElement===document.querySelector('.directory-tree button[aria-label="收起目录"]'));
   assert(await page.getByRole('button',{name:'收起目录',exact:true}).evaluate(n=>n===document.activeElement),'Opening transfers focus to the restored header control');
   const openingFrames=await page.evaluate(()=>{window.openingSampling=false;return window.openingFrames});
   assert(openingFrames.some(n=>n.width>0&&n.width<236),'Opening has intermediate normal-flow widths');
   assert(openingFrames.every(n=>Math.abs(n.edge-n.body)<1&&n.text>=n.edge),'No overlap during opening either');
   assert.equal(await page.getByRole('dialog',{name:'账号操作'}).count(),0,'No stale menu on reopen');
   const boxes=await page.evaluate(()=>({nav:document.querySelector('.library-navigation').getBoundingClientRect().right,body:document.querySelector('.workspace-center-layer').getBoundingClientRect().left,text:document.querySelector('.note-page').getBoundingClientRect().left}));
   assert(Math.abs(boxes.nav-boxes.body)<1 && boxes.text>=boxes.nav,'Docked document is alongside, not behind the library');
   await bodyAction(page);
   if(width===1277)await page.screenshot({path:join(output,'opened.png')});
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);
  }
  let positions=null;
  if(width>=768){
   await collapsedSurfaceCheck(page);
   positions=await page.locator('.library-launcher').boundingBox();
  }
  if(width===1277)await page.screenshot({path:join(output,'collapsed.png')});
  if(width<768){
   const body=await page.locator('.document-editor').boundingBox();
   await page.evaluate(()=>{window.motionFrames=[];window.sampleMotion=true;const sample=()=>{const n=document.querySelector('.library-drawer-surface');window.motionFrames.push(n?Number(getComputedStyle(n).transform.split(',')[4]):null);if(window.sampleMotion)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
   await open(page);
   await headerCheck(page);
   const frames=await page.evaluate(()=>{window.sampleMotion=false;return window.motionFrames;});
   assert(frames.some(n=>n<0&&n>-279),'Opening must render intermediate translation frames');
   assert.deepEqual(await page.locator('.document-editor').boundingBox(),body,'Drawer must not reflow body');
   assert.equal(await page.locator('.library-drawer-veil').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),true);
   assert.equal(await page.getByRole('button',{name:'收起目录',exact:true}).evaluate(n=>n===document.activeElement),true);
   if(width===320)assert(await page.getByRole('button',{name:'收起目录',exact:true}).evaluate(n=>n.getBoundingClientRect().height)>=44);
   await page.getByRole('button',{name:'搜索全部笔记'}).press('Shift+Tab');
   const lastControl=width>=768?page.getByRole('separator',{name:'调整目录宽度'}):page.locator('.library-drawer .nf-account-trigger');
   assert.equal(await lastControl.evaluate(n=>n===document.activeElement),true);
   await lastControl.press('Tab');
   assert.equal(await page.getByRole('button',{name:'搜索全部笔记'}).evaluate(n=>n===document.activeElement),true);
   await page.mouse.move(width-10,400);
   if(width>=768)await resizeChecks(page,page.locator('.library-drawer-surface'),width);
   else assert.equal(await page.getByRole('separator',{name:'调整目录宽度'}).count(),0);
   if(width===1277)await page.screenshot({path:join(output,'opened.png')});
   await page.locator('.library-drawer .nf-account-trigger').click();
   await page.getByRole('dialog',{name:'账号操作'}).waitFor();
   await page.getByRole('button',{name:'设置',exact:true}).press('Escape');
   await page.getByRole('dialog',{name:'账号操作'}).waitFor({state:'hidden'});
   assert.equal(await page.locator('.library-drawer').getAttribute('data-open'),'true','Closing the account menu must not close its parent drawer');
   await page.getByRole('button',{name:'收起目录',exact:true}).click();
   // Exit stays mounted, but becomes inaccessible and non-interactive immediately.
   assert.equal(await page.locator('.library-drawer').evaluate(n=>n.inert),true);
   assert.equal(await page.locator('.library-drawer').getAttribute('aria-hidden'),'true');
   await page.waitForFunction(()=>{const n=document.querySelector('.library-drawer-surface');if(!n)return false;const x=Number(getComputedStyle(n).transform.split(',')[4]);return x<0&&x>-280;});
   await open(page); // Reversal must cancel the old removal timer.
   await page.waitForTimeout(280);assert.equal(await page.locator('.library-drawer').count(),1);
   await page.getByRole('button',{name:'收起目录',exact:true}).press('Escape');
   await page.locator('.library-drawer').waitFor({state:'detached'});
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),false);
   assert.equal(await page.locator('.library-launcher').evaluate(n=>n===document.activeElement),true,`Focus must return to the launcher at ${width}px`);
   await open(page);await page.locator('.library-drawer-veil').click({position:{x:width-5,y:450}});
   await page.locator('.library-drawer').waitFor({state:'detached'});
   if(positions)assert.deepEqual(await page.locator('.library-launcher').boundingBox(),positions);
   await page.emulateMedia({reducedMotion:'reduce'});await open(page);
   assert.equal(await page.locator('.library-drawer-surface').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});
   await page.emulateMedia({reducedMotion:'no-preference'});
  }
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settled(page);
  if(width>=768){
   await collapsedSurfaceCheck(page);
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.getByRole('button',{name:'展开目录',exact:true}).click();await settled(page);
   assert.equal(await page.locator('.library-navigation').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
   assert.equal(await page.locator('.library-drawer-veil').count(),0,'Dark/reduced-motion remains non-modal');
   await bodyAction(page);
   await page.getByRole('separator',{name:'调整目录宽度'}).press('Escape');await settled(page);
   assert(await page.getByRole('button',{name:'展开目录',exact:true}).evaluate(n=>n===document.activeElement));
   assert.equal(await page.locator('.library-launcher').evaluate(n=>getComputedStyle(n).animationName),'none','Reduced motion does not delay the replacement entry');
   await collapsedSurfaceCheck(page);
   await page.emulateMedia({reducedMotion:'no-preference'});
  }
  if(width<768){await open(page);assert.equal(await page.locator('.library-drawer-veil').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0.2)');await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  if(width>=768){
   await page.reload();await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor();
   const panel=page.locator('.library-navigation');
   assert.equal((await panel.boundingBox()).width,236,'Persistence across reload');
   // Storage rejection must not block an in-memory width change.
   await page.evaluate(()=>{window.originalStorageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Denied','SecurityError');};});
   await page.getByRole('separator',{name:'调整目录宽度'}).press('ArrowRight');await settled(page);
   assert.equal((await panel.boundingBox()).width,252);
   if(width===1440){
    await page.getByRole('button',{name:'展开 AI 助手',exact:true}).click();await settled(page);
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>Number(document.querySelector('[aria-label="调整目录宽度"]').getAttribute('aria-valuemax'))<=364);
    await settled(page);
    assert(Number(await page.getByRole('separator',{name:'调整目录宽度'}).getAttribute('aria-valuemax'))<=364);
   }
   const edge=await page.getByRole('separator',{name:'调整目录宽度'}).boundingBox();
   await page.mouse.move(edge.x+5,200);await page.mouse.down();await page.mouse.move(edge.x+45,200);
   await page.setViewportSize({width:320,height:900});
   await page.getByRole('separator',{name:'调整目录宽度'}).waitFor({state:'detached'});
   await settled(page);await page.mouse.up();
   assert.equal(await page.getByRole('separator',{name:'调整目录宽度'}).count(),0);
   assert.equal(await page.evaluate(()=>document.body.style.cursor),'');
   assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');
   assert.notEqual(await page.locator('.app-frame').getAttribute('data-library-resizing'),'true');
   await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSetItem;localStorage.setItem('noteflow-library-width','invalid');});
   await page.setViewportSize({width,height:900});await page.reload();await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor();
   assert.equal((await page.locator('.library-navigation').boundingBox()).width,260,'Invalid saved width falls back safely');
  }
  assert.deepEqual(errors,[]);
  if(width<768 && await page.getByRole('button',{name:'收起目录',exact:true}).count()) {
   await page.getByRole('button',{name:'收起目录',exact:true}).click();
   await page.locator('.library-drawer:not(.ai-drawer)').waitFor({state:'detached'});
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'展开 AI 助手',exact:true}).click();await settled(page);
  if(width>=1280){
   const ai=page.locator('.ai-navigation'), handle=page.getByRole('separator',{name:'调整 AI 助手宽度'});
   assert.equal((await ai.boundingBox()).width,500);
   const before=await page.evaluate(()=>window.bodyRenderCount), edge=await handle.boundingBox();
   await page.mouse.move(edge.x+5,200);await page.mouse.down();await page.mouse.move(edge.x-75,200,{steps:12});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal((await ai.boundingBox()).width,580);
   assert.equal(await page.evaluate(()=>window.bodyRenderCount),before,'AI dragging must not rerender the document');
   assert.equal(await page.locator('.note-page').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
   await handle.press('Escape');await page.mouse.up();await settled(page);assert.equal((await ai.boundingBox()).width,500);
   await handle.press('Home');await settled(page);assert.equal((await ai.boundingBox()).width,320);
   await handle.press('End');await settled(page);assert.equal((await ai.boundingBox()).width,680);
   await handle.press('ArrowRight');await settled(page);assert.equal((await ai.boundingBox()).width,664);
   const cancelEdge=await handle.boundingBox();await page.mouse.move(cancelEdge.x+5,200);await page.mouse.down();await page.mouse.move(cancelEdge.x-20,200);
   await page.getByRole('button',{name:'收起 AI 助手',exact:true}).press('Enter');await page.mouse.up();await settled(page);
   assert.equal((await ai.boundingBox()).width,0,'Closing during drag cannot leave empty AI space');
   assert.equal(await page.evaluate(()=>document.body.style.userSelect),'');
   assert.equal(await page.evaluate(()=>document.body.style.cursor),'');
   assert.notEqual(await page.locator('.app-frame').getAttribute('data-ai-resizing'),'true');
  } else {
   const drawer=page.locator('.ai-drawer');await page.locator('.ai-drawer[data-open="true"]').waitFor({state:'visible'});await settled(page);
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),true);
   const close=drawer.getByRole('button',{name:'收起 AI 助手',exact:true}), input=drawer.getByRole('textbox',{name:'合成对话输入'});
   await close.focus();await page.keyboard.press('Shift+Tab');assert(await input.evaluate(n=>document.activeElement===n));
   await page.keyboard.press('Tab');assert(await close.evaluate(n=>document.activeElement===n));
   await close.dispatchEvent('keydown',{key:'Escape',bubbles:true,isComposing:true});assert.equal(await drawer.getAttribute('data-open'),'true');
   await close.press('Escape');await drawer.waitFor({state:'detached'});
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),false);
   assert(await page.getByRole('button',{name:'展开 AI 助手',exact:true}).evaluate(n=>document.activeElement===n));
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.deepEqual(errors,[]);
  reports.push({width,realEditor,motion,resizing:width>=768,persistence:width>=768,noDocumentRerenderDuringDrag:width>=768,noCollapsedAccountRail:true,dockedWithoutVeil:width>=768,bodyClickableWhileLibraryOpen:width>=768,noOverlapDuringMotion:width>=768,avatarMovesWithPanel:width>=768,viewportModals:width>=768,collapsedGlobalSearch:width>=768,drawerEnterExit:width<768,aiConsistentMotion:true,aiDragOrFocusVerified:true,stableBodyAndControls:true,focusAndReducedMotion:true,dark:true,requests,errors});await context.close();
 }
 console.log(JSON.stringify({actualNavigation:true,syntheticOnly:true,output,reports},null,2));
} finally {await browser.close();}
