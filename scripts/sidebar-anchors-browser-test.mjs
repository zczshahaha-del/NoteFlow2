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
const output=mkdtempSync(join(tmpdir(),'noteflow-sidebar-anchors-'));
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
try{
 for(const width of [736,320]){
  const context=await browser.newContext({viewport:{width,height:1600},hasTouch:width===320});
  const requests=[],errors=[];
  await context.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://127.0.0.1:8198/'))return r.continue();if(u==='https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js')return r.fulfill({contentType:'text/javascript',body:icons});if(['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js','https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js'].includes(u))return r.fulfill({contentType:'text/javascript',body:floating});requests.push(u);return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8198/');
  const frame=page.frames().find(f=>f!==page.mainFrame());const root=frame.locator('#nf-sidebar-anchors');
  await root.locator('.nfa-toggle svg').first().waitFor();
  assert.equal(await root.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
  const stage=root.locator('[data-stage="normal"]');
  const edge=stage.locator('.nfa-edge'),toggle=stage.locator('.nfa-toggle'),avatar=stage.locator('.nfa-account');
  const initialToggle=await toggle.boundingBox(),initialAvatar=await avatar.boundingBox();
  assert.equal(initialToggle.x+initialToggle.width/2,initialAvatar.x+initialAvatar.width/2);
  assert.equal(await edge.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await edge.evaluate(n=>getComputedStyle(n).borderRightWidth),'0px');
  assert.equal(await avatar.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  await toggle.press('Enter');
  await frame.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
  assert.equal(await stage.getAttribute('data-expanded'),'true');
  assert.deepEqual(await toggle.boundingBox(),initialToggle,'Library toggle cannot jump');
  assert.deepEqual(await avatar.boundingBox(),initialAvatar,'Avatar cannot jump');
  await toggle.click();await frame.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
  await avatar.click();const menu=stage.locator('.nfa-menu');assert(await menu.isVisible());
  const menuBox=await menu.boundingBox(),stageBox=await stage.boundingBox();
  assert(menuBox.x>=initialAvatar.x+initialAvatar.width,'Account menu opens to the right');
  assert(menuBox.x+menuBox.width<=stageBox.x+stageBox.width,'Menu stays inside its surface');
  await avatar.press('Escape');assert.equal(await menu.isVisible(),false);
  assert(await avatar.evaluate(n=>n===document.activeElement));
  // Default-state pictures must not depict the preceding keyboard focus ring.
  await stage.locator('.nfa-paper h2').click();
  await page.mouse.move(width-10,10);await page.waitForTimeout(180);
  await page.screenshot({path:join(output,`comparison-${width}.png`),clip:await root.boundingBox()});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  assert.notEqual(await stage.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(253, 253, 252)');
  await page.screenshot({path:join(output,`dark-${width}.png`),clip:await root.boundingBox()});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,noRailSurface:true,noAvatarOuterFrame:true,alignedAnchors:true,stableDuringToggle:true,rightMenu:true,keyboard:true,dark:true});await context.close();
 }
 console.log(JSON.stringify({ok:true,designOnly:true,output,reports},null,2));
}finally{await browser.close()}
