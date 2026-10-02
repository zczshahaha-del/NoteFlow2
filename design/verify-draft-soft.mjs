// Design-only verification. Fresh isolated browser; never opens localhost or a
// user session. The only allowed network response is the local Lucide bundle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const source=readFileSync(new URL('./noteflow-draft-soft.source.html',import.meta.url),'utf8');
assert.ok(!/<svg|fetch\(|XMLHttpRequest|WebSocket|<html|<body|<head>/i.test(source));
const snapshots=[], domErrors=[];
const dom=new JSDOM(source,{runScripts:'dangerously',beforeParse(win){
  win.openai={setWidgetState(value){snapshots.push(value);return Promise.resolve();}};
  win.addEventListener('error',event=>domErrors.push(event.message));
}});
const d=dom.window.document,soft=d.querySelector('[data-view="soft"]'),reference=d.querySelector('[data-view="reference"]');
const click=action=>soft.querySelector(`[data-action="${action}"]`).click();
const fill=(node,value)=>{node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
assert.equal(snapshots.length,0,'do not persist on initial render');
assert.equal(d.querySelectorAll('[data-variant]').length,2);
assert.deepEqual([...soft.querySelectorAll('.nds-tools [data-action]')].map(n=>n.dataset.action),['directory','requirements','generate-all','save','more','close']);
click('requirements');assert.ok(soft.querySelector('[data-action="preview-apply"]').disabled);assert.ok(soft.querySelector('[data-action="preview-rewrite"]').disabled);
fill(soft.querySelector('[data-panel="requirements"] textarea'),'PRIVATE TEST TEXT');
assert.ok(!soft.querySelector('[data-action="preview-apply"]').disabled);click('preview-apply');assert.ok(!soft.querySelector('[data-panel]'));
click('requirements');assert.equal(soft.querySelector('[data-panel="requirements"] textarea').value,'PRIVATE TEST TEXT');assert.ok(soft.querySelector('[data-action="preview-apply"]').disabled);
const field=soft.querySelector('textarea[aria-label="全文写作要求"]');
field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}));assert.ok(soft.querySelector('[data-panel]'));
field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.ok(!soft.querySelector('[data-panel]'));assert.equal(d.activeElement.dataset.action,'requirements');
click('save');assert.equal(soft.querySelector('.nds-modal-layer [data-panel]').dataset.panel,'save');fill(soft.querySelector('input'),'');assert.ok(soft.querySelector('[data-action="preview-save"]').disabled);click('dismiss-panel');assert.ok(!soft.querySelector('.nds-modal-layer'));
assert.ok(soft.querySelector('[data-action="revise"]').disabled);fill(soft.querySelector('.nds-revision textarea'),'PRIVATE REVISION TEXT');assert.ok(!soft.querySelector('[data-action="revise"]').disabled);
click('edit');fill(soft.querySelector('.nds-edit-field'),'PRIVATE BODY TEXT');click('edit');assert.equal(reference.querySelector('.nds-reading').textContent,'PRIVATE BODY TEXT');
click('confirm');assert.ok(soft.querySelector('[data-action="confirm"]').hidden);assert.match(soft.querySelector('[data-chapter="1"]').getAttribute('aria-label'),/已确认/);
soft.querySelector('[data-chapter="2"]').click();assert.ok(soft.querySelector('[data-action="generate-section"]'));assert.ok(soft.querySelector('.nds-footer-actions').hidden);
assert.ok(!JSON.stringify(snapshots).includes('PRIVATE'),'never persist entered text');
const send=saved=>dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{privateContent:{draftDesign:saved}}}}}));
const saved=snapshots.at(-1).privateContent.draftDesign,count=snapshots.length;
send({...saved,design:'foreign',selected:0});assert.equal(soft.querySelector('[aria-current]').dataset.chapter,'2');
send({...saved,revision:0,selected:0});assert.equal(soft.querySelector('[aria-current]').dataset.chapter,'2');
send({...saved,revision:100,selected:1,radius:99,rowHeight:99});assert.equal(soft.querySelector('[aria-current]').dataset.chapter,'1');assert.equal(d.getElementById('nf-draft-study').style.getPropertyValue('--nds-radius'),'24px');assert.equal(snapshots.length,count);assert.deepEqual(domErrors,[]);dom.window.close();

