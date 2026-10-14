// Independent design fragment only. No production service, notes, or clipboard.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright');
const source=readFileSync(new URL('../design/noteflow-workbench-proposal.html',import.meta.url),'utf8');
assert(!/<(?:html|head|body|!doctype)\b/i.test(source),'Keep the source an inline fragment');
assert(source.includes('nfPreviewHighlight'),'Use the bundled syntax engine');
assert(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(source),'No business network calls');
const output=mkdtempSync(join(tmpdir(),'noteflow-workbench-proposal-'));
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const reports=[];
const iconScript=readFileSync(process.env.NOTEFLOW_LUCIDE_SCRIPT||'/Users/zhangcheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/lucide/dist/umd/lucide.min.js','utf8');
const floatBundle=await build({configFile:false,logLevel:'silent',plugins:[{name:'offline-floating-ui',resolveId(id){if(id==='virtual:floating')return '\0floating'},load(id){if(id==='\0floating')return 'import * as floating from "@floating-ui/dom";window.FloatingUIDOM=floating;'}}],build:{write:false,minify:true,rolldownOptions:{input:'virtual:floating',output:{format:'iife',codeSplitting:false}}}});
const floatScript=floatBundle.output.find(n=>n.type==='chunk').code;
async function settled(page,frame){await frame.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.waitForTimeout(250);}
try{
 for(const width of [1024,736,320]){
  // The standalone wrapper uses a viewport-height iframe. Fit the complete
  // mockup in it so outer-frame scrolling does not eat native click delivery.
  const context=await browser.newContext({viewport:{width,height:2600},hasTouch:width===320});
  const errors=[],requests=[];
  await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.hostname==='127.0.0.1'&&url.port==='8197')return r.continue();if(url.href==='https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js')return r.fulfill({contentType:'text/javascript',body:iconScript});if(url.href==='https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js')return r.fulfill({contentType:'text/javascript',body:floatScript});requests.push(url.href);return r.abort()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.NOTEFLOW_PROPOSAL_URL||'http://127.0.0.1:8197/');
  const frame=page.frames().find(f=>f!==page.mainFrame());assert(frame);
  await frame.locator('#nf-workbench-proposal .nf-note').first().waitFor();
  await frame.evaluate(()=>{window.previewCopies=[];window.clicks=[];document.getElementById('nf-workbench-proposal').addEventListener('click',e=>window.clicks.push({action:e.target.closest('button')?.dataset.action,chapter:e.target.closest('button')?.dataset.chapter,text:e.target.closest('button')?.textContent}),true);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>window.previewCopies.push(s)}})});
  for(let i=0;i<3;i++){
   const view=frame.locator('[data-variant]:visible');assert.equal(await view.count(),1);
   assert.equal(await view.locator('.nf-document-heading h1').innerText(),'Go 语言');
   assert(await view.locator('.nf-codeblock .hljs-keyword').count()>0);
   assert.equal(await view.locator('.nf-layout').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'No workspace overflow');
   assert.equal(await view.locator('.nf-reading').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'No document overflow');
   await view.locator('[data-action="copy"]').click();
   assert((await frame.evaluate(()=>window.previewCopies.at(-1))).includes('package main'));
   await view.locator('[data-action="outline"]').press('Enter');
   await view.locator('[data-chapter="2"]').click();
   assert((await view.locator('.nf-prose h2').innerText()).includes('通道'));
   await view.locator('[data-action="fold"]').click();assert.equal(await view.locator('.nf-outline-groups').isVisible(),false);
   await view.locator('[data-action="outline"]').click();
   await view.locator('[data-chapter="0"]').click();
   await view.locator('[data-action="outline"]').click();
   const before=await view.locator('.nf-screen').getAttribute('data-ai');
   const libraryBefore=await view.locator('.nf-screen').getAttribute('data-library');
   await view.locator('.nf-chrome [data-action="ai"]').click();
   assert.notEqual(await view.locator('.nf-screen').getAttribute('data-ai'),before);
   await view.locator('.nf-chrome [data-action="ai"]').click();
   if(await view.locator('.nf-screen').getAttribute('data-library')!==libraryBefore)await view.locator('.nf-chrome [data-action="library"]').click();
   await settled(page,frame);
   await page.screenshot({path:join(output,`${width}-${i}.png`),clip:await view.locator('.nf-screen').boundingBox()});
   if(i<2)await frame.getByRole('button',{name:'下一状态',exact:true}).click();
  }
  const view=frame.locator('[data-variant]:visible');
  await view.getByRole('textbox',{name:'示例对话输入'}).fill('尚未发送的预览草稿');
  await view.locator('.nf-chrome [data-action="library"]').click();
  assert.equal(await view.locator('.nf-ai textarea').inputValue(),'尚未发送的预览草稿','Panel toggles preserve the draft');
  const firstNote=view.locator('[data-note="Git 入门学习笔记"]');await firstNote.click();
  assert.equal(await view.locator('.nf-document-heading h1').innerText(),'Git 入门学习笔记');
  assert((await view.locator('pre code').innerText()).includes('git status'));
  assert.equal(await view.locator('.nf-codebar>span').innerText(),'Bash');
  await view.locator('[data-action="copy"]').click();
  assert((await frame.evaluate(()=>window.previewCopies.at(-1))).includes('git status'));
  await view.locator('[data-action="search"]').click();
  await view.getByRole('textbox',{name:'筛选示例笔记'}).fill('Redis');
  assert.equal(await view.locator('.nf-note:visible').count(),1);
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await settled(page,frame);
  assert.notEqual(await view.locator('.nf-screen').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(253, 253, 252)');
  await page.screenshot({path:join(output,`${width}-dark.png`),clip:await view.locator('.nf-screen').boundingBox()});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  reports.push({width,threeLayouts:true,syntaxEngine:true,chapterSelection:true,groupCollapse:true,noteSelection:true,copy:true,search:true,dark:true});
  await context.close();
 }
 console.log(JSON.stringify({ok:true,designOnly:true,output,reports},null,2));
}finally{await browser.close()}
