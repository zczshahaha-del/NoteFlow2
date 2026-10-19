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
const before = '# 模型接口与 API 调用基础\n\n原来的合成内容。';
const after = '# 模型接口与 API 调用基础\n\n修改后的合成内容，保留正常排版和代码颜色。\n\n调用模型的过程可以分成三个步骤：准备请求、发送请求、处理响应。先把这个流程走通，再逐步添加参数和错误处理。\n\n## 1. 从最小示例开始\n\n下面的示例先展示程序结构。实际项目中，请通过环境变量读取密钥，不要直接写入代码。\n\n```go\nfunc main() {\n  fmt.Println("hello")\n}\n```\n\n## 2. 处理响应与异常\n\n除了正常结果，还应考虑超时、限流和空响应。把请求与业务逻辑分开，后续更换模型时就不必重写整个应用。';
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Preview from ${JSON.stringify(path('components/EditPreviewWorkspace.tsx'))};
import {useAppStore} from ${JSON.stringify(path('store/index.tsx'))};
const preview={id:'synthetic-preview',noteId:'synthetic-note',targetType:'section',oldContent:${JSON.stringify(before)},newContent:${JSON.stringify(after)},instruction:'合成修改',changeSummary:['更新说明并增加代码示例','补全请求、响应与异常处理的讲解，保留原来的正文风格','增加环境变量与密钥保管的提醒','整理章节顺序，方便逐步阅读'],status:'preview'};
const histories=new Map();
function history(id){if(!histories.has(id))histories.set(id,[{id:id+'-r1',editId:id,newContent:preview.newContent,instruction:'合成初始稿',changeSummary:preview.changeSummary,source:'generated',createdAt:'2026-10-20T10:50:00Z'}]);return histories.get(id)}
function appendRevision(id,instruction='合成继续修改'){const records=history(id),number=records.length;const revision={id:id+'-r'+(number+1),editId:id,newContent:preview.newContent+'\\n\\n本轮调整：补充第 '+number+' 次合成说明。',instruction,changeSummary:preview.changeSummary,source:'revised',createdAt:'invalid'};records.push(revision);return revision}
function asPreview(id,revision){return {...preview,id,newContent:revision.newContent,changeSummary:revision.changeSummary}}
window.previewTest={applied:0,cancelled:0,closed:0,requests:[],requestBodies:[],completedRevisionReads:[],failNext:'',holdRevisions:false,holdRevise:false,seedRevision:appendRevision,setSummary(items=preview.changeSummary){useAppStore.setState(state=>({activeEditPreview:{...state.activeEditPreview,changeSummary:items}}))},replace(id='second'){const records=history(id);useAppStore.setState({activeEditPreview:asPreview(id,records[records.length-1]),editPreviewError:''})}};
history(preview.id);
useAppStore.setState({activeEditPreview:preview,chatLoading:false,applyEditPreviewRequest:async()=>{window.previewTest.applied++;await new Promise(resolve=>window.previewTest.finishApply=resolve)},closeEditPreview:()=>{window.previewTest.closed++}});
window.fetch=async(input,init={})=>{const a=window.previewTest,url=String(input);a.requests.push(url);const payload=init.body?JSON.parse(String(init.body)):{};a.requestBodies.push({url,payload});
 const id=decodeURIComponent(url.split('/note-edit-previews/')[1]?.split('/')[0]||'synthetic-preview');
 // Capture each response before waiting, so a late old request genuinely carries the old owner's records.
 const snapshot=url.endsWith('/revisions')?history(id).map(record=>({...record})):null;
 if(a.holdRevisions&&snapshot){a.holdRevisions=false;await new Promise(resolve=>a.finishRevisions=resolve)}
 if(a.holdRevise&&url.endsWith('/revise')){a.holdRevise=false;await new Promise(resolve=>a.finishRevise=resolve)}
 if(a.failNext && url.endsWith(a.failNext)){a.failNext='';return new Response('{"detail":"合成请求失败"}',{status:503})}
 let data;
 if(snapshot){a.completedRevisionReads.push(id);data={revisions:snapshot}}
 else if(url.endsWith('/revise'))data={preview:asPreview(id,appendRevision(id,payload.instruction))};
 else if(url.endsWith('/restore-revision')){const revision=history(id).find(record=>record.id===payload.revisionId);if(!revision)return new Response('{"detail":"合成版本不存在"}',{status:404});data={preview:asPreview(id,revision)}}
 else if(url.endsWith('/cancel'))data=(a.cancelled++,{preview:{...preview,id,status:'cancelled'}});
 else return new Response('{"detail":"未配置的合成接口"}',{status:404});
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
    assert.match(await page.locator('.nf-edit-header').getByRole('heading',{level:1}).innerText(),/修改.*模型接口与 API 调用基础/);
    await page.getByText('预览中，尚未写入笔记',{exact:true}).waitFor();
    assert.equal(await page.locator('select,.nf-writing-status ol').count(),0,'No native version dropdown or repeated stage strip');
    const summary=page.getByRole('region',{name:'修改说明',exact:true});
    await summary.waitFor();assert.match(await summary.innerText(),/更新说明并增加代码示例/);
    assert.equal(await summary.locator('li').count(),0,'The initial summary is a short sentence, not the complete list');
    assert.equal(await page.getByRole('button',{name:'撤销上次调整',exact:true}).count(),0,'The initial generated version has nothing to undo');
    assert.equal(await page.getByRole('menu').count(),0,'The more menu does not remain in the closed DOM');
    assert.equal(await page.getByRole('menuitem').count(),0);
    assert.equal(await page.getByRole('region',{name:'预览版本',exact:true}).count(),0);
    const geometry=await page.evaluate(()=>{const r=n=>{const b=document.querySelector(n).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};return {header:r('.nf-edit-header'),bar:r('[aria-label="修改说明"]'),result:r('.edit-preview-result'),footer:r('.nf-edit-footer'),composer:r('.nf-edit-composer'),scroll:r('.nf-edit-scroll')}});
    assert(geometry.header.height<=(width===320?120:80));assert(geometry.footer.height<=90);
    assert(Math.abs(geometry.bar.left-geometry.result.left)<=1);assert(Math.abs(geometry.composer.left-geometry.result.left)<=1);assert(Math.abs(geometry.composer.right-geometry.result.right)<=1);
    assert(geometry.result.top<220,'The document should begin near the top, not below a large summary card');
    const instruction=page.getByRole('textbox',{name:'继续修改预览',exact:true});
    assert.equal(await instruction.getAttribute('placeholder'),'告诉 AI 还需要怎么改…');
    assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?22:24);
    await instruction.fill('一行\n二行\n三行\n四行\n五行\n六行');
    assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?88:96);assert.equal(await instruction.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    await instruction.fill('');assert.equal(await instruction.evaluate(n=>Math.round(n.getBoundingClientRect().height)),width===1280?22:24);
    const more=page.getByRole('button',{name:'更多预览操作',exact:true});
    const openMenu=async()=>{await more.click();await page.getByRole('menu').waitFor();return page.getByRole('menu');};
    const openHistory=async()=>{await page.locator('.nf-edit-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);const menu=await openMenu();await menu.getByRole('menuitem',{name:'历史版本',exact:true}).click();await page.getByRole('menu').waitFor({state:'detached'});await page.getByRole('region',{name:'预览版本',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.nf-edit-scroll').scrollTop===0);};
    const closeHistory=async()=>{await page.getByRole('button',{name:'关闭历史版本',exact:true}).click();await page.getByRole('region',{name:'预览版本',exact:true}).waitFor({state:'detached'});};
    await page.getByRole('button',{name:'展开修改说明',exact:true}).click();assert.equal(await summary.locator('li').count(),4);
    await screenshot('summary');
    await page.evaluate(()=>window.previewTest.setSummary(['精简说明']));assert.equal(await summary.locator('li').count(),1);assert(await page.getByRole('button',{name:'收起修改说明',exact:true}).isVisible());
    await page.evaluate(()=>window.previewTest.setSummary([]));await summary.getByText('修改后的内容已准备好',{exact:true}).waitFor();await page.getByRole('button',{name:'收起修改说明',exact:true}).click();
    await page.evaluate(()=>window.previewTest.setSummary(['补全模型调用的准备步骤并增加适合初学者阅读的错误处理示例']));
    if(width===320){const expand=page.getByRole('button',{name:'展开修改说明',exact:true});await expand.waitFor();await expand.click();assert.match(await summary.locator('li').innerText(),/适合初学者阅读的错误处理示例/);await page.getByRole('button',{name:'收起修改说明',exact:true}).click();}
    await page.evaluate(()=>window.previewTest.setSummary());assert.equal(await summary.locator('li').count(),0);
    let menu=await openMenu();const menuItems=menu.getByRole('menuitem');assert.equal(await menuItems.count(),2);
    await more.press('ArrowDown');await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem');
    await page.keyboard.press('End');assert.equal(await menuItems.last().evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('Home');assert.equal(await menuItems.first().evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('ArrowDown');assert.equal(await menuItems.last().evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('ArrowUp');assert.equal(await menuItems.first().evaluate(n=>document.activeElement===n),true);
    await menuItems.first().dispatchEvent('keydown',{key:'Escape',isComposing:true});assert(await menu.isVisible());
    await menuItems.first().dispatchEvent('keydown',{key:'Escape',keyCode:229});assert(await menu.isVisible(),'Legacy IME Escape must not enter the shared menu fallback');
    await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});assert.equal(await more.evaluate(n=>document.activeElement===n),true);
    await openMenu();await result.locator('p').first().click();await page.getByRole('menu').waitFor({state:'detached'});
    const colors=await result.locator('pre span').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).color))]);
    assert(colors.length>=2,JSON.stringify({width,colors}));
    assert.equal(await page.locator('.note-content p').first().evaluate(n=>getComputedStyle(n).fontSize),'16px');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    await result.evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await result.locator('p').first().click();await screenshot('result');
    const compare=page.getByRole('button',{name:'对照原文',exact:true});assert.equal(await compare.getAttribute('aria-pressed'),'false');
    await compare.click();const collapseCompare=page.getByRole('button',{name:'收起对照',exact:true});assert.equal(await collapseCompare.getAttribute('aria-pressed'),'true');
    const oldCompare=page.getByRole('tabpanel',{name:'原文',exact:true}),newCompare=page.getByRole('tabpanel',{name:'修改后',exact:true});
    if(width>=960){assert.match(await oldCompare.innerText(),/原来的合成内容/);assert.match(await newCompare.innerText(),/修改后的合成内容/);assert.equal(await page.getByRole('tablist',{name:'对照内容',exact:true}).isVisible(),false);}
    else {const tabs=page.getByRole('tablist',{name:'对照内容',exact:true});await tabs.waitFor();assert.equal(await tabs.getByRole('tab',{name:'修改后',exact:true}).getAttribute('aria-selected'),'true');assert(await newCompare.isVisible());assert.equal(await oldCompare.isVisible(),false);await tabs.getByRole('tab',{name:'原文',exact:true}).click();assert.match(await oldCompare.innerText(),/原来的合成内容/);assert.equal(await newCompare.isVisible(),false);await tabs.getByRole('tab',{name:'修改后',exact:true}).click();}
    if(width===1280){await page.locator('#root').evaluate(n=>n.style.width='736px');const tabs=page.getByRole('tablist',{name:'对照内容',exact:true});await tabs.waitFor();assert.equal(await tabs.getByRole('tab',{name:'修改后',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await oldCompare.isVisible(),false,'A wide viewport with a narrow workspace uses one readable comparison tab');await page.locator('#root').evaluate(n=>n.style.width='');await oldCompare.waitFor();}
    await collapseCompare.click();await result.waitFor();
    await page.locator('.nf-edit-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);menu=await openMenu();await menu.getByRole('menuitem',{name:'详细差异',exact:true}).click();await page.getByRole('menu').waitFor({state:'detached'});await page.waitForFunction(()=>document.querySelector('.nf-edit-scroll').scrollTop===0);
    await page.getByRole('region',{name:'详细差异正文',exact:true}).waitFor();
    assert.match(await page.locator('main').innerText(),/原来的合成内容/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Wide diff rows scroll locally');
    await page.getByRole('button',{name:'返回修改稿',exact:true}).click();await result.waitFor();
    await page.evaluate(()=>{window.previewTest.seedRevision('held-second');window.previewTest.holdRevisions=true;window.previewTest.replace('held-second')});
    await result.waitFor({state:'visible'});
    await openHistory();
    await page.getByText('正在读取版本…',{exact:true}).waitFor();
    const pendingUndo=page.getByRole('button',{name:'撤销上次调整',exact:true});if(await pendingUndo.count())assert.ok(await pendingUndo.isDisabled(),'a new preview cannot restore the previous preview revisions');
    assert.equal(await page.locator('.nf-edit-revision').count(),0);
    await page.waitForFunction(()=>Boolean(window.previewTest.finishRevisions));
    await page.evaluate(()=>window.previewTest.replace('ownership-current'));
    await page.waitForFunction(()=>document.querySelector('main').dataset.previewId==='ownership-current');
    assert.equal(await page.getByRole('region',{name:'预览版本',exact:true}).count(),0,'Switching previews closes the history');assert.equal(await page.getByRole('menu').count(),0);assert.equal(await page.locator('main').getAttribute('data-view-mode'),'result');
    await openHistory();await page.getByRole('button',{name:'初始稿，当前预览',exact:true}).waitFor();
    await page.evaluate(()=>window.previewTest.finishRevisions());
    await page.waitForFunction(()=>window.previewTest.completedRevisionReads.includes('held-second'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.nf-edit-revision').count(),1,'The late previous preview response cannot replace the current owner’s revision list');assert.equal(await page.getByRole('button',{name:'恢复初始稿',exact:true}).count(),0);
    await page.getByRole('button',{name:'关闭历史版本',exact:true}).dispatchEvent('keydown',{key:'Escape',isComposing:true});assert(await page.getByRole('region',{name:'预览版本',exact:true}).isVisible());
    await page.getByRole('button',{name:'关闭历史版本',exact:true}).press('Escape');await page.getByRole('region',{name:'预览版本',exact:true}).waitFor({state:'detached'});assert.equal(await more.evaluate(n=>document.activeElement===n),true);
    const callsBeforeIME=await page.evaluate(()=>window.previewTest.requests.filter(url=>url.endsWith('/revise')).length);
    await instruction.fill('输入法尚未确认');await instruction.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});await instruction.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,keyCode:229});
    assert.equal(await page.evaluate(()=>window.previewTest.requests.filter(url=>url.endsWith('/revise')).length),callsBeforeIME,'IME confirmation must not submit a preview adjustment');
    await instruction.fill('失败后保留这条调整要求');
    await page.evaluate(()=>window.previewTest.failNext='/revise');
    await page.getByRole('button',{name:'继续修改',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.equal(await instruction.inputValue(),'失败后保留这条调整要求');
    assert.equal(await page.getByRole('button',{name:'撤销上次调整',exact:true}).count(),0,'A failed first adjustment does not create an undo version');
    await page.getByRole('button',{name:'继续修改',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('textarea').value);
    await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('本轮调整'));
    const undo=page.getByRole('button',{name:'撤销上次调整',exact:true});await undo.waitFor();await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('button')).find(n=>n.textContent.includes('撤销上次调整'));return button&&!button.disabled;});
    await openHistory();await page.getByRole('button',{name:'恢复初始稿',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'第一次调整，当前预览',exact:true}).isDisabled());assert.doesNotMatch(await page.getByRole('region',{name:'预览版本'}).innerText(),/Invalid Date/);await screenshot('versions');await closeHistory();
    await page.evaluate(()=>window.previewTest.failNext='/restore-revision');
    await undo.click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.match(await result.innerText(),/本轮调整/,'failed restore keeps the adjusted preview');
    await undo.click();await page.waitForFunction(()=>!document.querySelector('.edit-preview-result').textContent.includes('本轮调整'));
    await undo.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement===document.querySelector('textarea'));
    const restoreBodies=await page.evaluate(()=>window.previewTest.requestBodies.filter(item=>item.url.endsWith('/restore-revision')).map(item=>item.payload.revisionId));assert.deepEqual(restoreBodies,['ownership-current-r1','ownership-current-r1']);
    await openHistory();await page.getByRole('button',{name:'恢复第一次调整',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('本轮调整'));await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='更多预览操作');
    if(await page.getByRole('region',{name:'预览版本',exact:true}).count())await closeHistory();
    assert.equal(await page.evaluate(()=>window.previewTest.requestBodies.filter(item=>item.url.endsWith('/restore-revision')).at(-1).payload.revisionId),'ownership-current-r2','An explicit history restore uses the selected revision, not a fixed old body');
    await page.getByRole('button',{name:'应用到笔记',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.previewTest.applied),1);
    await page.getByText('正在应用并保存',{exact:true}).waitFor();
    assert.ok(await page.getByRole('button',{name:'应用到笔记',exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'放弃',exact:true}).isDisabled());assert.ok(await undo.isDisabled());
    await instruction.fill('请求中输入的新要求');const callsWhileApplying=await page.evaluate(()=>window.previewTest.requests.length);await instruction.press('Control+Enter');assert.equal(await page.evaluate(()=>window.previewTest.requests.length),callsWhileApplying,'A pending apply cannot start another adjustment');
    await page.evaluate(()=>window.previewTest.finishApply());
    await page.getByText('预览中，尚未写入笔记',{exact:true}).waitFor();
    assert.equal(await instruction.inputValue(),'请求中输入的新要求');await instruction.fill('');
    await page.evaluate(()=>{window.previewTest.holdRevise=true;window.previewTest.replace('pending-input')});await result.waitFor();
    await instruction.fill('本次提交的修改要求');await page.getByRole('button',{name:'继续修改',exact:true}).click();await page.waitForFunction(()=>Boolean(window.previewTest.finishRevise));
    await instruction.fill('请求尚未完成时新写的要求');await page.evaluate(()=>window.previewTest.finishRevise());await page.waitForFunction(()=>document.querySelector('.edit-preview-result').textContent.includes('本轮调整'));
    assert.equal(await instruction.inputValue(),'请求尚未完成时新写的要求','A successful adjustment clears only its submitted text, not new input typed while waiting');await instruction.fill('');
    await page.evaluate(()=>{window.previewTest.failNext='/revisions';window.previewTest.replace('revision-error')});
    await openHistory();await page.getByRole('alert').filter({hasText:'暂时无法读取修订记录'}).waitFor();
    await page.getByRole('button',{name:'重试读取',exact:true}).click();await page.getByRole('button',{name:'初始稿，当前预览',exact:true}).waitFor();await closeHistory();
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
    await page.getByRole('button',{name:'放弃',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'合成请求失败'}).waitFor();
    assert.match(await result.innerText(),/修改后的合成内容/,'failed cancellation must keep the retry target visible');
    await page.getByRole('button',{name:'放弃',exact:true}).click();
    await result.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.previewTest.cancelled),1);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    reports.push({width,geometry,resultFirst:true,summaryDirect:true,summaryExpandable:true,moreMenuKeyboard:true,moreMenuOutsideClose:true,versionPanel:true,openedAuxiliaryVisibleAfterScrolling:true,initialUndoAbsent:true,undoAfterSuccessfulAdjustment:true,compactComposer:true,IME:true,compare:true,narrowCompareTabs:true,diff:true,newPreviewReset:true,coloredCode:true,applyRetained:true,applyStage:true,inFlightNewInstructionRetained:true,revisionOwnership:true,lateRevisionIgnored:true,selectedRevisionRestored:true,revisionReadRetry:true,restoreFailureRetry:true,cancelFailureRetry:true,dark:true,reducedMotion:true,errors,requests});
    await context.close();
  }
  console.log(JSON.stringify({ok:true,productionComponent:true,syntheticOnly:true,output,reports},null,2));
} finally { await browser.close(); }
