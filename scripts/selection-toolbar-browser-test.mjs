// Real NoteEditor / built CSS, synthetic services and notes, no application session.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component=fileURLToPath(new URL('../src/components/NoteEditor.tsx',import.meta.url));
const assets=new URL('../dist/assets/',import.meta.url);
const cssFiles=readdirSync(assets).filter(n=>/^(index-|NoteEditor-).*\.css$/.test(n));
// Reversed order also exercises local theme priority against legacy global rules.
const css=cssFiles.map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
assert(css,'Build production CSS first');
const output=mkdtempSync(join(tmpdir(),'noteflow-selection-ui-'));
const markdown=['# Go 语言笔记','','正文用于独立检查，不是用户笔记。','','正文颜色与代码高亮保持原样。','','Go 允许在 `if` 语句前加一个简单的初始化语句。','',...Array.from({length:30},()=>['这是用于滚动检查的合成段落。','']).flat()].join('\n');
const entry=`import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import NoteEditor from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));const api={editor:null,updates:[],chat:[],render(){root.render(React.createElement(StrictMode,null,React.createElement(NoteEditor)))}};
const slice={selectedFileId:'toolbar-synthetic',treeData:[{id:'toolbar-synthetic',name:'Go 语言笔记.md',type:'file',indexStatus:'indexed'}],fileContents:{'toolbar-synthetic':${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,updateFileContent(id,text){api.updates.push(text);slice.fileContents[id]=text;api.render()},updateNodeName(){throw new Error('Unexpected rename')},reindexNote(){throw new Error('Unexpected reindex')},addSelectionToChat(...args){api.chat.push(args)},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};
window.toolbarTest={api,slice};api.render();`;
const bundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'offline-selection-toolbar',enforce:'pre',
  resolveId(id,importer){if(id==='virtual:selection-toolbar')return'\0selection-toolbar';if(id==='../store/selectors'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return'\0toolbar-store';if(id==='../services/notes'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return'\0toolbar-notes';if(id==='../services/attachments'&&importer===component)return'\0toolbar-attachments';},
  load(id){if(id==='\0selection-toolbar')return entry;if(id==='\0toolbar-store')return'export const useEditorSlice=()=>window.toolbarTest.slice;';if(id==='\0toolbar-notes')return'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';if(id==='\0toolbar-attachments')return'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw new Error("Unexpected upload")};';if(id===component){const source=readFileSync(id,'utf8');assert(source.includes('      extensions,'));return source.replace('      extensions,','      extensions, onCreate: ({editor}) => {window.toolbarTest.api.editor=editor;},');}}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:selection-toolbar',output:{codeSplitting:false}}}});
const chunks=bundle.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const source=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
async function select(page){
  await page.evaluate(()=>{const e=window.toolbarTest.api.editor;let range;e.state.doc.descendants((n,p)=>{if(n.type.name==='paragraph'&&n.textContent.startsWith('Go 允许在'))range={from:p+1,to:p+1+n.content.size};});if(!range)throw new Error('Missing test paragraph');e.chain().focus().setTextSelection(range).run();});
  await page.locator('.tiptap-selection-toolbar').waitFor({state:'visible'});
  await page.waitForTimeout(200);
}
async function settle(page){await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function geometry(page){return page.locator('.tiptap-selection-toolbar').evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),b=n.querySelector('button'),bs=getComputedStyle(b),svg=getComputedStyle(b.querySelector('svg'));return{width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:innerWidth,bodyWidth:document.documentElement.scrollWidth,radius:s.borderRadius,surface:s.backgroundColor,shadow:s.boxShadow,buttonWidth:b.getBoundingClientRect().width,buttonHeight:b.getBoundingClientRect().height,icon:svg.width,stroke:svg.strokeWidth,buttonShadow:bs.boxShadow,buttonsFit:Array.from(n.querySelectorAll('button')).every(b=>{const q=b.getBoundingClientRect();return q.left>=r.left&&q.right<=r.right&&q.top>=r.top&&q.bottom<=r.bottom;})};});}
try{
  for(const [width,touch] of [[1280,false],[736,false],[320,true]]){
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch,deviceScaleFactor:1});
    const errors=[],requests=[];await context.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100vh"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>window.toolbarTest?.api.editor);await select(page);await settle(page);
    const bar=page.locator('.tiptap-selection-toolbar');
    assert.deepEqual(await bar.locator('button').evaluateAll(n=>n.map(b=>b.getAttribute('aria-label'))),['加入对话','加粗','斜体','下划线','删除线','高亮','行内代码','添加链接','无序列表','有序列表','引用','清除格式']);
    const initial=await geometry(page);assert(initial.buttonsFit,JSON.stringify(initial));assert(initial.left>=0&&initial.right<=width,JSON.stringify(initial));assert(initial.top>=0,JSON.stringify(initial));assert.equal(initial.bodyWidth,width);assert.equal(initial.radius,'12px');assert.equal(initial.stroke,'1.7px');assert.equal(initial.icon,'15px');assert.equal(initial.surface,'rgb(255, 255, 255)');assert.equal(initial.buttonWidth,touch?44:31);assert.equal(initial.buttonShadow,'none');
    assert.equal(await page.locator('.note-content').evaluate(n=>getComputedStyle(n).color),'rgb(41, 42, 40)');assert.equal(await page.evaluate(()=>window.toolbarTest.api.updates.length),0,'Showing the toolbar must not edit a note');
    await page.screenshot({path:join(output,'light-'+width+'.png')});
    const bold=bar.getByRole('button',{name:'加粗',exact:true});await bold.hover();await settle(page);assert.equal(await bold.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(240, 243, 246)');
    const range=await page.evaluate(()=>({from:window.toolbarTest.api.editor.state.selection.from,to:window.toolbarTest.api.editor.state.selection.to}));
    await bold.click();await page.waitForFunction(()=>document.querySelector('[aria-label="加粗"].selection-toolbar-button')?.classList.contains('is-active'));await settle(page);
    assert.deepEqual(await page.evaluate(()=>({from:window.toolbarTest.api.editor.state.selection.from,to:window.toolbarTest.api.editor.state.selection.to})),range);
    assert.equal(await bold.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(232, 241, 248)');assert.match(await page.evaluate(()=>window.toolbarTest.slice.fileContents['toolbar-synthetic']),/\*\*Go 允许在/);
    await page.keyboard.press('ControlOrMeta+z');await page.waitForFunction(()=>!document.querySelector('[aria-label="加粗"].selection-toolbar-button')?.classList.contains('is-active'));
    await select(page);await bar.getByRole('button',{name:'添加链接',exact:true}).click();await page.getByRole('textbox',{name:'链接地址',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'取消添加链接',exact:true}).click();
    await select(page);await bar.getByRole('button',{name:'加入对话',exact:true}).click();assert.equal(await page.evaluate(()=>window.toolbarTest.api.chat.length),1);
    await select(page);await bold.focus();await page.keyboard.press('Tab');const italic=bar.getByRole('button',{name:'斜体',exact:true});assert.equal(await italic.evaluate(n=>document.activeElement===n),true);assert.equal(await italic.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');assert.equal(await italic.evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settle(page);const dark=await geometry(page);assert.equal(dark.surface,'rgb(43, 50, 59)');assert.equal(await italic.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(55, 65, 77)');
    await page.screenshot({path:join(output,'dark-'+width+'.png')});
    await page.emulateMedia({reducedMotion:'reduce'});assert((await italic.evaluate(n=>getComputedStyle(n).transitionDuration)).split(',').every(n=>parseFloat(n)<=.00001),'Existing global reduced-motion rule may use 0.01ms instead of literal zero');
    await page.emulateMedia({forcedColors:'active'});assert.equal(await bar.evaluate(n=>getComputedStyle(n).borderStyle),'solid');assert.equal(await italic.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
    await page.emulateMedia({forcedColors:'none'});await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    // Position remains delegated to the existing Floating UI options during scroll.
    const textTop=()=>page.locator('.note-content p').filter({hasText:'Go 允许在'}).evaluate(n=>n.getBoundingClientRect().top);
    const textBeforeScroll=await textTop();const menuBeforeScroll=await geometry(page);
    const scrollDelta=await page.locator('.document-scroll').evaluate(n=>{const before=n.scrollTop;n.scrollTop+=45;return n.scrollTop-before;});assert.equal(scrollDelta,45);await page.waitForTimeout(350);const scrolled=await geometry(page);assert(scrolled.left>=0&&scrolled.right<=width&&scrolled.buttonsFit,JSON.stringify(scrolled));
    const textScrollShift=(await textTop())-textBeforeScroll,menuScrollShift=scrolled.top-menuBeforeScroll.top;
    const followsSelection=Math.abs(textScrollShift-menuScrollShift)<1;
    assert(followsSelection, JSON.stringify({width,textScrollShift,menuScrollShift}));
    await page.evaluate(()=>window.toolbarTest.api.editor.commands.setTextSelection(1));await bar.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);reports.push({width,touch,initial,dark,scrolled,scrollDelta,textScrollShift,menuScrollShift,followsSelection,selectionPreserved:true,undo:true,linkCancel:true,chat:true,keyboard:true,reducedMotion:true,forcedColors:true,errors,requests});await context.close();
  }
  console.log(JSON.stringify({ok:true,scope:'appearance-and-retained-actions',actualProductionComponent:true,syntheticOnly:true,output,scrollFollowingDiagnostic:{ok:reports.every(r=>r.followsSelection),issue:reports.every(r=>r.followsSelection)?null:'UI-28'},reports},null,2));
}finally{await browser.close();}
