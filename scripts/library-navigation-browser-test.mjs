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
  if(stubs.has(id))return 'export default function Stub(){return null}';
  if(id===path('components/NoteEditor.tsx'))return `import React from 'react';export default function Body(){return <div className="document-editor" style={{padding:'84px 72px',width:'100%'}}><h1>Git 入门学习笔记</h1><p>这是隔离验证正文，不读取真实笔记。</p><button>正文操作</button></div>}`;
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
try {
 for(const width of [1440,1277,768,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
  const requests=[],errors=[];await context.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><style>'+css+' html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module">'+script+'</script></body></html>');
  await page.getByRole('heading',{name:'Git 入门学习笔记'}).waitFor();
  if(width===1440){await page.getByRole('button',{name:'收起目录',exact:true}).click();await settled(page);}
  let positions=null;
  if(width>=768){
   const rail=page.locator('.directory-tree');
   const state=await rail.evaluate(n=>({width:n.getBoundingClientRect().width,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderRightColor}));
   assert.equal(state.width,52);assert.equal(state.bg,'rgba(0, 0, 0, 0)');assert.equal(state.border,'rgba(0, 0, 0, 0)');
   positions=await page.evaluate(()=>[...document.querySelectorAll('.directory-toggle,.nf-account-trigger')].map(n=>n.getBoundingClientRect().toJSON()));
  }
  if(width===1277)await page.screenshot({path:join(output,'collapsed.png')});
  if(width<1280){
   const body=await page.locator('.document-editor').boundingBox();
   await page.evaluate(()=>{window.motionFrames=[];window.sampleMotion=true;const sample=()=>{const n=document.querySelector('.library-drawer-surface');window.motionFrames.push(n?Number(getComputedStyle(n).transform.split(',')[4]):null);if(window.sampleMotion)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
   await open(page);
   const frames=await page.evaluate(()=>{window.sampleMotion=false;return window.motionFrames;});
   assert(frames.some(n=>n<0&&n>-279),'Opening must render intermediate translation frames');
   assert.deepEqual(await page.locator('.document-editor').boundingBox(),body,'Drawer must not reflow body');
   assert.equal(await page.locator('.library-drawer-veil').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
   assert.equal(await page.locator('.workspace-center-layer').evaluate(n=>n.inert),true);
   assert.equal(await page.getByRole('button',{name:'收起目录',exact:true}).evaluate(n=>n===document.activeElement),true);
   if(width===320)assert(await page.getByRole('button',{name:'收起目录',exact:true}).evaluate(n=>n.getBoundingClientRect().height)>=44);
   await page.getByRole('button',{name:'搜索全部笔记'}).press('Shift+Tab');
   assert.equal(await page.locator('.library-drawer .nf-account-trigger').evaluate(n=>n===document.activeElement),true);
   await page.locator('.library-drawer .nf-account-trigger').press('Tab');
   assert.equal(await page.getByRole('button',{name:'搜索全部笔记'}).evaluate(n=>n===document.activeElement),true);
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
   if(positions)assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.directory-toggle,.nf-account-trigger')].map(n=>n.getBoundingClientRect().toJSON())),positions);
   await page.emulateMedia({reducedMotion:'reduce'});await open(page);
   assert.equal(await page.locator('.library-drawer-surface').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
   await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});
   await page.emulateMedia({reducedMotion:'no-preference'});
  }
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settled(page);
  if(width>=768)assert.equal(await page.locator('.directory-tree').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  if(width<1280){await open(page);assert.equal(await page.locator('.library-drawer-veil').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0.2)');await page.getByRole('button',{name:'收起目录',exact:true}).click();await page.locator('.library-drawer').waitFor({state:'detached'});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,transparentRail:width>=768,drawerEnterExit:width<1280,stableBodyAndControls:true,focusAndReducedMotion:true,dark:true,requests,errors});await context.close();
 }
 console.log(JSON.stringify({actualNavigation:true,syntheticOnly:true,output,reports},null,2));
} finally {await browser.close();}
