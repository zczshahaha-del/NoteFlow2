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
  '## 删除（Delete）', '', '```go',
  'db.Delete(&u, 1) // 删 id=1',
  'db.Where("age < ?", 10).Delete(&User{}) // 按条件删', '```', '',
  '软删除：模型里加 `gorm.DeletedAt` 字段，只是把 `deleted_at` 写上时间。', '',
  '---', '', '## 预加载（Preload）', '', '```go',
  'var users []User', 'db.Preload("Posts").Find(&users)',
  '// 等于先查 users，再一次性把所有 Posts 都查出来填进去', '```', '',
  '> **人话：** 没有 Preload，要重复查询；有了 Preload，只查 2 次。', '',
  '### 宽内容与编辑', '', '```go',
  'const longValue = "' + '保留代码行结构'.repeat(40) + '"', '```', '',
  '| 名称 | 类型 | 说明 |', '| --- | --- | --- |', '| 用户 | User | 合成表格 |', '',
  '用于编辑验证的一行正文。',
].join('\n');
const entry = `import React, {StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
import NoteEditor from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));
const api={updates:[],copied:[],render(){root.render(React.createElement(StrictMode,null,React.createElement(NoteEditor)))}};
const slice={selectedFileId:'synthetic-prose',treeData:[{id:'synthetic-prose',name:'GORM 学习笔记.md',type:'file',indexStatus:'indexed'}],fileContents:{'synthetic-prose':${JSON.stringify(markdown)}},noteSaveState:{status:'saved'},pendingEditorSelection:null,pendingSourceFocus:null,
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
    const code = pre.querySelector('code');
    const colors = [...root.querySelectorAll('[class^="token-"]')].map(el => ({ type: el.className, color: getComputedStyle(el).color }));
    return { body: style(root), paragraph: style(root.querySelector('p')), heading: style(root.querySelector('h2')), code: style(code), inline: style(root.querySelector('p code')), quote: style(root.querySelector('blockquote')),
      width: root.getBoundingClientRect().width, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, prePadding: getComputedStyle(pre).padding,
      toolbarClear: toolbar.getBoundingClientRect().bottom <= code.getBoundingClientRect().top,
      toolbarGeometry: { bottom: toolbar.getBoundingClientRect().bottom, codeTop: code.getBoundingClientRect().top, height: toolbar.getBoundingClientRect().height },
      codeText: [...root.querySelectorAll('pre code')].map(el => el.textContent), text: root.innerText, colors, scrollbar: getComputedStyle(pre).scrollbarWidth };
  });
}
function ratio(a, b) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
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
    await page.evaluate(() => document.fonts.ready);
    await shell.evaluate(el => el.classList.remove('nf-prose-refined'));
    await settleStyles(editor);
    const before = await metrics(page);
    await page.screenshot({ path: join(output, 'before-' + width + '.png') });
    await shell.evaluate(el => el.classList.add('nf-prose-refined'));
    await settleStyles(editor);
    const after = await metrics(page);
    assert.equal(after.text, before.text, 'CSS must not change body content');
    assert.deepEqual(after.codeText, before.codeText);
    assert.equal(after.width, before.width, 'Keep the existing canvas width');
    assert.equal(after.pageWidth, width, 'No global horizontal overflow');
    assert.equal(after.paragraph.size, '16px');
    assert.equal(after.paragraph.leading, '28.8px');
    assert.equal(after.heading.size, width === 320 ? '19px' : '20px');
    assert.equal(after.heading.weight, '650');
    assert.equal(after.code.size, '13.5px');
    assert.equal(after.code.weight, '400');
    assert.equal(after.code.leading, '22.95px');
    assert.equal(after.prePadding, width === 320 ? '44px 16px 22px' : '44px 22px 22px');
    assert.equal(after.inline.background, 'rgb(243, 242, 239)');
    assert.equal(after.quote.background, 'rgb(233, 242, 236)');
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
    await language.click();
    await page.getByRole('listbox', { name: '代码语言', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索代码语言');
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
    assert.equal(dark.quote.background, 'rgb(39, 55, 46)');
    for (const token of dark.colors) assert(ratio(token.color, 'rgb(41, 41, 39)') >= 4.5, JSON.stringify(token));
    assert(ratio(dark.inline.color, dark.inline.background) >= 4.5);
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
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    reports.push({ width, before, after, dark, nativeCopy: true, languageOpenEscape: true, editingUndo: true, retainedCodeScroll: true, scopeRollback: true, reducedMotion: true, forcedColors: true, errors, requests });
    await context.close();
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ ok: true, actualProductionComponent: true, syntheticStateOnly: true, networkBlocked: true, output, checks: reports.map(r => ({ width: r.width, noOverflow: r.after.pageWidth === r.width, widthPreserved: r.before.width === r.after.width, toolbarClear: r.after.toolbarClear, nativeCopy: r.nativeCopy, languageOpenEscape: r.languageOpenEscape, editingUndo: r.editingUndo, retainedCodeScroll: r.retainedCodeScroll, scopeRollback: r.scopeRollback, errors: r.errors })) }, null, 2));
} finally { await browser.close(); }
