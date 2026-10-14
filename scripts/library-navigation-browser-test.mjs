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
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(n => /^index-.*\.css$/.test(n)).map(n => readFileSync(new URL(n, assets), 'utf8')).join('\n');
assert(css, 'Build production CSS first');
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import App from ${JSON.stringify(path('App.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
useAppStore.setState({treeData:[{id:'folder',type:'folder',name:'学习笔记',children:[{id:'note',type:'file',name:'Git 入门学习笔记.md'}]}],selectedFileId:'note',expandedFolderIds:new Set(['folder']),fileContents:{note:'合成正文'},centerMode:'note',serverSyncReady:false,hydratedUserId:null});
window.fetch=async()=>new Response(JSON.stringify({note:{id:'note',title:'Git 入门学习笔记.md',content:'合成正文'}}),{headers:{'Content-Type':'application/json'}});
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`;
const stubs = new Set(['components/AIPanel.tsx','components/AIDraftWorkspace.tsx','components/EditPreviewWorkspace.tsx'].map(path));
const result=await build({configFile:false,logLevel:'silent',plugins:[{
 name:'isolated-navigation',enforce:'pre',
 resolveId(id){if(id==='virtual:entry')return '\0entry';},
 load(id){
  if(id==='\0entry')return entry;
  if(id===path('components/AIPanel.tsx'))return `import React from 'react';export default function AI({onCollapse}){return <div><button aria-label="收起 AI 助手" onClick={onCollapse}>收起</button><textarea aria-label="合成对话输入" /></div>}`;
  if(stubs.has(id))return 'export default function Stub(){return null}';
  if(id===path('components/NoteEditor.tsx'))return `import React from 'react';export default function Body(){window.bodyRenderCount=(window.bodyRenderCount||0)+1;return <div className="document-editor" style={{padding:'84px 72px',width:'100%'}}><div className="document-canvas"><div className="note-page"><h1>Git 入门学习笔记</h1><p>这是隔离验证正文，不读取真实笔记。</p><button>正文操作</button></div></div></div>}`;
  if(id===path('App.tsx'))return readFileSync(id,'utf8')
   .replace('import { useAuthSession } from "./hooks/useAuthSession";', 'const noop = () => {}; const useAuthSession = () => ({loading:false,session:{user:{id:"synthetic",email:"test@example.invalid",displayName:"合成用户",emailVerified:true}},signIn:noop,signInWithEmailCode:noop,signUp:noop,signOut:noop,updateSession:noop});')
   .replace('<AppProvider userId={session.user.id}>','<>').replace('</AppProvider>','</>');
 }
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:entry',output:{codeSplitting:false}}}});
const chunks=result.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const script=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-library-navigation-')), reports=[];
async function settled(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});}
async function open(page){const button=page.getByRole('button',{name:/^(展开目录|打开知识库)$/});await button.click();await page.locator('.library-drawer[data-open="true"]').waitFor();await settled(page);}
async function headerCheck(page){
 const title=page.getByRole('heading',{name:'知识库',exact:true});
 assert.equal(await title.count(),1);
 assert.equal(await title.evaluate(n=>n.parentElement.textContent.trim()),'知识库','Library header has no note count');
 assert.equal(await title.evaluate(n=>n.parentElement.querySelector('svg')?.getAttribute('width')),'16','Book icon is retained');
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
 assert.equal(await handle.locator('span').evaluate(n=>getComputedStyle(n).opacity),'0');
 const renders=await page.evaluate(()=>window.bodyRenderCount), stored=await page.evaluate(()=>localStorage.getItem('noteflow-library-width'));
 await page.mouse.move(hit.x+5,200);await page.mouse.down();await page.mouse.move(hit.x+105,200,{steps:12});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal((await panel.boundingBox()).width,start.width+100);
 assert.equal(await page.evaluate(()=>window.bodyRenderCount),renders,'Dragging must not rerender the document');
 assert.equal(await page.evaluate(()=>localStorage.getItem('noteflow-library-width')),stored,'Do not write storage on pointermove');
 assert.equal(await page.locator('.library-navigation').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 if(width>=1280)assert.equal(await page.locator('.note-page').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 await page.mouse.up();await settled(page);
 assert.equal(await page.evaluate(()=>Number(localStorage.getItem('noteflow-library-width'))),start.width+100);
 const committed=(await panel.boundingBox()).width;
 const current=await handle.boundingBox();await page.mouse.move(current.x+5,200);await page.mouse.down();await page.mouse.move(current.x+65,200);
 await handle.press('Escape');await page.mouse.up();await settled(page);
 assert.equal((await panel.boundingBox()).width,committed,'Escape rolls back only the current drag');
 assert.equal(await page.evaluate(()=>Number(localStorage.getItem('noteflow-library-width'))),committed);
 await handle.press('Home');await settled(page);assert.equal((await panel.boundingBox()).width,220);
 await handle.press('End');await settled(page);assert.equal((await panel.boundingBox()).width,420);
 await handle.press('ArrowLeft');await settled(page);assert.equal((await panel.boundingBox()).width,404);
 const limit=await handle.boundingBox();await page.mouse.move(limit.x+5,200);await page.mouse.down();await page.mouse.move(limit.x+305,200);await page.mouse.up();await settled(page);
 assert.equal((await panel.boundingBox()).width,420,'Pointer maximum');
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
  if(width===1440){
   await headerCheck(page);
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
   await page.evaluate(()=>{window.avatarFrames=[];window.avatarSampling=true;const sample=()=>{const p=document.querySelector('.library-navigation-surface').getBoundingClientRect(),a=document.querySelector('.nf-account-trigger').getBoundingClientRect();window.avatarFrames.push({p:p.x,a:a.x});if(window.avatarSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);
   await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'搜索全部笔记',exact:true}).waitFor();
   await page.getByRole('combobox',{name:'搜索全部笔记',exact:true}).press('Escape');await settled(page);
   assert.equal(await page.getByRole('dialog',{name:'搜索全部笔记',exact:true}).count(),0,'Global search remains available while the library is closed');
   const avatarFrames=await page.evaluate(()=>{window.avatarSampling=false;return window.avatarFrames});
   assert(avatarFrames.some(n=>n.p<0&&n.p>-236),'Full panel animates out');
   const relative=avatarFrames[0].a-avatarFrames[0].p;
   assert(avatarFrames.every(n=>Math.abs(n.a-n.p-relative)<0.01),'Avatar travels with its panel');
   assert.equal(await page.getByRole('separator',{name:'调整目录宽度'}).count(),0);
   await page.getByRole('button',{name:'展开目录',exact:true}).click();await settled(page);
   assert.equal(await page.getByRole('dialog',{name:'账号操作'}).count(),0,'No stale menu on reopen');
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);
  }
  let positions=null;
  if(width>=768){
   await collapsedSurfaceCheck(page);
   positions=await page.locator('.library-launcher').boundingBox();
  }
  if(width===1277)await page.screenshot({path:join(output,'collapsed.png')});
  if(width<1280){
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
   assert.equal(await page.getByRole('button',{name:/^(展开目录|打开知识库)$/}).evaluate(n=>n===document.activeElement),true,`Focus must return to the launcher at ${width}px`);
   await open(page);await page.locator('.library-drawer-veil').click({position:{x:width-5,y:450}});
   await page.locator('.library-drawer').waitFor({state:'detached'});
   if(positions)assert.deepEqual(await page.locator('.library-launcher').boundingBox(),positions);
   await page.emulateMedia({reducedMotion:'reduce'});await open(page);
   assert.equal(await page.locator('.library-drawer-surface').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});
   await page.emulateMedia({reducedMotion:'no-preference'});
  }
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settled(page);
  if(width>=768)await collapsedSurfaceCheck(page);
  if(width<1280){await open(page);assert.equal(await page.locator('.library-drawer-veil').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0.2)');await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  if(width>=768){
   await page.reload();await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor();
   if(width<1280)await open(page);
   const panel=page.locator(width>=1280?'.library-navigation':'.library-drawer-surface');
   assert.equal((await panel.boundingBox()).width,236,'Persistence across reload');
   // Storage rejection must not block an in-memory width change.
   await page.evaluate(()=>{window.originalStorageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Denied','SecurityError');};});
   await page.getByRole('separator',{name:'调整目录宽度'}).press('ArrowRight');await settled(page);
   assert.equal((await panel.boundingBox()).width,252);
   if(width===1440){
    await page.getByRole('button',{name:'展开 AI 助手',exact:true}).click();await settled(page);
    await page.setViewportSize({width:1280,height:900});await settled(page);
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
   if(width<1280)await open(page);
   assert.equal((await page.locator(width>=1280?'.library-navigation':'.library-drawer-surface').boundingBox()).width,width>=1280?260:280,'Invalid saved width falls back safely');
  }
  assert.deepEqual(errors,[]);
  if(width<1280 && await page.getByRole('button',{name:'收起目录',exact:true}).count()) {
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
  reports.push({width,resizing:width>=768,persistence:width>=768,noDocumentRerenderDuringDrag:width>=768,noCollapsedAccountRail:true,avatarMovesWithPanel:width===1440,viewportModals:width===1440,collapsedGlobalSearch:width===1440,drawerEnterExit:width<1280,aiConsistentMotion:true,aiDragOrFocusVerified:true,stableBodyAndControls:true,focusAndReducedMotion:true,dark:true,requests,errors});await context.close();
 }
 console.log(JSON.stringify({actualNavigation:true,syntheticOnly:true,output,reports},null,2));
} finally {await browser.close();}
