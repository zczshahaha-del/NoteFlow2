// Synthetic proposal only; no app, real notes, auth, clipboard or model access.
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
const output=mkdtempSync(join(tmpdir(),'noteflow-clean-reading-'));
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
async function settled(frame){await frame.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});}
try{
 for(const width of [1024,736,320]){
  const context=await browser.newContext({viewport:{width,height:1900},hasTouch:width===320}),requests=[],errors=[];
  await context.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://127.0.0.1:8201/'))return r.continue();if(u==='https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js')return r.fulfill({contentType:'text/javascript',body:icons});if(['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js','https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js'].includes(u))return r.fulfill({contentType:'text/javascript',body:floating});requests.push(u);return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8201/');
  const frame=page.frames().find(f=>f!==page.mainFrame()),root=frame.locator('#nf-clean-reading'),toggle=root.locator('[data-action="library"]'),library=root.locator('.cr-library'),avatar=root.locator('.cr-account');
  await toggle.locator('svg').waitFor();await settled(frame);
  const initialToggle=await toggle.boundingBox(),initialDocument=await root.locator('.cr-document').boundingBox();
  assert.equal(await root.locator('header').count(),0,'No topbar');
  assert.equal(await root.getAttribute('data-library'),'false');
  assert.equal(await root.getByRole('button',{name:'我的账号菜单'}).count(),0,'Account is not a collapsed-state control');
  assert(await library.evaluate(n=>n.inert));assert(await library.evaluate(n=>n.getBoundingClientRect().right<=0));
  assert.equal(await root.locator('.cr-content').evaluate(n=>getComputedStyle(n).paddingLeft),'0px','No empty left rail');
  assert(await root.evaluate(n=>n.scrollWidth<=n.clientWidth));
  assert.equal(await root.locator('.cr-keyword').count(),2);assert.equal(await root.locator('.cr-number').count(),3);
  await page.screenshot({path:join(output,`reading-${width}.png`),clip:await root.boundingBox()});
  await toggle.press('Enter');await settled(frame);
  assert.equal(await root.getAttribute('data-library'),'true');assert(await avatar.isVisible());
  assert.equal((await avatar.boundingBox()).width,44);assert.equal(await avatar.locator('.cr-avatar').evaluate(n=>n.getBoundingClientRect().width),34);
  assert.deepEqual(await toggle.boundingBox(),initialToggle);
  if(width>=900)assert.equal((await root.locator('.cr-document').boundingBox()).width,initialDocument.width);
  else assert.deepEqual(await root.locator('.cr-document').boundingBox(),initialDocument);
  assert(!/\d{5,}/.test(await library.innerText()));
  await root.locator('.cr-library-heading h2').click(); // Picture is mouse/default state, not the previous Enter focus ring.
  await page.screenshot({path:join(output,`library-${width}.png`),clip:await root.boundingBox()});
  await avatar.click();const menu=root.locator('.cr-menu');assert(await menu.isVisible());
  const menuBox=await menu.boundingBox(),avatarBox=await avatar.boundingBox(),rootBox=await root.boundingBox();
  assert(menuBox.x>=avatarBox.x+avatarBox.width);assert(menuBox.x+menuBox.width<=rootBox.x+rootBox.width);
  assert.equal(await menu.locator('.cr-identity > span:last-of-type').textContent(),'我的账号');
  assert(await menu.evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.right-20,r.bottom-20));}),'Floating AI entrance cannot cover the account menu');
  await page.screenshot({path:join(output,`account-${width}.png`),clip:await root.boundingBox()});
  await menu.locator('[data-action="close-account"]').press('Escape');assert(!(await menu.isVisible()));assert(await avatar.evaluate(n=>n===document.activeElement));
  await root.getByRole('button',{name:'搜索知识库'}).click();const input=root.getByRole('searchbox',{name:'搜索示例笔记'});
  await input.fill('Redis');assert.equal(await root.locator('[data-note]:visible').count(),1);await input.fill('');
  await input.press('Escape');assert(!(await input.isVisible()),'Close the search layer before testing whole-library Escape');
  await avatar.click();assert(await menu.isVisible());
  await frame.evaluate(()=>{window.cleanMotion=[];window.cleanSampling=true;const sample=()=>{const panel=document.querySelector('.cr-library').getBoundingClientRect(),account=document.querySelector('.cr-account').getBoundingClientRect();window.cleanMotion.push({panel:panel.x,account:account.x});if(window.cleanSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample)});
  await toggle.click();await settled(frame);
  const frames=await frame.evaluate(()=>{window.cleanSampling=false;return window.cleanMotion});
  assert(frames.some(n=>n.panel<0&&n.panel>-240),'Slide has intermediate positions');
  assert(frames.every(n=>Math.abs(n.account-n.panel-12)<0.01),'Avatar travels with the panel, never nudges independently');
  assert.equal(await root.getByRole('button',{name:'我的账号菜单'}).count(),0);assert(!(await menu.isVisible()));assert(await library.evaluate(n=>n.inert));
  assert(await toggle.evaluate(n=>n===document.activeElement));
  await toggle.click();await settled(frame);assert(await avatar.isVisible());assert(!(await menu.isVisible()),'No stale popover on reopen');
  await avatar.press('Escape');await settled(frame);assert.equal(await root.getAttribute('data-library'),'false');assert(await toggle.evaluate(n=>n===document.activeElement));
  await root.locator('.cr-ai-launcher').click();const draft=root.getByRole('textbox',{name:'示例对话草稿'});await draft.fill('保留示例草稿');
  await root.locator('.cr-ai-heading button').click();await root.locator('.cr-ai-launcher').click();assert.equal(await draft.inputValue(),'保留示例草稿');await root.locator('.cr-ai-heading button').press('Escape');await settled(frame);
  if(width===320)assert((await toggle.boundingBox()).height>=44);
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await toggle.click();await settled(frame);
  assert.equal(await root.locator('.cr-shell').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(17, 24, 32)');assert.equal(await library.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
  await page.screenshot({path:join(output,`dark-${width}.png`),clip:await root.boundingBox()});
  assert(await root.evaluate(n=>n.scrollWidth<=n.clientWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,noTopbar:true,noRail:true,accountHiddenWithLibrary:true,avatarSharesPanelMotion:true,launcherStable:true,menuRightAndContained:true,search:true,coloredCode:true,aiDraftPreserved:true,keyboard:true,dark:true,reducedMotion:true,errors,requests});await context.close();
 }
 console.log(JSON.stringify({ok:true,designOnly:true,output,reports},null,2));
}finally{await browser.close()}
