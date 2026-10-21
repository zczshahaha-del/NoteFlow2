// Real note editor, toolbar, quick-edit panel and store; synthetic HTTP only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const path = name => fileURLToPath(new URL('../src/' + name, import.meta.url));
const original = '## 标题\n\n前面 原句。 后面。\n\n重复 原句。 结尾。\n\n保留 **粗体** 与 `代码`。';
const css = readdirSync(new URL('../dist/assets/', import.meta.url)).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL('../dist/assets/' + n, import.meta.url), 'utf8')).join('\n');
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import NoteEditor from ${JSON.stringify(path('components/NoteEditor.tsx'))};
import{useAppStore}from ${JSON.stringify(path('store/index.tsx'))};
const source=${JSON.stringify(original)};
const api=window.quickTest={store:useAppStore,editor:null,calls:[],next:'改好的句子。',hold:false,failure:false};
useAppStore.setState({treeData:[{id:'note',name:'合成笔记.md',type:'file',content:source,indexStatus:'indexed'},{id:'other',name:'其他笔记.md',type:'file',content:'别的正文',indexStatus:'indexed'}],selectedFileId:'note',fileContents:{note:source,other:'别的正文'},serverSyncReady:false,hydratedUserId:'quick-test'});
window.fetch=async(url,init={})=>{url=String(url);const body=init.body?JSON.parse(init.body):null;api.calls.push({url,body});
 if(url.endsWith('/outline'))return new Response('{"sections":[]}',{headers:{'Content-Type':'application/json'}});
 if(url.endsWith('/note-selection-rewrite')){const text=api.next;if(api.hold)await new Promise(resolve=>api.release=resolve);if(api.failure)return new Response('{"detail":"合成网络错误，请重试"}',{status:503,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({newContent:text}),{headers:{'Content-Type':'application/json'}});}
 throw Error('Unexpected API '+url);};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(NoteEditor)));`;
const result = await build({configFile:false,logLevel:'silent',plugins:[{name:'quick-edit-fixture',
 resolveId(id){if(id==='virtual:quick')return '\0quick'},
 load(id){if(id==='\0quick')return entry;if(id===path('components/NoteEditor.tsx'))return readFileSync(id,'utf8').replace('      extensions,','      extensions, onCreate: ({editor}) => { window.quickTest.editor=editor; },');}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:quick',output:{codeSplitting:false}}}});
const code=result.output.filter(n=>n.type==='chunk');assert.equal(code.length,1);
const html='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+' html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-selection-quick-')), reports=[];
try {
 for(const width of [1280,736,320]){
  const context=await browser.newContext({viewport:{width,height:850},hasTouch:width!==1280});
  const errors=[],unexpected=[];
  await context.route('**/*',r=>r.request().url()==='http://noteflow.test/'?r.fulfill({contentType:'text/html',body:html}):r.request().url()==='http://noteflow.test/bundle.js'?r.fulfill({contentType:'text/javascript',body:code[0].code}):(unexpected.push(r.request().url()),r.abort()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.goto('http://noteflow.test/');
  try { await page.waitForFunction(()=>window.quickTest?.editor&&!window.quickTest.editor.isDestroyed); }
  catch(error) { console.error(JSON.stringify({errors,unexpected,body:await page.locator('body').innerText()})); throw error; }
  const markdown=()=>page.evaluate(()=>window.quickTest.editor.getMarkdown());
  const baseline=await markdown();
  const choose=async(text='原句。',last=false)=>{
   await page.evaluate(({text,last})=>{const e=window.quickTest.editor,ranges=[];e.state.doc.descendants((n,p)=>{if(n.isText){let i=n.text.indexOf(text);while(i>=0){ranges.push({from:p+i,to:p+i+text.length});i=n.text.indexOf(text,i+text.length)}}});if(!ranges.length)throw Error('Fixture selection not found');e.chain().focus().setTextSelection(last?ranges.at(-1):ranges[0]).run();},{text,last});
   await page.getByRole('button',{name:'AI 改一下',exact:true}).click();
   await page.getByRole('dialog',{name:'AI 改一下',exact:true}).waitFor();
  };
  const panel=page.getByRole('dialog',{name:'AI 改一下',exact:true});
  const input=panel.getByRole('textbox',{name:'快捷修改意见'});
  await choose('原句。',true);
  await page.getByRole('button',{name:'AI 改一下',exact:true}).waitFor({state:'hidden'});
  assert.equal(await input.inputValue(),'');
  await input.fill('更通俗一点');
  const beforeComposition=await page.evaluate(()=>window.quickTest.calls.length);
  await input.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
  assert.equal(await page.evaluate(()=>window.quickTest.calls.length),beforeComposition,'IME composition must not submit');
  await input.fill('');
  await panel.getByRole('button',{name:'直接润色',exact:true}).click();
  try { await panel.getByRole('button',{name:'采用',exact:true}).waitFor(); }
  catch(error) { console.error(JSON.stringify({width,errors,panel:await panel.innerText(),calls:await page.evaluate(()=>window.quickTest.calls)})); throw error; }
  assert.equal(await markdown(),baseline,'Generation must not modify the note');
  const sent=await page.evaluate(()=>window.quickTest.calls.filter(c=>c.url.endsWith('/note-selection-rewrite')).at(-1).body);
  assert.equal(sent.selectedMarkdown.trim(),'原句。');assert.equal(sent.instruction,'');assert(!('currentDraft' in sent));
  await input.fill('更通俗一点');await page.evaluate(()=>window.quickTest.next='更通俗的句子。');
  await input.press('ControlOrMeta+Enter');
  await panel.getByRole('region',{name:'选区修改结果'}).getByText('更通俗的句子。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.quickTest.calls.at(-1).body.currentDraft),'改好的句子。');
  const geometry=await panel.boundingBox();assert(geometry.x>=0&&geometry.x+geometry.width<=width+1&&geometry.y>=0&&geometry.y+geometry.height<=850);
  await page.screenshot({path:join(output,'result-'+width+'.png')});
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).borderTopColor),'rgb(58, 66, 77)','Dark panel uses the shared dark border');
  await page.screenshot({path:join(output,'dark-'+width+'.png')});
  await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
  await panel.getByRole('button',{name:'采用',exact:true}).click();await panel.waitFor({state:'detached'});
  assert.equal(await markdown(),baseline.replace('重复 原句。','重复 更通俗的句子。'),'Duplicate text uses captured editor position, never first occurrence');
  assert.equal(await page.evaluate(()=>window.quickTest.store.getState().centerMode),'note');
  assert.equal(await page.evaluate(()=>window.quickTest.store.getState().fileContents.note),await markdown(),'Normal note update pipeline receives adoption');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline,'One native undo restores the entire adoption');

  await choose('标题');await input.fill('换一个标题');await page.evaluate(()=>window.quickTest.next='新标题');
  await panel.getByRole('button',{name:'开始修改',exact:true}).click();await panel.getByRole('button',{name:'采用',exact:true}).click();
  assert.equal(await markdown(),baseline.replace('标题','新标题'),'Title remains a heading, surrounding content retained');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline);

  await choose();await page.evaluate(()=>window.quickTest.next='');
  await panel.getByRole('button',{name:'直接润色',exact:true}).click();
  await panel.getByText('采用后将删除选中文字。',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'采用',exact:true}).click();
  assert.equal(await markdown(),baseline.replace('原句。',''),'Empty result deletes only the selected text');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline);

  await choose('粗体');await page.evaluate(()=>window.quickTest.next='**更清晰**');
  await panel.getByRole('button',{name:'直接润色',exact:true}).click();await panel.getByRole('button',{name:'采用',exact:true}).click();
  assert.equal(await markdown(),baseline.replace('**粗体**','**更清晰**'),'Rich marks and unselected inline code are preserved');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline);

  await page.evaluate(()=>{const e=window.quickTest.editor,r=[];e.state.doc.descendants((n,p)=>{if(n.isText&&n.text.includes('原句。'))r.push({from:p+n.text.indexOf('原句。'),to:p+n.text.indexOf('原句。')+'原句。'.length})});e.chain().focus().setTextSelection({from:r[0].from,to:r[1].to}).run();});
  await page.getByRole('button',{name:'AI 改一下',exact:true}).click();
  await page.evaluate(()=>window.quickTest.next='新的第一段。\n\n新的第二段。');
  await panel.getByRole('button',{name:'直接润色',exact:true}).click();await panel.getByRole('button',{name:'采用',exact:true}).click();
  assert.equal(await markdown(),baseline.replace('原句。 后面。\n\n重复 原句。','新的第一段。\n\n新的第二段。'),'Multi-paragraph replacement retains unselected prefixes and suffixes');
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline);

  await choose();await page.evaluate(()=>window.quickTest.failure=true);await panel.getByRole('button',{name:'直接润色',exact:true}).click();
  await panel.getByRole('alert').getByText('合成网络错误，请重试').waitFor();assert.equal(await markdown(),baseline);
  await page.evaluate(()=>window.quickTest.failure=false);await panel.getByRole('button',{name:'直接润色',exact:true}).click();await panel.getByRole('button',{name:'采用',exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await markdown(),baseline);

  await choose();await page.evaluate(()=>{window.quickTest.hold=true;window.quickTest.next='迟到结果'});
  await panel.getByRole('button',{name:'直接润色',exact:true}).click();await page.waitForFunction(()=>typeof window.quickTest.release==='function');
  await panel.getByRole('button',{name:'取消',exact:true}).click();await page.evaluate(()=>{window.quickTest.hold=false;window.quickTest.release()});
  await panel.waitFor({state:'detached'});assert.equal(await markdown(),baseline);

  await choose();await page.evaluate(()=>window.quickTest.editor.commands.insertContentAt(1,'正文变化'));
  await panel.getByRole('alert').getByText('正文已变化，请重新选中文字。当前结果未应用。').waitFor();
  assert.equal(await panel.getByRole('button',{name:'直接润色',exact:true}).isEnabled(),false);
  await panel.getByRole('button',{name:'取消',exact:true}).press('Escape');await panel.waitFor({state:'detached'});
  await page.getByTestId('tiptap-editor-content').press('ControlOrMeta+z');assert.equal(await markdown(),baseline);

  await choose();await page.evaluate(()=>window.quickTest.store.getState().setSelectedFileId('other'));
  await panel.waitFor({state:'detached'});await page.waitForFunction(()=>window.quickTest.editor&&!window.quickTest.editor.isDestroyed&&window.quickTest.editor.getText()==='别的正文');
  await page.evaluate(()=>window.quickTest.store.getState().setSelectedFileId('note'));
  await page.waitForFunction(()=>window.quickTest.editor&&!window.quickTest.editor.isDestroyed&&window.quickTest.editor.getText().includes('原句。'));
  await choose();await input.press('Escape');await panel.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  reports.push({width,lockedSelection:true,duplicatePosition:true,customInstruction:true,continueCurrentDraft:true,headingPreserved:true,richMarks:true,multiParagraph:true,emptyDeletion:true,compositionGuard:true,nativeUndo:true,cancelLateResult:true,staleBlocked:true,errorRetry:true,noteSwitch:true,geometry,errors,unexpected});
  await context.close();
 }
 console.log(JSON.stringify({ok:true,syntheticOnly:true,output,reports},null,2));
}finally{await browser.close()}
