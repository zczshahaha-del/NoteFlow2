// Actual NoteEditor/Tiptap and built CSS, with synthetic state/services only.
// No original app session, note data, clipboard or network is accessed.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';

const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/NoteEditor.tsx', import.meta.url));
const previewComponent = fileURLToPath(new URL('../src/components/EditablePreviewBody.tsx', import.meta.url));
const markdownRenderer = fileURLToPath(new URL('../src/utils/chatMarkdown.ts', import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const cssFile = readdirSync(assets).find(name => /^index-.*\.css$/.test(name));
const proseCssFile = readdirSync(assets).find(name => /^NoteEditor-.*\.css$/.test(name));
assert(cssFile, 'Run npm run build first');
assert(proseCssFile, 'The lazy NoteEditor CSS chunk must be included');
const css = readFileSync(new URL(cssFile, assets), 'utf8') + '\n' + readFileSync(new URL(proseCssFile, assets), 'utf8');
const output = mkdtempSync(join(tmpdir(), 'noteflow-prose-ui-'));
const markdown = [
  '# GORM 学习笔记', '',
  '这是用于隔离检查的正文，保留 **重点**、`gorm.DeletedAt` 与 <mark>高亮内容</mark>。', '',
  '阅读节奏检查：这一段刻意保留较长的中文说明，用于检查换行之后能否轻松找到下一行，而不是只用短句标本判断长篇笔记的阅读感受。正文内容必须保持原样，不能靠删除文字让页面看起来清爽。', '',
  '段落分隔检查：这是另一个独立想法，应该与上文有可见的停顿。段落空隙、行距和章节留白承担不同职责，不应把所有内容压成同一种密度。', '',
  '1. **第一个要点：** 多行列表项也需要呼吸空间。这段补充说明有足够长度，在窄屏和桌面上都能检查列表换行与下一条之间的间隔。',
  '2. **第二个要点：** 这不是上一条的延续，序号和原文都是实际文档内容，显示样式不应该修改它们。', '',
  '## 删除（Delete）', '', '```go',
  'db.Delete(&u, 1) // 删 id=1',
  'db.Where("age < ?", 10).Delete(&User{}) // 按条件删', '```', '',
  '软删除：模型里加 `gorm.DeletedAt` 字段，只是把 `deleted_at` 写上时间。', '',
  '---', '', '## 预加载（Preload）', '', '```go',
  'var users []User', 'db.Preload("Posts").Find(&users)',
  '// 等于先查 users，再一次性把所有 Posts 都查出来填进去', '```', '',
  '> 普通引用保持细竖线，不添加图标或提示语。', '',
  '> **人话：** 没有 Preload，要重复查询；有了 Preload，只查 2 次。', '',
  '> ⚠️ **注意：** struct 更新会忽略零值。', '',
  '### 宽内容与编辑', '', '```go',
  'const longValue = "' + '保留代码行结构'.repeat(40) + '"', '```', '',
  '| 名称 | 类型 | 说明 |', '| --- | --- | --- |', '| 用户 | User | 合成表格 |', '',
  '用于编辑验证的一行正文。',
].join('\n');
const entry = `import React, {StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
import NoteEditor from ${JSON.stringify(component)};
import EditablePreviewBody from ${JSON.stringify(previewComponent)};
import {renderChatMarkdown,handleRenderedCodeBlockAction} from ${JSON.stringify(markdownRenderer)};
const root=createRoot(document.getElementById('root'));
const originalContent=${JSON.stringify(markdown)};
const api={updates:[],copied:[],previewUpdates:[],surface:'note',render(){
  let surface=React.createElement(NoteEditor);
  if(api.surface==='preview')surface=React.createElement('div',{className:'edit-preview-workspace document-canvas nf-prose-refined',style:{width:'100%',padding:'20px'}},React.createElement('div',{className:'nf-edit-frame'},React.createElement(EditablePreviewBody,{previewId:'synthetic-parity',content:originalContent,oldContent:originalContent,documentTitle:'GORM 学习笔记',showComparison:false,disabled:false,onChange:c=>api.previewUpdates.push(c),onBlur:()=>{}})));
  if(api.surface==='rendered')surface=React.createElement('div',{className:'nf-draft-workspace',style:{width:'100%',overflow:'auto',height:'100%'}},React.createElement('div',{className:'nf-draft-reading'},React.createElement('div',{className:'note-content nf-reading-prose draft-note-content',onClick:e=>void handleRenderedCodeBlockAction(e.target,e.currentTarget),dangerouslySetInnerHTML:{__html:renderChatMarkdown(originalContent,0,{scrollTables:true})}})));
  root.render(React.createElement(StrictMode,null,surface));
}};
const slice={selectedFileId:'synthetic-prose',treeData:[{id:'synthetic-prose',name:'GORM 学习笔记.md',type:'file',indexStatus:'indexed',createdAt:'2026-07-22T15:50:00+08:00',updatedAt:'2026-08-18T09:14:00+08:00'}],fileContents:{'synthetic-prose':${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
updateFileContent(id,content){api.updates.push({id,content});slice.fileContents[id]=content;api.render()},updateNodeName(){throw new Error('Unexpected rename')},reindexNote(){throw new Error('Unexpected reindex')},addSelectionToChat(){throw new Error('Unexpected chat')},clearPendingEditorSelection(){},clearPendingSourceFocus(){},setActiveEditorSectionId(){}};
window.proseTest={api,slice}; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>api.copied.push(text)}});
api.render();`;
const bundled = await build({ configFile: false, logLevel: 'silent', plugins: [{
  name: 'offline-prose-component', enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'virtual:offline-prose') return '\0offline-prose';
    if (id === '../store/selectors' && (importer === component || importer?.endsWith('/VersionHistoryPanel.tsx'))) return '\0prose-store';
    if (id === '../services/notes' && (importer === component || importer?.endsWith('/VersionHistoryPanel.tsx'))) return '\0prose-notes';
    if (id === '../services/attachments' && importer === component) return '\0prose-attachments';
  },
  load(id) {
    if (id === '\0offline-prose') return entry;
    if (id === '\0prose-store') return 'export const useEditorSlice=()=>window.proseTest.slice;';
    if (id === '\0prose-notes') return 'export const getNoteOutline=async()=>({sections:[]}); export const listNoteVersions=async()=>[];';
    if (id === '\0prose-attachments') return 'export const attachmentMarkdown=()=>"";export const uploadAttachment=()=>{throw new Error("Unexpected upload")};';
  },
}], build: { write: false, minify: false, rolldownOptions: { input: 'virtual:offline-prose', output: { codeSplitting: false } } } });
const chunks = bundled.output.filter(item => item.type === 'chunk');
assert.equal(chunks.length, 1);
const source = chunks[0].code.replaceAll('</script', '<\\/script');
const browser = await chromium.launch({ executablePath: process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined, headless: true });
const reports = [];

