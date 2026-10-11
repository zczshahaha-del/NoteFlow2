import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

const base = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const icons = require('lucide-react');
const source = readFileSync(join(base, 'noteflow-prose-study.source.html'), 'utf8');
const preview = readFileSync(join(base, 'noteflow-prose-study.preview.html'), 'utf8');
const previewURL = pathToFileURL(join(base, 'noteflow-prose-study.preview.html')).href;
assert(Buffer.byteLength(source) < 1_000_000);
assert(!/<!doctype|<html|<head>|<body>/i.test(source));
assert(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.clipboard|localStorage/.test(source));
assert(!source.includes('\\"') && !source.includes('\\n'));
new Script(source.match(/<script>([\s\S]*?)<\/script>/)[1]);
const iconMarkup = {};
for (const name of ['chevron-left', 'chevron-right']) {
  const exportName = name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');
  iconMarkup[name] = renderToStaticMarkup(React.createElement(icons[exportName], { size: 16 }));
}
// Only a QA substitute for the host's supplied icon runtime. No product icon
// paths or external service calls are added to the authored fragment.
const iconAdapter = 'globalThis.lucide={createIcons(){const markup=' + JSON.stringify(iconMarkup) + ';document.querySelectorAll("i[data-lucide]").forEach(el=>{const span=document.createElement("span");span.innerHTML=markup[el.dataset.lucide]||"";if(span.firstElementChild)el.replaceWith(span.firstElementChild);});}};';
const output = mkdtempSync(join(tmpdir(), 'noteflow-prose-study-'));
const results = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined });

