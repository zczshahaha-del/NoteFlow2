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
const appRoot=createRoot(document.getElementById('root'));
const props={
onSignIn:async(email,password)=>{await login({email,password});api.completed++},
onEmailCodeSignIn:async(email,code)=>{await loginWithEmailCode(email,code);api.completed++},
onSignUp:async(email,code)=>{await register({email,code});api.completed++}};
api.show=()=>appRoot.render(React.createElement(React.StrictMode,null,React.createElement(LoginPage,props)));
api.hide=()=>appRoot.render(null);api.show();`;
const bundled = await build({configFile:false,logLevel:'silent',plugins:[{
  name:'offline-auth',resolveId(id){if(id==='virtual:offline-auth')return '\0offline-auth'},
  load(id){if(id==='\0offline-auth')return source},
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:offline-auth',output:{codeSplitting:false}}}});
const chunks = bundled.output.filter(x => x.type === 'chunk'); assert.equal(chunks.length,1);
const browser = await chromium.launch({headless:true,executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined});
const errors=[],requests=[],reports=[];
let activePage;
try {
  for(const width of (process.env.NOTEFLOW_AUTH_ANIMATION_ONLY ? [] : [1024,736,320])) {
    const context=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:1,reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      if(route.request().url()==='https://auth-fixture.invalid/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      requests.push(route.request().url());return route.abort();
    });
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('"/noteflow_icon.svg"',JSON.stringify(logo)).replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.locator('.auth-form').waitFor();
    await page.locator('#cloth-character-login[data-cloth-ready="true"]').waitFor();
    const email=page.getByRole('textbox',{name:'邮箱',exact:true});
    const code=page.getByRole('textbox',{name:'验证码',exact:true});
    const primary=page.locator('.auth-submit');
    const measure=()=>primary.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y+n.closest('.auth-page').scrollTop,width:r.width,height:r.height,color:s.color,bg:s.backgroundColor,radius:s.borderRadius,font:s.fontSize}});
    const release=()=>page.evaluate(()=>{window.authTest.hold=false;window.authTest.pending.splice(0).forEach(r=>r())});
    const shot=async(name)=>{
      await page.locator('.auth-fields').evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})))});
      if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR && width!==736)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-cloth-'+name+'-'+width+'.png'});
    };
    const touchTargets=async()=>assert.ok(await page.locator('.auth-page button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).every(n=>{const r=n.getBoundingClientRect();return r.width>=44 && r.height>=44})));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const initial=await measure();
    assert.ok(initial.width>=160 && initial.width<=270);assert.equal(initial.height,48);
    assert.equal(initial.bg,'rgba(0, 0, 0, 0)');assert.equal(initial.radius,'4px');assert.equal(initial.font,'14px');
    assert.equal(await page.locator('.cl-scene').evaluate(n=>n.dataset.entrance),'ready');
    assert.equal(await page.locator('.auth-switch').count(),0);assert.equal(await code.count(),0);
    assert.equal(await page.locator('input').count(),1);assert.equal(await primary.innerText(),'获取验证码');
    assert.equal(await page.locator('[data-replay],[data-reset],.intro,.site-footer,.cl-hint').count(),0);
    assert.ok(await page.locator('.cl-bubble').isHidden());
    assert.equal(await page.locator('.auth-feedback').evaluate(n=>n.getBoundingClientRect().height),0);
    const optionTop=await page.locator('.auth-options').evaluate(n=>n.getBoundingClientRect().top);
    assert.ok(optionTop>initial.y+initial.height && optionTop<initial.y+initial.height+130,'account actions stay close to the form');
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
    assert.equal((await measure()).bg,'rgba(0, 0, 0, 0)');
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
    await page.locator('.auth-options').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.auth-options button').evaluateAll(nodes=>nodes.every(n=>{
      const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return hit===n||n.contains(hit);
    })),'the animation scene must not intercept the account actions');
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
    assert.equal(await page.locator('#cloth-character-login').evaluate(n=>getComputedStyle(n).colorScheme),'dark');
    assert.equal(await page.locator('.cl-probe').evaluate(n=>getComputedStyle(n).color),'rgb(255, 182, 160)');
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
  // Normal-motion integration: same production component, no auth/network actions.
  const auditSource = `(()=>{
    window.clothLabels=new Set();
    const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.clothLabels.add(String(text));return fillText.call(this,text,...args)};
    const frames=new Set(), observers={resize:new Set(),intersection:new Set(),mutation:new Set()}, listeners=[];
    const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{let id=request(time=>{frames.delete(id);callback(time)});frames.add(id);return id};
    window.cancelAnimationFrame=id=>{frames.delete(id);cancel(id)};
    for(const [name,key] of [['ResizeObserver','resize'],['IntersectionObserver','intersection'],['MutationObserver','mutation']]){
      const Base=window[name];window[name]=class extends Base {
        observe(...args){if(key!=='mutation'||(args[0]===document.documentElement&&args[1]?.attributeFilter?.includes('class')))observers[key].add(this);return super.observe(...args)}
        disconnect(){observers[key].delete(this);return super.disconnect()}
      };
    }
    const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
    const tracked=(target,type)=>((target===window||target===document)&&['pointerup','pointercancel','blur','visibilitychange'].includes(type))||(target instanceof MediaQueryList&&type==='change');
    EventTarget.prototype.addEventListener=function(type,callback,options){
      const capture=typeof options==='boolean'?options:!!options?.capture;
      // The driver adds a persistent window pointerup hit-test interceptor on first click.
      // It belongs to Playwright, not the mounted application.
      if(tracked(this,type)&&!String(callback).includes('_hitTargetInterceptor')&&!listeners.some(x=>x.target===this&&x.type===type&&x.callback===callback&&x.capture===capture))listeners.push({target:this,type,callback,capture});
      return add.call(this,type,callback,options);
    };
    EventTarget.prototype.removeEventListener=function(type,callback,options){
      const capture=typeof options==='boolean'?options:!!options?.capture;
      const index=listeners.findIndex(x=>x.target===this&&x.type===type&&x.callback===callback&&x.capture===capture);
      if(index>=0)listeners.splice(index,1);return remove.call(this,type,callback,options);
    };
    window.clothAudit=()=>({frames:frames.size,listeners:listeners.length,resize:observers.resize.size,intersection:observers.intersection.size,mutation:observers.mutation.size});
    window.clothListenerDetails=()=>listeners.map(x=>({type:x.type,target:x.target===window?'window':x.target===document?'document':'media',callback:String(x.callback).slice(0,100)}));
  })();`;
  for (const width of [1280,736,320]) {
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1,reducedMotion:'no-preference'});
    await context.route('**/*',route=>route.request().url()==='https://auth-fixture.invalid/'?
      route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+auditSource+'</script><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.locator('#cloth-character-login[data-cloth-ready="true"]').waitFor();
    const scene=page.locator('.cl-scene');
    const remount=async(focus=true)=>{
      await page.evaluate(()=>window.authTest.hide());await page.locator('.auth-page').waitFor({state:'detached'});
      await page.evaluate(()=>window.authTest.show());await page.locator('#cloth-character-login[data-cloth-ready="true"]').waitFor();
      if(focus)await page.getByRole('textbox',{name:'邮箱',exact:true}).focus();
    };
    assert.equal(await scene.getAttribute('data-entrance'),'entering');
    assert.ok(Number(await scene.getAttribute('data-time'))<1);
    await page.waitForFunction(()=>Number(document.querySelector('.cl-scene')?.dataset.time)>=3.08,{},{timeout:20000});
    assert.notEqual(await scene.getAttribute('data-entrance'),'entering');
    await page.waitForFunction(()=>document.querySelector('.cl-scene')?.dataset.entrance==='ready',{},{timeout:20000});
    const labels=await page.evaluate(()=>[...window.clothLabels]);
    assert.ok(labels.includes('登录')&&labels.includes('获取验证码'));
    for(const copy of ['给你留下一小片空白','把灵感','新想法','留住那些','通过邮箱验证码安全登录','无需输入密码'])assert.ok(!labels.some(label=>label.includes(copy)));
    if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-cloth-arrived-'+width+'.png'});
    const grip=async()=>scene.evaluate(n=>{
      const r=n.getBoundingClientRect(),form=n.closest('form'),w=parseFloat(form.style.getPropertyValue('--cl-card-width'));
      const x=parseFloat(form.style.getPropertyValue('--cl-card-left')),y=Math.max(52,(r.height-448)/2-12);
      return {x:r.x+x+12,y:r.y+y+420,w};
    });
    // Lower-left hem pulled upwards; releasing then editing must recover and remain usable.
    const p=await grip();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(Math.max(14,p.x-120),p.y-200,{steps:18});
    assert.equal(await scene.getAttribute('data-grab'),'holding');
    await page.mouse.up();assert.equal(await scene.getAttribute('data-grab'),'idle');
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    const password=page.locator('input[autocomplete="current-password"]');await password.fill('synthetic-only');
    assert.equal(await scene.getAttribute('data-torn'),'0');
    assert.ok(await password.evaluate(n=>n===document.activeElement && !/NaN|Infinity/.test(n.style.transform)));
    await page.getByRole('button',{name:'显示密码',exact:true}).click();assert.equal(await password.getAttribute('type'),'text');
    assert.equal(await page.evaluate(()=>window.authTest.calls.length),0);
    await remount();
    // All interruption paths release pointer capture, including the native lost-capture path.
    for(const type of ['pointercancel','lostpointercapture','blur']){
      const q=await grip();await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+30,q.y-80,{steps:8});
      assert.equal(await scene.getAttribute('data-grab'),'holding');
      await scene.evaluate((n,type)=>{if(type==='blur')window.dispatchEvent(new Event('blur'));else if(type==='lostpointercapture')n.releasePointerCapture(1);else n.dispatchEvent(new PointerEvent(type,{pointerId:1,bubbles:true,cancelable:true}));},type);
      await page.mouse.up();assert.equal(await scene.getAttribute('data-grab'),'idle');
      assert.equal(await scene.getAttribute('data-torn'),'0');
      await remount();
    }
    // Focus during entrance lets the user type immediately instead of waiting.
    await remount(false);
    assert.equal(await scene.getAttribute('data-entrance'),'entering');
    await page.getByRole('textbox',{name:'邮箱',exact:true}).focus();
    assert.equal(await scene.getAttribute('data-entrance'),'ready');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const live=await page.evaluate(()=>window.clothAudit());
    assert.deepEqual({resize:live.resize,intersection:live.intersection,mutation:live.mutation},{resize:1,intersection:1,mutation:1});
    for(let i=0;i<3;i++){
      // Unmount even while a pointer is held: no global listener, RAF or observer may remain.
      const q=await grip();await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+30,q.y-70,{steps:4});
      const oldScene=await scene.elementHandle();await page.evaluate(()=>window.authTest.hide());
      await page.locator('.auth-page').waitFor({state:'detached'});await page.mouse.up();
      const frames=await oldScene.evaluate(n=>n.dataset.frames);await page.waitForTimeout(120);
      assert.equal(await oldScene.evaluate(n=>n.dataset.frames),frames);
      assert.deepEqual(await page.evaluate(()=>window.clothAudit()),{frames:0,listeners:0,resize:0,intersection:0,mutation:0});
      await oldScene.dispose();await page.evaluate(()=>window.authTest.show());
      await page.locator('#cloth-character-login[data-cloth-ready="true"]').waitFor();
      await page.getByRole('textbox',{name:'邮箱',exact:true}).focus();
      const current=await page.evaluate(()=>window.clothAudit());
      assert.equal(current.listeners,live.listeners);assert.equal(current.resize,1);assert.equal(current.intersection,1);assert.equal(current.mutation,1);
    }
    if(width===1280){
      await page.waitForFunction(()=>window.clothAudit().frames===0,{},{timeout:20000,polling:100});
      const idleFrames=await scene.getAttribute('data-frames');await page.waitForTimeout(1200);
      assert.equal(await scene.getAttribute('data-frames'),idleFrames,'the auth clock must not wake idle cloth rendering');
    }
    reports.push({width,normalEntrance:true,landingSeconds:3.08,dragRebound:true,pointerInterruptions:true,inputDuringEntrance:true,strictModeMountUnmountCleanup:true});
    await context.close();
  }
  // No Canvas at all: the same native form still submits to the existing auth service.
  {
    const context=await browser.newContext({viewport:{width:320,height:700}});
    await context.route('**/*',route=>route.request().url()==='https://auth-fixture.invalid/'?
      route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>HTMLCanvasElement.prototype.getContext=()=>null;</script><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.getByRole('textbox',{name:'邮箱',exact:true}).fill('fallback@example.com');
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    await page.locator('input[autocomplete="current-password"]').fill('synthetic-only');
    await page.locator('.auth-submit').click();await page.waitForFunction(()=>window.authTest.completed===1);
    assert.equal(await page.locator('[data-cloth-ready]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
    assert.ok(await page.locator('.cl-email').evaluate(n=>getComputedStyle(n).color!=='rgba(0, 0, 0, 0)'));
    reports.push({canvasUnavailable:true,nativeFallbackAuth:true});await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,productionComponentAndServices:true,syntheticFetch:true,networkBlocked:true,reports,errors},null,2));
} catch(error) {
  if(activePage) console.error(await activePage.evaluate(()=>({text:document.body.innerText,calls:window.authTest?.calls.map(x=>({url:x.url,purpose:x.body.purpose,aborted:x.aborted})),completed:window.authTest?.completed,listeners:window.clothListenerDetails?.()})));
  throw error;
} finally {await browser.close()}
