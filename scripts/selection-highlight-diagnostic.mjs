// Regression: production NoteEditor + CSS, synthetic note, all network blocked.
// No changes to user notes, session, or system clipboard.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const component=fileURLToPath(new URL('../src/components/NoteEditor.tsx',import.meta.url));
const assets=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assets).filter(n=>/^(index-|NoteEditor-).*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
assert(css,'Build production CSS first');
const markdown='# 合成笔记\n\n正文用于独立检查。\n\n前缀文字选中高亮测试后缀文字不应该移动。\n\n'+Array.from({length:30},()=> '这是用于保证滚动容器真实存在的合成段落。\n\n').join('');
const entry=`import React from'react';import{createRoot}from'react-dom/client';import NoteEditor from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));const api={editor:null,updates:[],render(){root.render(React.createElement(NoteEditor))}};
const slice={selectedFileId:'synthetic',treeData:[{id:'synthetic',name:'合成笔记.md',type:'file',indexStatus:'indexed'}],fileContents:{synthetic:${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,updateFileContent(id,text){api.updates.push(text);slice.fileContents[id]=text;api.render()},updateNodeName(){throw Error('Unexpected rename')},reindexNote(){throw Error('Unexpected reindex')},addSelectionToChat(){throw Error('Unexpected chat')},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};window.toolbarTest={api,slice};api.render();`;
const bundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'offline-highlight-diagnostic',enforce:'pre',
  resolveId(id,importer){if(id==='virtual:diagnostic')return'\0diagnostic';if(id==='../store/selectors'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return'\0store';if(id==='../services/notes'&&(importer===component||importer?.endsWith('/VersionHistoryPanel.tsx')))return'\0notes';if(id==='../services/attachments'&&importer===component)return'\0attachments';},
  load(id){if(id==='\0diagnostic')return entry;if(id==='\0store')return'export const useEditorSlice=()=>window.toolbarTest.slice;';if(id==='\0notes')return'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';if(id==='\0attachments')return'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw Error("Unexpected upload")};';if(id===component){const s=readFileSync(id,'utf8');assert(s.includes('      extensions,'));return s.replace('      extensions,','      extensions, onCreate: ({editor}) => {window.toolbarTest.api.editor=editor;},');}}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:diagnostic',output:{codeSplitting:false}}}});
const chunks=bundle.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const source=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
async function snapshot(page){return page.evaluate(()=>{
  const p=Array.from(document.querySelectorAll('.note-content p')).find(p=>p.textContent.startsWith('前缀文字'));
  const glyphs=[];const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;
  while(n=walker.nextNode())for(let i=0;i<n.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect();glyphs.push({text:n.data[i],x:b.x,y:b.y,width:b.width});}
  const rect=n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};};
  const scroll=document.querySelector('.document-scroll'),mark=p.querySelector('mark'),style=mark&&getComputedStyle(mark);
  return{glyphs,paragraph:rect(p),body:rect(document.querySelector('.note-content')),scroll:{left:scroll.scrollLeft,top:scroll.scrollTop,client:scroll.clientWidth,width:scroll.scrollWidth},selection:getSelection().toString(),updates:window.toolbarTest.api.updates.length,mark:mark?{paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,fontWeight:style.fontWeight}:null};
});}
function shifts(before,after){assert.equal(before.glyphs.length,after.glyphs.length);return before.glyphs.map((a,i)=>({text:a.text,dx:after.glyphs[i].x-a.x,dy:after.glyphs[i].y-a.y}));}
function maximumShift(values){return Math.max(...values.flatMap(a=>[Math.abs(a.dx),Math.abs(a.dy)]));}
try{
  for(const width of [1280,736,320]){
    const context=await browser.newContext({viewport:{width,height:900}}),requests=[],errors=[];
    await context.route('**/*',r=>{requests.push(r.request().url());return r.abort();});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100vh"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>document.querySelector('.note-entry')?.dataset.ready==='true');await page.waitForTimeout(250);
    const before=await snapshot(page),a=before.glyphs[4],b=before.glyphs[10];
    // Sample the whole drag and menu delay, not just the final settled frame.
    await page.evaluate(()=>{
      const p=Array.from(document.querySelectorAll('.note-content p')).find(p=>p.textContent.startsWith('前缀文字'));
      window.selectionFrames=[];window.selectionSampling=true;
      const sample=()=>{const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),glyphs=[];let n;
        while(n=walker.nextNode())for(let i=0;i<n.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect();glyphs.push({text:n.data[i],x:b.x,y:b.y,width:b.width});}
        window.selectionFrames.push({glyphs});if(window.selectionSampling)requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
    // Native mouse selection, including the actual BubbleMenu appearing.
    await page.mouse.move(a.x+1,a.y+8);await page.mouse.down();await page.mouse.move(b.x+1,b.y+8,{steps:12});await page.mouse.up();
    await page.locator('.tiptap-selection-toolbar').waitFor({state:'visible'});await page.waitForTimeout(350);
    const selected=await snapshot(page);assert.equal(selected.selection,'选中高亮测试');assert.equal(selected.updates,0);
    const nativeShifts=shifts(before,selected);
    const frames=await page.evaluate(()=>{window.selectionSampling=false;return window.selectionFrames;});
    const nativeMaximumFrameShift=Math.max(...frames.map(frame=>maximumShift(shifts(before,frame))));
    await page.getByRole('button',{name:'高亮',exact:true}).click();await page.waitForTimeout(200);
    const marked=await snapshot(page);assert(marked.mark);const markShifts=shifts(selected,marked);
    await page.keyboard.press('ControlOrMeta+z');await page.waitForTimeout(200);const undone=await snapshot(page);assert.equal(undone.mark,null);
    assert.equal(marked.mark.paddingLeft,'0px');
    assert.equal(marked.mark.paddingRight,'0px');
    assert.equal(maximumShift(markShifts),0,'Production highlight must not reflow any glyph');
    // Reapply after undo: the original product style, not a fixture CSS override.
    await page.getByRole('button',{name:'高亮',exact:true}).click();await page.waitForTimeout(200);const noPadding=await snapshot(page);
    const zeroPaddingShifts=shifts(undone,noPadding);
    assert.equal(noPadding.mark.paddingLeft,'0px');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    assert.equal(maximumShift(zeroPaddingShifts),0,'Repeated highlighting must remain stable');
    assert.equal(maximumShift(shifts(selected,undone)),0,'Undo should restore original glyph positions');
    // Mixed bold/link/inline-code marks, wrapping, serializing and reopening use the same rule.
    await page.evaluate(()=>{const {slice,api}=window.toolbarTest;slice.fileContents.synthetic='# 合成笔记\n\n前缀文字**选中**[高亮](https://example.invalid)测试后缀文字`代码`不应该移动。';api.render();});
    await page.waitForFunction(()=>document.querySelector('.note-content p strong') && document.querySelector('.note-content p a'));
    const mixedBefore=await snapshot(page);
    await page.evaluate(()=>{const e=window.toolbarTest.api.editor;let range;e.state.doc.descendants((n,p)=>{if(n.type.name==='paragraph'&&n.textContent.startsWith('前缀文字'))range={from:p+1,to:p+1+n.content.size};});e.chain().focus().setTextSelection(range).toggleHighlight().run();});
    const mixedAfter=await snapshot(page);assert.equal(maximumShift(shifts(mixedBefore,mixedAfter)),0);
    await page.evaluate(()=>{const {slice,api}=window.toolbarTest;const saved=api.editor.getMarkdown();if(!saved.includes('<mark>'))throw Error('Highlight missing from saved Markdown');slice.fileContents.synthetic=saved;slice.treeData.push({id:'other',name:'另一篇.md',type:'file'});slice.fileContents.other='另一个合成正文';slice.selectedFileId='other';api.render();});
    await page.waitForFunction(()=>document.querySelector('.note-entry')?.dataset.ready==='true'&&document.querySelector('.note-content')?.textContent==='另一个合成正文');
    await page.evaluate(()=>{window.toolbarTest.slice.selectedFileId='synthetic';window.toolbarTest.api.render();});
    await page.waitForFunction(()=>document.querySelector('.note-entry')?.dataset.ready==='true'&&document.querySelector('.note-content mark'));
    await page.waitForTimeout(250);assert.equal(maximumShift(shifts(mixedBefore,await snapshot(page))),0);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    assert.equal(maximumShift(shifts(mixedBefore,await snapshot(page))),0);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    reports.push({width,selection:selected.selection,nativeMaximumSettledShift:maximumShift(nativeShifts),nativeMaximumFrameShift,sampledFrames:frames.length,markPadding:marked.mark,markedFirstGlyph:markShifts[4],markedFollowingGlyph:markShifts[10],zeroPaddingMaximumShift:maximumShift(zeroPaddingShifts),paragraphUnchanged:JSON.stringify(selected.paragraph)===JSON.stringify(marked.paragraph),undoRestoresPositions:true,mixedFormatSavedReopenAndDark:true,requests,errors});await context.close();
  }
  console.log(JSON.stringify({scope:'highlight-geometry-regression',syntheticOnly:true,actualComponent:true,reports},null,2));
}finally{await browser.close();}
