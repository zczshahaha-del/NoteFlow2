// Offline design QA only: no running NoteFlow app, email, accounts or API calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('./noteflow-auth-entry.source.html',import.meta.url),'utf8');
assert.ok(!/<svg|fetch\(|XMLHttpRequest|WebSocket|<html|<body|<head>|tabindex=|title=/i.test(source));
assert.ok(Buffer.byteLength(source)<1024*1024);
assert.ok(!source.includes('__NOTEFLOW_EXISTING_BRAND__'));
const snapshots=[],domErrors=[];
const dom=new JSDOM(source,{runScripts:'dangerously',beforeParse(w){w.openai={setWidgetState(s){snapshots.push(s);return Promise.resolve();}};w.addEventListener('error',e=>domErrors.push(e.message));}});
const d=dom.window.document,form=d.querySelector('.nfa-form');
const restore=s=>dom.window.dispatchEvent(new dom.window.CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{privateContent:{authEntry:s}}}}}));
const baseline={design:'noteflow-auth-entry-a',revision:1,views:[{mode:'register',method:'code'}],width:390,radius:14};
assert.equal(snapshots.length,0);restore({...baseline,design:'foreign'});assert.equal(form.dataset.mode,'login');
restore({...baseline,revision:99});assert.equal(form.dataset.mode,'login');
restore(baseline);assert.equal(form.dataset.mode,'register');assert.equal(snapshots.length,0);
const email=form.querySelector('[data-input="email"]');email.value='design@example.invalid';email.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
form.querySelector('[data-mode="login"]').click();form.querySelector('[data-input="code"]').value='123456';
restore(baseline);assert.equal(form.dataset.mode,'login');assert.equal(form.querySelector('[data-input="code"]').value,'123456');
form.querySelector('[data-mode="register"]').click();assert.equal(email.value,'design@example.invalid');assert.equal(form.querySelector('[data-input="code"]').value,'');
assert.equal(form.querySelector('[data-input="password"]').disabled,true);
assert.ok(snapshots.length>0);assert.ok(!JSON.stringify(snapshots).includes('design@example.invalid'));assert.ok(!JSON.stringify(snapshots).includes('123456'));
assert.deepEqual(domErrors,[]);dom.window.close();
const {chromium}=await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const bundle=readFileSync(process.env.NOTEFLOW_LUCIDE_BUNDLE,'utf8');
const url=new URL('./noteflow-auth-entry.preview.html',import.meta.url).href;
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const reports=[],errors=[],blocked=[];
const artifact=name=>fileURLToPath(new URL(`./noteflow-auth-entry-${name}.png`,import.meta.url));
try {
  for (const width of [1024,736,320]) {
    const context=await browser.newContext({viewport:{width:width+32,height:1000},hasTouch:width===320,isMobile:width===320,colorScheme:'light',deviceScaleFactor:1});
    await context.route('**/*',route=>{const u=route.request().url();if(u===url)return route.continue();if(/\/lucide@[^/]+\/dist\/umd\/lucide.js$/.test(u))return route.fulfill({contentType:'application/javascript',body:bundle});blocked.push(u);if(u!=='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js')console.log(JSON.stringify({blockedUnexpected:u}));return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(url);
    const frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>document.querySelector('.nfa-header img')?.complete && document.querySelector('.nfa-submit svg.lucide'));
    assert.deepEqual(errors,[]);
    for (const variant of ['柔和留白','轻盈聚焦']) {
      if(variant==='轻盈聚焦')await frame.locator('.viz-carousel-next').click();
      const stage=frame.locator(`[data-variant="${variant}"] .nfa-page`),f=stage.locator('.nfa-form');
      const get=n=>f.locator(`[data-${n.startsWith('mode:')?'mode':'action'}="${n.replace('mode:','')}"]`);
      const input=n=>f.locator(`[data-input="${n}"]`),feedback=f.locator('.nfa-feedback'),submit=f.locator('.nfa-submit');
      const box=()=>submit.boundingBox(),start=await box();
      assert.equal(await stage.evaluate(n=>n.getBoundingClientRect().height),850);
      const icon=await stage.locator('.nfa-input-wrap svg').first().evaluate(n=>({width:getComputedStyle(n).width,stroke:getComputedStyle(n).strokeWidth}));
      assert.deepEqual(icon,{width:'18px',stroke:'1.65px'});
      assert.equal(await input('password').isDisabled(),true);
      await submit.click();assert.match(await feedback.textContent(),/有效的邮箱/);assert.equal((await box()).y,start.y);
      await input('email').fill('design@example.invalid');await get('send').click();assert.equal((await box()).y,start.y);
      assert.equal(await get('send').textContent(),'发送中…');await page.waitForTimeout(720);assert.match(await feedback.textContent(),/未实际发邮件/);
      await input('code').fill('123456');await submit.click();assert.equal((await box()).y,start.y);assert.equal(await submit.getAttribute('aria-busy'),'true');
      await submit.click();assert.match(await feedback.textContent(),/已取消/);assert.match(await get('send').textContent(),/后重发/);assert.equal(await input('code').inputValue(),'123456');
      await page.waitForTimeout(950);assert.match(await feedback.textContent(),/已取消/);
      await get('mode:register').click();assert.equal(await input('code').inputValue(),'');assert.equal(await input('email').inputValue(),'design@example.invalid');assert.equal((await box()).y,start.y);
      assert.equal(await input('password').isDisabled(),true);assert.equal(await get('send').textContent(),'获取验证码');
      await input('code').fill('123456');await submit.click();await input('code').fill('654321');await page.waitForTimeout(950);assert.equal(await feedback.textContent(),'');assert.equal(await submit.getAttribute('aria-busy'),'false');
      await get('mode:login').click();await get('method').click();assert.equal(await input('code').isDisabled(),true);assert.equal(await input('password').isDisabled(),false);
      await input('password').fill('mock-password');await get('eye').click();assert.equal(await input('password').getAttribute('type'),'text');
      await get('reset').click();assert.ok(await input('email').evaluate(n=>document.activeElement===n));assert.equal(await input('password').getAttribute('autocomplete'),'new-password');
      assert.equal(await stage.evaluate(n=>n.getBoundingClientRect().height),850);
      await get('back').click();assert.ok(await get('reset').evaluate(n=>document.activeElement===n));assert.equal(await input('password').inputValue(),'mock-password');
      await get('method').click();await get('send').click();await get('mode:register').click();await page.waitForTimeout(740);assert.equal(await feedback.textContent(),'');assert.equal(await get('send').textContent(),'获取验证码');
      await input('email').fill('');await input('code').fill('');await page.mouse.move(0,0);await frame.evaluate(()=>document.activeElement?.blur());
      await input('email').focus();await page.keyboard.press('Enter');assert.match(await feedback.textContent(),/有效的邮箱/);
      await input('email').fill('temporary@example.invalid');await input('email').fill('');await frame.evaluate(()=>document.activeElement?.blur());
      const layout=await stage.evaluate(n=>{const boxes=[...n.querySelectorAll('input,button')].filter(e=>e.getClientRects().length).map(e=>({r:e.getBoundingClientRect(),tag:e.tagName}));const b=n.getBoundingClientRect();return{viewport:innerWidth,scroll:document.documentElement.scrollWidth,height:b.height,fit:boxes.every(e=>e.r.left>=b.left-.5&&e.r.right<=b.right+.5),touch:boxes.filter(e=>e.tag==='BUTTON').every(e=>e.r.height>=44),size:getComputedStyle(n.querySelector('input')).fontSize};});
      assert.equal(layout.viewport,width);assert.equal(layout.scroll,width);assert.ok(layout.fit);assert.equal(layout.size,'16px');if(width===320)assert.ok(layout.touch);
      if(width===1024) {
        await get('mode:login').click();await frame.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(250);await stage.screenshot({path:artifact(variant==='柔和留白'?'login':'focus-login')});
        await get('mode:register').click();await frame.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(250);await stage.screenshot({path:artifact(variant==='柔和留白'?'register':'focus-register')});
      }
      if(width===320) {await page.waitForTimeout(250);await stage.screenshot({path:artifact(variant==='柔和留白'?'mobile':'focus-mobile')});}
      await page.emulateMedia({colorScheme:'dark'});await frame.evaluate(()=>document.documentElement.style.colorScheme='dark');await page.waitForTimeout(260);
      const dark=await stage.evaluate(n=>getComputedStyle(n).backgroundColor);assert.notEqual(dark,'rgb(252, 252, 253)');
      assert.equal(await stage.locator('.nfa-input-wrap').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(40, 45, 53)');
      assert.equal(await stage.locator('.nfa-switch-thumb').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(58, 67, 80)');
      if(width===1024)await stage.screenshot({path:artifact(variant==='柔和留白'?'dark':'focus-dark')});
      await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await submit.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
      await frame.evaluate(()=>document.documentElement.style.colorScheme='light');await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
      reports.push({variant,width,...layout,dark,reducedMotion:true,cancel:true,purposeSwitch:true,focusReturn:true,stableSubmit:true});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.ok(blocked.every(u=>u==='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js'),JSON.stringify([...new Set(blocked)]));
  console.log(JSON.stringify({ok:true,designOnly:true,statePrivacy:true,networkBlocked:true,reports,errors},null,2));
} finally {await browser.close();}