const {chromium}=await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const lucide=readFileSync(process.env.NOTEFLOW_LUCIDE_BUNDLE,'utf8');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const reports=[],errors=[],unexpectedRequests=[];
const previewURL=new URL('./noteflow-draft-soft.preview.html',import.meta.url).href;
try {
  for(const mobile of [false,true]) {
    const context=await browser.newContext({viewport:{width:mobile?352:768,height:1400},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,colorScheme:'light'});
    await context.route('**/*',route=>{const url=route.request().url();if(url===previewURL)return route.continue();if(/\/lucide@[^/]+\/dist\/umd\/lucide.js$/.test(url))return route.fulfill({contentType:'application/javascript',body:lucide});unexpectedRequests.push(url);return route.abort();});
    const page=await context.newPage();page.on('pageerror',err=>errors.push(String(err)));
    await page.goto(previewURL);
    const frame=page.frames().find(f=>f.parentFrame());
    await frame.waitForFunction(()=>document.querySelector('[data-view="soft"] svg.lucide'));
    await frame.locator('.viz-carousel-next').click();
    const view=frame.locator('[data-view="soft"]');
    const measure=()=>frame.evaluate(()=>{
      const root=document.getElementById('nf-draft-study'),view=root.querySelector('[data-view="soft"]'),r=view.getBoundingClientRect();
      const visible=[...view.querySelectorAll('button')].filter(n=>n.getBoundingClientRect().width>0);
      return {contentWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,windowWidth:r.width,height:r.height,border:getComputedStyle(view).borderWidth,radius:getComputedStyle(view).borderRadius,background:getComputedStyle(view).backgroundColor,minButton:Math.min(...visible.map(n=>n.getBoundingClientRect().height)),clipped:visible.some(n=>{const b=n.getBoundingClientRect();return b.left<r.left-1 || b.right>r.right+1}),icon:getComputedStyle(view.querySelector('.nds-action svg')).width,revisionFont:getComputedStyle(view.querySelector('.nds-revision textarea')).fontSize};
    });
    const initial=await measure();assert.equal(initial.contentWidth,mobile?320:736);assert.equal(initial.scrollWidth,initial.contentWidth);assert.equal(initial.border,'0px');assert.equal(initial.icon,'17px');assert.equal(initial.clipped,false);if(mobile){assert.ok(initial.minButton>=44);assert.equal(initial.revisionFont,'16px');}
    const revision=view.locator('.nds-revision textarea');
    assert.equal(await revision.evaluate(n=>getComputedStyle(n).resize),'none');
    const close=view.locator('[data-action="close"]');
    const closeStyle=await close.evaluate(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect(),i=n.querySelector('svg');return {radius:s.borderRadius,border:s.borderWidth,background:s.backgroundColor,icon:getComputedStyle(i).width,stroke:getComputedStyle(i).strokeWidth,width:r.width,height:r.height};});
    assert.equal(closeStyle.radius,'50%');assert.equal(closeStyle.border,'0px');assert.equal(closeStyle.icon,'14px');assert.equal(closeStyle.stroke,'1.8px');if(mobile)assert.ok(closeStyle.width>=44 && closeStyle.height>=44);
    if(!mobile){await close.hover();await page.waitForTimeout(180);assert.notEqual(await close.evaluate(n=>getComputedStyle(n).backgroundColor),closeStyle.background);await page.mouse.move(0,0);}
    await revision.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行');
    const grown=await revision.evaluate(n=>({height:n.getBoundingClientRect().height,overflow:getComputedStyle(n).overflowY,scroll:n.scrollHeight}));assert.ok(grown.height>52 && grown.height<=104);assert.ok(grown.scroll>grown.height && grown.overflow==='auto');assert.equal((await measure()).clipped,false);
    await revision.fill('');assert.equal(await revision.evaluate(n=>n.getBoundingClientRect().height),52);assert.ok(await view.locator('[data-action="revise"]').isDisabled());
    await view.locator('[data-action="requirements"]').click();
    const bounds=await view.locator('[data-panel="requirements"]').evaluate(n=>{const r=n.getBoundingClientRect(),v=n.closest('[data-view]').getBoundingClientRect();return r.left>=v.left && r.right<=v.right && r.bottom<=v.bottom;});assert.ok(bounds);
    await view.locator('[data-action="dismiss-panel"]').click();assert.equal(await view.locator('[data-action="requirements"]').evaluate(n=>n===document.activeElement),true);
    await view.locator('[data-action="save"]').click();
    await page.waitForTimeout(220); // Measure the settled surface, after its 180ms entry.
    const modal=await view.locator('[data-panel="save"]').evaluate(n=>{const r=n.getBoundingClientRect(),v=n.closest('[data-view]').getBoundingClientRect(),s=getComputedStyle(n),p=getComputedStyle(n.parentElement);return {offsetX:Math.abs((r.left+r.right-v.left-v.right)/2),offsetY:Math.abs((r.top+r.bottom-v.top-v.bottom)/2),inside:r.left>=v.left && r.right<=v.right && r.top>=v.top && r.bottom<=v.bottom,panel:{x:r.x,width:r.width},window:{x:v.x,width:v.width},css:{width:s.width,max:s.maxWidth,grid:p.gridTemplateColumns,display:p.display,padding:p.padding}};});assert.ok(modal.inside && modal.offsetX<1 && modal.offsetY<1,JSON.stringify(modal));
    await view.locator('input').press('Escape');assert.equal(await view.locator('.nds-modal-layer').count(),0);
    await view.locator('[data-chapter="2"]').click();assert.equal(await view.locator('[data-action="generate-section"]').count(),1);await view.locator('[data-chapter="1"]').click();
    // Full comparison screenshots are an ephemeral test arrangement, not an
    // added carousel mode or a claim that both actual app windows are open.
    await frame.evaluate(()=>{document.querySelectorAll('[data-variant]').forEach(n=>n.hidden=false);window.scrollTo(0,0);});
    const stageHeights=await frame.locator('.nds-stage').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
    assert.deepEqual(stageHeights,mobile?[1120,1120]:[712,712]);
    const fullHeight=await frame.locator('#nf-draft-study').evaluate(n=>Math.ceil(n.getBoundingClientRect().height));
    await page.setViewportSize({width:mobile?352:768,height:fullHeight+64});
    await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(0,0);await page.waitForTimeout(250);
    await frame.locator('#nf-draft-study').screenshot({path:fileURLToPath(new URL(mobile?'./noteflow-draft-soft-mobile.png':'./noteflow-draft-soft.png',import.meta.url))});
    await frame.evaluate(()=>document.documentElement.style.colorScheme='dark');
    assert.equal((await measure()).background,'rgb(37, 43, 51)');
    if(!mobile)await frame.locator('#nf-draft-study').screenshot({path:fileURLToPath(new URL('./noteflow-draft-soft-dark.png',import.meta.url))});
    await page.emulateMedia({reducedMotion:'reduce'});
    await view.locator('[data-action="requirements"]').click();assert.equal(await view.locator('[data-panel]').evaluate(n=>getComputedStyle(n).animationDuration),'0s');
    await context.close();reports.push({mobile,initial,closeStyle,revisionAutoGrowth:grown,requirementsWithinWindow:true,saveCentered:modal,keyboardFocus:true,dark:true,reducedMotion:true});
  }
  assert.deepEqual(errors,[]);assert.ok(unexpectedRequests.every(url=>url==='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js'),'only the optional wrapper positioning asset may be attempted and blocked');
  console.log(JSON.stringify({ok:true,designOnly:true,domStateAndPrivacy:true,networkBlocked:true,blockedOptionalAssets:unexpectedRequests,reports,errors},null,2));
} finally {await browser.close();}
