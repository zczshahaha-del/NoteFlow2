// Isolated design-file check; never accesses an application or user session.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('./noteflow-close-study.source.html',import.meta.url),'utf8');
assert.ok(!/<svg|fetch\(|XMLHttpRequest|WebSocket|<html|<body|<head>/i.test(source));
const snapshots=[],domErrors=[];
const dom=new JSDOM(source,{runScripts:'dangerously',beforeParse(win){win.openai={setWidgetState(value){snapshots.push(value);return Promise.resolve();}};win.addEventListener('error',e=>domErrors.push(e.message));}});
const d=dom.window.document,root=d.getElementById('nf-close-study'),candidate=d.querySelector('[data-variant="无常驻底座"]');
assert.equal(snapshots.length,0);candidate.querySelector('button.ncc-close').click();assert.equal(snapshots.at(-1).modelContent.action,'试按无底座关闭');
const saved=snapshots.at(-1).privateContent.closeStudy,count=snapshots.length;
const send=value=>dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{privateContent:{closeStudy:value}}}}}));
send({...saved,design:'foreign',size:20});assert.equal(root.style.getPropertyValue('--ncc-size'),'18px');
send({...saved,revision:0,size:20});assert.equal(root.style.getPropertyValue('--ncc-size'),'18px');
send({...saved,revision:100,size:30,stroke:3});assert.equal(root.style.getPropertyValue('--ncc-size'),'20px');assert.equal(root.style.getPropertyValue('--ncc-zoom-size'),'80px');assert.equal(root.style.getPropertyValue('--ncc-stroke'),'2');assert.equal(snapshots.length,count);assert.deepEqual(domErrors,[]);dom.window.close();
const {chromium}=await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const bundle=readFileSync(process.env.NOTEFLOW_LUCIDE_BUNDLE,'utf8'),url=new URL('./noteflow-close-study.preview.html',import.meta.url).href;
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const reports=[],errors=[],blocked=[];
try{
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:{width:mobile?352:552,height:900},isMobile:mobile,hasTouch:mobile,colorScheme:'light',deviceScaleFactor:1});
    await context.route('**/*',route=>{const u=route.request().url();if(u===url)return route.continue();if(/\/lucide@[^/]+\/dist\/umd\/lucide.js$/.test(u))return route.fulfill({contentType:'application/javascript',body:bundle});blocked.push(u);return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(url);
    const frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>document.querySelector('.ncc-after svg.lucide'));await frame.locator('.viz-carousel-next').click();
    const button=frame.locator('button.ncc-after');
    const measure=()=>button.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),i=getComputedStyle(n.querySelector('svg'));return{width:r.width,height:r.height,background:s.backgroundColor,radius:s.borderRadius,icon:i.width,stroke:i.strokeWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth};});
    const initial=await measure();assert.equal(initial.icon,'18px');assert.equal(initial.stroke,'1.8px');assert.equal(initial.background,'rgba(0, 0, 0, 0)');assert.equal(initial.doc,initial.viewport);assert.equal(initial.width,mobile?44:34);
    const zoom=frame.locator('.ncc-zoom-mark.ncc-after');assert.equal(await zoom.locator('svg').evaluate(n=>getComputedStyle(n).width),'72px');
    if(!mobile){await button.hover();await page.waitForTimeout(170);assert.notEqual((await measure()).background,initial.background);assert.equal(await zoom.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(244, 245, 247)');await page.mouse.move(0,0);await frame.locator('[data-variant="无常驻底座"] .ncc-more').focus();await page.keyboard.press('Tab');assert.ok(await button.evaluate(n=>document.activeElement===n));assert.notEqual(await button.evaluate(n=>getComputedStyle(n).outlineStyle),'none');}
    await button.click();assert.match(await frame.locator('.ncc-announcement').textContent(),/不会关闭应用/);
    await frame.evaluate(()=>{document.activeElement.blur();document.querySelectorAll('[data-variant]').forEach(n=>{n.hidden=false;n.dataset.hover='false';});});await page.mouse.move(0,0);await page.waitForTimeout(170);
    assert.deepEqual(await frame.locator('.ncc-stage').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height)),[348,348]);
    const rows=await frame.locator('.ncc-actions').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),p=n.closest('.ncc-bar').getBoundingClientRect();return r.left>=p.left && r.right<=p.right;}));assert.deepEqual(rows,[true,true]);
    await frame.locator('#nf-close-study').screenshot({path:fileURLToPath(new URL(mobile?'./noteflow-close-study-mobile.png':'./noteflow-close-study.png',import.meta.url))});
    await frame.evaluate(()=>document.documentElement.style.colorScheme='dark');assert.equal(await frame.locator('.ncc-bar').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(37, 43, 51)');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await button.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    reports.push({mobile,initial,zoom:'4x',keyboardFocus:!mobile,dark:true,reducedMotion:true});await context.close();
  }
  assert.deepEqual(errors,[]);assert.ok(blocked.every(u=>u==='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js'));console.log(JSON.stringify({ok:true,designOnly:true,stateChecks:true,networkBlocked:true,reports,errors},null,2));
}finally{await browser.close();}
