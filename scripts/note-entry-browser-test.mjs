// Actual directory, NoteEditor and Zustand store. Synthetic, isolated and network-blocked.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const path = name => fileURLToPath(new URL('../src/' + name, import.meta.url));
const component = path('components/NoteEditor.tsx');
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL(n, assets), 'utf8')).join('\n');
assert(css, 'Build CSS first');
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import NoteEditor from ${JSON.stringify(component)};
import DirectoryTree from ${JSON.stringify(path('components/DirectoryTree.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
const content=id=>'# '+id+' 标题\\n\\n'+id+' 独有正文\\n\\n\`\`\`go\\nfunc main() { println("color") }\\n\`\`\`';
const serverContents=new Map();
const note=id=>({id,title:id+'.md',categoryId:null,summary:null,tags:[],content:serverContents.get(id)??content(id),contentHash:'synthetic',isPinned:false,isFavorite:false,indexStatus:'indexed',createdAt:null,updatedAt:null,deletedAt:null});
const pending=new Map();const calls=[];
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,init={})=>{const url=String(input);calls.push(url);
  if(url==='/api/attachments'){
    window.noteEntryTest.uploads++;
    if(window.noteEntryTest.uploadWait)return new Promise(resolve=>{window.noteEntryTest.replyUpload=()=>resolve(response({attachment:{fileName:'late.txt',contentType:'text/plain',downloadUrl:'/synthetic-download'}}));});
    if(window.noteEntryTest.uploadFail)return response({error:'合成上传失败'},503);
    return response({attachment:{fileName:'example.txt',contentType:'text/plain',downloadUrl:'/synthetic-download'}});
  }
  if(init.method==='PUT'&&url.startsWith('/api/notes/')){
    if(window.noteEntryTest.saveFail)return response({error:'合成保存失败'},503);
    const id=url.split('/').at(-1);serverContents.set(id,JSON.parse(init.body).content);return response({note:note(id)});
  }
  if(url.endsWith('/outline')){const id=url.match(/\\/notes\\/([^/]+)\\/outline$/)[1];return response({sections:[{id:'section-'+id,title:id+' 标题'}]});}
  const id=url.match(/\\/api\\/notes\\/([^/]+)$/)?.[1];
  if(id){if(['missing','failed','late','race'].includes(id))return new Promise(resolve=>{pending.set(id,resolve)});return response({note:note(id)});}
  if(url.endsWith('/api/auth/sessions'))return response([]);
  if(url.endsWith('/api/settings'))return response({settings:{memoryEnabled:true,preferences:{}}});
  throw Error('Unexpected synthetic API: '+url);
};
const nodes=['A','B','C','missing','failed','late','race'].map(id=>({id,type:'file',name:id+'.md',indexStatus:'indexed'}));
useAppStore.setState({treeData:[{id:'folder',type:'folder',name:'合成目录',children:nodes}],selectedFileId:'A',expandedFolderIds:new Set(['folder']),fileContents:{A:content('A'),B:content('B'),C:content('C'),race:content('race')},serverSyncReady:false,hydratedUserId:null});
window.noteEntryTest={store:useAppStore,editor:null,calls,content,saveFail:false,uploadFail:false,uploads:0,uploadWait:false,select:id=>useAppStore.getState().setSelectedFileId(id),
  reply(id,ok=true){const resolve=pending.get(id);if(!resolve)throw Error('No pending '+id);pending.delete(id);resolve(ok?response({note:note(id)}):response({error:'synthetic unavailable'},503));}};
const noop=()=>{};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
 React.createElement('div',{className:'synthetic-directory'},React.createElement(DirectoryTree,{pinned:true,onPinnedChange:noop,themeMode:'light',onThemeModeChange:noop,userEmail:'synthetic@example.invalid',userEmailVerified:true,userName:'合成用户',onEmailChanged:noop,onSignOut:noop})),React.createElement(NoteEditor)));`;
const result = await build({ configFile:false, logLevel:'silent', plugins:[{
  name:'isolated-note-entry', enforce:'pre',
  resolveId(id){if(id==='virtual:entry')return '\0entry';},
  load(id){if(id==='\0entry')return entry;if(id===component)return readFileSync(id,'utf8').replace('      extensions,','      extensions, onCreate: ({editor}) => {window.noteEntryTest.editor=editor;},');},
}], build:{write:false,minify:false,rolldownOptions:{input:'virtual:entry',output:{codeSplitting:false}}} });
const chunks=result.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const script=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
const output=mkdtempSync(join(tmpdir(),'noteflow-note-entry-'));
async function ready(page,id){
  await page.waitForFunction(id=>document.querySelector('.note-entry')?.dataset.ready==='true' && document.querySelector('.note-content')?.textContent.includes(id+' 独有正文'),id);
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
}
try {
 for(const width of [1280,736,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===320}),requests=[],errors=[];
  await context.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><style>'+css+' #root{display:flex;height:100vh}.synthetic-directory{width:280px;flex-shrink:0}@media(max-width:500px){.synthetic-directory{display:none}}</style></head><body><div id="root"></div><script type="module">'+script+'</script></body></html>');
  await ready(page,'A');
  if(width===1280){
   // Mouse focus persists after leaving; it must NOT be painted as a second selection.
   await page.locator('.directory-node-open').filter({hasText:'合成目录'}).click();
   await page.mouse.move(1000,850);await page.waitForTimeout(180);
   const folder=page.locator('.directory-node-row[data-folder="true"]');
   assert.equal(await folder.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
   await page.locator('.directory-node-open').filter({hasText:'合成目录'}).click();
   await page.locator('.directory-node-open').filter({hasText:'B'}).click();
   await ready(page,'B');await page.mouse.move(1000,850);await page.waitForTimeout(180);
   assert.equal(await page.locator('.directory-node-row[data-selected="true"]').count(),1);
   assert.equal(await page.locator('.directory-node-row[data-selected="true"]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(234, 240, 245)');
   assert.equal(await folder.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
   // Real Tab retains the existing keyboard-only underline, without coloring the folder.
   await page.locator('.directory-node-open').filter({hasText:'合成目录'}).focus();await page.keyboard.press('Tab');
   const keyboard=await page.evaluate(()=>({visible:document.activeElement.matches(':focus-visible'),shadow:getComputedStyle(document.activeElement).boxShadow}));
   assert(keyboard.visible);assert.notEqual(keyboard.shadow,'none');
   await page.mouse.click(1000,850);
  }
  await page.evaluate(()=>window.noteEntryTest.select('missing'));
  await page.getByRole('status').waitFor();await page.waitForTimeout(250);
  assert.equal(await page.locator('.note-content').count(),0,'Old body is removed before waiting for a new note');
  assert.equal(await page.getByRole('status').textContent(),'正在打开笔记…');
  const hint=await page.getByRole('status').evaluate(n=>({opacity:getComputedStyle(n).opacity,b:n.getBoundingClientRect().toJSON()}));assert.equal(hint.opacity,'1');
  if(width===1280)await page.screenshot({path:join(output,'loading.png')});
  await page.evaluate(()=>{
   window.entryFrames=[];window.sampleEntry=true;
   const sample=()=>{const n=document.querySelector('.note-entry-content');window.entryFrames.push(n?Number(getComputedStyle(n).opacity):null);if(window.sampleEntry)requestAnimationFrame(sample);};
   requestAnimationFrame(sample);window.noteEntryTest.reply('missing');
  });await ready(page,'missing');
  const frames=await page.evaluate(()=>{window.sampleEntry=false;return window.entryFrames;});
  assert(frames.some(n=>n>0&&n<1),'The reveal must paint intermediate opacity frames, not jump from hidden to visible');
  if(width===1280)await page.screenshot({path:join(output,'opened.png')});
  assert.equal(await page.getByRole('status').count(),0);
  assert(await page.locator('.code-block pre code span').count()>0,'Newly opened code retains automatic syntax colors');
  // Slow failed open must end with a usable retry; cached refresh failures must not hide content.
  await page.evaluate(()=>window.noteEntryTest.select('failed'));
  await page.waitForFunction(()=>window.noteEntryTest.calls.includes('/api/notes/failed'));
  await page.evaluate(()=>window.noteEntryTest.reply('failed',false));await page.getByRole('alert').waitFor();
  if(width===320)assert(await page.getByRole('button',{name:'再试一次',exact:true}).evaluate(n=>n.getBoundingClientRect().height)>=44);
  await page.getByRole('button',{name:'再试一次',exact:true}).click();await page.getByRole('status').waitFor();
  await page.evaluate(()=>window.noteEntryTest.reply('failed'));await ready(page,'failed');
  // Switching while a fetch is pending, and cancelling multiple scheduled mounts.
  await page.evaluate(()=>window.noteEntryTest.select('late'));
  await page.waitForFunction(()=>window.noteEntryTest.calls.includes('/api/notes/late'));
  await page.evaluate(()=>{const api=window.noteEntryTest;api.select('A');api.select('B');api.select('C');});
  await ready(page,'C');await page.evaluate(()=>window.noteEntryTest.reply('late',false));await ready(page,'C');
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.getByRole('textbox',{name:'文档标题',exact:true}).inputValue(),'C');
  assert.equal(await page.locator('.note-entry-content').evaluate(n=>n.hasAttribute('inert')),false);
  await page.waitForFunction(()=>window.noteEntryTest.store.getState().activeEditorSectionId==='section-C');
  const outlineReads=await page.evaluate(()=>window.noteEntryTest.calls.filter(url=>url.endsWith('/C/outline')).length);
  for(const status of ['unsaved','saving','offline','error','saved']) {
    await page.evaluate(status=>window.noteEntryTest.store.setState({noteSaveState:{status}}),status);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>window.noteEntryTest.calls.filter(url=>url.endsWith('/C/outline')).length),outlineReads,'Save feedback must not refetch the outline');
    assert.equal(await page.evaluate(()=>window.noteEntryTest.store.getState().activeEditorSectionId),'section-C','Saving must keep the current section context');
  }
  // Real save API failure is visible and retry saves the current content.
  await page.evaluate(()=>{window.noteEntryTest.saveFail=true;window.noteEntryTest.store.getState().retryNoteSave('C');});
  await page.getByRole('button',{name:'重试保存',exact:true}).waitFor();
  assert((await page.getByRole('alert').textContent()).includes('合成保存失败'));
  await page.evaluate(()=>{window.noteEntryTest.saveFail=false;});
  await page.getByRole('button',{name:'重试保存',exact:true}).click();
  await page.waitForFunction(()=>window.noteEntryTest.store.getState().noteSaveState.status==='saved');
  assert.equal(await page.getByRole('alert').count(),0);
  // Paste a synthetic file, fail, retry only the pending file, then ignore a late upload after navigation.
  await page.evaluate(()=>{window.noteEntryTest.uploadFail=true;const data=new DataTransfer();data.items.add(new File(['synthetic'],'example.txt',{type:'text/plain'}));document.querySelector('.note-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  await page.getByRole('button',{name:'重试上传',exact:true}).waitFor();
  await page.evaluate(()=>{window.noteEntryTest.uploadFail=false;});
  await page.getByRole('button',{name:'重试上传',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.note-content').textContent.includes('example.txt'));
  assert.equal(await page.evaluate(()=>window.noteEntryTest.uploads),2);
  await page.evaluate(()=>{window.noteEntryTest.uploadWait=true;const data=new DataTransfer();data.items.add(new File(['late'],'late.txt',{type:'text/plain'}));document.querySelector('.note-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  await page.waitForFunction(()=>typeof window.noteEntryTest.replyUpload==='function');
  await page.evaluate(()=>window.noteEntryTest.select('B'));await ready(page,'B');
  await page.evaluate(()=>window.noteEntryTest.replyUpload());
  assert(!(await page.locator('.note-content').textContent()).includes('late.txt'));
  await page.evaluate(()=>window.noteEntryTest.select('C'));await ready(page,'C');
  const endKey=await page.evaluate(()=>/Mac/.test(navigator.platform)?'Meta+ArrowDown':'Control+End');
  const editor=page.locator('.note-content');await editor.locator('h1').first().click();await page.keyboard.press(endKey);await page.keyboard.type('stable-edit');
  assert((await editor.textContent()).endsWith('stable-edit'),JSON.stringify(await page.evaluate(()=>({text:document.querySelector('.note-content').textContent,focus:document.activeElement?.outerHTML?.slice(0,100),selection:window.noteEntryTest.editor.state.selection.toJSON()}))));
  assert((await page.evaluate(()=>window.noteEntryTest.store.getState().fileContents.C)).includes('stable-edit'));
  assert.equal(await page.evaluate(()=>window.noteEntryTest.calls.filter(url=>url.endsWith('/C/outline')).length),outlineReads,'Local input does not read an outdated outline');
  await page.evaluate(()=>{const store=window.noteEntryTest.store;store.setState({treeData:store.getState().treeData.map(folder=>({...folder,children:folder.children.map(node=>node.id==='C'?{...node,indexStatus:'indexed',updatedAt:'2026-10-12T00:00:00Z'}:node)}))});});
  await page.waitForFunction(before=>window.noteEntryTest.calls.filter(url=>url.endsWith('/C/outline')).length===before+1,outlineReads);
  await page.waitForFunction(()=>window.noteEntryTest.store.getState().activeEditorSectionId==='section-C');
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.animationName==='note-entry-reveal' && a.playState==='running').length),0,'Editing cannot replay the entry animation');
  await page.evaluate(()=>window.noteEntryTest.select('failed'));await ready(page,'failed');
  await page.evaluate(()=>window.noteEntryTest.reply('failed',false));await ready(page,'failed');
  assert.equal(await page.getByRole('alert').count(),0,'Cached content remains usable if the background refresh fails');
  await page.evaluate(()=>window.noteEntryTest.store.setState({selectedFileId:'A',pendingEditorSelection:{noteId:'A',markdown:'A 独有正文',mode:'select'}}));
  await ready(page,'A');await page.waitForFunction(()=>window.noteEntryTest.store.getState().pendingEditorSelection===null);
  assert.equal(await page.evaluate(()=>window.noteEntryTest.editor.state.doc.textBetween(window.noteEntryTest.editor.state.selection.from,window.noteEntryTest.editor.state.selection.to)),'A 独有正文');
  await page.evaluate(()=>window.noteEntryTest.store.setState({selectedFileId:'B',pendingSourceFocus:{noteId:'B',snippet:'B 独有正文'}}));
  await ready(page,'B');await page.waitForFunction(()=>window.noteEntryTest.store.getState().pendingSourceFocus===null);
  assert.equal(await editor.evaluate(n=>n.contains(document.activeElement)),true,'Deferred source navigation must still focus the presented editor');
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.noteEntryTest.select('B'));await ready(page,'B');
  assert.equal(await page.locator('.note-entry-content').evaluate(n=>getComputedStyle(n).animationName),'none');
  await page.emulateMedia({colorScheme:'dark'});
  await page.evaluate(async()=>{document.documentElement.classList.add('theme-dark');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.note-entry')).backgroundColor==='rgb(17, 24, 32)');
  const background=await page.locator('.note-entry').evaluate(n=>getComputedStyle(n).backgroundColor);
  assert.equal(background,'rgb(17, 24, 32)');
  assert.equal(background,await page.locator('.document-scroll').evaluate(n=>getComputedStyle(n).backgroundColor),'Opening and visible reading surfaces must match');
  // Type in an already cached note while its background GET is still pending.
  await page.evaluate(()=>window.noteEntryTest.select('race'));await ready(page,'race');
  await editor.click();await page.keyboard.press(endKey);await page.keyboard.type('local-race-input');
  await page.evaluate(()=>window.noteEntryTest.reply('race'));await ready(page,'race');
  assert((await editor.textContent()).endsWith('local-race-input'),'Late server read must not replace the visible local editor');
  assert((await page.evaluate(()=>window.noteEntryTest.store.getState().fileContents.race)).includes('local-race-input'));
  assert.equal(await editor.evaluate(n=>n.contains(document.activeElement)),true);
  await page.keyboard.press('ControlOrMeta+z');
  assert(!(await editor.textContent()).endsWith('local-race-input'),'Undo history survives the ignored server response');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,mouseFocusDoesNotSelect:width===1280?true:null,latestNoteOnly:true,loadingAndRetry:true,saveFailureRetry:true,uploadFailureRetry:true,lateUploadIgnored:true,revealIntermediateFrames:frames.filter(n=>n>0&&n<1).length,codeColors:true,inputSavedWithoutReanimation:true,saveFeedbackDoesNotRefetch:true,indexedOutlineRefreshes:true,lateReadKeepsTypingAndUndo:true,reducedMotion:true,dark:true,requests,errors});await context.close();
 }
 console.log(JSON.stringify({actualComponentsAndStore:true,syntheticOnly:true,output,reports},null,2));
} finally { await browser.close(); }
