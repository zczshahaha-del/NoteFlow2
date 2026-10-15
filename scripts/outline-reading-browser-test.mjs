// Actual NoteEditor/Tiptap, grouping hooks and built CSS. No user session/network.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const component=fileURLToPath(new URL('../src/components/NoteEditor.tsx',import.meta.url));
const baseline=process.env.NOTEFLOW_OUTLINE_BASELINE==='1';
const markdown=['# 长文阅读与分组','',...Array.from({length:25},(_,c)=>[
 '## 章节 '+c,'','章节介绍。'.repeat(30),'','```go','func main() { println("color") }','```','',
 ...Array.from({length:9},(_,n)=>['### 小节 '+c+'-'+n,'',('正文 '+c+'-'+n+'：保留 **重点** 与 `inline`。').repeat(8),'']).flat(),
]).flat()].join('\n');
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import NoteEditor from ${JSON.stringify(component)};
import {getDocumentHeadings} from ${JSON.stringify(fileURLToPath(new URL('../src/editor/documentCache.ts',import.meta.url)))};
const root=createRoot(document.getElementById('root'));
const api={editor:null,updates:0,scans:0,serializations:0,headingReads:0,cacheBuilds:0,selectionUpdates:0,render(){root.render(React.createElement(React.StrictMode,null,React.createElement(NoteEditor)))},headings(){return getDocumentHeadings(api.editor.state.doc)}};
const slice={selectedFileId:'reading',treeData:[{id:'reading',type:'file',name:'长文阅读与分组.md',indexStatus:'indexed'},{id:'short',type:'file',name:'短笔记.md'}],fileContents:{reading:${JSON.stringify(markdown)},short:'# 短笔记\\n\\n短正文\\n\\n## 单独小节\\n\\n短文内容'},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
updateFileContent(id,text){api.updates++;slice.fileContents[id]=text;api.render()},updateNodeName(){throw Error('Unexpected rename')},reindexNote(){throw Error('Unexpected reindex')},retryNoteSave(){},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){},addSelectionToChat(){}};
window.readingTest={api,slice};
const measure=HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect=function(){if(this.matches('.note-content h1,.note-content h2,.note-content h3'))api.headingReads++;return measure.call(this)};
api.render();`;
const bundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'reading-isolation',enforce:'pre',
resolveId(id,importer){if(id==='virtual:reading')return '\0reading';if(id==='../store/selectors'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0store';if(id==='../services/notes'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0notes';if(id==='../services/attachments'&&importer===component)return '\0attachments';},
load(id){if(id==='\0reading')return entry;if(id==='\0store')return 'export const useEditorSlice=()=>window.readingTest.slice;';if(id==='\0notes')return 'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';if(id==='\0attachments')return 'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw Error("Unexpected upload")};';
if(id===component){let s=baseline?execFileSync('git',['show','d7ba25b:src/components/NoteEditor.tsx'],{encoding:'utf8'}):readFileSync(id,'utf8');return s.replace('      extensions,','      extensions, onCreate: ({editor}) => {const api=window.readingTest.api;api.editor=editor;editor.on("selectionUpdate",()=>api.selectionUpdates++);const original=editor.getMarkdown.bind(editor);editor.getMarkdown=()=>{api.serializations++;return original()};},');}
if(id.endsWith('/documentCache.ts'))return readFileSync(id,'utf8').replace('  doc.descendants((node, position) => {','  window.readingTest.api.scans++;doc.descendants((node, position) => {');
if(id.endsWith('/useReadingHeading.ts'))return readFileSync(id,'utf8').replace('        positions = headings.flatMap','        window.readingTest.api.cacheBuilds++; positions = headings.flatMap').replace('  return activeId;','  window.readingTest.api.activeId=activeId; return activeId;');}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:reading',output:{codeSplitting:false}}}});
const assets=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assets).filter(n=>/^(index-|NoteEditor-).*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
const source=bundle.output.find(n=>n.type==='chunk').code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-outline-reading-')),reports=[];
const settle=page=>page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
const target=106;
async function scrollTo(page,index){await page.evaluate(i=>{const e=window.readingTest.api.editor,h=e.view.dom.querySelectorAll('h1,h2,h3')[i],s=document.querySelector('.document-scroll');s.scrollTop+=h.getBoundingClientRect().top-s.getBoundingClientRect().top-32},index);await settle(page);}
async function expectActive(page,index,scope='.chapter-rail'){
 const expected=await page.evaluate(i=>window.readingTest.api.headings()[i].id,index);
 await page.waitForFunction(({expected,scope})=>document.querySelector(scope+' [aria-current="location"]')?.dataset.headingId===expected,{expected,scope},{timeout:4000});
 assert.equal(await page.locator(scope+' [aria-current="location"]').count(),1);
}
async function expectTracked(page,index){const expected=await page.evaluate(i=>window.readingTest.api.headings()[i].id,index);await page.waitForFunction(id=>window.readingTest.api.activeId===id,expected);}
try{
 for(const {width,touch} of baseline?[{width:1280,touch:false}]:[{width:1280,touch:false},{width:800,touch:true},{width:320,touch:true}]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch});const page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100vh"></div><script type="module">'+source+'</script></body></html>');
  await page.waitForFunction(()=>window.readingTest.api.editor&&document.querySelector('.note-entry[data-ready="true"]'));await settle(page);
  assert.equal(await page.evaluate(()=>window.readingTest.api.headings().length),251);
  await page.evaluate(()=>{const a=window.readingTest.api;window.originalReadingDoc=a.editor.state.doc;window.originalReadingSelection=a.editor.state.selection;a.updates=a.scans=a.serializations=a.headingReads=a.selectionUpdates=0;});
  await scrollTo(page,target);
  if(baseline){const active=await page.locator('.chapter-rail-item.is-active').textContent();console.log(JSON.stringify({baselineRef:'d7ba25b',expected:'小节 10-4',actual:active}));assert(active.includes('小节 10-4'),'Scrolling without editing must update the active chapter');}
  if(width===320){await page.getByRole('button',{name:'展开目录',exact:true}).click();await expectActive(page,target,'[aria-label="本文目录"]');}
  else await expectActive(page,target);
  const scope=width===320?page.getByRole('dialog',{name:'本文目录',exact:true}):page.locator('.chapter-rail');
  assert((await scope.locator('[data-heading-id]').count())<60,'Long hierarchical notes start with chapter groups, not 251 marks');
  assert(await page.evaluate(()=>window.readingTest.api.editor.state.doc===window.originalReadingDoc&&window.readingTest.api.editor.state.selection===window.originalReadingSelection));
  assert.equal(await page.evaluate(()=>window.readingTest.api.updates),0);assert.equal(await page.evaluate(()=>window.readingTest.api.selectionUpdates),0);
  if(width!==320){
   await page.mouse.move(width-24,450);await settle(page);
   assert(await scope.locator('.chapter-rail-item').evaluateAll(nodes=>nodes.every(n=>Math.abs(n.getBoundingClientRect().width-n.closest('.chapter-rail-track').getBoundingClientRect().width)<1)),'Row wrappers must not shrink labels into a 23px-wide flex item');
   const before=await scope.locator('.chapter-rail-track').evaluate(n=>({top:n.scrollTop,height:n.clientHeight,range:n.scrollHeight}));
   const box=await scope.boundingBox();await page.mouse.move(20,20);await settle(page);
   await page.evaluate(()=>{const a=window.readingTest.api;a.scans=a.serializations=a.headingReads=0});
   await page.mouse.move(box.x+box.width-14,box.y+box.height/2);
   const frames=await scope.locator('.chapter-rail-track').evaluate(async n=>{const result=[];for(let i=0;i<25;i++){await new Promise(r=>requestAnimationFrame(r));result.push({top:n.scrollTop,height:n.clientHeight,range:n.scrollHeight})}return result});
   assert(frames.every(n=>JSON.stringify(n)===JSON.stringify(before)),'Grouping must not destabilize hover geometry');
   assert.deepEqual(await page.evaluate(()=>({scans:window.readingTest.api.scans,serializations:window.readingTest.api.serializations,headingReads:window.readingTest.api.headingReads})),{scans:0,serializations:0,headingReads:0});
  }
  await scope.getByRole('button',{name:'展开全部',exact:true}).click();assert.equal(await scope.locator('[data-heading-id]').count(),251);
  await scope.getByRole('button',{name:'收起分组',exact:true}).click();assert((await scope.locator('[data-heading-id]').count())<60);
  assert.equal(await scope.locator('[aria-current="location"]').count(),1,'Collapsing groups retains the current reading branch');
  await scope.locator('[aria-current="location"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(output,'grouped-'+width+'.png')});
  // Explicitly expand another branch; ordinary body edits must preserve its fold state.
  const expandFive=scope.getByRole('button',{name:'展开小节：章节 5',exact:true});await expandFive.click();
  assert.equal(await scope.getByRole('button',{name:'收起小节：章节 5',exact:true}).getAttribute('aria-expanded'),'true');
  if(width===320)await scope.getByRole('button',{name:'收起目录',exact:true}).click();
  else {await page.mouse.move(20,20);await page.getByRole('textbox',{name:'文档标题',exact:true}).focus();}
  // Reading scroll has no per-frame heading layout reads, parsing or serialization.
  await page.evaluate(()=>{const a=window.readingTest.api;a.scans=a.serializations=a.headingReads=0});
  await page.locator('.document-scroll').evaluate(async n=>{for(let i=0;i<20;i++){n.scrollTop+=12;await new Promise(r=>requestAnimationFrame(r))}});await settle(page);
  assert.deepEqual(await page.evaluate(()=>({scans:window.readingTest.api.scans,serializations:window.readingTest.api.serializations,headingReads:window.readingTest.api.headingReads})),{scans:0,serializations:0,headingReads:0});
  // Cursor ownership wins while editing, including a selection outside the viewport.
  await page.locator('.note-content').focus();
  await page.evaluate(()=>{const a=window.readingTest.api,h=a.headings();a.editor.commands.setTextSelection({from:h[106].position+2,to:h[109].position+2})});await settle(page);
  await expectTracked(page,109);if(width!==320)await expectActive(page,109);
  await page.evaluate(()=>{const a=window.readingTest.api;a.editor.commands.setTextSelection(a.headings()[205].position+2)});await settle(page);
  await expectTracked(page,205);if(width!==320)await expectActive(page,205);
  const cursor=await page.evaluate(()=>window.readingTest.api.editor.state.selection.from);
  await scrollTo(page,target); // programmatic scroll alone must not steal an editor's cursor ownership
  await expectTracked(page,205);if(width!==320)await expectActive(page,205);
  // An actual wheel gesture intentionally returns to reading without moving that cursor.
  const scroller=await page.locator('.document-scroll').boundingBox();await page.mouse.move(scroller.x+80,scroller.y+180);await page.mouse.wheel(0,40);await settle(page);
  await expectTracked(page,target);if(width!==320)await expectActive(page,target);
  assert.equal(await page.evaluate(()=>window.readingTest.api.editor.state.selection.from),cursor);
  // Resize/layout shifts invalidate cached positions; they do not edit the note.
  await page.getByRole('textbox',{name:'文档标题',exact:true}).focus();await page.evaluate(()=>{document.querySelector('.document-header').style.paddingBottom='240px'});await settle(page);
  await scrollTo(page,target);if(width!==320)await expectActive(page,target);
  await page.locator('.note-content').focus();await settle(page);
  await page.evaluate(()=>{const a=window.readingTest.api;a.cacheBuilds=0;a.editor.chain().setTextSelection(5).insertContent('新增').run()});await settle(page);
  assert.equal(await page.evaluate(()=>window.readingTest.api.cacheBuilds),0,'Editing defers reading-position measurements until reading resumes');
  if(width===320){await page.getByRole('button',{name:'展开目录',exact:true}).click();}
  else {const b=await scope.boundingBox();await page.mouse.move(b.x+b.width-14,b.y+100);await settle(page);}
  assert.equal(await scope.getByRole('button',{name:'收起小节：章节 5',exact:true}).getAttribute('aria-expanded'),'true','Body position shifts preserve user-expanded groups');
  if(width===320)await scope.getByRole('button',{name:'收起目录',exact:true}).click();
  await page.evaluate(()=>window.readingTest.api.editor.commands.undo());assert(await page.evaluate(()=>window.readingTest.api.editor.state.doc.eq(window.originalReadingDoc)));
  await page.getByRole('textbox',{name:'文档标题',exact:true}).focus();await page.locator('.document-scroll').evaluate(n=>{n.scrollTop=n.scrollHeight});await settle(page);
  if(width===320){await page.getByRole('button',{name:'展开目录',exact:true}).click();await expectActive(page,250,'[aria-label="本文目录"]');await page.getByRole('dialog',{name:'本文目录',exact:true}).getByRole('button',{name:'收起目录',exact:true}).click();}
  else await expectActive(page,250);
  assert(await page.locator('.note-content code [class^="token-"]').count()>0);
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settle(page);
  assert.equal(await page.locator('.note-content').evaluate(n=>getComputedStyle(n).color),'rgb(230, 229, 223)');
  if(width!==320)assert.notEqual(await page.locator('.chapter-rail').evaluate(n=>getComputedStyle(n,'::before').backgroundColor),'rgba(255, 255, 255, 0.96)');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{const t=window.readingTest;t.slice.selectedFileId='short';t.api.render()});await page.waitForFunction(()=>document.querySelector('.note-entry[data-ready="true"]')&&document.querySelector('.note-content').textContent.includes('短正文'));await settle(page);
  if(width!==320){assert.equal(await page.locator('.chapter-rail-item').count(),2);await expectActive(page,0);}
  assert.equal(await page.locator('.note-entry-content').evaluate(n=>getComputedStyle(n).animationName),'none');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,touch,readingFollows:true,cursorOwnership:true,wheelReturnsToReading:true,selectionPreserved:true,grouped251:true,expandCollapse:true,hoverStable:width===320?null:true,scrollCacheNoWork:true,layoutInvalidation:true,positionShiftGroups:true,undo:true,bottom:true,codeColors:true,noteSwitchCleanup:true,dark:true,reducedMotion:true});await context.close();
 }
 console.log(JSON.stringify({ok:true,actualEditorAndOutline:true,syntheticOnly:true,networkBlocked:true,output,reports},null,2));
}finally{await browser.close();}
