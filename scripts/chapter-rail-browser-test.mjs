// Actual NoteEditor + production CSS, synthetic long note, all network blocked.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/NoteEditor.tsx', import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL(n, assets), 'utf8')).join('\n');
assert(css, 'Build first');
const output = mkdtempSync(join(tmpdir(), 'noteflow-chapter-rail-'));
const markdown = Array.from({length:80},(_,i)=>[
  (i%4===0?'## ':'### ')+'章节 '+i+'：长笔记的目录测试', '',
  '正文阅读测试，保留 **加粗** 和 `行内代码`。'.repeat(10), '',
  ...(i%8===0?['```go','var users []User','db.Preload("Posts").Find(&users)','```','']:[]),
]).flat().join('\n');
const entry = `import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';import NoteEditor from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));
const api={editor:null,renders:0,scans:0,serializations:0,updates:0,render(){root.render(React.createElement(StrictMode,null,React.createElement(NoteEditor)))}};
const slice={selectedFileId:'rail-note',treeData:[{id:'rail-note',type:'file',name:'章节目录验证.md',indexStatus:'indexed'}],fileContents:{'rail-note':${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
updateFileContent(){api.updates++},updateNodeName(){throw Error('Unexpected rename')},reindexNote(){throw Error('Unexpected reindex')},addSelectionToChat(){},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};
window.railTest=api;window.proseTest={slice};api.render();`;
const result = await build({configFile:false,logLevel:'silent',plugins:[{
  name:'isolated-chapter-rail',enforce:'pre',
  resolveId(id,importer){
    if(id==='virtual:rail')return '\0rail';
    if(id==='../store/selectors'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0rail-store';
    if(id==='../services/notes'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return '\0rail-notes';
    if(id==='../services/attachments'&&importer===component)return '\0rail-attachments';
  },
  load(id){
    if(id==='\0rail')return entry;
    if(id==='\0rail-store')return 'export const useEditorSlice=()=>window.proseTest.slice';
    if(id==='\0rail-notes')return 'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';
    if(id==='\0rail-attachments')return 'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw Error("Unexpected upload")};';
    if(id===component)return readFileSync(id,'utf8')
      .replace('  const [titleDraft, setTitleDraft]', '  window.railTest.renders++; const [titleDraft, setTitleDraft]')
      .replace('      extensions,','      extensions, onCreate:({editor})=>{window.railTest.editor=editor;const original=editor.getMarkdown.bind(editor);editor.getMarkdown=()=>{window.railTest.serializations++;return original()};},');
    if(id.endsWith('/documentCache.ts'))return readFileSync(id,'utf8').replace('  doc.descendants((node, position) => {','  window.railTest.scans++; doc.descendants((node, position) => {');
  }
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:rail',output:{codeSplitting:false}}}});
const chunks=result.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const source=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
const settle=page=>page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
try{
  for(const width of [1280,800,320]){
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
    const errors=[],requests=[];
    await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
    const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100%"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>window.railTest?.editor&&document.querySelector('.note-entry[data-ready="true"]'));
    await settle(page);
    const rail=page.locator('.chapter-rail');
    if(width===320){
      assert.equal(await rail.count(),0,'mobile retains the explicit outline drawer');
      await page.getByRole('button',{name:'展开目录',exact:true}).click();
      await page.getByRole('dialog',{name:'本文目录',exact:true}).waitFor();
      // The drawer overlays the backdrop's center; use its exposed left edge.
      await page.getByRole('button',{name:'关闭本文目录',exact:true}).click({position:{x:10,y:20}});
      assert.equal(await page.getByRole('dialog',{name:'本文目录',exact:true}).count(),0);
      reports.push({width,mobileDrawerRetained:true});
    }else{
      const box=await rail.boundingBox();
      const track=rail.locator('.chapter-rail-track');
      await track.evaluate(n=>{n.scrollTop=240});
      const geometry=()=>track.evaluate(n=>({scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,rowHeight:n.querySelector('button').getBoundingClientRect().height}));
      const before=await geometry();
      await page.evaluate(()=>{window.railTest.renders=0;window.railTest.scans=0;window.railTest.serializations=0});
      // Native pointer hover, then record every transition frame without disabling it.
      await page.mouse.move(box.x+box.width-14,box.y+box.height/2);
      const frames=await track.evaluate(async n=>{const samples=[];const start=performance.now();while(performance.now()-start<450){await new Promise(r=>requestAnimationFrame(r));samples.push({geometry:{scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,rowHeight:n.querySelector('button').getBoundingClientRect().height},clip:getComputedStyle(n.parentElement).clipPath,opacity:Number(getComputedStyle(n.querySelector('.chapter-rail-label')).opacity)})}return samples});
      await settle(page);
      const after=await geometry();
      console.log(JSON.stringify({width,before,after,frames:frames.length}));
      assert.deepEqual(after,before,'hover cannot rebuild the scroll range or jump the reading position');
      assert(frames.every(f=>JSON.stringify(f.geometry)===JSON.stringify(before)),'row geometry stays fixed throughout opening');
      assert(new Set(frames.map(f=>f.clip)).size>2,'hover reveals intermediate expansion frames');
      assert(frames.some(f=>f.opacity>0&&f.opacity<1),'labels fade continuously rather than pop in');
      const snapshot=await page.evaluate(()=>({renders:window.railTest.renders,scans:window.railTest.scans,serializations:window.railTest.serializations,updates:window.railTest.updates}));
      assert.deepEqual(snapshot,{renders:0,scans:0,serializations:0,updates:0},'hover has no editor work or writes');
      assert.equal(await rail.locator('.chapter-rail-label').first().evaluate(n=>getComputedStyle(n).opacity),'1');
      const bodyScroll=await page.locator('.document-scroll').evaluate(n=>n.scrollTop);
      const expanded=await rail.boundingBox();
      await page.mouse.move(expanded.x+expanded.width/2,expanded.y+expanded.height/2);
      await page.mouse.wheel(0,330);
      await page.waitForFunction(top=>document.querySelector('.chapter-rail-track').scrollTop>top,before.scrollTop);
      assert.equal(await page.locator('.document-scroll').evaluate(n=>n.scrollTop),bodyScroll,'outline wheel stays local');
      await page.mouse.wheel(0,10000);
      await page.waitForFunction(()=>{const n=document.querySelector('.chapter-rail-track');return n.scrollTop+n.clientHeight>=n.scrollHeight-1});
      await page.mouse.wheel(0,330);await settle(page);
      assert.equal(await page.locator('.document-scroll').evaluate(n=>n.scrollTop),bodyScroll,'wheel at the outline edge cannot scroll the note');
      const wheelTop=await track.evaluate(n=>n.scrollTop);
      await page.mouse.move(30,30);await settle(page);
      assert.equal(await track.evaluate(n=>n.scrollTop),wheelTop,'closing retains outline scroll');
      assert.equal(await rail.locator('.chapter-rail-label').first().evaluate(n=>getComputedStyle(n).opacity),'0');
      // Clipped, hidden part of the 222px layer must not block the note behind it.
      assert.equal(await page.evaluate(b=>document.elementFromPoint(b.x+10,b.y+30)?.closest('.chapter-rail')!==null,expanded),false);
      await page.mouse.move(box.x+box.width-14,box.y+box.height/2);await settle(page);
      assert.equal(await track.evaluate(n=>n.scrollTop),wheelTop);
      await page.screenshot({path:join(output,`expanded-${width}.png`)});
      // A real click should scroll the document smoothly and not save content.
      const target=rail.locator('button').nth(30);
      await target.scrollIntoViewIfNeeded();await target.click();
      const samples=await page.locator('.document-scroll').evaluate(async n=>{const a=[];for(let i=0;i<50;i++){await new Promise(r=>requestAnimationFrame(r));a.push(n.scrollTop)}return a});
      assert(new Set(samples).size>3,'heading jump has intermediate scroll positions');
      await page.waitForFunction(()=>{const e=window.railTest.editor,h=e.view.dom.querySelectorAll('h2,h3')[30],s=document.querySelector('.document-scroll');return Math.abs(h.getBoundingClientRect().top-s.getBoundingClientRect().top-24)<2},{},{timeout:3000});
      const aligned=await page.evaluate(()=>{const e=window.railTest.editor,heading=e.view.dom.querySelectorAll('h2,h3')[30],s=document.querySelector('.document-scroll');return heading.getBoundingClientRect().top-s.getBoundingClientRect().top});
      console.log(JSON.stringify({width,aligned,scrollSamples:samples.filter((_,i)=>i%8===0),lastScroll:samples.at(-1)}));
      assert(Math.abs(aligned-24)<2,'heading settles at the existing 24px inset');
      assert.equal(await page.evaluate(()=>window.railTest.updates),0,'navigation cannot change note content');
      await page.mouse.move(30,30);await settle(page);
      assert.equal(await rail.locator('.chapter-rail-label').first().evaluate(n=>getComputedStyle(n).opacity),'0','mouse click focus cannot pin hover open');
      // Keyboard focus still reveals the same labels, with a visible focus cue.
      await page.keyboard.press('Tab');
      await rail.locator('button').first().focus();await settle(page);
      assert.equal(await rail.locator('.chapter-rail-label').first().evaluate(n=>getComputedStyle(n).opacity),'1');
      assert((await rail.locator('.chapter-rail-label').first().evaluate(n=>getComputedStyle(n).textDecorationLine)).includes('underline'));
      await page.locator('.document-title').focus();await settle(page);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.mouse.move(box.x+box.width-14,box.y+box.height/2);await settle(page);
      assert(parseFloat(await rail.evaluate(n=>getComputedStyle(n).transitionDuration))<0.001,'reduced motion avoids expansion tween');
      await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await settle(page);
      const surface=await rail.evaluate(n=>getComputedStyle(n,'::before').backgroundColor);
      assert.notEqual(surface,'rgba(255, 255, 255, 0.96)','dark rail uses a dark surface');
      await page.emulateMedia({forcedColors:'active'});await settle(page);
      assert.notEqual(await rail.evaluate(n=>getComputedStyle(n,'::before').borderStyle),'none');
      reports.push({width,stableGeometry:true,frames:frames.length,hoverWork:snapshot,localWheel:true,clickScroll:true,keyboard:true,reducedMotion:true,dark:true,forcedColors:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    await context.close();
  }
  console.log(JSON.stringify({ok:true,productionComponent:true,networkBlocked:true,reports,output},null,2));
}finally{await browser.close()}
