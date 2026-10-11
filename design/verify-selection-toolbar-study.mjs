// Offline synthetic design only. No app, notes, authentication or clipboard access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('./noteflow-selection-toolbar-study.source.html',import.meta.url),'utf8');
assert.ok(!/<svg|fetch\(|XMLHttpRequest|WebSocket|<html|<body|<head>/i.test(source));
const errors=[],snapshots=[];
const dom=new JSDOM(source,{runScripts:'dangerously',beforeParse(w){w.openai={setWidgetState(v){snapshots.push(v);return Promise.resolve();}};w.addEventListener('error',e=>errors.push(e.message));}});
const root=dom.window.document.getElementById('nf-selection-study');
assert.equal(root.querySelectorAll('.nst-toolbar button').length,24);
assert.equal(snapshots.length,0);
const names=Array.from(root.querySelectorAll('.nst-refined button')).map(n=>n.getAttribute('aria-label'));
assert.deepEqual(names,['加入对话','加粗','斜体','下划线','删除线','高亮','行内代码','添加链接','无序列表','有序列表','引用','清除格式']);
assert.deepEqual(Array.from(root.querySelectorAll('.nst-current button')).map(n=>n.getAttribute('aria-label')),names);
root.querySelector('.nst-refined [data-action="bold"]').click();
assert.ok(root.querySelector('.nst-refined .nst-selection').classList.contains('is-bold'));
root.querySelector('.nst-refined [data-action="clear"]').click();
assert.equal(root.querySelector('.nst-refined .nst-selection').className,'nst-selection');
dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{privateContent:{selectionToolbarStudy:{revision:1,radius:11,shadow:7}}}}}}));
assert.equal(root.style.getPropertyValue('--nst-radius'),'11px');assert.equal(snapshots.length,0);
assert.deepEqual(errors,[]);dom.window.close();
const {chromium}=await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const bundle=readFileSync(process.env.NOTEFLOW_LUCIDE_BUNDLE,'utf8');
const url=new URL('./noteflow-selection-toolbar-study.preview.html',import.meta.url).href;
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const reports=[],browserErrors=[],requests=[];
try{
  for(const [width,touch] of [[736,false],[480,false],[320,false],[320,true]]){
    const context=await browser.newContext({viewport:{width:width+32,height:1100},deviceScaleFactor:2,hasTouch:touch,isMobile:touch,colorScheme:'light'});
    await context.route('**/*',route=>{const u=route.request().url();if(u===url)return route.continue();if(/\/lucide@[^/]+\/dist\/umd\/lucide.js$/.test(u))return route.fulfill({contentType:'application/javascript',body:bundle});requests.push(u);return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>browserErrors.push(String(e)));await page.goto(url);
    const frame=page.frames().find(f=>f.parentFrame());
    await frame.waitForFunction(()=>document.querySelectorAll('.nst-toolbar svg.lucide').length===24);
    const candidate=frame.locator('.nst-refined'),bold=candidate.locator('[data-action="bold"]');
    const initial=await bold.evaluate(n=>({size:n.getBoundingClientRect().width,icon:getComputedStyle(n.querySelector('svg')).width,stroke:getComputedStyle(n.querySelector('svg')).strokeWidth}));
    assert.equal(initial.size,touch?44:31);assert.equal(initial.icon,'15px');assert.equal(initial.stroke,'1.7px');
    await bold.click();assert.equal(await bold.getAttribute('aria-pressed'),'true');
    assert.equal(await candidate.locator('.nst-selection').evaluate(n=>getComputedStyle(n).fontWeight),'600');
    await candidate.locator('[data-action="clear"]').click();assert.equal(await bold.getAttribute('aria-pressed'),'false');
    await frame.locator('.viz-carousel-next').click();assert.equal(await frame.locator('[data-variant="当前样式"]').isVisible(),true);
    await frame.locator('.viz-carousel-previous').click();assert.equal(await candidate.isVisible(),true);
    if(!touch){await bold.focus();await page.keyboard.press('Tab');const italic=candidate.locator('[data-action="italic"]');assert.equal(await italic.evaluate(n=>document.activeElement===n),true);assert.notEqual(await italic.evaluate(n=>getComputedStyle(n).outlineStyle),'none');}
    await frame.evaluate(()=>{document.activeElement?.blur();document.querySelectorAll('[data-variant]').forEach(n=>n.hidden=false);});
    const bounds=await frame.locator('.nst-toolbar').evaluateAll(nodes=>nodes.map(n=>{const bar=n.getBoundingClientRect(),paper=n.closest('.nst-paper').getBoundingClientRect();return{within:bar.left>=paper.left&&bar.right<=paper.right,buttons:Array.from(n.querySelectorAll('button')).every(b=>{const r=b.getBoundingClientRect();return r.left>=bar.left&&r.right<=bar.right&&r.top>=bar.top&&r.bottom<=bar.bottom;}),height:bar.height};}));
    assert.ok(bounds.every(n=>n.within&&n.buttons));
    assert.deepEqual(await frame.locator('.nst-stage').evaluateAll(n=>n.map(e=>e.getBoundingClientRect().height)),touch?[400,400]:width<=520?[348,348]:[282,282]);
    assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth),width);
    await page.mouse.move(0,0);await page.waitForTimeout(170);
    await frame.evaluate(()=>{document.querySelector('.viz-carousel-controls').style.display='none';const carousel=document.querySelector('.viz-carousel');carousel.style.paddingBottom='0';const sections=Array.from(carousel.querySelectorAll(':scope > section'));carousel.insertBefore(sections[1],sections[0]);});
    if(width===736&&!touch)await frame.locator('#nf-selection-study').screenshot({path:fileURLToPath(new URL('./noteflow-selection-toolbar-study-comparison.png',import.meta.url))});
    if(width===320&&touch)await frame.locator('#nf-selection-study').screenshot({path:fileURLToPath(new URL('./noteflow-selection-toolbar-study-mobile.png',import.meta.url))});
    await frame.evaluate(()=>document.documentElement.style.colorScheme='dark');
    assert.equal(await candidate.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(32, 37, 44)');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await bold.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    reports.push({width,touch,initial,bounds,dark:true,reducedMotion:true});await context.close();
  }
  assert.deepEqual(browserErrors,[]);assert.ok(requests.every(u=>u==='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js'));
  console.log(JSON.stringify({ok:true,designOnly:true,stateRestore:true,reports,browserErrors,externalRequests:requests},null,2));
}finally{await browser.close();}
