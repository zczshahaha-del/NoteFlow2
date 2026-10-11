// Actual AccountMenu + production CSS, synthetic state and callbacks, no real network.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
const { chromium }=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const path=n=>fileURLToPath(new URL('../src/'+n,import.meta.url));
const assets=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assets).filter(n=>/^index-.*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assets),'utf8')).join('\n');
assert(css,'Build CSS first');
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import AccountMenu from ${JSON.stringify(path('components/AppNav.tsx'))};
import{useAppStore}from ${JSON.stringify(path('store/index.tsx'))};
useAppStore.setState({treeData:[],fileContents:{},deletedNotes:[],serverSyncReady:false,hydratedUserId:null});
window.fetch=async()=>new Response(JSON.stringify([]),{headers:{'Content-Type':'application/json'}});
const root=createRoot(document.getElementById('anchor'));
const props={compact:true,themeMode:'light',userEmail:'example@example.invalid',userName:'示例用户',onThemeModeChange(){},onSignOut(){window.signOutCount++;},trashCount:13};
window.signOutCount=0;window.accountTest={update(p){Object.assign(props,p);root.render(React.createElement(React.StrictMode,null,React.createElement(AccountMenu,props)));}};
window.accountTest.update({});`;
const bundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'account-fixture',resolveId(id){if(id==='virtual:entry')return '\0entry';},load(id){if(id==='\0entry')return entry;}}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:entry',output:{codeSplitting:false}}}});
const chunks=bundle.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const script=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-account-menu-')),reports=[];
async function settled(page){await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});}
async function open(page){await page.locator('.nf-account-trigger').click();await page.locator('.nf-account-popover[data-open="true"]').waitFor();await settled(page);}
try{
 for(const width of [1280,736,320]){
  const context=await browser.newContext({viewport:{width,height:720},hasTouch:width===320}),requests=[],errors=[];
  await context.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><head><style>'+css+' body{background:#fdfdfc}#anchor{position:absolute;left:12px;bottom:16px;width:236px}</style></head><body><div id="anchor"></div><script type="module">'+script+'</script></body></html>');
  await page.locator('.nf-account-trigger').waitFor();const triggerBefore=await page.locator('.nf-account-trigger').boundingBox();
  await open(page);
  const panel=page.locator('.nf-account-popover');
  assert.equal(await panel.locator('.nf-account-separator').count(),2);
  const geometry=await panel.evaluate(n=>({box:n.getBoundingClientRect().toJSON(),radius:getComputedStyle(n).borderRadius,avatar:n.querySelector('.nf-avatar').getBoundingClientRect().width,footer:document.querySelector('.nf-account-trigger .nf-avatar').getBoundingClientRect().width,rows:[...n.querySelectorAll('.nf-menu-item')].map(b=>b.getBoundingClientRect().height)}));
  assert.equal(geometry.box.width,224);assert.equal(geometry.radius,'12px');assert.equal(geometry.avatar,28);assert.equal(geometry.footer,34);
  assert(geometry.box.x>=0&&geometry.box.right<=width);assert(geometry.box.y>=0&&geometry.box.bottom<=720);
  assert(geometry.rows.every(h=>h===(width===320?44:36)));
  assert.deepEqual(await page.locator('.nf-account-trigger').boundingBox(),triggerBefore,'Launcher must not change');
  assert.equal(await panel.locator('button').count(),3);assert.equal(await panel.getByText('13',{exact:true}).count(),1);
  assert.equal(await panel.locator('[title]').count(),0);
  if(width===1280)await page.screenshot({path:join(output,'menu.png')});
  await panel.getByRole('button',{name:'设置',exact:true}).press('Escape');await settled(page);
  assert.equal(await panel.count(),0);assert.equal(await page.locator('.nf-account-trigger').evaluate(n=>n===document.activeElement),true);
  await open(page);await page.locator('.nf-account-trigger').click();assert.equal(await panel.evaluate(n=>n.hasAttribute('inert')),true);
  await open(page);await page.waitForTimeout(210);assert.equal(await panel.count(),1);
  // Existing settings / trash routing is unchanged; no dangerous action is submitted.
  await panel.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();await settled(page);
  assert.equal(await page.getByRole('button',{name:'账号与安全',exact:true}).getAttribute('aria-current'),'page');
  await page.getByRole('dialog',{name:'设置',exact:true}).press('Escape');await settled(page);
  await open(page);await panel.getByRole('button',{name:/^回收站/}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();await settled(page);
  assert.equal(await page.getByRole('heading',{name:'回收站',exact:true}).count(),1);
  await page.getByRole('dialog',{name:'设置',exact:true}).press('Escape');await settled(page);
  await page.evaluate(()=>window.accountTest.update({userName:'很长的名字'.repeat(8),compact:false}));await open(page);
  assert.equal(await panel.locator('.nf-username').textContent(),'很长的名字'.repeat(8));
  assert.equal(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  assert.equal(await panel.evaluate(n=>n.getBoundingClientRect().width),236);
  await panel.getByRole('button',{name:'设置',exact:true}).press('Escape');await settled(page);
  await page.evaluate(()=>window.accountTest.update({userName:'示例用户',compact:true,themeMode:'dark'}));await open(page);
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(37, 43, 51)');
  assert.equal(await panel.locator('.nf-account-heading .nf-avatar').evaluate(n=>n.getBoundingClientRect().width),28);
  await panel.getByRole('button',{name:'设置',exact:true}).press('Escape');await settled(page);
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).animationName),'none');
  await panel.getByRole('button',{name:'退出登录',exact:true}).click();assert.equal(await page.evaluate(()=>window.signOutCount),1);
  await page.setViewportSize({width,height:240});await open(page);
  assert(await panel.evaluate(n=>n.getBoundingClientRect().top)>=0);assert.equal(await panel.evaluate(n=>getComputedStyle(n).overflowY),'auto');
  await page.emulateMedia({forcedColors:'active'});
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  reports.push({width,compactWidth:224,avatar:28,launcherUnchanged:true,rows:geometry.rows,settingsAndTrash:true,longName:true,dark:true,reducedMotion:true,shortViewport:true,requests,errors});await context.close();
 }
 console.log(JSON.stringify({actualAccountMenu:true,syntheticOnly:true,output,reports},null,2));
}finally{await browser.close();}
