// Real LoginPage, auth services and built CSS; fresh offline contexts only.
// No existing app/profile, account creation, email or model requests.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const deviceScaleFactor=Number(process.env.NOTEFLOW_AUTH_DPR||1);
assert.ok([1,2].includes(deviceScaleFactor),'auth regression supports standard and Retina pixel density');
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
const assertInputFocus=async(field,{dark=false}={})=>{
  const style=await field.evaluate(n=>{
    const s=getComputedStyle(n);
    return {focused:n===document.activeElement,outline:s.outlineStyle,shadow:s.boxShadow,wrapperShadow:getComputedStyle(n.closest('.cl-field')).boxShadow,bg:s.backgroundColor,
      borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],
      ink:s.webkitTextFillColor,transform:s.transform,wrapperTransform:getComputedStyle(n.closest('.cl-field')).transform,clip:s.backgroundClip};
  });
  assert.ok(style.focused,'check the real focused input, not an idle screenshot');
  assert.equal(style.outline,'none','native text fields must not gain a rectangular focus frame');
  assert.equal(style.shadow,'none','native editing layers must not be covered by an input box shadow');
  assert.equal(style.wrapperShadow,(dark?'rgb(212, 223, 184)':'rgb(93, 112, 79)')+' 0px 2px 0px 0px','the wrapper owns the cloth focus baseline');
  assert.equal(style.bg,'rgba(0, 0, 0, 0)','the weave stays visible while typing');
  assert.deepEqual(style.borders,['0px','0px','0px','0px']);
  assert.equal(style.ink,dark?'rgb(237, 240, 221)':'rgb(53, 68, 47)');
  assert.equal(style.transform,'none','move the wrapper, not the editable native layer');
  assert.equal(style.wrapperTransform,'none','editing must use a stable, untransformed field box rather than a cloth affine matrix');
  assert.notEqual(style.clip,'text','native glyphs must never depend on background text clipping');
};
// Real pointer placement, insertion, deletion and drag selection, not fill()/focus().
const assertMouseEditing=async(page,field)=>{
  const value=await field.inputValue();assert.ok(value.length>6);
  const point=async prefix=>field.evaluate((n,prefix)=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n),scale=r.width/n.offsetWidth;
    const c=document.createElement('canvas').getContext('2d');c.font=s.font;
    const advance=n.type==='password'?0:c.measureText(prefix).width;
    return {x:r.left+(parseFloat(s.paddingLeft)+advance+1)*scale,y:r.top+r.height/2};
  },prefix);
  let p=await point('');
  assert.ok(await field.evaluate((n,p)=>document.elementFromPoint(p.x,p.y)===n,p),'the native field receives the actual mouse click');
  await page.mouse.click(p.x,p.y);assert.ok(await field.evaluate(n=>n===document.activeElement));
  await field.evaluate(n=>{
    let count=0;const observer=new MutationObserver(records=>count+=records.length);
    observer.observe(n.closest('.cl-field'),{attributes:true,attributeFilter:['style']});
    window.finishNativeEditingLayoutAudit=()=>{count+=observer.takeRecords().length;observer.disconnect();return count;};
  });
  await page.keyboard.type('x');assert.equal(await field.inputValue(),'x'+value,'click at start positions the real caret');
  await page.keyboard.press('Backspace');assert.equal(await field.inputValue(),value);
  if(await field.getAttribute('type')!=='password'){
    p=await point(value.slice(0,5));await page.mouse.click(p.x,p.y);await page.keyboard.type('z');
    assert.equal(await field.inputValue(),value.slice(0,5)+'z'+value.slice(5),'mouse can place the caret inside an email');
    await page.keyboard.press('Backspace');assert.equal(await field.inputValue(),value);
    const start=await point(''),end=await point(value.slice(0,5));
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();
    await page.keyboard.type('q');assert.equal(await field.inputValue(),'q'+value.slice(5),'drag selects text instead of grabbing cloth');
    await field.press('ControlOrMeta+A');await page.keyboard.type(value);
  }
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  assert.equal(await page.evaluate(()=>window.finishNativeEditingLayoutAudit()),0,'caret placement and typing must not keep rewriting the active native field geometry');
  assert.equal(await page.locator('.cl-scene').getAttribute('data-grab'),'idle');
};
// Force the browser's real autofill pseudo-state, including its UA blue fill.
// No saved passwords, profile or real credentials are accessed.
const withAutofill=async(page,selectors,check)=>{
  const client=await page.context().newCDPSession(page),nodes=[];
  try {
    await client.send('DOM.enable');await client.send('CSS.enable');
    const {root}=await client.send('DOM.getDocument');
    for(const selector of selectors){
      const {nodeId}=await client.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert.ok(nodeId);
      nodes.push(nodeId);await client.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['autofill']});
    }
    await check(async()=>{for(const nodeId of nodes)await client.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});});
  } finally {
    for(const nodeId of nodes)await client.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    await client.detach();
  }
};
const assertAutofill=async(field,dark=false)=>{
  const style=await field.evaluate(n=>{const s=getComputedStyle(n);return {
    autofill:n.matches(':autofill'),clip:s.backgroundClip,ink:s.webkitTextFillColor,caret:s.caretColor,
    font:s.fontSize,opacity:s.opacity,security:s.webkitTextSecurity,type:n.type,autocomplete:n.autocomplete,shadow:s.boxShadow,appearance:s.appearance,
  }});
  const ink=dark?'rgb(237, 240, 221)':'rgb(53, 68, 47)';
  assert.ok(style.autofill,'exercise actual browser autofill styles, not a mock class');
  assert.equal(style.clip,'text','only the UA autofill background is clipped; native text stays opaque');
  assert.equal(style.shadow,'none','never put an opaque inset layer over autofilled caret/selection');
  assert.equal(style.appearance,'none');
  assert.equal(style.ink,ink);assert.equal(style.caret,ink);assert.equal(style.font,'16px');assert.equal(style.opacity,'1');
  assert.ok(['email','current-password'].includes(style.autocomplete),'keep native autofill semantics');
  if(style.type==='password')assert.equal(style.security,'disc','autofilled passwords remain masked');
};
// The CSS pseudo-state cannot reproduce a stuck credential editor. Assert the
// native handoff separately: same-value assignment BEFORE default mouse caret
// placement, no fake input/change, and no assignments on ordinary mouse editing.
// All inspected values here are the test's synthetic credentials, never a profile.
const assertAutofillEditingHandoff=async(page,field,autofill)=>{
  const value=await field.inputValue();
  const point=await field.evaluate(n=>{
    const descriptor=Object.getOwnPropertyDescriptor(n,'value');
    if(!descriptor?.get||!descriptor?.set)throw Error('expected React native value accessor');
    const initial=n.value,audit={writes:0,sameValue:true,writesBeforeMouseDown:-1,events:0};
    Object.defineProperty(n,'value',{configurable:true,get(){return descriptor.get.call(this)},set(value){audit.writes++;audit.sameValue&&=value===initial;descriptor.set.call(this,value)}});
    const down=()=>audit.writesBeforeMouseDown=audit.writes,event=()=>audit.events++;
    n.addEventListener('mousedown',down);n.addEventListener('input',event);n.addEventListener('change',event);
    window.finishAutofillHandoff=()=>{
      Object.defineProperty(n,'value',descriptor);n.removeEventListener('mousedown',down);n.removeEventListener('input',event);n.removeEventListener('change',event);
      return audit;
    };
    const r=n.getBoundingClientRect();return{x:r.x+40*r.width/n.offsetWidth,y:r.y+r.height/2};
  });
  let audit;
  try { await page.mouse.click(point.x,point.y); }
  finally { audit=await page.evaluate(()=>window.finishAutofillHandoff()); }
  assert.equal(audit.writes,autofill?1:0,'only autofilled fields need a native value handoff');
  assert.equal(audit.writesBeforeMouseDown,autofill?1:0,'handoff precedes the browser default caret placement');
  assert.ok(audit.sameValue,'handoff must not clear, trim or otherwise change credentials');
  assert.equal(audit.events,0,'do not synthesize Delete, input or change to activate editing');
  assert.equal(await field.inputValue(),value);
  assert.ok(await field.evaluate(n=>n===document.activeElement));
  if(await field.getAttribute('type')==='password')assert.ok(await field.evaluate(n=>n.selectionStart>0&&n.selectionStart===n.selectionEnd),'the same click places the native password caret inside its value');
};
// Check the painted selection while autofill is STILL active, before any key/fill.
// DOM focus alone cannot prove that the user can see the caret or selected text.
const assertAutofillSelectionVisible=async(page,field)=>{
  const value=await field.inputValue();
  const {start,end,clip}=await field.evaluate(n=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n),scale=r.width/n.offsetWidth;
    const c=document.createElement('canvas').getContext('2d');c.font=s.font;
    const advance=n.type==='password'?40:c.measureText(n.value.slice(0,5)).width;
    const x=r.x+parseFloat(s.paddingLeft)*scale,y=r.y+r.height/2;
    return {start:{x:x+1,y},end:{x:x+advance*scale,y},clip:{x:Math.ceil(x+3),y:Math.ceil(y-10*scale),width:Math.floor((advance-5)*scale),height:Math.floor(20*scale)}};
  });
  await page.mouse.click(start.x,start.y);
  const before=await page.screenshot({clip,caret:'hide'});
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();
  assert.equal(await field.inputValue(),value,'mouse-only autofill selection must not change the value');
  assert.ok(await field.evaluate(n=>n.matches(':autofill')&&n===document.activeElement),'do not clear autofill or type a key to make selection work');
  const after=await page.screenshot({clip,caret:'hide'});
  const pixels=await page.evaluate(async({before,after})=>{
    const decode=async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const a=await decode(before),b=await decode(after);let changed=0;
    for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>30)changed++;
    return {changed,total:a.length/4};
  },{before:before.toString('base64'),after:after.toString('base64')});
  assert.ok(pixels.changed/pixels.total>.3,`autofilled text must show a painted selection before Delete: ${JSON.stringify(pixels)}`);
};
let activePage;
try {
  for(const width of (process.env.NOTEFLOW_AUTH_ANIMATION_ONLY ? [] : [1920,1280,1024,736,320])) {
    const context=await browser.newContext({viewport:{width,height:width>=1200?1000:850},deviceScaleFactor,reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      if(route.request().url()==='https://auth-fixture.invalid/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      requests.push(route.request().url());return route.abort();
    });
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('"/noteflow_icon.svg"',JSON.stringify(logo)).replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.locator('.auth-form').waitFor();
    await page.locator('#cloth-character-login[data-cloth-ready="true"]').waitFor();
    await page.locator('#cloth-character-login[data-entered="true"]').waitFor();
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
    const displayScale=()=>page.locator('#cloth-character-login').evaluate(n=>parseFloat(getComputedStyle(n).getPropertyValue('--cl-display-scale')));
    const scale=await displayScale();
    const compactDelivery=async()=>{
      const currentScale=await displayScale();
      assert.ok(Math.abs(await page.locator('.auth-support').evaluate(n=>n.getBoundingClientRect().height)-88*currentScale)<.1,'delivery and account actions occupy only two scaled rows');
      assert.ok(Math.abs(await page.locator('.auth-options').evaluate(n=>n.getBoundingClientRect().height)-44*currentScale)<.1,'account actions must not wrap into another paragraph');
      assert.ok(await page.locator('.auth-delivery').evaluate(n=>{
        const r=n.getBoundingClientRect(),scale=parseFloat(getComputedStyle(n.closest('main')).getPropertyValue('--cl-display-scale'));return Math.abs(r.height-44*scale)<.1 && [...n.children].every(child=>{
          const b=child.getBoundingClientRect();return b.left>=r.left && b.right<=r.right+.1 && b.height>=44;
        });
      }),'editable email and resend stay on the same line, including narrow screens');
      assert.equal(await page.locator('.auth-code-actions').count(),0);
      await touchTargets();
    };
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const initial=await measure();
    assert.ok(initial.width>=160*scale && initial.width<=270*scale+.1);assert.ok(Math.abs(initial.height-48*scale)<.1);
    assert.equal(initial.bg,'rgba(0, 0, 0, 0)');assert.equal(initial.radius,'4px');assert.equal(initial.font,'14px');
    assert.equal(await page.locator('.cl-scene').evaluate(n=>n.dataset.entrance),'ready');
    assert.equal(await page.locator('.auth-switch').count(),0);assert.equal(await code.count(),0);
    assert.equal(await page.locator('input').count(),1);assert.equal(await primary.innerText(),'获取验证码');
    assert.equal(await page.locator('[data-replay],[data-reset],.intro,.site-footer,.cl-hint').count(),0);
    assert.ok(await page.locator('.cl-bubble').isHidden());
    assert.equal(await page.locator('.auth-feedback').evaluate(n=>n.getBoundingClientRect().height),0);
    const optionTop=await page.locator('.auth-options').evaluate(n=>n.getBoundingClientRect().top);
    assert.ok(optionTop>initial.y+initial.height && optionTop<initial.y+initial.height+130,'account actions stay close to the form');
    assert.ok(await page.locator('.cl-scene').evaluate(n=>{
      const stage=n.getBoundingClientRect(),root=n.closest('.auth-page').getBoundingClientRect();
      const scale=stage.height/parseFloat(getComputedStyle(n).height),top=stage.y+parseFloat(n.style.getPropertyValue('--cl-card-top'))*scale;
      const bottom=n.closest('form').querySelector('.auth-options').getBoundingClientRect().bottom;
      return stage.x===root.x && Math.abs(stage.width-root.width)<1 && Math.abs((top+bottom)/2-(root.y+root.height/2))<1;
    }),'the resting card and account actions are vertically centered in the viewport');
    await touchTargets();assert.ok(await primary.isDisabled());await shot('login');
    await page.locator('.site-brand').focus();await page.keyboard.press('Tab');
    await assertInputFocus(email);await shot('email-focused');
    assert.ok(await email.evaluate(n=>n.required && n.validity.valueMissing && !n.form.noValidate),'keep native required-field validation');
    assert.deepEqual(await measure(),initial,'focus must not resize or move the form');
    await page.keyboard.press('Tab');
    assert.equal(await email.evaluate(n=>getComputedStyle(n).boxShadow),'none','blur restores the original cloth line');
    assert.ok(await page.getByRole('button',{name:'使用密码登录',exact:true}).evaluate(n=>n===document.activeElement && getComputedStyle(n).outlineStyle==='solid'),'keyboard button focus remains visible');
    await email.fill('owner@example.com');await page.evaluate(()=>window.authTest.hold=true);await primary.click();
    await code.waitFor();assert.equal((await measure()).y,initial.y);
    await compactDelivery();
    assert.equal(await page.locator('.auth-feedback').getAttribute('data-quiet'),'true','pending copy must not duplicate the primary action');
    await page.getByRole('button',{name:'注册',exact:true}).click();await release();
    assert.equal(await code.count(),0);assert.equal(await email.inputValue(),'owner@example.com');
    assert.ok(await page.evaluate(()=>window.authTest.calls[0].aborted));
    assert.equal(await page.locator('input').count(),1);assert.equal((await measure()).y,initial.y);
    await shot('register');await primary.click();await page.getByRole('status').filter({hasText:'开发环境'}).waitFor();
    assert.equal(await code.inputValue(),'314159');assert.equal((await measure()).y,initial.y);
    await compactDelivery();
    assert.ok(await page.locator('.auth-feedback').evaluate(n=>getComputedStyle(n).position==='absolute' && getComputedStyle(n).clipPath==='inset(50%)'),'successful sending remains announced but adds no visible paragraph');
    assert.equal(await page.evaluate(()=>window.authTest.calls.at(-1).body.purpose),'register');
    assert.equal(await page.evaluate(()=>window.authTest.completed),0,'sending never creates an account');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('autocomplete')==='one-time-code');
    await assertInputFocus(code);
    await touchTargets();await primary.hover();await page.waitForTimeout(170);
    assert.equal((await measure()).bg,'rgba(0, 0, 0, 0)');
    await code.fill('');await code.fill('314159');await page.mouse.move(0,0);await page.waitForTimeout(170);await shot('verify');
    await page.evaluate(()=>window.authTest.fail=true);await primary.click();await page.getByRole('alert').waitFor();
    assert.equal(await code.inputValue(),'314159');assert.equal((await measure()).y,initial.y);
    await page.evaluate(()=>window.authTest.fail='合成失败：'+'很长的错误说明。'.repeat(40));await primary.click();
    await page.getByRole('alert').waitFor();assert.equal((await measure()).y,initial.y);
    assert.ok(await page.getByRole('alert').locator('span').evaluate(n=>n.scrollHeight>n.clientHeight && n.scrollTop===0));
    assert.equal(await page.getByRole('alert').getAttribute('data-quiet'),'false','errors must stay visible even after a quiet success');
    await primary.click();await page.waitForFunction(()=>window.authTest.completed===1);
    const registered=await page.evaluate(()=>window.authTest.calls.at(-1));
    assert.ok(registered.url.endsWith('/register'));assert.deepEqual(registered.body,{email:'owner@example.com',code:'314159'});
    await page.getByRole('button',{name:'登录',exact:true}).click();
    const countBeforeReturn=await page.evaluate(()=>window.authTest.calls.length);await primary.click();
    assert.equal(await code.inputValue(),'');assert.equal(await page.evaluate(()=>window.authTest.calls.length),countBeforeReturn);
    assert.match(await page.locator('.auth-send').innerText(),/后重发/);
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    const password=page.locator('input[autocomplete="current-password"]');await password.fill('synthetic-password');
    await assertInputFocus(password);
    const eye=page.getByRole('button',{name:'显示密码',exact:true});
    assert.equal(await eye.innerText(),'');assert.equal(await eye.locator('svg').count(),1);
    assert.equal(await eye.getAttribute('title'),'显示密码');
    assert.ok(await eye.evaluate(n=>n.getBoundingClientRect().height>=44 && n.getBoundingClientRect().width>=44));
    await page.getByRole('button',{name:'显示密码',exact:true}).click();
    assert.equal(await password.getAttribute('type'),'text');assert.ok(await password.evaluate(n=>n===document.activeElement));
    await page.getByRole('button',{name:'隐藏密码',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');
    await page.evaluate(()=>{
      const original=CanvasRenderingContext2D.prototype.fillText;window.autofillMirrorCount=0;
      window.restoreAutofillPaint=()=>{CanvasRenderingContext2D.prototype.fillText=original};
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){
        const email=document.querySelector('input[name="email"]'),password=document.querySelector('input[name="password"]');
        if((email?.value && text===email.value)||(password?.value && [password.value,'•'.repeat(Math.min(password.value.length,24))].includes(text)))window.autofillMirrorCount++;
        return original.call(this,text,...args);
      };
    });
    await withAutofill(page,['input[name="email"]','input[name="password"]'],async clearAutofill=>{
      for(const dark of [false,true]){
        await page.evaluate(dark=>document.documentElement.classList.toggle('theme-dark',dark),dark);
        await email.focus();await assertAutofill(email,dark);await assertAutofill(password,dark);
        await assertAutofillEditingHandoff(page,email,true);
        await assertAutofillSelectionVisible(page,email);
        await password.focus();await assertAutofill(password,dark);
        await assertAutofillEditingHandoff(page,password,true);
        await assertAutofillSelectionVisible(page,password);
        const frames=Number(await page.locator('.cl-scene').getAttribute('data-frames'));
        await page.evaluate(()=>window.autofillMirrorCount=0);await password.blur();
        await page.waitForFunction(frames=>Number(document.querySelector('.cl-scene').dataset.frames)>frames,frames);
        assert.equal(await page.evaluate(()=>window.autofillMirrorCount),0,'blurred autofill must not be drawn twice by Canvas and the native input');
        await assertAutofill(email,dark);await assertAutofill(password,dark);await shot(dark?'autofill-dark':'autofill-light');
      }
      await page.emulateMedia({forcedColors:'active'});await email.focus();
      assert.ok(await email.evaluate(n=>{const s=getComputedStyle(n);return s.webkitTextFillColor===s.color && s.caretColor===s.color}),'autofill follows system field text in forced colors');
      assert.ok(await email.evaluate(n=>{const s=getComputedStyle(n,'::selection');return s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.webkitTextFillColor===s.color}),'forced colors retain a visible system selection and matching selected text');
      await page.emulateMedia({forcedColors:'none'});
      await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
      await clearAutofill();
      await assertAutofillEditingHandoff(page,email,false);await assertAutofillEditingHandoff(page,password,false);
      await assertMouseEditing(page,email);await assertMouseEditing(page,password);
      await password.blur();
      assert.equal(await page.evaluate(()=>window.autofillMirrorCount),0,'autofill to manual editing still has exactly one native text source');
      await shot('mouse-edited');
    });
    await page.evaluate(()=>{document.documentElement.classList.remove('theme-dark');window.restoreAutofillPaint()});
    await email.focus();await password.focus();await assertInputFocus(password);
    assert.ok(Math.abs(await page.locator('.auth-options').evaluate(n=>n.getBoundingClientRect().height)-44*scale)<.1,'all password account actions fit in one row');
    await page.locator('.auth-options').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.auth-options button').evaluateAll(nodes=>nodes.every(n=>{
      const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return hit===n||n.contains(hit);
    })),'the animation scene must not intercept the account actions');
    await shot('password');await page.getByRole('button',{name:'忘记密码？',exact:true}).click();
    assert.equal(await page.locator('input').count(),1);await primary.click();
    await page.getByRole('status').filter({hasText:'已发送'}).waitFor();assert.equal(await code.inputValue(),'');
    await code.fill('314159');await page.locator('input[autocomplete="new-password"]').fill('new-password-123');
    const newPassword=page.locator('input[autocomplete="new-password"]');await assertInputFocus(newPassword);
    await newPassword.dispatchEvent('keyup',{key:'A',modifierCapsLock:true});
    await page.getByRole('status').filter({hasText:'大写锁定已开启'}).waitFor();
    assert.equal(await page.getByRole('status').getAttribute('data-quiet'),'false','a quiet delivery success must not hide a password warning');
    assert.ok(Math.abs(await page.getByRole('status').evaluate(n=>n.getBoundingClientRect().height)-44*scale)<.1);
    await newPassword.dispatchEvent('keyup',{key:'A',modifierCapsLock:false});await compactDelivery();await primary.click();
    await page.getByRole('status').filter({hasText:'密码已更新'}).waitFor();assert.equal(await password.inputValue(),'');
    assert.equal(await page.getByRole('status').getAttribute('data-quiet'),'false','reset completion is an important visible state');
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
    await compactDelivery();await shot('delivery');
    assert.equal(await page.getByRole('button',{name:'修改邮箱',exact:true}).getAttribute('title'),'long.alias.'.repeat(4)+'@example.com');
    assert.equal(await code.getAttribute('aria-describedby'),await page.locator('.auth-destination span').getAttribute('id'),'the full delivery address still describes the code field');
    assert.ok(await page.locator('.auth-destination span').evaluate(n=>getComputedStyle(n).textOverflow==='ellipsis' && n.scrollWidth>n.clientWidth),'long addresses truncate visually instead of stacking lines');
    await code.fill('314159');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.equal((await measure()).y,initial.y);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await page.mouse.move(0,0);await page.waitForTimeout(170);
    assert.equal(await page.locator('#cloth-character-login').evaluate(n=>getComputedStyle(n).colorScheme),'dark');
    assert.equal(await page.locator('.cl-probe').evaluate(n=>getComputedStyle(n).color),'rgb(255, 182, 160)');
    await code.focus();await assertInputFocus(code,{dark:true});
    await page.emulateMedia({forcedColors:'active'});
    assert.ok(await code.evaluate(n=>{const s=getComputedStyle(n);return s.outlineStyle==='solid' && s.outlineWidth==='2px'}),'system high contrast retains a real focus indicator when shadows are removed');
    await page.emulateMedia({forcedColors:'none'});await assertInputFocus(code,{dark:true});
    await shot('dark');await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.auth-fields').evaluate(n=>getComputedStyle(n).animationName),'none');
    assert.equal(await primary.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    await page.setViewportSize({width,height:480});await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    assert.equal(await displayScale(),1,'short windows restore the compact size instead of clipping the enlarged composition');
    await page.getByRole('button',{name:'忘记密码？',exact:true}).click();await primary.click();
    await page.getByRole('status').filter({hasText:'已发送'}).waitFor();await primary.scrollIntoViewIfNeeded();
    assert.ok(await primary.evaluate(n=>{const r=n.getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const storage=await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))));
    assert.ok(!storage.includes('password-123') && !storage.includes('314159'));
    await page.getByRole('button',{name:'返回登录',exact:true}).click();await password.fill('synthetic-password');
    await page.evaluate(()=>Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Synthetic storage denied','SecurityError')}}));
    await primary.click();await page.waitForFunction(()=>window.authTest.completed===5);
    await page.getByRole('button',{name:'使用验证码登录',exact:true}).click();await email.fill('resend@example.com');await primary.click();
    await page.getByRole('status').filter({hasText:'已发送'}).waitFor();
    const beforeResend=await page.evaluate(()=>window.authTest.calls.length);
    assert.ok(await page.locator('.auth-send').isDisabled());
    // Advance only the synthetic clock; do not wait a real minute or shorten product cooldown.
    await page.evaluate(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+61000});
    await page.waitForFunction(()=>!document.querySelector('.auth-send').disabled);
    await page.getByRole('button',{name:'重新发送验证码',exact:true}).click();
    await page.waitForFunction(count=>window.authTest.calls.length===count+1,beforeResend);
    await page.waitForFunction(()=>document.querySelector('.auth-form').getAttribute('aria-busy')==='false');
    assert.equal(await page.evaluate(()=>window.authTest.calls.at(-1).body.purpose),'login');
    await compactDelivery();assert.ok(await page.locator('.auth-send').isDisabled());
    reports.push({width,initial,emailFirst:true,explicitRegistration:true,stablePrimaryAcrossEmailCode:true,purposeIsolation:true,failureRetry:true,cancelStale:true,passwordReset:true,realAuthServicePayloads:true,compactDelivery:true,quietSuccessAnnouncement:true,importantFeedbackVisible:true,cooldownResend:true,integratedInputFocus:true,nativeAutofillStyle:true,noAutofillCanvasDuplicate:true,autofillPasswordMasked:true,mouseCaretAndDragSelection:true,autofillToManualEditing:true,passwordEyeIcon:true,keyboardFocus:true,nativeValidationRetained:true,forcedColors:true,dark:true,reducedMotion:true,shortViewport:true,longEmail:true,storageDeniedAuthSucceeds:true});
    await context.close();
  }
  // Normal-motion integration: same production component, no auth/network actions.
  const auditSource = `(()=>{
    window.clothLabels=new Set();
    window.clothArcRadii=new Set();
    const arc=CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc=function(x,y,radius,...args){if(this.canvas.classList.contains('cl-fx'))window.clothArcRadii.add(radius);return arc.call(this,x,y,radius,...args)};
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
  for (const width of [1920,1280,736,320]) {
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor,reducedMotion:'no-preference'});
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
    assert.equal(await page.locator('.auth-support').getAttribute('inert'),'');
    assert.equal(await page.getByRole('button',{name:'使用密码登录',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'注册',exact:true}).count(),0);
    assert.ok(await page.locator('.auth-support').isHidden());
    assert.equal(await scene.evaluate(n=>n.getBoundingClientRect().x),0);
    assert.ok(Math.abs(await scene.evaluate(n=>n.getBoundingClientRect().width)-width)<1,'entry clipping must be the screen edge, not a centered pane');
    const displayScale=await scene.evaluate(n=>n.getBoundingClientRect().height/parseFloat(getComputedStyle(n).height));
    assert.ok(Math.abs(displayScale-(width>=1600?1.18:width>=1200?1.1:1))<.001,'large viewports enlarge the whole composition; narrow screens retain their original size');
    assert.ok(await page.locator('.cl-fx').evaluate(n=>Math.abs(n.width-n.getBoundingClientRect().width*Math.min(devicePixelRatio,2))<=1),'canvas backing pixels track the actual displayed width');
    assert.ok(await page.locator('#cloth-character-login').evaluate(n=>{
      const s=getComputedStyle(n,'::before');return s.pointerEvents==='none' && s.backgroundImage.includes('radial-gradient');
    }),'ambient light is static, decorative and cannot intercept the form');
    await page.waitForFunction(()=>Number(document.querySelector('.cl-scene')?.dataset.time)>=.55);
    assert.equal(await page.locator('.auth-support').getAttribute('inert'),'');
    assert.ok(await page.locator('.auth-support').isHidden());
    assert.ok(await page.locator('.cl-enter').evaluate(n=>n.getBoundingClientRect().right>innerWidth),'the incoming card is still crossing the right screen edge');
    if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-cloth-entering-'+width+'.png'});
    await page.waitForFunction(()=>Number(document.querySelector('.cl-scene')?.dataset.time)>=3.08,{},{timeout:20000});
    assert.notEqual(await scene.getAttribute('data-entrance'),'entering');
    await page.waitForFunction(()=>document.querySelector('.cl-scene')?.dataset.entrance==='ready',{},{timeout:20000});
    await page.locator('#cloth-character-login[data-entered="true"]').waitFor();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.auth-support')).opacity==='1');
    assert.equal(await page.locator('.auth-support').getAttribute('inert'),null);
    assert.ok(await page.locator('.auth-support').isVisible());
    const labels=await page.evaluate(()=>[...window.clothLabels]);
    assert.ok(labels.includes('登录')&&labels.includes('获取验证码'));
    for(const copy of ['给你留下一小片空白','把灵感','新想法','留住那些','通过邮箱验证码安全登录','无需输入密码'])assert.ok(!labels.some(label=>label.includes(copy)));
    if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-cloth-arrived-'+width+'.png'});
    const grip=async()=>scene.evaluate(n=>{
      const r=n.getBoundingClientRect(),form=n.closest('form'),w=parseFloat(form.style.getPropertyValue('--cl-card-width'));
      const x=parseFloat(form.style.getPropertyValue('--cl-card-left')),y=parseFloat(n.style.getPropertyValue('--cl-card-top'));
      const scale=r.height/parseFloat(getComputedStyle(n).height);
      return {x:r.x+(x+12)*scale,y:r.y+(y+420)*scale,w:w*scale};
    });
    // Lower-left hem pulled upwards; releasing then editing must recover and remain usable.
    const beforeDragFrames=Number(await scene.getAttribute('data-frames'));
    const p=await grip();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(Math.max(14,p.x-120),p.y-200,{steps:18});
    assert.equal(await scene.getAttribute('data-grab'),'holding');
    await page.waitForFunction(frames=>Number(document.querySelector('.cl-scene').dataset.frames)>frames,beforeDragFrames);
    assert.deepEqual(await page.evaluate(()=>[...window.clothArcRadii]),[4.2],'keep the cloth pins but never draw the extra grab-position circle');
    if(process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_AUTH_SCREENSHOT_DIR+'/noteflow-auth-cloth-dragging-'+width+'.png'});
    await page.mouse.up();assert.equal(await scene.getAttribute('data-grab'),'idle');
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    const password=page.locator('input[autocomplete="current-password"]');await password.fill('synthetic-only');
    await assertInputFocus(password);
    assert.equal(await scene.getAttribute('data-torn'),'0');
    assert.ok(await password.evaluate(n=>n===document.activeElement && getComputedStyle(n).transform==='none' && getComputedStyle(n.closest('.cl-field')).transform==='none'));
    await assertMouseEditing(page,password);
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
    if(width===1280){
      await page.setViewportSize({width,height:1254});
      await page.waitForFunction(()=>{
        const n=document.querySelector('.cl-scene'),r=n.getBoundingClientRect(),scale=r.height/parseFloat(getComputedStyle(n).height),top=r.y+parseFloat(n.style.getPropertyValue('--cl-card-top'))*scale;
        const bottom=n.closest('form').querySelector('.auth-options').getBoundingClientRect().bottom;
        return Math.abs((top+bottom)/2-innerHeight/2)<1;
      });
    }
    reports.push({width,displayScale,normalEntrance:true,landingSeconds:3.08,screenEdgeEntrance:true,auxiliaryInertUntilArrival:true,viewportCentered:true,dragRebound:true,noGrabPositionCircle:true,pointerInterruptions:true,inputDuringEntrance:true,strictModeMountUnmountCleanup:true});
    await context.close();
  }
  // No Canvas at all: the same native form still submits to the existing auth service.
  {
    const context=await browser.newContext({viewport:{width:320,height:700},deviceScaleFactor});
    await context.route('**/*',route=>route.request().url()==='https://auth-fixture.invalid/'?
      route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
    const page=await context.newPage();activePage=page;page.on('pageerror',err=>errors.push(String(err)));
    await page.goto('https://auth-fixture.invalid/');
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>HTMLCanvasElement.prototype.getContext=()=>null;</script><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>');
    await page.locator('#cloth-character-login[data-renderer="fallback"]').waitFor();
    const email=page.getByRole('textbox',{name:'邮箱',exact:true});await email.fill('fallback@example.com');
    await assertInputFocus(email);
    await page.getByRole('button',{name:'使用密码登录',exact:true}).click();
    await page.locator('input[autocomplete="current-password"]').fill('synthetic-only');
    await assertInputFocus(page.locator('input[autocomplete="current-password"]'));
    await withAutofill(page,['input[name="email"]','input[name="password"]'],async()=>{
      await assertAutofill(email);await assertAutofill(page.locator('input[autocomplete="current-password"]'));
    });
    await page.locator('.auth-submit').click();await page.waitForFunction(()=>window.authTest.completed===1);
    assert.equal(await page.locator('[data-cloth-ready]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
    assert.ok(await page.locator('.cl-email').evaluate(n=>getComputedStyle(n).color!=='rgba(0, 0, 0, 0)'));
    reports.push({canvasUnavailable:true,nativeFallbackAuth:true});await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,productionComponentAndServices:true,syntheticFetch:true,networkBlocked:true,deviceScaleFactor,autofillMouseOnlyPaintedSelection:true,reports,errors},null,2));
} catch(error) {
  if(activePage) console.error(await activePage.evaluate(()=>({text:document.body.innerText,calls:window.authTest?.calls.map(x=>({url:x.url,purpose:x.body.purpose,aborted:x.aborted})),completed:window.authTest?.completed,listeners:window.clothListenerDetails?.()})));
  throw error;
} finally {await browser.close()}
