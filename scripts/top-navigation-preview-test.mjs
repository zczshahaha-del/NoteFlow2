// Standalone proposal, synthetic content, no production app or account access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const icons=readFileSync(process.env.NOTEFLOW_LUCIDE_SCRIPT||'/Users/zhangcheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.min.js','utf8');
const bundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'preview-floating',resolveId(id){if(id==='virtual:floating')return '\0floating'},load(id){if(id==='\0floating')return 'import * as f from "@floating-ui/dom";import * as c from "@floating-ui/core";window.FloatingUIDOM=f;window.FloatingUICore=c;'}}],build:{write:false,minify:true,rolldownOptions:{input:'virtual:floating',output:{format:'iife',codeSplitting:false}}}});
const floating=bundle.output.find(x=>x.type==='chunk').code;
const output=mkdtempSync(join(tmpdir(),'noteflow-top-navigation-'));
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
async function settled(frame){await frame.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});}
try{
 for(const width of [1024,736,320]){
  const context=await browser.newContext({viewport:{width,height:1800},hasTouch:width===320}),requests=[],errors=[];
  await context.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://127.0.0.1:8200/'))return r.continue();if(u==='https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js')return r.fulfill({contentType:'text/javascript',body:icons});if(['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js','https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js'].includes(u))return r.fulfill({contentType:'text/javascript',body:floating});requests.push(u);return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8200/');
  const frame=page.frames().find(f=>f!==page.mainFrame()),root=frame.locator('#nf-top-navigation'),toggle=root.locator('[data-action="library"]'),avatar=root.locator('[data-action="account"]');
  await toggle.locator('svg').waitFor();await settled(frame);
  const initialAvatar=await avatar.boundingBox(),initialToggle=await toggle.boundingBox();
  const initialDocument=await root.locator('.tn-document').boundingBox();
  assert.equal(await root.getAttribute('data-library'),String(width>=900));
  assert(await root.evaluate(n=>n.scrollWidth<=n.clientWidth),'No horizontal overflow');
  assert.equal(await root.locator('.tn-library .tn-avatar').count(),0,'Library owns no account entry');
  assert.equal(await root.locator('.tn-keyword').count(),2);assert.equal(await root.locator('.tn-number').count(),3);
  await page.screenshot({path:join(output,`initial-${width}.png`),clip:await root.boundingBox()});
  await frame.evaluate(()=>{window.navFrames=[];window.navSampling=true;const sample=()=>{const n=document.querySelector('.tn-library');window.navFrames.push(getComputedStyle(n).transform);if(window.navSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
  await toggle.click();await settled(frame);
  const frames=await frame.evaluate(()=>{window.navSampling=false;return window.navFrames});
  assert(frames.some(t=>t.startsWith('matrix(')&&Number(t.split(',')[4])<0&&Number(t.split(',')[4])>-240),'Slide includes intermediate frames');
  assert.deepEqual(await avatar.boundingBox(),initialAvatar,'Account entry is independent of directory geometry');
  assert.deepEqual(await toggle.boundingBox(),initialToggle,'Launcher remains in top chrome');
  if(width>=900)assert.equal((await root.locator('.tn-document').boundingBox()).width,initialDocument.width,'Desktop close recenters without rewrapping this document');
  else assert.deepEqual(await root.locator('.tn-document').boundingBox(),initialDocument,'Narrow drawer overlays rather than reflowing the document');
  await toggle.press('Enter');await settled(frame);
  if(await root.getAttribute('data-library')!=='true'){await toggle.click();await settled(frame);}
  await root.getByRole('button',{name:'搜索知识库',exact:true}).click();
  await root.getByRole('searchbox',{name:'搜索示例笔记'}).fill('Redis');
  assert.equal(await root.locator('[data-note]:visible').count(),1);
  await root.getByRole('searchbox',{name:'搜索示例笔记'}).fill('');
  await toggle.click();await settled(frame);
  assert.equal(await root.getAttribute('data-library'),'false');
  assert(await root.locator('.tn-library').evaluate(n=>n.inert));
  assert(await root.locator('.tn-library').evaluate(n=>n.getBoundingClientRect().right<=0),'Closed sidebar leaves no rail');
  assert.equal(await root.locator('.tn-reading-area').evaluate(n=>getComputedStyle(n).paddingLeft),'0px');
  await page.screenshot({path:join(output,`reading-${width}.png`),clip:await root.boundingBox()});
  await avatar.click();const menu=root.locator('.tn-menu');assert(await menu.isVisible());
  const menuBox=await menu.boundingBox(),rootBox=await root.boundingBox();assert(menuBox.x>=rootBox.x&&menuBox.x+menuBox.width<=rootBox.x+rootBox.width);
  assert(menuBox.y>=initialAvatar.y+initialAvatar.height,'Account menu opens below top chrome');
  assert.equal(await menu.locator('.tn-identity > span:last-of-type').textContent(),'我的账号');
  await page.screenshot({path:join(output,`account-${width}.png`),clip:await root.boundingBox()});
  await menu.getByRole('button',{name:'关闭账号菜单'}).press('Escape');assert(!(await menu.isVisible()));assert(await avatar.evaluate(n=>n===document.activeElement));
  await root.locator('.tn-ai-toggle').click();await settled(frame);
  const draft=root.getByRole('textbox',{name:'示例对话草稿'});await draft.fill('保留这一段示例草稿');
  await root.locator('.tn-ai-toggle').click();await settled(frame);await root.locator('.tn-ai-toggle').click();await settled(frame);
  assert.equal(await draft.inputValue(),'保留这一段示例草稿');
  await root.locator('.tn-ai-toggle').click();await settled(frame);
  if(width===320)assert((await toggle.boundingBox()).height>=44&&(await avatar.boundingBox()).height>=44);
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  assert.equal(await root.locator('.tn-shell').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(17, 24, 32)');
  await toggle.click();await settled(frame);assert.equal(await root.locator('.tn-library').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
  await page.screenshot({path:join(output,`dark-${width}.png`),clip:await root.boundingBox()});
  if(width<900){await toggle.press('Escape');assert.equal(await root.getAttribute('data-library'),'false');assert(await toggle.evaluate(n=>n===document.activeElement));}
  assert(await root.evaluate(n=>n.scrollWidth<=n.clientWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,topChromeStable:true,sidebarLeavesNoRail:true,continuousSlide:true,coloredCode:true,accountBelowHeader:true,keyboard:true,search:true,aiDraftPreserved:true,dark:true,reducedMotion:true,errors,requests});await context.close();
 }
 console.log(JSON.stringify({ok:true,designOnly:true,output,reports},null,2));
}finally{await browser.close()}
