// Benchmark the real NoteEditor with synthetic notes and all network blocked.
// Instrumentation is injected only into this offline bundle, never production.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/NoteEditor.tsx', import.meta.url));
const baselineRef = process.env.NOTEFLOW_PERF_BASE_REF;
assert.equal(Boolean(baselineRef),process.env.NOTEFLOW_PERF_BASELINE === '1','Baseline mode requires an explicit committed source ref; normal regression uses the working tree');
const componentSource = baselineRef
  ? execFileSync('git',['show',`${baselineRef}:src/components/NoteEditor.tsx`],{encoding:'utf8',cwd:fileURLToPath(new URL('../',import.meta.url))})
  : readFileSync(component,'utf8');
const extensionSource = baselineRef
  ? execFileSync('git',['show',`${baselineRef}:src/editor/tiptapExtensions.ts`],{encoding:'utf8',cwd:fileURLToPath(new URL('../',import.meta.url))})
  : null;
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(name => /^(index-|NoteEditor-).*\.css$/.test(name)).map(name => readFileSync(new URL(name, assets), 'utf8')).join('\n');
assert(css, 'Build production CSS first');
const output = mkdtempSync(join(tmpdir(), 'noteflow-editor-perf-'));
const markdown = Array.from({ length: 80 }, (_, index) => [
  '## 章节 ' + index, '', '正文阅读测试，保留 **加粗文字**、`行内代码`。'.repeat(8), '',
  ...(index % 4 === 0 ? ['```go', 'var users []User', 'db.Preload("Posts").Find(&users)'.repeat(8), '```', ''] : []),
]).flat().concat(['尾段性能测试。'.repeat(30)]).join('\n');
const entry = `import React,{StrictMode} from 'react';import{createRoot}from'react-dom/client';import NoteEditor from ${JSON.stringify(component)};
const stats=()=>({renders:0,headingScans:0,outlinePasses:0,headingDomPasses:0,serializations:0,serializeMs:0,highlightParses:0,updates:0});
const root=createRoot(document.getElementById('root'));
const api={stats:stats(),statsFactory:stats,editor:null,updates:[],copied:[],render(){root.render(React.createElement(StrictMode,null,React.createElement(NoteEditor)))}};
const slice={selectedFileId:'perf-note',treeData:[{id:'perf-note',name:'性能验证.md',type:'file',indexStatus:'indexed'}],fileContents:{'perf-note':${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
updateFileContent(id,content){api.stats.updates++;api.updates.push({id,content});slice.fileContents[id]=content;api.render()},updateNodeName(){throw new Error('Unexpected rename')},reindexNote(){throw new Error('Unexpected reindex')},addSelectionToChat(){},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};
window.editorPerf=api;window.proseTest={api,slice};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>api.copied.push(text)}});api.render();`;
const result = await build({ configFile: false, logLevel: 'silent', plugins: [{
  name: 'offline-editor-performance', enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'virtual:editor-perf') return '\0editor-perf';
    if (id === '../store/selectors' && (importer === component || importer?.endsWith('/VersionHistoryPanel.tsx'))) return '\0perf-store';
    if (id === '../services/notes' && (importer === component || importer?.endsWith('/VersionHistoryPanel.tsx'))) return '\0perf-notes';
    if (id === '../services/attachments' && importer === component) return '\0perf-attachments';
  },
  load(id) {
    if (id === '\0editor-perf') return entry;
    if (id === '\0perf-store') return 'export const useEditorSlice=()=>window.proseTest.slice;';
    if (id === '\0perf-notes') return 'export const getNoteOutline=async()=>({sections:[]});export const listNoteVersions=async()=>[];';
    if (id === '\0perf-attachments') return 'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw new Error("Unexpected upload")};';
    if (id === component) return componentSource
      .replace(componentSource.includes('function NoteEditorDocument(')
        ? '  const [titleDraft, setTitleDraft]'
        : 'export default function NoteEditor() {',
        componentSource.includes('function NoteEditorDocument(')
          ? '  window.editorPerf.stats.renders++; const [titleDraft, setTitleDraft]'
          : 'export default function NoteEditor() { window.editorPerf.stats.renders++;')
      .replace('editor.state.doc.descendants((node, position) => {', 'window.editorPerf.stats.headingScans++; editor.state.doc.descendants((node, position) => {')
      .replace('const headingElements = Array.from(', 'window.editorPerf.stats.headingDomPasses++; const headingElements = Array.from(')
      .replace('      extensions,', `      extensions,
      onCreate: ({editor}) => { window.editorPerf.editor=editor; const original=editor.getMarkdown.bind(editor); editor.getMarkdown=()=>{ const start=performance.now();window.editorPerf.stats.serializations++;try{return original()}finally{window.editorPerf.stats.serializeMs+=performance.now()-start} }; },`);
    if (id.endsWith('/headingNumbering.ts')) return readFileSync(id, 'utf8').replace('  if (headings.length === 0)', '  window.editorPerf.stats.outlinePasses++; if (headings.length === 0)');
    if (id.endsWith('/tiptapExtensions.ts') && extensionSource) return extensionSource;
    if (id.endsWith('/documentCache.ts')) return readFileSync(id,'utf8').replace('  doc.descendants((node, position) => {','  window.editorPerf.stats.headingScans++; doc.descendants((node, position) => {');
    if (id.endsWith('/headingDecorations.ts')) return readFileSync(id,'utf8').replace('  const decorations = DecorationSet.create(', '  window.editorPerf.stats.headingDomPasses++; const decorations = DecorationSet.create(');
    if (id.endsWith('/codeHighlight.ts')) return readFileSync(id, 'utf8').replace('  const requested = normalizeCodeLanguage(storedLanguage);', '  window.editorPerf.stats.highlightParses++; const requested = normalizeCodeLanguage(storedLanguage);');
  },
}], build: { write: false, minify: false, rolldownOptions: { input: 'virtual:editor-perf', output: { codeSplitting: false } } } });
const chunks = result.output.filter(item => item.type === 'chunk');
assert.equal(chunks.length, 1);
const source = chunks[0].code.replaceAll('</script', '<\\/script');
const browser = await chromium.launch({ executablePath: process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined, headless: true });
const reports = [];
async function settled(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
}
async function phase(page, action) {
  await settled(page);
  await page.evaluate(() => { window.editorPerf.stats = window.editorPerf.statsFactory(); });
  const start = performance.now();
  await action();
  await settled(page);
  return { ...await page.evaluate(() => window.editorPerf.stats), wallMs: Math.round(performance.now() - start) };
}
try {
  for (const width of [1280, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 320 });
    const errors = [], requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root" style="display:flex;height:100%"></div><script type="module">'+source+'</script></body></html>');
    const editor = page.locator('.tiptap.note-content');
    await editor.waitFor();await page.waitForFunction(() => window.editorPerf.editor && document.querySelectorAll('.note-content h2').length === 80);
    await page.evaluate(() => { window.editorPerf.editor.commands.focus('end'); });
    await settled(page);
    const original = await editor.textContent();
    const selection = await phase(page, async () => { for (let i=0;i<40;i++) await page.keyboard.press('ArrowLeft'); });
    assert.equal(selection.updates, 0);assert.equal(selection.serializations, 0);assert.equal(selection.highlightParses, 0);
    assert.equal(await editor.textContent(), original);
    const headerFocus = await phase(page, async () => {
      const title=page.getByRole('textbox',{name:'文档标题',exact:true});
      for(let i=0;i<5;i++) {
        await title.focus();await title.press('Escape');
      }
    });
    assert.equal(headerFocus.updates,0);assert.equal(headerFocus.highlightParses,0);
    await page.evaluate(() => { window.editorPerf.editor.commands.focus('end'); });
    const typing = await phase(page, async () => { await page.keyboard.type('performance-check'); });
    assert.equal(typing.updates, 'performance-check'.length, 'Keep immediate per-input save updates');
    assert.equal(typing.highlightParses, 0, 'Editing a paragraph cannot reparse unchanged code');
    assert((await editor.textContent()).endsWith('performance-check'));
    assert((await page.evaluate(() => window.proseTest.slice.fileContents['perf-note'])).endsWith('performance-check'));
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)),true);
    console.log(JSON.stringify({width,selection,headerFocus,typing}));
    // Selection formatting must stay reactive when the whole editor stops
    // rerendering on every caret move. These affect synthetic data only.
    await page.evaluate(() => { const e=window.editorPerf.editor;e.commands.setTextSelection({from:e.state.doc.content.size-18,to:e.state.doc.content.size-1}); });
    const bold=page.getByRole('button',{name:'加粗',exact:true});await bold.waitFor({state:'visible'});
    await bold.click();await page.waitForFunction(() => document.querySelector('.selection-toolbar-button[aria-label="加粗"]')?.classList.contains('is-active'));
    assert.match(await page.evaluate(() => window.proseTest.slice.fileContents['perf-note']), /\*\*performance-check\*\*/);
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.querySelector('.selection-toolbar-button[aria-label="加粗"]')?.classList.contains('is-active'));
    if(width===1280) {
      await page.evaluate(() => {
        const e=window.editorPerf.editor,positions=[];
        e.state.doc.descendants((node,pos)=>{if(node.type.name==='heading')positions.push(pos);});
        e.commands.setTextSelection(positions[1]+1);
      });
      await page.waitForFunction(() => document.querySelector('.chapter-rail-item.is-active')?.textContent.includes('章节 1'));
    }
    // Creating a heading must not synthesize an invisible/generated number.
    await page.waitForFunction(() => document.querySelector('.note-content').classList.contains('ProseMirror'));
    await page.evaluate(() => { const e=window.editorPerf.editor;e.commands.setTextSelection(e.state.doc.content.size-1);e.commands.toggleHeading({level:2}); });
    await settled(page);
    await page.waitForFunction(() => document.querySelectorAll('.note-content h2').length === 81);
    if(process.env.NOTEFLOW_PERF_BASELINE !== '1') await page.waitForFunction(() => [...document.querySelectorAll('.note-content h2')].at(-1)?.dataset.headingNumber === undefined);
    const noPhantomNumbering=await page.evaluate(() => [...document.querySelectorAll('.note-content h2')].at(-1)?.dataset.headingNumber === undefined);
    await page.evaluate(() => {
      const e=window.editorPerf.editor;let position=0;
      e.state.doc.descendants((node,pos) => {if(node.type.name==='heading') position=pos;});
      e.chain().setTextSelection(position+1).setParagraph().run();
    });
    await page.waitForFunction(() => document.querySelectorAll('.note-content h2').length === 80);
    // Nonlocal replacement and switching notes must not be mistaken for an
    // already-published edit by Markdown caches.
    await page.evaluate(() => { window.proseTest.slice.fileContents['perf-note']='## 外部替换\n\n外部内容';window.proseTest.api.render(); });
    await page.waitForFunction(() => document.querySelector('.note-content').textContent === '外部替换外部内容');
    assert.equal(await page.evaluate(() => window.editorPerf.editor.getMarkdown().includes('外部内容')),true);
    await page.evaluate(() => {
      const slice=window.proseTest.slice;
      slice.treeData.push({id:'perf-note-2',name:'第二篇.md',type:'file',indexStatus:'indexed'});
      slice.fileContents['perf-note-2']='## 第二篇\n\n切换内容\n\n```\ndef example():\n    return True\n```';
      slice.selectedFileId='perf-note-2';window.proseTest.api.render();
    });
    await page.waitForFunction(() => document.querySelector('.note-content')?.textContent.includes('切换内容') && !window.editorPerf.editor.isDestroyed);
    await page.waitForFunction(() => document.querySelector('.code-block')?.dataset.language === 'python');
    assert.equal(await page.evaluate(() => window.editorPerf.editor.getMarkdown().includes('第二篇')),true);
    await page.evaluate(() => {window.proseTest.slice.selectedFileId='perf-note';window.proseTest.api.render();});
    await page.waitForFunction(() => document.querySelector('.note-content')?.textContent === '外部替换外部内容' && !window.editorPerf.editor.isDestroyed);
    assert.equal(await page.evaluate(() => window.proseTest.slice.fileContents['perf-note-2'].includes('切换内容')),true);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    if(process.env.NOTEFLOW_PERF_BASELINE !== '1') {
      assert.equal(selection.renders,0,'Caret moves inside one section should not rerender NoteEditor');
      assert.equal(selection.headingScans,0);assert.equal(selection.outlinePasses,0);assert.equal(selection.headingDomPasses,0);
      assert.equal(headerFocus.headingScans,0);assert.equal(headerFocus.outlinePasses,0);assert.equal(headerFocus.headingDomPasses,0);assert.equal(headerFocus.serializations,0);
      assert.equal(typing.serializations,typing.updates,'Serialize each new document once, not again after save');
      assert.equal(typing.headingScans,typing.updates,'Scan headings once per changed document');
      assert.equal(typing.headingDomPasses,0,'No generated-number decorations to rebuild');
    }
    reports.push({width,sourceCharacters:markdown.length,headings:80,codeBlocks:20,selection,headerFocus,typing,formattingUndo:true,noPhantomNumbering,externalContent:true,noteSwitch:true,errors,requests});
    await context.close();
  }
  writeFileSync(join(output,'results.json'),JSON.stringify(reports,null,2));
  console.log(JSON.stringify({ok:true,baseline:process.env.NOTEFLOW_PERF_BASELINE==='1',output,reports},null,2));
} finally { await browser.close(); }
