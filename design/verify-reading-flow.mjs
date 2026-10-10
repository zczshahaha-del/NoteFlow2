import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const base = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const icons = require('lucide-react');
const source = readFileSync(join(base, 'noteflow-reading-flow.source.html'), 'utf8');
const preview = readFileSync(join(base, 'noteflow-reading-flow.preview.html'), 'utf8');
assert(source.length < 1_000_000);
assert(!/<!doctype|<html|<head>|<body>/i.test(source));
assert(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(source));
const nameSet = new Set([...source.matchAll(/data-lucide="([a-z-]+)"/g)].map(match => match[1]));
nameSet.add('square');
const iconMarkup = {};
for (const name of nameSet) {
  const exportName = name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');
  assert(icons[exportName], `Unknown Lucide icon ${name}`);
  iconMarkup[name] = renderToStaticMarkup(React.createElement(icons[exportName], { size: 16, strokeWidth: 1.65, 'aria-hidden': true }));
}
// The product source uses host Lucide. This offline adapter renders the same
// supplied icon names from the installed official package; it is QA-only.
const iconAdapter = `globalThis.lucide={createIcons(){const markup=${JSON.stringify(iconMarkup)};document.querySelectorAll('i[data-lucide]').forEach(el=>{const holder=document.createElement('span');holder.innerHTML=markup[el.dataset.lucide]||'';if(holder.firstElementChild)el.replaceWith(holder.firstElementChild);});}};`;
const output = mkdtempSync(join(tmpdir(), 'noteflow-reading-flow-'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined });
const results = [];
async function makePage(width, options = {}) {
  const context = await browser.newContext({ viewport: { width: width + 32, height: 960 }, colorScheme: options.dark ? 'dark' : 'light', reducedMotion: options.reduce ? 'reduce' : 'no-preference', hasTouch: !!options.touch, isMobile: !!options.touch });
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('/lucide@')) return route.fulfill({ contentType: 'text/javascript', body: iconAdapter });
    // No external resource, account, note API or model can be accessed.
    blocked.push(url);
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.setContent(preview, { waitUntil: 'load' });
  const iframe = page.frameLocator('iframe');
  const root = iframe.locator('#nf-reading-flow');
  await root.waitFor();
  const frame = page.frames().find(candidate => candidate.parentFrame());
  assert(frame);
  await frame.evaluate(() => document.fonts.ready);
  return { context, page, iframe, root, frame, errors, blocked };
}
async function settle(frame) {
  await frame.waitForFunction(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length === 0);
}
async function geometry(frame) {
  return frame.evaluate(() => {
    const root = document.getElementById('nf-reading-flow');
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const documentBox = box(root.querySelector('.nf-document'));
    return { width: root.clientWidth, scrollWidth: root.scrollWidth, coarsePointer: matchMedia('(pointer: coarse)').matches, document: documentBox, fontSize: getComputedStyle(root.querySelector('.nf-document')).fontSize, lineHeight: getComputedStyle(root.querySelector('.nf-document')).lineHeight, library: box(root.querySelector('.nf-library')), ai: box(root.querySelector('.nf-ai-panel')), send: box(root.querySelector('.nf-send')), aiButton: box(root.querySelector('[data-action="ai"]')), libraryButton: box(root.querySelector('[data-action="library"]')) };
  });
}
async function screenshot(run, name) {
  const height = await run.root.evaluate(el => Math.ceil(el.getBoundingClientRect().height));
  const viewport = run.page.viewportSize();
  // A short outer viewport can clip an oversized nested iframe during a
  // full-page capture. Enlarge only the QA viewport; never alter product CSS.
  await run.page.setViewportSize({ width: viewport.width, height: height + 32 });
  await run.page.evaluate(height => { document.querySelector('iframe').style.height = height + 'px'; }, height);
  await run.frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await run.page.screenshot({ path: join(output, name), fullPage: true });
  await run.page.setViewportSize(viewport);
}
try {
  for (const width of [1024, 736, 320]) {
    const run = await makePage(width, { touch: width === 320 });
    const { root, frame, iframe } = run;
    const normal = await geometry(frame);
    assert(Math.abs(normal.width - width) <= 1, JSON.stringify(normal));
    assert(normal.scrollWidth <= normal.width + 1);
    await screenshot(run, `reading-${width}.png`);
    await root.locator('[data-action="library"]').click();
    await settle(frame);
    const library = await geometry(frame);
    assert(library.scrollWidth <= library.width + 1);
    assert.equal(library.fontSize, normal.fontSize);
    assert.equal(await root.locator('[data-note="go"] svg').evaluate(el => el.getBoundingClientRect().width), 14);
    if (width === 320) {
      for (const selector of ['[data-action="library"]', '[data-action="ai"]', '[data-action="folder"]', '[data-note="go"]']) assert(await root.locator(selector).evaluate(el => el.getBoundingClientRect().height >= 44), selector);
    }
    assert(Math.abs(library.libraryButton.x - normal.libraryButton.x) < 1);
    await root.locator('[data-note="go"]').click();
    if (width === 1024) await screenshot(run, 'directory-1024.png');
    await root.locator('[data-action="ai"]').click();
    await settle(frame);
    const ai = await geometry(frame);
    assert(ai.scrollWidth <= ai.width + 1);
    assert.equal(ai.fontSize, normal.fontSize);
    assert(Math.abs(ai.aiButton.x - normal.aiButton.x) < 1);
    assert(ai.document.width >= 200);
    if (width === 320) assert(ai.send.height >= 44, JSON.stringify(ai));
    await screenshot(run, `ai-${width}.png`);
    const input = root.locator('textarea');
    await input.fill('草稿在开合后仍然保留');
    await root.locator('[data-action="ai"]').click();
    await settle(frame);
    await root.locator('[data-action="ai"]').click();
    await settle(frame);
    assert.equal(await input.inputValue(), '草稿在开合后仍然保留');
    await input.focus();
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await root.locator('.nf-message-user').count(), 0);
    await root.locator('[data-action="send"]').click();
    assert.equal(await root.locator('.nf-thinking').count(), 1);
    await frame.waitForFunction(() => document.querySelector('.nf-message-assistant')?.textContent.length > 8 && !document.querySelector('.nf-thinking'));
    const first = await root.locator('.nf-message-assistant').textContent();
    await frame.waitForFunction(previous => document.querySelector('.nf-message-assistant')?.textContent.length > previous + 8, first.length);
    const intermediate = await root.locator('.nf-message-assistant').textContent();
    assert(intermediate.length > first.length);
    await input.fill('下一条草稿');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '下一条草稿');
    await frame.evaluate(() => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { modelContent: { design: 'noteflow-reading-flow', revision: 0 }, privateContent: { library: false, ai: false, note: 'git' } } } } })));
    assert.equal(await root.getAttribute('data-ai'), 'true');
    assert.equal(await root.locator('h1').textContent(), 'Go 语言 · GORM 学习笔记');
    assert.equal(await root.locator('[data-action="send"]').getAttribute('data-busy'), 'true');
    await root.locator('[data-action="send"]').click();
    const stopped = await root.locator('.nf-message-assistant').textContent();
    await frame.waitForTimeout(150);
    assert.equal(await root.locator('.nf-message-assistant').textContent(), stopped);
    assert.equal(await root.locator('.nf-thinking').count(), 0);
    assert.equal(await input.inputValue(), '下一条草稿');
    await root.locator('[data-action="mode"]').click();
    await root.locator('[data-mode="notes"]').click();
    assert.equal(await root.locator('[data-mode-label]').textContent(), '全库搜索');
    await input.focus();
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    assert.equal(await root.getAttribute('data-ai'), 'true');
    await input.press('Escape');
    assert.equal(await root.getAttribute('data-ai'), 'false');
    assert(await root.locator('[data-action="ai"]').evaluate(el => el === document.activeElement));
    assert.equal(run.errors.length, 0, JSON.stringify(run.errors));
    const resourceSet = run.blocked.filter(url => !url.startsWith('https://unpkg.com/@floating-ui/'));
    assert.equal(resourceSet.length, 0, JSON.stringify(resourceSet));
    results.push({ width, normal, library, ai, typewriterFirst: first.length, typewriterIntermediate: intermediate.length, draftPreserved: true, imeProtected: true, stoppedPreserved: true, pageErrors: run.errors });
    await run.context.close();
  }
  for (const options of [{ dark: true }, { reduce: true }]) {
    const run = await makePage(1024, options);
    await run.root.locator('[data-action="library"]').click();
    await run.root.locator('[data-action="ai"]').click();
    await settle(run.frame);
    await screenshot(run, options.dark ? 'dark-1024.png' : 'reduce-1024.png');
    if (options.reduce) {
      await run.root.locator('textarea').fill('看看等待与回复');
      await run.root.locator('[data-action="send"]').click();
      await run.frame.waitForFunction(() => document.querySelector('[data-action="send"]').dataset.busy === 'false');
      assert.equal(await run.root.locator('.nf-thinking').count(), 0);
      assert(await run.root.locator('.nf-message-assistant').textContent());
    }
    assert.equal(run.errors.length, 0);
    results.push({ ...options, pageErrors: run.errors, geometry: await geometry(run.frame) });
    await run.context.close();
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, output, checks: results.map(result => ({ width: result.width || 1024, dark: !!result.dark, reducedMotion: !!result.reduce, overflow: result.normal ? result.normal.scrollWidth - result.normal.width : result.geometry.scrollWidth - result.geometry.width, draftPreserved: result.draftPreserved, imeProtected: result.imeProtected, stoppedPreserved: result.stoppedPreserved, pageErrors: result.pageErrors })) }, null, 2));
} finally { await browser.close(); }
