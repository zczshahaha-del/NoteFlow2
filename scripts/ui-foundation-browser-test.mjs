// Computed-style contract samples with production CSS; interaction regression
// is separately covered by the real component/browser suites.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const assets=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assets).filter(n=>/^(index-|NoteEditor-).*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
const html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{overflow:auto;padding:24px;background:var(--color-jelly-card)}.gallery{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.sample{padding:16px;min-width:0}.sample h2{font-size:14px;margin-bottom:12px}.nf-soft-menu{position:relative}.nf-draft-workspace{padding:16px}.nf-chat-composer{position:relative!important;width:100%;min-height:180px} .nf-dialog{padding:16px} .nf-search-dialog{width:100%!important}.sample fieldset{min-width:0}</style></head><body>
<button id="utility" class="text-[12px] font-medium leading-5">辅助文字</button><input id="utility-input" class="text-[13px]" value="输入字号">
<div class="gallery">
<section class="sample"><h2>通用控件</h2><button id="generic" class="ui-button ui-button-secondary px-3">取消</button> <button id="disabled" class="ui-button ui-button-primary px-3" disabled>处理中</button><input class="ui-input mt-3 px-3" placeholder="输入内容"></section>
<section class="sample"><h2>菜单</h2><div class="nf-soft-menu"><button class="nf-soft-menu-item">新建笔记</button><button class="nf-soft-menu-item nf-soft-menu-danger">删除笔记</button><div class="nf-history-search"><input id="history" placeholder="搜索历史对话"></div></div></section>
<section class="sample nf-settings-system"><h2>设置</h2><div class="nf-dialog"><button class="nf-nav" aria-current="page">外观</button><label>名称</label><input class="nf-input" value="我的账号"><button class="nf-button">取消</button><button class="nf-button nf-primary">保存</button></div></section>
<section class="sample nf-draft-workspace"><h2>草稿</h2><textarea class="nf-draft-field" placeholder="说明你想写什么"></textarea><button class="ui-button nf-draft-action">取消</button><button class="ui-button nf-draft-action nf-draft-primary">确认</button></section>
<section class="sample nf-ai-conversation"><h2>AI 对话</h2><div class="nf-chat-composer"><textarea class="ai-chat-input" placeholder="继续聊聊"></textarea><button class="nf-chat-send" aria-label="发送">↑</button></div><button class="nf-chat-copy" aria-label="复制回复">□</button></section>
<section class="sample edit-preview-workspace"><h2>修改预览</h2><button class="px-3">应用修改</button><button class="px-3" disabled>保存中</button></section>
<section class="sample" id="cloth-character-login" style="min-width:0"><h2>登录色彩</h2><div class="cl-scene" style="position:relative;inset:auto;height:100px;min-height:0"><span id="login-primary" style="display:block;background:var(--cl-button);color:var(--cl-button-ink);height:36px;border-radius:9px">登录</span><div class="cl-field" style="top:50px;width:100%"><input class="cl-input" placeholder="邮箱"></div></div></section>
<section class="sample directory-tree"><h2>目录选中态</h2><div class="directory-node-list"><div class="directory-node-row" data-selected="true">Go 语言</div></div></section>
</div></body></html>`;
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-ui-foundation-')),reports=[];
try{
 for(const {width,touch} of [{width:1280,touch:false},{width:320,touch:true}]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:touch});
  await context.route('**/*',r=>r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(html);
  assert.equal(await page.locator('#utility').evaluate(n=>getComputedStyle(n).fontSize),'12px','Base inheritance must not override declared utility typography');
  assert.equal(await page.locator('#utility-input').evaluate(n=>getComputedStyle(n).fontSize),'13px');
  const generic=page.locator('#generic'),before=await generic.boundingBox();
  await generic.focus();assert.equal(await generic.evaluate(n=>getComputedStyle(n).outlineStyle),'solid','Keyboard gets a visible focus fallback');
  await page.mouse.move(before.x+10,before.y+10);await page.mouse.down();const pressed=await generic.boundingBox();await page.mouse.up();
  assert.equal(pressed.y,before.y,'Pressed feedback cannot shift the button or surrounding text');
  assert.equal(await page.locator('#disabled').evaluate(n=>getComputedStyle(n).cursor),'not-allowed');
  assert.equal(await page.locator('#disabled').evaluate(n=>getComputedStyle(n).opacity),'0.55');
  await page.locator('#history').focus();assert.equal(await page.locator('#history').evaluate(n=>getComputedStyle(n).outlineStyle),'none');assert.equal(await page.locator('#history').evaluate(n=>getComputedStyle(n).boxShadow),'none','History search must not regain an inner box or underline');
  for(const dark of [false,true]){
   await page.evaluate(dark=>document.documentElement.classList.toggle('theme-dark',dark),dark);
   // Controls transition their colors; compare the settled theme, not its first frame.
   await page.evaluate(async()=>{getComputedStyle(document.querySelector('#disabled')).backgroundColor;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
   const colors=await page.evaluate(()=>['.nf-soft-menu','.nf-settings-system','.nf-draft-workspace','.nf-ai-conversation'].map(selector=>getComputedStyle(document.querySelector(selector)).getPropertyValue(selector==='.nf-soft-menu'?'--nf-menu-text':selector==='.nf-settings-system'?'--nf-text':selector==='.nf-draft-workspace'?'--draft-text':'--nf-chat-text').trim()));
   assert(colors.every(c=>c===colors[0]),'Auxiliary UI surfaces share the same semantic text color');
   const palette=await page.evaluate(()=>{
    const primary=['#login-primary','#disabled','.nf-settings-system .nf-primary','.nf-draft-primary','.nf-chat-send'].map(selector=>{
     const s=getComputedStyle(document.querySelector(selector));return{background:s.backgroundColor,ink:s.color};
    });
    const navigation=['.nf-nav[aria-current]','.directory-node-row[data-selected]'].map(selector=>{
     const s=getComputedStyle(document.querySelector(selector));return{background:s.backgroundColor,ink:s.color};
    });
    return{primary,navigation,loginFont:getComputedStyle(document.querySelector('.cl-input')).fontFamily,uiFont:getComputedStyle(document.querySelector('#utility')).fontFamily};
   });
   assert(palette.primary.every(c=>c.background===palette.primary[0].background&&c.ink===palette.primary[0].ink),`login, generic, settings, draft and chat primary actions must use one palette: ${JSON.stringify({width,dark,primary:palette.primary})}`);
   assert.equal(palette.primary[0].background,dark?'rgb(66, 118, 147)':'rgb(63, 120, 152)');
   assert.equal(palette.primary[0].ink,'rgb(255, 255, 255)');
   assert.deepEqual(palette.navigation[0],palette.navigation[1],'settings and directory active navigation use the same pale blue-gray and emphasis');
   assert.equal(palette.navigation[0].background,dark?'rgb(38, 62, 77)':'rgb(231, 238, 242)');
   assert.equal(palette.loginFont,palette.uiFont,'native login controls share the workspace UI font');
   const luminance=color=>color.match(/\d+/g).slice(0,3).map(x=>{const v=Number(x)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
   const ink=luminance(palette.primary[0].ink),background=luminance(palette.primary[0].background);
   assert((Math.max(ink,background)+.05)/(Math.min(ink,background)+.05)>=4.5,'primary action text retains AA contrast in both themes');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   await page.screenshot({path:join(output,`foundation-${width}-${dark?'dark':'light'}.png`)});
  }
  if(touch){assert((await generic.boundingBox()).height>=44);assert((await page.locator('.nf-chat-copy').boundingBox()).height>=44);}
  else assert.equal((await page.locator('.nf-chat-copy').boundingBox()).height,26,'Quiet copy control keeps its deliberate compact size');
  await page.emulateMedia({reducedMotion:'reduce'});assert(await generic.evaluate(n=>getComputedStyle(n).transitionDuration.split(',').every(t=>parseFloat(t)<=0.00001)),'Reduced motion retains at most the existing imperceptible event-compatible duration');
  await page.emulateMedia({forcedColors:'active'});await generic.focus();assert.equal(await generic.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
  assert.deepEqual(errors,[]);reports.push({width,touch,utilityTypography:true,sharedPalette:true,loginWorkspaceAccent:true,activeNavigationPalette:true,primaryContrastAA:true,noPressShift:true,historyFrameless:true,focusFallback:true,disabled:true,reducedMotion:true,forcedColors:true});await context.close();
 }
 console.log(JSON.stringify({ok:true,productionCSS:true,styleSamplesOnly:true,networkBlocked:true,output,reports},null,2));
}finally{await browser.close();}
