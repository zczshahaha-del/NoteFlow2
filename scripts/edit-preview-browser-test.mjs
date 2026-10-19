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
const after = '# 模型接口与 API 调用基础\n\n修改后的合成内容，保留正常排版和代码颜色。\n\n调用模型的过程可以分成三个步骤：准备请求、发送请求、处理响应。先把这个流程走通，再逐步添加参数和错误处理。\n\n## 1. 从最小示例开始\n\n下面的示例先展示程序结构。实际项目中，请通过环境变量读取密钥，不要直接写入代码。\n\n```go\nfunc main() {\n  fmt.Println("hello")\n}\n```\n\n## 2. 处理响应与异常\n\n除了正常结果，还应考虑超时、限流和空响应。把请求与业务逻辑分开，后续更换模型时就不必重写整个应用。';
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Preview from ${JSON.stringify(path('components/EditPreviewWorkspace.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
const preview={id:'synthetic-preview',noteId:'synthetic-note',targetType:'section',oldContent:${JSON.stringify(before)},newContent:${JSON.stringify(after)},instruction:'合成修改',changeSummary:['更新说明并增加代码示例','补全请求、响应与异常处理的讲解，保留原来的正文风格','增加环境变量与密钥保管的提醒','整理章节顺序，方便逐步阅读'],status:'preview'};
window.previewTest={applied:0,cancelled:0,closed:0,requests:[],failNext:'',holdRevisions:false,replace(id='second'){useAppStore.setState({activeEditPreview:{...preview,id}})}};
useAppStore.setState({activeEditPreview:preview,chatLoading:false,applyEditPreviewRequest:async()=>{window.previewTest.applied++;await new Promise(resolve=>window.previewTest.finishApply=resolve)},closeEditPreview:()=>{window.previewTest.closed++}});
window.fetch=async(input)=>{const a=window.previewTest,url=String(input);a.requests.push(url);
 if(a.holdRevisions&&url.endsWith('/revisions')){a.holdRevisions=false;await new Promise(resolve=>a.finishRevisions=resolve)}
 if(a.failNext && url.endsWith(a.failNext)){a.failNext='';return new Response('{"detail":"合成请求失败"}',{status:503})}
 const id=decodeURIComponent(url.split('/note-edit-previews/')[1]?.split('/')[0]||'synthetic-preview');
 const data=url.endsWith('/revisions')?{revisions:[{id:id+'-r1',newContent:preview.oldContent,source:'generated',createdAt:'2026-10-20T10:50:00Z'},{id:id+'-r2',newContent:preview.newContent,source:'revised',createdAt:'invalid'}]}
 :url.endsWith('/cancel')?(a.cancelled++,{preview:{...preview,id,status:'cancelled'}})
 :{preview:{...preview,id,newContent:preview.oldContent}};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})};
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
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:width!==1280,timezoneId:'Asia/Shanghai'});
    const errors=[], requests=[];
    await context.route('**/*',r=>r.request().url()==='http://noteflow.test/' ? r.fulfill({contentType:'text/html; charset=utf-8',body:html}) : (requests.push(r.request().url()),r.abort()));
    const page = await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    const screenshot=async name=>{await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:join(output,name+'-'+width+'.png')});};
    await page.goto('http://noteflow.test/');
    const result=page.getByRole('region',{name:'修改后正文'});
    try { await result.waitFor({state:'visible'}); }
    catch (error) { console.error(JSON.stringify({width,errors,requests,body:await page.locator('body').innerText()})); throw error; }
    assert.match(await result.innerText(),/修改后的合成内容/);
    assert(!await page.getByText('原来的合成内容。',{exact:true}).count());
    assert.equal(await page.getByRole('button',{name:'修改后',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByText('修改待确认',{exact:true}).waitFor();
    assert.equal(await page.locator('select,.nf-writing-status ol').count(),0,'No native version dropdown or repeated stage strip');
    assert.equal(await page.getByRole('region',{name:'修改说明',exact:true}).count(),0);
    assert.equal(await page.getByRole('region',{name:'预览版本',exact:true}).count(),0);
    const geometry=await page.evaluate(()=>{const r=n=>{const b=document.querySelector(n).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};return {header:r('.nf-edit-header'),bar:r('.nf-edit-reviewbar'),result:r('.edit-preview-result'),footer:r('.nf-edit-footer'),composer:r('.nf-edit-composer'),scroll:r('.nf-edit-scroll')}});
    assert(geometry.header.height<=80);assert(geometry.footer.height<=90);
    assert(Math.abs(geometry.bar.left-geometry.result.left)<=1);assert(Math.abs(geometry.composer.left-geometry.result.left)<=1);assert(Math.abs(geometry.composer.right-geometry.result.right)<=1);
    assert(geometry.result.top<220,'The document should begin near the top, not below a large summary card');
    const instruction=page.getByRole('textbox',{name:'继续调整预览',exact:true});
    assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?22:24);
    await instruction.fill('一行\n二行\n三行\n四行\n五行\n六行');
    assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?88:96);assert.equal(await instruction.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    await instruction.fill('');assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?22:24);
    const summaryToggle=page.getByRole('button',{name:'修改说明',exact:true}),historyToggle=page.getByRole('button',{name:'版本记录',exact:true});
    await summaryToggle.click();const summary=page.getByRole('region',{name:'修改说明',exact:true});await summary.waitFor();assert.equal(await summary.locator('li').count(),4);
    await screenshot('summary');await summaryToggle.dispatchEvent('keydown',{key:'Escape',isComposing:true});assert(await summary.isVisible());
    await summaryToggle.press('Escape');await summary.waitFor({state:'detached'});assert.equal(await summaryToggle.evaluate(n=>document.activeElement===n),true);
    const colors=await result.locator('pre span').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).color))]);
    assert(colors.length>=2,JSON.stringify({width,colors}));
    assert.equal(await page.locator('.note-content p').first().evaluate(n=>getComputedStyle(n).fontSize),'16px');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    await result.evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await result.locator('p').first().click();await screenshot('result');
    await page.getByRole('button',{name:'对照原文',exact:true}).click();
    assert.match(await page.locator('main').innerText(),/原来的合成内容/);
    assert.match(await page.locator('main').innerText(),/修改后的合成内容/);
    assert.equal(await page.locator('.nf-edit-compare').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),width>=960?2:1);
    if(width===1280){await page.locator('#root').evaluate(n=>n.style.width='736px');assert.equal(await page.locator('.nf-edit-compare').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1,'Compare columns use the workspace width, not the viewport');await page.locator('#root').evaluate(n=>n.style.width='');}
    await page.getByRole('button',{name:'详细差异',exact:true}).click();
    assert.match(await page.locator('main').innerText(),/原版本/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Wide diff rows scroll locally');
    await page.evaluate(()=>{window.previewTest.holdRevisions=true;window.previewTest.replace()});
    await result.waitFor({state:'visible'});
    await historyToggle.click();
    await page.getByText('正在读取版本…',{exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'撤销上次调整',exact:true}).isDisabled(),'a new preview cannot restore the previous preview revisions');
    assert.equal(await page.locator('.nf-edit-revision').count(),0);
    await page.waitForFunction(()=>Boolean(window.previewTest.finishRevisions));
    await page.evaluate(()=>window.previewTest.finishRevisions());
    await page.getByRole('button',{name:'恢复第 1 版',exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'第 2 版，当前预览',exact:true}).isDisabled());
    assert.doesNotMatch(await page.getByRole('region',{name:'预览版本'}).innerText(),/Invalid Date/);
    await screenshot('versions');
    await page.getByRole('button',{name:'恢复第 1 版',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('原来的合成内容'));
    await page.waitForFunction(()=>document.activeElement?.textContent.includes('版本记录'));
    await page.evaluate(()=>window.previewTest.replace());await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('修改后的合成内容'));
    await historyToggle.press('Escape');assert.equal(await historyToggle.evaluate(n=>document.activeElement===n),true);
    const callsBeforeIME=await page.evaluate(()=>window.previewTest.requests.filter(url=>url.endsWith('/revise')).length);
    await instruction.fill('输入法尚未确认');await instruction.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});await instruction.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,keyCode:229});
    assert.equal(await page.evaluate(()=>window.previewTest.requests.filter(url=>url.endsWith('/revise')).length),callsBeforeIME,'IME confirmation must not submit a preview adjustment');
    await instruction.fill('失败后保留这条调整要求');
    await page.evaluate(()=>window.previewTest.failNext='/revise');
    await page.getByRole('button',{name:'调整预览',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.equal(await instruction.inputValue(),'失败后保留这条调整要求');
    await page.getByRole('button',{name:'调整预览',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('textarea').value);
    await page.evaluate(()=>window.previewTest.replace());
    await historyToggle.click();await page.getByRole('button',{name:'恢复第 1 版',exact:true}).waitFor();
    await page.evaluate(()=>window.previewTest.failNext='/restore-revision');
    await page.getByRole('button',{name:'撤销上次调整',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.match(await result.innerText(),/修改后的合成内容/,'failed restore keeps the preview');
    await page.getByRole('button',{name:'撤销上次调整',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('原来的合成内容'));
    // Reopen the synthetic result for visual/color and pending-apply checks.
    await page.evaluate(()=>window.previewTest.replace());
    await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('修改后的合成内容'));
    await historyToggle.click();
    await page.getByRole('button',{name:'应用修改',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.previewTest.applied),1);
    await page.getByText('正在应用并保存',{exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'应用修改',exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'取消',exact:true}).isDisabled());
    await instruction.fill('请求中输入的新要求');const callsWhileApplying=await page.evaluate(()=>window.previewTest.requests.length);await instruction.press('Control+Enter');assert.equal(await page.evaluate(()=>window.previewTest.requests.length),callsWhileApplying,'A pending apply cannot start another adjustment');
    await page.evaluate(()=>window.previewTest.finishApply());
    await page.getByText('修改待确认',{exact:true}).waitFor();
    assert.equal(await instruction.inputValue(),'请求中输入的新要求');await instruction.fill('');
    await page.evaluate(()=>{window.previewTest.failNext='/revisions';window.previewTest.replace('revision-error')});
    await historyToggle.click();await page.getByRole('alert').filter({hasText:'暂时无法读取修订记录'}).waitFor();
    await page.getByRole('button',{name:'重试读取',exact:true}).click();await page.getByRole('button',{name:'恢复第 1 版',exact:true}).waitFor();await historyToggle.press('Escape');
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    assert.notEqual(await page.locator('main').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await result.evaluate(n=>getComputedStyle(n).animationName),'none');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
    await result.locator('p').first().click();
    assert.notEqual(await result.locator('.code-toolbar-actions').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(255, 255, 255, 0.98)','Dark preview toolbars do not retain a white island');
    await screenshot('dark');
    await page.setViewportSize({width,height:360});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    const short=await page.locator('.nf-edit-footer').boundingBox();assert(short.y+short.height<=360.1);
    await page.emulateMedia({forcedColors:'active'});await instruction.focus();assert.equal(await instruction.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
    await page.evaluate(()=>window.previewTest.failNext='/cancel');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.match(await result.innerText(),/修改后的合成内容/,'failed cancellation must keep the retry target visible');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await result.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.previewTest.cancelled),1);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    reports.push({width,geometry,resultFirst:true,summaryOnDemand:true,versionPanel:true,compactComposer:true,IME:true,compare:true,diff:true,newPreviewReset:true,coloredCode:true,applyRetained:true,applyStage:true,revisionOwnership:true,revisionReadRetry:true,restoreFailureRetry:true,cancelFailureRetry:true,dark:true,reducedMotion:true,errors,requests});
    await context.close();
  }
  console.log(JSON.stringify({ok:true,productionComponent:true,syntheticOnly:true,output,reports},null,2));
} finally { await browser.close(); }
