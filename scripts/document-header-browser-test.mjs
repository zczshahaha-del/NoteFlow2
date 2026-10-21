// Real NoteEditor/Tiptap and header; synthetic state, services, and blocked network.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const component=fileURLToPath(new URL('../src/components/NoteEditor.tsx',import.meta.url));
const baseline=process.env.NOTEFLOW_HEADER_BASELINE==='1';
const title='知识库学习笔记';
const markdown='# '+title+'\n\n保留 **重点** 与 `inline`。\n\n## 正文章节\n\n```go\nfunc main() { println("color") }\n```';
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {closeHistory} from '@tiptap/pm/history';import NoteEditor from ${JSON.stringify(component)};
let legacyNumberReads=0;
Object.defineProperty(window,'localStorage',{value:{getItem(key){if(key==='noteflow:show-heading-numbers'){legacyNumberReads++;return 'false'}return null},setItem(){},removeItem(){}}});
const root=createRoot(document.getElementById('root'));
const note={id:'note',type:'file',name:${JSON.stringify(title+'.md')},createdAt:'2026-07-22T15:50:00+08:00',updatedAt:'2026-10-15T09:14:00+08:00',indexStatus:'indexed'};
const folders=()=>[{id:'f1',type:'folder',name:'全栈开发',children:[{id:'f2',type:'folder',name:'学习笔记',children:[note]}]}];
const api={renames:[],updates:[],retries:[],editor:null,render(){root.render(React.createElement(React.StrictMode,null,React.createElement(NoteEditor)))},
move(root){slice.treeData=root?[note]:folders();api.render()},status(status){slice.noteSaveState={status};api.render()},startUserEdit(){api.editor.view.dispatch(closeHistory(api.editor.state.tr))}};
const slice={selectedFileId:'note',treeData:folders(),fileContents:{note:${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
updateNodeName(id,name){api.renames.push({id,name});note.name=name;api.render()},updateFileContent(id,content){api.updates.push({id,content});slice.fileContents[id]=content;api.render()},
retryNoteSave(id){api.retries.push(id)},reindexNote(){throw Error('Unexpected reindex')},addSelectionToChat(){},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};
window.headerTest={api,slice,note,original:${JSON.stringify(markdown)},legacyNumberReads:()=>legacyNumberReads};api.render();`;
const bundled=await build({configFile:false,logLevel:'silent',plugins:[{name:'header-isolated',enforce:'pre',
resolveId(id,importer){if(id==='virtual:header')return '\0header';if(id==='../store/selectors'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0store';if(id==='../services/notes'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0notes';if(id==='../services/attachments'&&importer===component)return '\0attachments';},
load(id){if(id==='\0header')return entry;if(id==='\0store')return 'export const useEditorSlice=()=>window.headerTest.slice;';if(id==='\0notes')return 'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';if(id==='\0attachments')return 'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw Error("Unexpected upload")};';
if(id===component){const source=baseline?execFileSync('git',['show','fe3d20c:src/components/NoteEditor.tsx'],{encoding:'utf8'}):readFileSync(id,'utf8');return source.replace('      extensions,','      extensions, onCreate: ({editor}) => {window.headerTest.api.editor=editor;},');}}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:header',output:{codeSplitting:false}}}});
const assets=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assets).filter(n=>/^(index-|NoteEditor-).*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
const source=bundled.output.find(n=>n.type==='chunk').code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-document-header-')),reports=[];
async function settle(page){await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(r));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
try{
 for(const width of baseline?[1280]:[1280,736,320]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===320,timezoneId:'Asia/Shanghai'});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100vh"></div><script type="module">'+source+'</script></body></html>');
  await page.waitForFunction(()=>document.querySelector('.note-entry')?.dataset.ready==='true'&&window.headerTest.api.editor);await settle(page);
  const input=page.getByRole('textbox',{name:'文档标题',exact:true});
  const header=page.locator('.document-header');
  if(!baseline){
   assert.equal(await header.getAttribute('data-title-mode'),'body');assert.equal(await input.evaluate(n=>getComputedStyle(n).fontSize),width===320?'16px':'14px');
   assert.equal(await page.locator('.note-content h1').textContent(),title);
   assert.equal(await page.locator('.document-location,.document-save-state').count(),0);
   assert.equal(await page.locator('.document-meta-date').count(),1);
   assert.equal(await page.locator('time.document-meta-date').getAttribute('datetime'),'2026-07-22T15:50:00+08:00');
   assert.equal(await page.locator('.document-meta-date').textContent(),'创建于 2026-07-22 15:50');
   assert.equal(await header.locator('.document-meta-row').getByText(/知识库|全栈开发|正文自动保存|更新于/).count(),0,'Read-only metadata excludes breadcrumbs; the editable title may legitimately contain these words');
   assert.equal(await page.evaluate(()=>window.headerTest.api.updates.length),0);assert.equal(await page.evaluate(()=>window.headerTest.slice.fileContents.note),markdown);
   await page.evaluate(()=>{window.headerOriginalEditor=window.headerTest.api.editor;window.headerOriginalDoc=window.headerTest.api.editor.state.doc});
   assert.equal(await page.getByRole('button',{name:'文档显示设置',exact:true}).count(),0,'No empty numbering-settings menu');
   const anchor=await page.locator('.document-meta-date').boundingBox();
   const bodyTop=await page.locator('.note-content').boundingBox();
   for(const status of ['idle','unsaved','saving','offline','error','saved']){
    await page.evaluate(s=>window.headerTest.api.status(s),status);await settle(page);
    assert.deepEqual(await page.locator('.document-meta-date').boundingBox(),anchor,'Saving never adds a status row or shifts the creation time');
    assert.equal(await page.locator('.document-save-state').count(),0);
    const exceptional=['error','offline'].includes(status);
    assert.equal(await page.locator('.nf-note-feedback [role="alert"]').count(),exceptional?1:0,'Only sync failures show actionable feedback');
    if(exceptional){
      const label=status==='offline'?'立即同步':'重试保存';
      await page.getByRole('button',{name:label,exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.headerTest.api.retries),status==='offline'?['note']:['note','note']);
    }
    if(!['error','offline'].includes(status))assert.equal((await page.locator('.note-content').boundingBox()).y,bodyTop.y,'Routine save state must not shift prose; exceptional retry feedback remains visible');
    assert(await page.evaluate(()=>window.headerTest.api.editor===window.headerOriginalEditor&&window.headerTest.api.editor.state.doc===window.headerOriginalDoc));
   }
   await page.evaluate(()=>{window.headerTest.note.updatedAt='2026-10-20T21:30:00+08:00';window.headerTest.api.render()});await settle(page);
   assert.equal(await page.locator('.document-meta-date').textContent(),'创建于 2026-07-22 15:50');
   assert.equal((await page.locator('.note-content').boundingBox()).y,bodyTop.y,'An updated timestamp must not move the prose');
   assert.equal(await page.evaluate(()=>window.headerTest.note.updatedAt),'2026-10-20T21:30:00+08:00','Do not remove update metadata from the model');
   for(const createdAt of [null,'invalid-time']){
     await page.evaluate(value=>{window.headerTest.note.createdAt=value;window.headerTest.api.render()},createdAt);await settle(page);
     assert.equal(await page.locator('.document-meta-row').count(),0,'No blank date row or fallback to updated time');
     assert(await input.isVisible());
   }
   await page.evaluate(()=>{window.headerTest.note.createdAt='2026-07-22T15:50:00+08:00';window.headerTest.api.render()});await settle(page);
   await page.screenshot({path:join(output,'header-'+width+'.png')});
  }
  await input.focus();await input.press('End');await input.pressSequentially(' 新版本');
  if(baseline)console.log(JSON.stringify({baselineRef:'fe3d20c',renameCalls:await page.evaluate(()=>window.headerTest.api.renames.length),typedSuffix:' 新版本',actualTitle:await input.inputValue()}));
  assert.equal(await page.evaluate(()=>window.headerTest.api.renames.length),0,'Typing must not send a rename for each keystroke');
  assert.equal(await input.inputValue(),title+' 新版本','Spaces must survive controlled title typing');
  assert.equal(await header.getAttribute('data-title-mode'),'body','Renaming must not resize the focused title');
  await input.press('Enter');await page.waitForFunction(()=>window.headerTest.api.renames.length===1);
  assert.deepEqual(await page.evaluate(()=>window.headerTest.api.renames[0]),{id:'note',name:title+' 新版本.md'});
  await page.waitForFunction(()=>document.querySelector('.document-header').dataset.titleMode==='document');
  assert.equal(await page.locator('.note-content h1').textContent(),title,'Renaming the file never rewrites the H1');
  assert.equal(await page.evaluate(()=>window.headerTest.slice.fileContents.note),markdown);
  await input.fill(title);await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.document-header').dataset.titleMode==='body');
  const committed=await page.evaluate(()=>window.headerTest.api.renames.length);
  await input.fill('取消的名称');await input.press('Escape');assert.equal(await input.inputValue(),title);assert.equal(await page.evaluate(()=>window.headerTest.api.renames.length),committed);
  await input.fill('输入法草稿');
  for(const kind of ['composition','isComposing','229']){
   await input.evaluate((n,kind)=>{if(kind==='composition')n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:kind==='isComposing',keyCode:kind==='229'?229:13}));},kind);
   assert.equal(await page.evaluate(()=>window.headerTest.api.renames.length),committed);assert(await input.evaluate(n=>document.activeElement===n));
   await input.evaluate(n=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  }
  await input.press('Escape');assert.equal(await input.inputValue(),title);
  await input.fill('仍在编辑的 名称');
  await page.evaluate(()=>{window.headerTest.note.name='迟到的元数据名称.md';window.headerTest.api.render()});
  await settle(page);assert.equal(await input.inputValue(),'仍在编辑的 名称','A late metadata name must not replace an active title draft');
  assert(await input.evaluate(n=>document.activeElement===n));
  await input.press('Escape');assert.equal(await input.inputValue(),'迟到的元数据名称');
  assert.equal(await page.evaluate(()=>window.headerTest.api.renames.length),committed,'Cancel does not send a rename over the newer metadata name');
  await input.fill('   ');await input.press('Enter');assert.equal(await input.inputValue(),'未命名笔记');
  await input.fill(title);await input.press('Enter');await settle(page);
  // Edit the first H1: presentation stays stable during typing, then updates on blur.
  await page.locator('.note-content').focus();
  const top=await header.boundingBox();await page.evaluate(()=>window.headerTest.api.editor.chain().setTextSelection(2).insertContent('改').run());
  await page.waitForFunction(()=>document.querySelector('.note-content h1').textContent.startsWith('知改'));
  assert.equal(await header.getAttribute('data-title-mode'),'body');assert.equal((await header.boundingBox()).height,top.height);
  await input.focus();await input.press('Tab');await page.waitForFunction(()=>document.querySelector('.document-header').dataset.titleMode==='document');
  await page.evaluate(()=>window.headerTest.api.editor.chain().focus().undo().run());
  await input.focus();await input.press('Tab');await page.waitForFunction(()=>document.querySelector('.document-header').dataset.titleMode==='body');
  assert.equal(await page.locator('.note-content h1').getAttribute('data-heading-number'),null,'A matching document title never consumes a chapter number');
  assert.equal(await page.evaluate(()=>window.headerTest.legacyNumberReads()),0,'Old disabled preference is no longer consulted');
  await page.evaluate(()=>window.headerTest.api.move(true));await settle(page);
  assert.equal(await page.locator('.document-location').count(),0);
  assert(await page.evaluate(()=>window.headerTest.api.editor===window.headerOriginalEditor));
  await page.evaluate(()=>{window.headerTest.api.move(false);window.headerTest.slice.treeData[0].name='长文件夹'.repeat(30);window.headerTest.api.render()});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settle(page);assert.equal(await page.locator('.document-meta-row').evaluate(n=>getComputedStyle(n).color),'rgb(167, 176, 188)');
  await page.screenshot({path:join(output,'header-'+width+'-dark.png')});
  await page.emulateMedia({reducedMotion:'reduce'});await input.focus();await input.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
  const nestedSource='## 模型接口与API调用基础\n\n### 1. 准备工作\n\n### 2. 使用 SDK\n\n### 自动子节\n\n## 提示工程\n\n结尾';
  const updatesBefore=await page.evaluate(()=>window.headerTest.api.updates.length);
  await page.evaluate(content=>{window.headerTest.slice.fileContents.note=content;window.headerTest.api.render()},nestedSource);
  await page.waitForFunction(()=>document.querySelector('.note-content h3')?.textContent==='1. 准备工作');
  assert.deepEqual(await page.locator('.note-content h2,.note-content h3').evaluateAll(nodes=>nodes.map(n=>n.textContent)),
    ['模型接口与API调用基础','1. 准备工作','2. 使用 SDK','自动子节','提示工程']);
  assert.equal(await page.locator('.note-content [data-heading-number]').count(),0,'No display-only numbering');
  if(width>=768){
    await page.getByRole('button',{name:'展开章节目录',exact:true}).click();
    assert.deepEqual(await page.locator('.chapter-rail-label').allTextContents(),['模型接口与API调用基础','1. 准备工作','2. 使用 SDK','自动子节','提示工程']);
  }else{
    await page.getByRole('button',{name:'展开目录',exact:true}).click();
    assert.deepEqual(await page.locator('.document-outline-heading').allTextContents(),['模型接口与API调用基础','1. 准备工作','2. 使用 SDK','自动子节','提示工程']);
    assert.equal(await page.getByRole('button',{name:'1. 准备工作',exact:true}).count(),1);
  }
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),nestedSource);
  assert.equal(await page.evaluate(()=>window.headerTest.api.updates.length),updatesBefore,'Display correction must never save rewritten headings');
  await page.screenshot({path:join(output,'numbering-'+width+'.png')});
  // Legacy ordinals remain literal editable heading text.
  const chineseSource='## 一、Docker 是什么\n\n### 一句话定义\n\n### （二）容器\n\n## 二、安装\n\n### 2026 年环境\n\n## 继续学习\n\n正文保持原样。';
  if(width>=768)await page.keyboard.press('Escape');
  else await page.getByRole('button',{name:'收起目录',exact:true}).click();
  await page.evaluate(content=>{window.headerTest.slice.fileContents.note=content;window.headerTest.api.render()},chineseSource);
  await page.waitForFunction(()=>document.querySelector('.note-content h2')?.textContent==='一、Docker 是什么');
  const chineseLabels=['一、Docker 是什么','一句话定义','（二）容器','二、安装','2026 年环境','继续学习'];
  assert.deepEqual(await page.locator('.note-content h2,.note-content h3').evaluateAll(nodes=>nodes.map(n=>(n.dataset.headingNumber?n.dataset.headingNumber+(n.dataset.headingNumberJoin?'':' '):'')+n.textContent)),chineseLabels);
  if(width>=768){
    await page.getByRole('button',{name:'展开章节目录',exact:true}).click();
    assert.deepEqual(await page.locator('.chapter-rail-label').allTextContents(),chineseLabels);
    await page.keyboard.press('Escape');
  }else{
    await page.getByRole('button',{name:'展开目录',exact:true}).click();
    for(const label of chineseLabels)assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1);
    await page.getByRole('button',{name:'收起目录',exact:true}).click();
  }
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),chineseSource);
  assert.equal(await page.evaluate(()=>window.headerTest.api.updates.length),updatesBefore);
  await page.screenshot({path:join(output,'chinese-numbering-'+width+'.png')});
  assert.equal(await page.getByRole('button',{name:'统一章节编号',exact:true}).count(),0,'No manual maintenance action is required');
  // The synthetic external replacements above establish a new baseline; do
  // not group them into the native typing/undo operation being tested below.
  await page.evaluate(()=>window.headerTest.api.startUserEdit());
  await page.locator('.note-content p').last().click();
  await page.keyboard.press('End');await page.keyboard.insertText('继续写作');
  await page.waitForFunction(()=>window.headerTest.api.editor.getMarkdown().includes('继续写作'));
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),chineseSource+'继续写作','Normal saving retains legacy source prefixes without resetting the editor');
  assert.equal(await page.evaluate(()=>window.headerTest.api.updates.length),updatesBefore+1);
  const unifiedLabels=['一、Docker 是什么','一句话定义','（二）容器','二、安装','2026 年环境','继续学习'];
  assert.deepEqual(await page.locator('.note-content h2,.note-content h3').evaluateAll(nodes=>nodes.map(n=>(n.dataset.headingNumber?n.dataset.headingNumber+' ':'')+n.textContent)),unifiedLabels);
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),chineseSource);
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+Shift+z');
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),chineseSource+'继续写作');
  if(width>=768){
    await page.getByRole('button',{name:'展开章节目录',exact:true}).click();
    assert.deepEqual(await page.locator('.chapter-rail-label').allTextContents(),unifiedLabels);
    await page.keyboard.press('Escape');
  }else{
    await page.getByRole('button',{name:'展开目录',exact:true}).click();
    for(const label of unifiedLabels)assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1);
    await page.getByRole('button',{name:'收起目录',exact:true}).click();
  }
  await page.screenshot({path:join(output,'unified-numbering-'+width+'.png')});
  const literalSource='## 4. CRUD\n\n### 4.1 增（Create）\n\n正文。';
  await page.evaluate(content=>{window.headerTest.slice.fileContents.note=content;window.headerTest.api.render()},literalSource);
  await page.waitForFunction(()=>document.querySelector('.note-content h3')?.textContent==='4.1 增（Create）');
  await page.locator('.note-content').focus();
  await page.evaluate(()=>{const a=window.headerTest.api;let pos=0;a.editor.state.doc.descendants((node,p)=>{if(node.type.name==='heading'&&node.attrs.level===3)pos=p});a.startUserEdit();a.editor.commands.setTextSelection(pos+4)});
  await page.waitForFunction(()=>document.getSelection()?.anchorNode?.textContent==='4.1 增（Create）'&&document.getSelection()?.anchorOffset===3);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.note-content h3').textContent(),'4. 增（Create）','Backspace deletes one literal digit, not an indivisible marker');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');
  assert.equal(await page.evaluate(()=>window.headerTest.api.editor.getMarkdown()),literalSource);
  await page.locator('.note-content').focus();
  await page.evaluate(()=>{const a=window.headerTest.api;let pos=0;a.editor.state.doc.descendants((node,p)=>{if(node.type.name==='heading'&&node.attrs.level===3)pos=p});a.startUserEdit();a.editor.commands.setTextSelection({from:pos+1,to:pos+5})});
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.note-content h3').textContent(),'增（Create）');
  assert.equal(await page.locator('.note-content [data-heading-number]').count(),0);
  const savedLiteral=await page.evaluate(()=>window.headerTest.slice.fileContents.note);
  assert(savedLiteral.includes('### 增（Create）')&&!savedLiteral.includes('4.1'));
  await page.evaluate(text=>window.headerTest.api.editor.commands.setContent(text,{contentType:'markdown',emitUpdate:false}),savedLiteral);
  assert.equal(await page.locator('.note-content h3').textContent(),'增（Create）','Reopening saved Markdown never restores deleted digits');
  if(width>=768){await page.getByRole('button',{name:'展开章节目录',exact:true}).click();assert.deepEqual(await page.locator('.chapter-rail-label').allTextContents(),['4. CRUD','增（Create）']);await page.keyboard.press('Escape');}
  else{await page.getByRole('button',{name:'展开目录',exact:true}).click();assert.equal(await page.getByRole('button',{name:'增（Create）',exact:true}).count(),1);await page.getByRole('button',{name:'收起目录',exact:true}).click();}
  await page.locator('.note-content').focus();
  await page.evaluate(()=>{const e=window.headerTest.api.editor;let end=1;e.state.doc.descendants((n,p)=>{if(n.type.name==='heading'&&n.attrs.level===3)end=p+n.nodeSize-1});e.commands.setTextSelection(end)});
  await page.keyboard.press('Enter');await page.keyboard.insertText('下一段');
  assert.equal(await page.locator('.note-content p').first().textContent(),'下一段','Enter does not inject or clone numbering');
  await page.screenshot({path:join(output,'editable-number-'+width+'.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);reports.push({width,compactDuplicateTitle:true,originalH1Preserved:true,noBreadcrumb:true,createdTimeOnly:true,updatedMetadataPreserved:true,noBlankDateRow:true,silentNormalSave:true,errorOfflineRetry:true,saveStateGeometry:true,renameOnCommit:true,spaces:true,escapeCancel:true,imeGuards:true,emptyFallback:true,noResizeUnderCaret:true,undo:true,literalEditableNumbers:true,noEmptyMenu:true,nestedManualNumbers:true,proseOutlineAgree:true,sourceUnchanged:true,rootMove:true,dark:true,reducedMotion:true});await context.close();
 }
 console.log(JSON.stringify({ok:true,actualEditorAndHeader:true,syntheticOnly:true,networkBlocked:true,output,reports},null,2));
}finally{await browser.close();}
