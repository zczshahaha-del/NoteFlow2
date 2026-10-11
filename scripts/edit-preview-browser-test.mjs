// Production preview with synthetic store/API only; never opens a user session.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const path = name => fileURLToPath(new URL('../src/' + name, import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(assets).filter(n => /^(index-|NoteEditor-).*\.css$/.test(n)).map(n => readFileSync(new URL(n, assets), 'utf8')).join('\n');
const before = '# 原版本\n\n原来的合成内容。';
const after = '# Go 学习笔记\n\n修改后的合成内容，保留正常排版和代码颜色。\n\n```go\nfunc main() {\n  fmt.Println("hello")\n}\n```';
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Preview from ${JSON.stringify(path('components/EditPreviewWorkspace.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
const preview={id:'synthetic-preview',noteId:'synthetic-note',targetType:'note',oldContent:${JSON.stringify(before)},newContent:${JSON.stringify(after)},instruction:'合成修改',changeSummary:['更新说明并增加代码示例'],status:'preview'};
window.previewTest={applied:0,cancelled:0,closed:0,replace(){useAppStore.setState({activeEditPreview:{...preview,id:'second'}})}};
useAppStore.setState({activeEditPreview:preview,chatLoading:false,applyEditPreviewRequest:async()=>{window.previewTest.applied++},cancelEditPreviewRequest:async()=>{window.previewTest.cancelled++},closeEditPreview:()=>{window.previewTest.closed++}});
window.fetch=async()=>new Response('{"revisions":[]}',{headers:{'Content-Type':'application/json'}});
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Preview)));`;
const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'isolated-preview',
  resolveId(id) { if(id === 'virtual:preview') return '\0preview'; }, load(id) { if(id === '\0preview') return entry; },
}], build: { write:false, minify:false, rolldownOptions:{input:'virtual:preview',output:{codeSplitting:false}} } });
const chunks = bundle.output.filter(n=>n.type==='chunk');assert.equal(chunks.length,1);
const html = '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+' html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>';
const browser = await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output = mkdtempSync(join(tmpdir(),'noteflow-edit-preview-')), reports=[];
try {
  for (const width of [1280,736,320]) {
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
    const errors=[], requests=[];
    await context.route('**/*',r=>r.request().url()==='http://noteflow.test/' ? r.fulfill({contentType:'text/html; charset=utf-8',body:html}) : (requests.push(r.request().url()),r.abort()));
    const page = await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://noteflow.test/');
    const result=page.getByRole('region',{name:'修改后正文'});
    try { await result.waitFor({state:'visible'}); }
    catch (error) { console.error(JSON.stringify({width,errors,requests,body:await page.locator('body').innerText()})); throw error; }
    assert.match(await result.innerText(),/修改后的合成内容/);
    assert(!await page.getByText('原来的合成内容。',{exact:true}).count());
    assert.equal(await page.getByRole('button',{name:'修改后',exact:true}).getAttribute('aria-pressed'),'true');
    const colors=await result.locator('pre span').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).color))]);
    assert(colors.length>=2,JSON.stringify({width,colors}));
    assert.equal(await page.locator('.note-content p').first().evaluate(n=>getComputedStyle(n).fontSize),'16px');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    await result.evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await page.screenshot({path:join(output,'result-'+width+'.png')});
    await page.getByRole('button',{name:'对照原文',exact:true}).click();
    assert.match(await page.locator('main').innerText(),/原来的合成内容/);
    assert.match(await page.locator('main').innerText(),/修改后的合成内容/);
    await page.getByRole('button',{name:'详细差异',exact:true}).click();
    assert.match(await page.locator('main').innerText(),/原版本/);
    await page.evaluate(()=>window.previewTest.replace());
    await result.waitFor({state:'visible'});
    await page.getByRole('button',{name:'应用修改',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.previewTest.applied),1);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    assert.notEqual(await page.locator('main').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await result.evaluate(n=>getComputedStyle(n).animationName),'none');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
    await page.screenshot({path:join(output,'dark-'+width+'.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    reports.push({width,resultFirst:true,compare:true,diff:true,newPreviewReset:true,coloredCode:true,applyRetained:true,dark:true,reducedMotion:true,errors,requests});
    await context.close();
  }
  console.log(JSON.stringify({ok:true,productionComponent:true,syntheticOnly:true,output,reports},null,2));
} finally { await browser.close(); }