async function settleStyles(editor) {
  await editor.evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Existing global transitions still apply; measure their final frame instead
    // of disabling product motion or comparing an in-between geometry.
    await Promise.all(el.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function metrics(page) {
  return page.locator('.note-content').evaluate(root => {
    const style = el => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, leading: s.lineHeight, color: s.color, background: s.backgroundColor }; };
    const pre = root.querySelector('pre');
    const toolbar = root.querySelector('.code-toolbar-actions');
    const language = root.querySelector('.code-language-trigger');
    const languageStyle = getComputedStyle(language);
    const code = pre.querySelector('code');
    const colors = [...root.querySelectorAll('[class^="token-"]')].map(el => ({ type: el.className, color: getComputedStyle(el).color }));
    const contentOnly=root.cloneNode(true);contentOnly.querySelectorAll('.code-toolbar').forEach(el=>el.remove());
    return { body: style(root), paragraph: style(root.querySelector('p')), heading: style(root.querySelector('h2')), code: style(code), inline: style(root.querySelector('p code')), quote: style(root.querySelector('blockquote')),
      language: {...style(language), borderWidth:languageStyle.borderTopWidth, borderStyle:languageStyle.borderTopStyle, borderColor:languageStyle.borderTopColor, opacity:languageStyle.opacity, width:language.getBoundingClientRect().width, height:language.getBoundingClientRect().height},
      width: root.getBoundingClientRect().width, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, prePadding: getComputedStyle(pre).padding,
      toolbarClear: toolbar.getBoundingClientRect().bottom <= code.getBoundingClientRect().top,
      toolbarGeometry: { bottom: toolbar.getBoundingClientRect().bottom, codeTop: code.getBoundingClientRect().top, height: toolbar.getBoundingClientRect().height },
      codeText: [...root.querySelectorAll('pre code')].map(el => el.textContent), text: contentOnly.textContent, colors, scrollbar: getComputedStyle(pre).scrollbarWidth };
  });
}
function ratio(a, b) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
async function freshCodeLifecycle(page) {
  const checks = [];
  for (const [language, source] of [
    ['javascript', 'class FreshExample {}\nconst value = 42;'],
    ['python', 'def example():\n    return True'],
    ['go', 'var users []User\ndb.Preload("Posts").Find(&users)'],
  ]) {
    const id = 'fresh-code-' + language;
    await page.evaluate(({ id }) => {
      const { slice, api } = window.proseTest;
      slice.treeData.push({ id, name: '新建代码验证.md', type: 'file', indexStatus: 'indexed' });
      slice.fileContents[id] = '';
      slice.selectedFileId = id;
      api.render();
    }, { id });
    const editor = page.locator('.tiptap.note-content');
    await page.waitForFunction(() => document.querySelector('.note-content')?.textContent === '');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+Alt+c');
    await editor.locator('.code-block').waitFor();
    // Exercise the browser's editable paste event with an in-memory payload.
    // Do not access the system clipboard or seed colored HTML/decorations.
    await editor.evaluate((el, text) => {
      const payload = new DataTransfer();
      payload.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: payload, bubbles: true, cancelable: true }));
    }, source);
    const block = editor.locator('.code-block');
    await page.waitForFunction(language => document.querySelector('.note-content .code-block')?.dataset.language === language, language);
    assert.equal(await block.locator('code').textContent(), source);
    assert.equal(await block.getAttribute('data-language-mode'), 'auto');
    assert(await block.locator('code [class^="token-"]').count() > 0);
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(language === 'python' ? '    # 新输入 😀' : '// 新输入 😀');
    const edited = await block.locator('code').textContent();
    assert(edited.endsWith('新输入 😀'));
    assert(await block.locator('.token-comment').count() > 0, 'New input must be highlighted without changing focus');
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), true);
    await page.waitForFunction(id => window.proseTest.api.updates.some(item => item.id === id && item.content.includes('新输入 😀')), id);
    const saved = await page.evaluate(id => window.proseTest.slice.fileContents[id], id);
    assert.match(saved, /^```\n/);
    assert.doesNotMatch(saved, /token-|<span|style=/);
    await block.hover();
    await block.locator('.code-copy-button').click();
    assert.equal(await page.evaluate(() => window.proseTest.api.copied.at(-1)), edited);
    await block.locator('.code-language-trigger').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索代码语言');
    await page.getByRole('option', { name: 'Plain Text', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.note-content .code-block')?.dataset.languageMode === 'manual');
    assert.equal(await block.locator('code [class^="token-"]').count(), 0);
    assert.equal(await block.locator('code').textContent(), edited);
    await block.locator('.code-language-trigger').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索代码语言');
    await page.getByRole('option', { name: '自动识别', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.note-content .code-block')?.dataset.languageMode === 'auto');
    assert(await block.locator('code [class^="token-"]').count() > 0);
    // Switch away and reopen through the real NoteEditor/Markdown lifecycle.
    await page.evaluate(() => { window.proseTest.slice.selectedFileId = 'synthetic-prose'; window.proseTest.api.render(); });
    await page.waitForFunction(() => document.querySelectorAll('.note-content .code-block').length === 3);
    await page.evaluate(id => { window.proseTest.slice.selectedFileId = id; window.proseTest.api.render(); }, id);
    await page.waitForFunction(language => document.querySelectorAll('.note-content .code-block').length === 1 && document.querySelector('.note-content .code-block')?.dataset.language === language, language);
    assert.equal(await editor.locator('pre code').textContent(), edited);
    assert.equal(await block.getAttribute('data-language-mode'), 'auto');
    assert(await block.locator('code [class^="token-"]').count() > 0);
    checks.push({ language, keyboardCreate: true, domPaste: true, liveInput: true, focusPreserved: true, rawCopy: true, manualPlainAndAuto: true, savedReopen: true });
  }
  return checks;
}
async function sharedGrammar(page) {
  await page.evaluate(() => { const {slice,api}=window.proseTest;slice.selectedFileId='synthetic-prose';api.surface='note';api.render(); });
  await page.locator('.document-canvas .note-content').waitFor();
  const shape=()=>page.locator('.note-content').evaluate(root=>{
    const s=selector=>{const e=root.querySelector(selector),c=getComputedStyle(e);return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,line:c.lineHeight,margin:c.margin,padding:c.padding,background:c.backgroundColor,color:c.color};};
    return {bodySize:getComputedStyle(root).fontSize,heading:s('h2'),paragraph:s('p'),list:s('ol'),item:s('li'),code:s('pre code'),quote:s('blockquote'),note:s('blockquote[data-reading-callout="note"]'),warning:s('blockquote[data-reading-callout="warning"]'),cell:s('td'),toolbar:s('.code-toolbar-actions'),language:s('.code-language-trigger')};
  });
  const baseline=await shape(), reports=[];
  await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
  await settleStyles(page.locator('.note-content'));
  const darkBaseline=await shape();
  await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
  await settleStyles(page.locator('.note-content'));
  const before=await page.evaluate(()=>window.proseTest.api.updates.length);
  for(const surface of ['preview','rendered']) {
    await page.evaluate(surface=>{window.proseTest.api.surface=surface;window.proseTest.api.render();},surface);
    await page.locator('.nf-reading-prose').waitFor();
    await settleStyles(page.locator('.nf-reading-prose'));
    assert.deepEqual(await shape(),baseline,'Same source must use one block grammar on '+surface);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    await settleStyles(page.locator('.nf-reading-prose'));
    assert.deepEqual(await shape(),darkBaseline,'Dark reading grammar must also match on '+surface);
    await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    await settleStyles(page.locator('.nf-reading-prose'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),await page.evaluate(()=>innerWidth));
    if(surface==='rendered') {
      const block=page.locator('.rendered-code-block').first();
      await block.hover();await block.locator('.code-copy-button').click();
      assert.equal(await page.evaluate(()=>window.proseTest.api.copied.at(-1)),await block.locator('code').textContent());
      await block.locator('.code-language-trigger').click();
      const option=block.locator('[data-language-option="python"]');
      await option.click();assert.equal(await block.getAttribute('data-language'),'python');
      assert.equal(await block.locator('.code-language-trigger').getAttribute('aria-expanded'),'false');
    }
    reports.push(surface);
  }
  assert.equal(await page.evaluate(()=>window.proseTest.api.updates.length),before);
  assert.deepEqual(await page.evaluate(()=>window.proseTest.api.previewUpdates),[],'Opening preview must not change/save its Markdown');
  return reports;
}
try {
  for (const width of [1280, 736, 320]) {
    console.log('Checking actual NoteEditor at ' + width + 'px');
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 320 });
    const errors = [], requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => { errors.push(error.message); console.error('Offline prose pageerror:', error.message); });
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root" style="display:flex;height:100%"></div><script type="module">' + source + '</script></body></html>');
    const shell = page.locator('.document-canvas');
    const editor = page.locator('.tiptap.note-content');
    await editor.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.note-content pre').length === 3);
    await page.waitForFunction(() => document.querySelector('.note-entry')?.dataset.ready === 'true');
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))); });
    await page.evaluate(() => document.fonts.ready);
    const dates=page.locator('.document-meta-date');assert.equal(await dates.count(),1);
    const dateGeometry=await dates.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    assert(dateGeometry.every(n=>n.x>=0 && n.x+n.width<=width),'Each full date stays inside the reading surface');
    assert.match(await dates.textContent(),/^创建于 /);
    assert.equal(await page.locator('.document-location,.document-save-state').count(),0);
    assert.equal(await page.getByRole('button',{name:'文档显示设置',exact:true}).count(),0);
    for(const metadata of [
      {createdAt:'2026-07-22T15:50:00+08:00',updatedAt:null,count:1},
      {createdAt:null,updatedAt:'2026-08-18T09:14:00+08:00',count:0},
      {createdAt:'2026-07-22T15:50:00+08:00',updatedAt:'2026-08-18T09:14:00+08:00',count:1},
    ]) {
      await page.evaluate(({createdAt,updatedAt})=>{const {slice,api}=window.proseTest;Object.assign(slice.treeData[0],{createdAt,updatedAt});api.render();},metadata);
      await page.waitForFunction(count=>document.querySelectorAll('.document-meta-date').length===count,metadata.count);
      assert.equal(await page.locator('.document-meta-row').count(),metadata.count,'No empty metadata row when creation time is absent');
    }
    if (width < 768) {
      const header = await page.getByRole('toolbar', {name:'笔记导航'}).boundingBox();
      const title = await page.locator('.document-title').boundingBox();
      const outlineButton = await page.getByRole('button', {name:'展开目录',exact:true}).boundingBox();
      assert(title.y >= header.y + header.height, 'Mobile controls must not cover the document title');
      assert.equal(outlineButton.width,44); assert.equal(outlineButton.height,44);
      assert(outlineButton.x + outlineButton.width <= width);
    }
    await shell.evaluate(el => el.classList.remove('nf-prose-refined'));
    await settleStyles(editor);
    const before = await metrics(page);
    await page.screenshot({ path: join(output, 'before-' + width + '.png') });
    await shell.evaluate(el => el.classList.add('nf-prose-refined'));
    await settleStyles(editor);
    const after = await metrics(page);
    assert.equal(after.text, before.text, 'CSS must not change body content');
    assert.deepEqual(after.codeText, before.codeText);
    assert.equal(after.width, Math.min(704, before.width), 'Reading column caps at 704px and fits narrow screens');
    assert.equal(after.pageWidth, width, 'No global horizontal overflow');
    assert.equal(after.paragraph.size, '16px');
    assert.equal(after.paragraph.leading, '28px');
    assert.equal(after.heading.size, '24px');
    assert.equal(after.heading.weight, '600');
    assert.equal(after.code.size, '13.6px');
    assert.equal(after.code.weight, '400');
    assert.equal(after.code.leading, '20.4px');
    assert.equal(after.prePadding, width === 320 ? '8px 14px 18px' : '8px 18px 18px');
    assert.equal(after.language.size, '13px', 'Language selection must not shrink into 11px utility text');
    assert.equal(after.language.borderWidth, '1px');
    assert.equal(after.language.borderStyle, 'solid');
    assert.equal(after.language.opacity, '1', 'Language select stays visible without hover');
    assert(after.language.width >= 80);
    assert(after.language.height >= (width === 320 ? 44 : 30));
    assert(ratio(after.language.borderColor, 'rgb(248, 247, 245)') >= 3);
    assert(ratio(after.language.color, after.language.background) >= 4.5);
    assert.equal(after.inline.background, 'rgb(243, 242, 239)');
    assert.equal(after.quote.background, 'rgba(0, 0, 0, 0)');
    const callouts=page.locator('blockquote[data-reading-callout]');
    assert.equal(await callouts.count(),2);
    assert.equal(await callouts.first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(233, 242, 236)');
    assert.equal(await callouts.last().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(251, 243, 223)');
    assert.equal(await editor.locator('.code-toolbar-actions').first().evaluate(el=>getComputedStyle(el).boxShadow),'none');
    assert.equal(await editor.locator('td p').first().evaluate(el=>getComputedStyle(el).fontSize),'15px');
    const rhythm = await editor.evaluate(root => {
      const paragraphs = [...root.querySelectorAll(':scope > p')];
      const a = paragraphs.find(n => n.textContent.startsWith('阅读节奏检查：'));
      const b = paragraphs.find(n => n.textContent.startsWith('段落分隔检查：'));
      const items = [...root.querySelectorAll(':scope > ol > li')];
      const heading = root.querySelector('h2');
      return { paragraphGap:b.getBoundingClientRect().top-a.getBoundingClientRect().bottom,
        itemGap:items[1].getBoundingClientRect().top-items[0].getBoundingClientRect().bottom,
        itemLeading:getComputedStyle(items[0]).lineHeight,
        sectionSpace:parseFloat(getComputedStyle(heading).marginTop) };
    });
    assert(rhythm.paragraphGap >= 14, 'Separate ideas must have a visible paragraph break');
    assert(rhythm.itemGap >= 8, 'Multi-line list items must not merge into one paragraph');
    assert.equal(rhythm.itemLeading, '28px');
    assert(rhythm.sectionSpace >= 40, 'Section breaks must be stronger than paragraph breaks');
    assert(after.toolbarClear, 'Actual hover toolbar must not cover the first line: ' + JSON.stringify(after.toolbarGeometry));
    assert.equal(after.scrollbar, 'thin');
    assert(new Set(after.colors.map(item => item.color)).size >= 5);
    for (const token of after.colors) assert(ratio(token.color, 'rgb(248, 247, 245)') >= 4.5, JSON.stringify(token));
    assert(ratio(after.inline.color, after.inline.background) >= 4.5);
    assert.equal(await page.evaluate(() => window.proseTest.api.updates.length), 0, 'Reading/applying CSS must not save a note');
    await page.screenshot({ path: join(output, 'after-' + width + '.png') });

    // Exercise real retained controls, with clipboard writes captured in memory.
    const block = editor.locator('.code-block').first();
    await block.scrollIntoViewIfNeeded();
    await block.hover();
    const copy = block.locator('.code-copy-button');
    await copy.click();
    await page.waitForFunction(() => window.proseTest.api.copied.length === 1);
    assert.equal(await page.evaluate(() => window.proseTest.api.copied[0]), before.codeText[0]);
    const language = block.locator('.code-language-trigger');
    await page.screenshot({ path: join(output, 'language-' + width + '.png') });
    await language.click();
    await page.getByRole('listbox', { name: '代码语言', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索代码语言');
    await page.screenshot({ path: join(output, 'language-menu-' + width + '.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('listbox', { name: '代码语言', exact: true }).waitFor({ state: 'detached' });
    await copy.focus();
    assert.equal(await copy.evaluate(el => document.activeElement === el), true);
    const wide = editor.locator('pre').last();
    assert(await wide.evaluate(el => el.scrollWidth > el.clientWidth));
    await wide.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert(await wide.evaluate(el => el.scrollLeft > 0));
    assert.equal(await editor.locator('pre code').last().textContent(), before.codeText[2]);
    const paragraph = editor.getByText('用于编辑验证的一行正文。', { exact: true });
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('离线输入');
    await page.waitForFunction(() => window.proseTest.api.updates.some(item => item.content.includes('离线输入')));
    assert.equal(await editor.evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.querySelector('.note-content').innerText.includes('离线输入'));

    await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
    await settleStyles(editor);
    const dark = await metrics(page);
    assert.equal(dark.body.color, 'rgb(230, 229, 223)');
    assert.equal(dark.quote.background, 'rgba(0, 0, 0, 0)');
    for (const token of dark.colors) assert(ratio(token.color, 'rgb(41, 41, 39)') >= 4.5, JSON.stringify(token));
    assert(ratio(dark.inline.color, dark.inline.background) >= 4.5);
    assert(ratio(dark.language.color, dark.language.background) >= 4.5);
    assert(ratio(dark.language.borderColor, 'rgb(41, 41, 39)') >= 3);
    await page.screenshot({ path: join(output, 'dark-' + width + '.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await metrics(page);
    assert.equal(reduced.paragraph.leading, after.paragraph.leading);
    assert.equal(reduced.width, after.width);
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await block.evaluate(el => getComputedStyle(el).borderStyle), 'solid');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.evaluate(() => document.documentElement.classList.remove('theme-dark'));
    await page.waitForFunction(() => !matchMedia('(forced-colors: active)').matches);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const updates = await page.evaluate(() => window.proseTest.api.updates.length);
    await shell.evaluate(el => el.classList.remove('nf-prose-refined'));
    await page.locator('.document-scroll').evaluate(el => { el.scrollTop = 0; });
    await settleStyles(editor);
    const restored = await metrics(page);
    assert.deepEqual(restored.paragraph, before.paragraph);
    assert.deepEqual(restored.heading, before.heading);
    assert.deepEqual(restored.code, before.code);
    assert.equal(await page.evaluate(() => window.proseTest.api.updates.length), updates);
    await shell.evaluate(el => el.classList.add('nf-prose-refined'));
    const freshCode = await freshCodeLifecycle(page);
    const surfaceParity = await sharedGrammar(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    reports.push({ width, before, after, dark, freshCode, surfaceParity, nativeCopy: true, languageOpenEscape: true, editingUndo: true, retainedCodeScroll: true, scopeRollback: true, reducedMotion: true, forcedColors: true, errors, requests });
    await context.close();
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ ok: true, actualProductionComponent: true, syntheticStateOnly: true, networkBlocked: true, output, checks: reports.map(r => ({ width: r.width, freshCode: r.freshCode, surfaceParity:r.surfaceParity, noOverflow: r.after.pageWidth === r.width, readingWidthCorrect: r.after.width === Math.min(704, r.before.width), toolbarClear: r.after.toolbarClear, nativeCopy: r.nativeCopy, languageOpenEscape: r.languageOpenEscape, editingUndo: r.editingUndo, retainedCodeScroll: r.retainedCodeScroll, scopeRollback: r.scopeRollback, errors: r.errors })) }, null, 2));
} finally { await browser.close(); }