async function makePage(width, options = {}) {
  const context = await browser.newContext({ viewport: { width: width + 32, height: 2400 }, colorScheme: options.dark ? 'dark' : 'light', reducedMotion: options.reduce ? 'reduce' : 'no-preference', hasTouch: width === 320 });
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url === previewURL) return route.continue();
    if (url.includes('/lucide@')) return route.fulfill({ contentType: 'text/javascript', body: iconAdapter });
    blocked.push(url);
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.goto(previewURL, { waitUntil: 'load' });
  const frame = page.frames().find(candidate => candidate.parentFrame());
  assert(frame);
  const root = frame.locator('#nf-prose-study');
  await root.waitFor();
  await frame.evaluate(() => document.fonts.ready);
  await frame.waitForFunction(() => parseFloat(document.getElementById('nf-prose-study').style.getPropertyValue('--np-stage-height')) > 100);
  await root.locator('.viz-carousel-controls').waitFor();
  return { context, page, frame, root, errors, blocked };
}
async function measure(run) {
  return run.frame.evaluate(() => {
    const root = document.getElementById('nf-prose-study');
    const carousel = root.querySelector('.viz-carousel');
    const article = carousel.querySelector('[data-variant]:not([hidden]) article');
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const nav = root.querySelector('.viz-carousel-controls');
    return { width: root.clientWidth, scrollWidth: root.scrollWidth, height: root.getBoundingClientRect().height, article: box(article), callout: box(article.querySelector('.np-callout')), nav: box(nav), variant: carousel.dataset.activeVariant, size: getComputedStyle(article).fontSize, lineHeight: getComputedStyle(article).lineHeight, codeBlocks: [...article.querySelectorAll('pre')].map(el => ({ ...box(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })), documentScrollWidth: document.documentElement.scrollWidth };
  });
}
async function contrast(run) {
  return run.frame.evaluate(() => {
    const article = document.querySelector('.np-refined');
    const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, index) => sum + n * [.2126, .7152, .0722][index], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const codeBackground = getComputedStyle(article.querySelector('pre')).backgroundColor;
    const entries = ['np-kw', 'np-string', 'np-type', 'np-function', 'np-number', 'np-comment', 'np-punctuation', 'np-operator'].map(name => {
      const element = article.querySelector('.' + name);
      const color = getComputedStyle(element).color;
      return { name, color, ratio: ratio(color, codeBackground) };
    });
    const inline = article.querySelector('p code');
    const inlineStyle = getComputedStyle(inline);
    entries.push({ name: 'inline', color: inlineStyle.color, ratio: ratio(inlineStyle.color, inlineStyle.backgroundColor) });
    const callout = article.querySelector('.np-callout');
    const calloutStyle = getComputedStyle(callout);
    entries.push({ name: 'callout', color: calloutStyle.color, ratio: ratio(calloutStyle.color, calloutStyle.backgroundColor) });
    return entries;
  });
}
async function screenshot(run, name) {
  const height = await run.root.evaluate(el => Math.ceil(el.getBoundingClientRect().height));
  const viewport = run.page.viewportSize();
  // Full outer-iframe capture: do not clip the final callout or the carousel.
  await run.page.setViewportSize({ width: viewport.width, height: height + 32 });
  await run.page.evaluate(h => { document.querySelector('iframe').style.height = h + 'px'; }, height);
  await run.frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await run.page.screenshot({ path: join(output, name), fullPage: true });
  // Keep the full iframe visible for QA. Product geometry still depends only
  // on the measured content width; no product CSS or animation is disabled.
}
async function detailScreenshot(run, name) {
  const article = run.root.locator('.viz-carousel > [data-variant]:not([hidden]) article');
  const paper = await article.boundingBox();
  const heading = await article.locator('h2').nth(1).boundingBox();
  const callout = await article.locator('.np-callout').boundingBox();
  // An ordinary DOM-measured crop, never combined with fullPage.
  await run.page.screenshot({ path: join(output, name), clip: { x: paper.x, y: heading.y - 12, width: paper.width, height: callout.y + callout.height + 24 - (heading.y - 12) } });
}
try {
  for (const width of [736, 480, 320]) {
    console.log('Checking ' + width + 'px');
    const run = await makePage(width);
    const { root, frame } = run;
    const allText = await root.locator('article').evaluateAll(elements => elements.map(el => el.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(allText[0], allText[1], 'Both variants must use identical supplied content');
    const codeText = await root.locator('article').evaluateAll(elements => elements.map(el => [...el.querySelectorAll('pre code')].map(code => code.textContent)));
    assert.deepEqual(codeText[0], codeText[1]);
    const refined = await measure(run);
    assert(Math.abs(refined.width - width) <= 1, JSON.stringify(refined));
    assert(refined.scrollWidth <= width + 1 && refined.documentScrollWidth <= width + 1, JSON.stringify(refined));
    assert(refined.nav.y >= refined.callout.bottom, 'Controls must not obscure content');
    const ratios = await contrast(run);
    for (const token of ratios) assert(token.ratio >= 4.5, JSON.stringify(token));
    assert(new Set(ratios.slice(0, 8).map(token => token.color)).size >= 6);
    await screenshot(run, 'refined-' + width + '.png');
    if (width === 736) await detailScreenshot(run, 'refined-detail-736.png');
    const next = root.getByRole('button', { name: '下一版', exact: true });
    const target = await next.boundingBox();
    const outerHit = await run.page.evaluate(point => { const element = document.elementFromPoint(point.x + point.width / 2, point.y + point.height / 2); return { tag: element?.tagName, id: element?.id, outerHeight, innerHeight }; }, target);
    await next.click();
    const pointerVerified = (await measure(run)).variant === '图片参考';
    let keyboardVerified = false;
    let handlerVerified = pointerVerified;
    if (!pointerVerified) {
      // Keep native input failures visible; handler-only success is never
      // reported as native pointer or keyboard verification.
      await next.focus();
      await next.press('Enter');
      keyboardVerified = (await measure(run)).variant === '图片参考';
      if (!keyboardVerified) await next.evaluate(element => element.click());
      handlerVerified = (await measure(run)).variant === '图片参考';
    }
    await frame.waitForFunction(() => document.querySelector('#nf-prose-study .viz-carousel').dataset.activeVariant === '图片参考');
    const reference = await measure(run);
    assert.equal(reference.variant, '图片参考');
    assert.equal(reference.height, refined.height, 'Variant navigation position must remain stable');
    assert.equal(reference.nav.y, refined.nav.y);
    assert(reference.scrollWidth <= width + 1 && reference.documentScrollWidth <= width + 1);
    await screenshot(run, 'reference-' + width + '.png');
    if (width === 736) await detailScreenshot(run, 'reference-detail-736.png');
    await root.getByRole('button', { name: '上一版', exact: true }).focus();
    await root.getByRole('button', { name: '上一版', exact: true }).press('Enter');
    const keyboardReturned = (await measure(run)).variant === '局部精修';
    keyboardVerified = keyboardReturned && (pointerVerified || keyboardVerified);
    if (!keyboardReturned) await root.getByRole('button', { name: '上一版', exact: true }).evaluate(element => element.click());
    await frame.waitForFunction(() => document.querySelector('#nf-prose-study .viz-carousel').dataset.activeVariant === '局部精修');
    assert.equal((await measure(run)).variant, '局部精修');
    // Exercise restored design parameters without pretending to test the host's
    // real Tweak panel; no actual app/notes/clipboard request is allowed.
    await frame.evaluate(() => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { modelContent: { design: 'noteflow-prose-study', revision: 5 }, privateContent: { settings: { size: 17, leading: 1.95, padding: 28, wrap: true } } } } } })));
    await frame.waitForFunction(() => getComputedStyle(document.querySelector('.np-refined')).fontSize === '17px');
    await frame.waitForFunction(() => document.querySelector('.viz-carousel-controls').getBoundingClientRect().y >= document.querySelector('.np-refined .np-callout').getBoundingClientRect().bottom);
    const adjusted = await measure(run);
    assert(adjusted.scrollWidth <= width + 1);
    assert(adjusted.nav.y >= adjusted.callout.bottom);
    await frame.evaluate(() => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { modelContent: { design: 'noteflow-prose-study', revision: 1 }, privateContent: { settings: { size: 15, leading: 1.6, padding: 18, wrap: false } } } } } })));
    assert.equal(await root.locator('.np-refined').evaluate(el => getComputedStyle(el).fontSize), '17px');
    assert.equal(run.errors.length, 0, JSON.stringify(run.errors));
    assert(run.blocked.every(url => url.startsWith('https://unpkg.com/@floating-ui/')), JSON.stringify(run.blocked));
    results.push({ width, refined, reference, adjusted, contrast: ratios, contentIdentical: true, navigationStable: true, staleStateRejected: true, pointerVerified, keyboardVerified, handlerVerified, outerHit, errors: run.errors });
    await run.context.close();
  }
  for (const options of [{ dark: true }, { reduce: true }]) {
    const run = await makePage(736, options);
    const ratios = await contrast(run);
    for (const token of ratios) assert(token.ratio >= 4.5, JSON.stringify(token));
    await screenshot(run, options.dark ? 'dark-736.png' : 'reduced-motion-736.png');
    assert.equal(run.errors.length, 0);
    results.push({ ...options, contrast: ratios, errors: run.errors });
    await run.context.close();
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ completed: true, nativeInputVerified: results.filter(result => result.width).every(result => result.pointerVerified && result.keyboardVerified), output, checks: results.map(result => ({ width: result.width || 736, dark: !!result.dark, reducedMotion: !!result.reduce, contentIdentical: result.contentIdentical, navigationStable: result.navigationStable, pointerVerified: result.pointerVerified, keyboardVerified: result.keyboardVerified, handlerVerified: result.handlerVerified, outerHit: result.outerHit, minContrast: Math.min(...result.contrast.map(token => token.ratio)), errors: result.errors })) }, null, 2));
} finally { await browser.close(); }
