// Real LoginPage, auth services and built CSS; fresh offline contexts only.
// No existing app/profile, account creation, email or model requests.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const css = readFileSync(new URL(readdirSync(assets).find(x => /^index-.*\.css$/.test(x)), assets), 'utf8');
const logo = 'data:image/svg+xml;base64,' + readFileSync(new URL('../public/noteflow_icon.svg', import.meta.url)).toString('base64');
const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
import LoginPage from ${JSON.stringify(root + 'src/components/LoginPage.tsx')};
import {login,loginWithEmailCode,register} from ${JSON.stringify(root + 'src/services/auth.ts')};
const api=window.authTest={calls:[],hold:false,pending:[],fail:false,completed:0,development:true};
window.fetch=async (url,init={})=>{const body=JSON.parse(init.body||'{}');api.calls.push({url:String(url),body,aborted:false});
const call=api.calls.at(-1);init.signal?.addEventListener('abort',()=>call.aborted=true);
if(api.hold)await new Promise(resolve=>api.pending.push(resolve));
if(api.fail){const detail=typeof api.fail==='string'?api.fail:'合成失败，请重试。';api.fail=false;return new Response(JSON.stringify({detail}),{status:400})}
return new Response(JSON.stringify(String(url).endsWith('/request')?{message:'验证码已发送，请检查邮箱。',...(String(url).includes('password-reset') || !api.development?{}:{developmentCode:'314159'})}:
String(url).includes('password-reset')?{message:'密码已更新，请重新登录。'}:{user:{id:'synthetic',email:body.email,displayName:'合成用户',emailVerified:true}}),{status:200,headers:{'Content-Type':'application/json'}})};
createRoot(document.getElementById('root')).render(React.createElement(LoginPage,{
onSignIn:async(email,password)=>{await login({email,password});api.completed++},
onEmailCodeSignIn:async(email,code)=>{await loginWithEmailCode(email,code);api.completed++},
onSignUp:async(email,code)=>{await register({email,code});api.completed++}}));`;
const bundled = await build({configFile:false,logLevel:'silent',plugins:[{
  name:'offline-auth',resolveId(id){if(id==='virtual:offline-auth')return '\0offline-auth'},
  load(id){if(id==='\0offline-auth')return source},
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:offline-auth'}}});
const chunks = bundled.output.filter(x => x.type === 'chunk'); assert.equal(chunks.length,1);
const browser = await chromium.launch({headless:true,executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined});
const errors=[],requests=[],reports=[];
let activePage;
try {
  for(const width of [1024,736,320]) {
    const context=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:1});
    await context.route('**/*',route=>{
      if(route.request().url()==='https://auth-fixture.invalid/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      requests.push(route.request().url());return route.abort();
    });
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('"/noteflow_icon.svg"',JSON.stringify(logo)).replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.locator('.auth-form').waitFor();
    const email=page.getByRole('textbox',{name:'邮箱',exact:true});
    const code=page.getByRole('textbox',{name:'验证码',exact:true});
    const primary=page.locator('.auth-submit');
    const measure=()=>primary.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,color:s.color,bg:s.backgroundColor,radius:s.borderRadius,font:s.fontSize}});
    const release=()=>page.evaluate(()=>{window.authTest.hold=false;window.authTest.pending.splice(0).forEach(r=>r())});
    const shot=async(name)=>{
      await page.locator('.auth-fields').evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})))});
      if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR && width!==736)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-notion-'+name+'-'+width+'.png'});
    };
    const touchTargets=async()=>assert.ok(await page.locator('.auth-page button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).every(n=>{const r=n.getBoundingClientRect();return r.width>=44 && r.height>=44})));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const initial=await measure();assert.equal(initial.width,Math.min(360,width-48));assert.equal(initial.height,44);
    assert.equal(initial.bg,'rgb(82, 118, 154)');assert.equal(initial.radius,'8px');assert.equal(initial.font,'14px');
    assert.equal(await page.locator('.auth-switch').count(),0);assert.equal(await code.count(),0);
    assert.equal(await page.locator('input').count(),1);assert.equal(await primary.innerText(),'继续');
    await touchTargets();assert.ok(await primary.isDisabled());await shot('login');
    await email.fill('owner@example.com');await page.evaluate(()=>window.authTest.hold=true);await primary.click();
    await code.waitFor();assert.equal((await measure()).y,initial.y);
    await page.getByRole('button',{name:'注册',exact:true}).click();await release();
    assert.equal(await code.count(),0);assert.equal(await email.inputValue(),'owner@example.com');
    assert.ok(await page.evaluate(()=>window.authTest.calls[0].aborted));
    assert.equal(await page.locator('input').count(),1);assert.equal((await measure()).y,initial.y);
    await shot('register');await primary.click();await page.getByRole('status').filter({hasText:'开发环境'}).waitFor();
    assert.equal(await code.inputValue(),'314159');assert.equal((await measure()).y,initial.y);
    assert.equal(await page.evaluate(()=>window.authTest.calls.at(-1).body.purpose),'register');
    assert.equal(await page.evaluate(()=>window.authTest.completed),0,'sending never creates an account');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('autocomplete')==='one-time-code');
    await touchTargets();await primary.hover();await page.waitForTimeout(170);
    assert.equal((await measure()).bg,'rgb(73, 107, 141)');
    await code.fill('');await code.fill('314159');await page.mouse.move(0,0);await page.waitForTimeout(170);await shot('verify');
    await page.evaluate(()=>window.authTest.fail=true);await primary.click();await page.getByRole('alert').waitFor();
    assert.equal(await code.inputValue(),'314159');assert.equal((await measure()).y,initial.y);
    await page.evaluate(()=>window.authTest.fail='合成失败：'+'很长的错误说明。'.repeat(40));await primary.click();
    await page.getByRole('alert').waitFor();assert.equal((await measure()).y,initial.y);
    assert.ok(await page.getByRole('alert').locator('span').evaluate(n=>n.scrollHeight>n.clientHeight && n.scrollTop===0));
    await primary.click();await page.waitForFunction(()=>window.authTest.completed===1);
    const registered=await page.evaluate(()=>window.authTest.calls.at(-1));
    assert.ok(registered.url.endsWith('/register'));assert.deepEqual(registered.body,{email:'owner@example.com',code:'314159'});
    await page.getByRole('button',{name:'登录',exact:true}).click();
    const countBeforeReturn=await page.evaluate(()=>window.authTest.calls.length);await primary.click();
    assert.equal(await code.inputValue(),'');assert.equal(await page.evaluate(()=>window.authTest.calls.length),countBeforeReturn);
    assert.match(await page.locator('.auth-send').innerText(),/后重发/);
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    const password=page.locator('input[autocomplete="current-password"]');await password.fill('synthetic-password');
    await page.getByRole('button',{name:'显示密码',exact:true}).click();
    assert.equal(await password.getAttribute('type'),'text');assert.ok(await password.evaluate(n=>n===document.activeElement));
    await page.getByRole('button',{name:'隐藏密码',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');
    await shot('password');await page.getByRole('button',{name:'忘记密码？',exact:true}).click();
    assert.equal(await page.locator('input').count(),1);await primary.click();
    await page.getByRole('status').filter({hasText:'已发送'}).waitFor();assert.equal(await code.inputValue(),'');
    await code.fill('314159');await page.locator('input[autocomplete="new-password"]').fill('new-password-123');await primary.click();
    await page.getByRole('status').filter({hasText:'密码已更新'}).waitFor();assert.equal(await password.inputValue(),'');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('autocomplete')==='current-password');
    await password.fill('new-password-123');await password.press('Enter');await page.waitForFunction(()=>window.authTest.completed===2);
    await page.getByRole('button',{name:'使用验证码登录',exact:true}).click();await primary.click();
    await code.fill('314159');await code.press('Enter');await page.waitForFunction(()=>window.authTest.completed===3);
    assert.ok(await page.evaluate(()=>window.authTest.calls.at(-1).url.endsWith('/email-code/confirm')));
    await code.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await page.evaluate(()=>window.authTest.completed),3);
    await page.evaluate(()=>window.authTest.hold=true);await primary.click();assert.ok(await code.isDisabled());
    assert.ok(await page.getByRole('button',{name:'注册',exact:true}).isDisabled());
    assert.ok(await page.getByRole('button',{name:'修改邮箱',exact:true}).isDisabled());
    const count=await page.evaluate(()=>window.authTest.calls.length);await page.locator('form').dispatchEvent('submit');
    assert.equal(await page.evaluate(()=>window.authTest.calls.length),count);await release();await page.waitForFunction(()=>window.authTest.completed===4);
    await page.getByRole('button',{name:'修改邮箱',exact:true}).click();await email.fill('cancel@example.com');
    await page.evaluate(()=>window.authTest.hold=true);await primary.click();await page.getByRole('button',{name:'取消等待',exact:true}).click();
    await release();assert.equal(await code.inputValue(),'');assert.match(await page.locator('.auth-send').innerText(),/后重发/);
    assert.match(await page.getByRole('status').innerText(),/已停止等待/);assert.ok(await page.evaluate(()=>window.authTest.calls.at(-1).aborted));
    await page.getByRole('button',{name:'修改邮箱',exact:true}).click();
    const cancelCount=await page.evaluate(()=>window.authTest.calls.length);await primary.click();
    assert.equal(await page.evaluate(()=>window.authTest.calls.length),cancelCount);assert.equal(await code.inputValue(),'');
    await page.getByRole('button',{name:'修改邮箱',exact:true}).click();await email.fill('edit@example.com');
    await page.evaluate(()=>window.authTest.hold=true);await primary.click();await code.fill('222222');await release();
    assert.equal(await code.inputValue(),'222222');assert.ok(await page.evaluate(()=>window.authTest.calls.at(-1).aborted));
    await page.getByRole('button',{name:'修改邮箱',exact:true}).click();await email.fill('failure@example.com');
    await page.evaluate(()=>window.authTest.fail=true);await primary.click();await page.getByRole('alert').waitFor();
    assert.ok(await primary.isDisabled());assert.match(await page.locator('.auth-send').innerText(),/后重发/);
    await page.getByRole('button',{name:'修改邮箱',exact:true}).click();assert.equal(await email.inputValue(),'failure@example.com');
    await page.evaluate(()=>window.authTest.development=false);
    await email.fill('long.alias.'.repeat(4)+'@example.com');await primary.click();await page.getByRole('status').filter({hasText:'已发送'}).waitFor();
    assert.equal(await code.inputValue(),'');assert.equal(await page.evaluate(()=>window.authTest.completed),4);
    await code.fill('314159');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.equal((await measure()).y,initial.y);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await page.mouse.move(0,0);await page.waitForTimeout(170);
    assert.equal((await measure()).bg,'rgb(155, 189, 224)');assert.equal((await measure()).color,'rgb(25, 43, 59)');
    await shot('dark');await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.auth-fields').evaluate(n=>getComputedStyle(n).animationName),'none');
    assert.equal(await primary.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    await page.setViewportSize({width,height:480});await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    await page.getByRole('button',{name:'忘记密码？',exact:true}).click();await primary.click();
    await page.getByRole('status').filter({hasText:'已发送'}).waitFor();await primary.scrollIntoViewIfNeeded();
    assert.ok(await primary.evaluate(n=>{const r=n.getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const storage=await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))));
    assert.ok(!storage.includes('password-123') && !storage.includes('314159'));
    await page.getByRole('button',{name:'返回登录',exact:true}).click();await password.fill('synthetic-password');
    await page.evaluate(()=>Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Synthetic storage denied','SecurityError')}}));
    await primary.click();await page.waitForFunction(()=>window.authTest.completed===5);
    reports.push({width,initial,emailFirst:true,explicitRegistration:true,stablePrimaryAcrossEmailCode:true,purposeIsolation:true,failureRetry:true,cancelStale:true,passwordReset:true,realAuthServicePayloads:true,dark:true,reducedMotion:true,shortViewport:true,longEmail:true,storageDeniedAuthSucceeds:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,productionComponentAndServices:true,syntheticFetch:true,networkBlocked:true,reports,errors},null,2));
} catch(error) {
  if(activePage) console.error(await activePage.evaluate(()=>({text:document.body.innerText,calls:window.authTest?.calls.map(x=>({url:x.url,purpose:x.body.purpose,aborted:x.aborted})),completed:window.authTest?.completed})));
  throw error;
} finally {await browser.close()}
