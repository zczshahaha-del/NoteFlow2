// Local design fragment only; not an implementation or business-data test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const icons=readFileSync(process.env.NOTEFLOW_LUCIDE_SCRIPT||'/Users/zhangcheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.min.js','utf8');
const result=await build({configFile:false,logLevel:'silent',plugins:[{name:'preview-floating',resolveId(id){if(id==='virtual:floating')return '\0floating'},load(id){if(id==='\0floating')return 'import * as f from "@floating-ui/dom";import * as c from "@floating-ui/core";window.FloatingUIDOM=f;window.FloatingUICore=c;'}}],build:{write:false,minify:true,rolldownOptions:{input:'virtual:floating',output:{format:'iife',codeSplitting:false}}}});
const floating=result.output.find(x=>x.type==='chunk').code;
const output=mkdtempSync(join(tmpdir(),'noteflow-fixed-account-'));
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
async function settled(frame){await frame.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});}
try{
 for(const width of [736,320]){
  const context=await browser.newContext({viewport:{width,height:1600},hasTouch:width===320});
  const requests=[],errors=[];
  await context.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://127.0.0.1:8199/'))return r.continue();if(u==='https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js')return r.fulfill({contentType:'text/javascript',body:icons});if(['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js','https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js'].includes(u))return r.fulfill({contentType:'text/javascript',body:floating});requests.push(u);return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8199/');
  const frame=page.frames().find(f=>f!==page.mainFrame()),root=frame.locator('#nf-fixed-account');
  await root.locator('.fa-toggle svg').first().waitFor();
  assert(await root.evaluate(n=>n.scrollWidth<=n.clientWidth),'No horizontal overflow');
  assert(!/\d{5,}/.test(await root.innerText()),'No numerical account identifier in either sidebar');
  for(const stage of await root.locator('.fa-stage').all()){
   const toggle=stage.locator('.fa-toggle'),avatar=stage.locator('.fa-account'),box=await avatar.boundingBox();
   assert.equal(box.width,44);assert.equal(box.height,44);
   assert.equal(await avatar.locator('.fa-circle').evaluate(n=>n.getBoundingClientRect().width),34);
   await toggle.press('Enter');await settled(frame);
   assert.deepEqual(await avatar.boundingBox(),box,'Avatar must not move when library toggles');
   await toggle.click();await settled(frame);
   assert.deepEqual(await avatar.boundingBox(),box);
   await avatar.click();const menu=stage.locator('.fa-menu');assert(await menu.isVisible());
   assert.equal(await menu.locator('.fa-identity > span:last-of-type').textContent(),'我的账号');
   const menuBox=await menu.boundingBox(),stageBox=await stage.boundingBox();
   assert(menuBox.x>=box.x+box.width,'Menu is on the right');
   assert(menuBox.x+menuBox.width<=stageBox.x+stageBox.width,'Menu fits its surface');
   assert(await menu.evaluate(n=>n.scrollWidth<=n.clientWidth),'Menu content fits');
   await menu.locator('.fa-close').press('Escape');assert(!(await menu.isVisible()));
   assert(await avatar.evaluate(n=>n===document.activeElement));
   await stage.locator('.fa-paper h2').click();
  }
  await page.mouse.move(width-10,10);await settled(frame);
  await page.screenshot({path:join(output,`comparison-${width}.png`),clip:await root.boundingBox()});
  const initial=root.locator('[data-stage="expanded"]');
  await initial.locator('.fa-account').click();
  await page.screenshot({path:join(output,`menu-${width}.png`),clip:await root.boundingBox()});
  await initial.locator('.fa-close').click();await initial.locator('.fa-paper h2').click();
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  assert.equal(await initial.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(17, 24, 32)');
  assert.equal(await initial.locator('.fa-library').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
  await page.screenshot({path:join(output,`dark-${width}.png`),clip:await root.boundingBox()});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,fixedAvatarBothStates:true,noSidebarAccountText:true,neutralIdentityInMenu:true,menuRightAndContained:true,keyboard:true,dark:true,reducedMotion:true,errors,requests});await context.close();
 }
 console.log(JSON.stringify({ok:true,designOnly:true,output,reports},null,2));
}finally{await browser.close()}
