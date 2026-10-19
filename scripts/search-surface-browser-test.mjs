// Offline production-component check: synthetic props, blocked network, fresh
// browser context. Never opens the app, localhost, or the user's browser session.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/LibrarySearchDialog.tsx', import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const cssFile = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
assert.ok(cssFile, 'run npm run build before this check');
const css = readFileSync(new URL(cssFile, assets), 'utf8');
const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import SearchDialog from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));
const pending=[]; let open=false,selected=null;
const search=(query,options)=>new Promise((resolve,reject)=>pending.push({query,options,resolve,reject}));
const tree=[{id:'sample-redis',name:'Redis',type:'file',updatedAt:'2026-10-01T00:00:00Z'}];
const render=()=>root.render(React.createElement(SearchDialog,{open,treeData:tree,searchNotesFn:search,onClose(){open=false;render()},onSelect(source){selected=source}}));
window.searchTest={get pending(){return pending},get selected(){return selected},show(){open=true;render()},resolve(rows){pending.at(-1).resolve({results:rows})},reject(){pending.at(-1).reject(new Error('合成搜索错误'))}};
document.getElementById('trigger').onclick=()=>window.searchTest.show(); render();`;
const bundled = await build({
  configFile: false, logLevel: 'silent',
  plugins: [{ name: 'offline-search-entry', resolveId(id) { if (id === 'virtual:offline-search') return '\0offline-search'; }, load(id) { if (id === '\0offline-search') return entry; } }],
  build: { write: false, minify: false, rolldownOptions: { input: 'virtual:offline-search' } },
});
const scripts = bundled.output.filter((item) => item.type === 'chunk');
assert.equal(scripts.length, 1, 'offline test must be self-contained');
const source = scripts[0].code.replaceAll('</script', '<\\/script');
const browser = await chromium.launch({ executablePath: process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined, headless: true });
const reports = [], errors = [];
const markdownSnippet='**Redis** 缓存：用 `GOPRIVATE` 配合 [Git 文档](https://example.invalid/git)；尾段 ``` > **常见错误**：不要公开 API_KEY。<img src="https://example.invalid/image" onerror="alert(1)">';
const row = (index) => ({ noteId: index ? 'sample-'+index : 'sample-redis', noteTitle: index ? 'Python 的面试常见问题 '+index : 'Redis', sectionId: 'section-'+index, sectionTitle: '缓存基础', sourceType: 'chunk_content', snippet: index?'如何用 Redis 缓存热点数据？需要考虑过期策略与数据一致性。':markdownSnippet, retrievalChannels: ['content'] });
try {
  for (const {width,mobile} of [{width:1280,mobile:false},{width:736,mobile:true},{width:320,mobile:true}]) {
    const context = await browser.newContext({ viewport: {width,height:mobile?640:720}, isMobile:mobile, hasTouch:mobile, deviceScaleFactor:1 });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><button id="trigger">搜索入口</button><script type="module">${source}</script></body></html>`);
    await page.waitForFunction(() => Boolean(window.searchTest));
    await page.locator('#trigger').click(); await page.locator('.nf-search-input').waitFor();
    await page.waitForTimeout(250);
    const geometry = () => page.evaluate(() => {
      const panel=document.querySelector('.nf-search-dialog'), viewport=document.querySelector('.nf-search-viewport'), input=document.querySelector('.nf-search-input');
      const p=panel.getBoundingClientRect(), v=viewport.getBoundingClientRect(), s=getComputedStyle(panel);
      const buttons=[...panel.querySelectorAll('button')];
      return { x:p.x,y:p.y,width:p.width,height:p.height,right:p.right,bottom:p.bottom,viewHeight:innerHeight,docWidth:document.documentElement.scrollWidth,bodyHeight:v.height,bodyScroll:viewport.scrollHeight,bodyClient:viewport.clientHeight,font:getComputedStyle(input).fontSize,border:s.borderWidth,radius:s.borderRadius,minButton:Math.min(...buttons.map(b=>b.getBoundingClientRect().height)),background:s.backgroundColor,clipped:buttons.some(b=>{const r=b.getBoundingClientRect();return r.width && (r.left<p.left || r.right>p.right)}) };
    });
    const initial=await geometry(); assert.equal(initial.width, Math.min(580,width-(width<=480?24:32))); assert.ok(initial.height<(mobile?210:170));
    assert.equal(initial.bodyClient,0,'The initial state has no redundant description area or scrollbar');
    assert.equal(initial.border,'0px'); assert.equal(initial.radius,'18px'); assert.equal(initial.font,mobile?'16px':'15px');
    assert.equal(initial.docWidth,width); assert.equal(initial.clipped,false); if(mobile) assert.ok(initial.minButton>=44);
    assert.equal(await page.evaluate(()=>document.getElementById('root').inert), true);
    const focus=await page.locator('.nf-search-input').evaluate(node=>({outline:getComputedStyle(node).outlineStyle,shadow:getComputedStyle(node).boxShadow}));
    assert.equal(focus.outline,'none'); assert.equal(focus.shadow,'none','The focused input has no underline or nested frame');
    assert.equal(await page.locator('.nf-search-field').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('#library-search-hint').count(),1);
    if(process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR){
      await page.screenshot({path:process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR+'/search-'+width+'-initial.png'});
      await page.locator('.nf-search-dialog').screenshot({path:process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR+'/search-panel-'+width+'-initial.png'});
    }
    await page.locator('.nf-search-input').fill('Redis');
    await page.waitForFunction(()=>window.searchTest.pending.length===1);
    assert.equal(await page.locator('[role="status"]').count(),1); assert.equal(await page.locator('.nf-search-summary').textContent(),'');
    await page.evaluate((rows)=>window.searchTest.resolve(rows), [row(0),{...row(0),sectionId:'second-hit'},row(1)]);
    await page.waitForFunction(()=>document.querySelectorAll('[role="option"]').length===2); await page.waitForTimeout(250);
    const results=await geometry(); assert.equal(results.y,initial.y); assert.ok(results.height>initial.height); assert.ok(results.bottom<=results.viewHeight-15); assert.equal(results.clipped,false);
    assert.equal(await page.locator('.nf-search-summary').textContent(),'2 篇笔记 · 3 处命中');
    assert.equal(await page.locator('[role="status"]').count(),0);
    const snippet=page.locator('.nf-search-snippet').first();
    assert.equal(await snippet.textContent(),'Redis 缓存：用 GOPRIVATE 配合 Git 文档；尾段 常见错误：不要公开 API_KEY。');
    assert.equal(await snippet.locator('mark').first().textContent(),'Redis','Highlight is applied after Markdown is converted to text');
    assert.equal(await snippet.locator('a,img,script,pre,code,strong').count(),0,'Search previews never insert rich HTML or nested interactive links');
    if(process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR){
      await page.screenshot({path:process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR+'/search-'+width+'-results.png'});
      await page.locator('.nf-search-dialog').screenshot({path:process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR+'/search-panel-'+width+'-results.png'});
    }
    await page.locator('.nf-search-input').press('ArrowDown'); assert.equal(await page.locator('.nf-search-input').getAttribute('aria-activedescendant'),'library-search-result-1');
    await page.locator('.nf-search-input').press('ArrowUp');
    await page.locator('.nf-search-input').press('Enter'); await page.waitForFunction(()=>!document.querySelector('.nf-library-search'));
    assert.equal(await page.evaluate(()=>window.searchTest.selected.noteId),'sample-redis');
    assert.equal(await page.evaluate(()=>window.searchTest.selected.sectionId),'section-0');
    assert.equal(await page.evaluate(()=>window.searchTest.selected.snippet),markdownSnippet,'Selecting a readable preview still returns the unchanged original source');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'trigger');
    await page.locator('#trigger').click(); await page.locator('.nf-search-input').fill('更多结果');
    await page.waitForFunction(()=>window.searchTest.pending.length===2);
    await page.evaluate((rows)=>window.searchTest.resolve(rows), Array.from({length:20},(_,i)=>row(i))); await page.waitForTimeout(280);
    const long=await geometry(); assert.ok(long.bottom<=long.viewHeight-15); assert.ok(long.bodyScroll>long.bodyClient); assert.equal(long.clipped,false);
    await page.locator('.nf-search-input').press('End');
    for(let i=0;i<19;i++) await page.locator('.nf-search-input').press('ArrowDown');
    assert.equal(await page.locator('.nf-search-input').getAttribute('aria-activedescendant'),'library-search-result-19');
    const lastVisible=await page.locator('#library-search-result-19').evaluate((node)=>{const r=node.getBoundingClientRect(),p=document.querySelector('.nf-search-viewport').getBoundingClientRect();return r.bottom<=p.bottom+1 && r.top>=p.top-1});
    assert.equal(lastVisible,true);
    await page.locator('.nf-search-clear').click(); await page.waitForTimeout(250);
    const cleared=await geometry();assert.equal(cleared.bodyClient,0,'Clearing a long result list must collapse its now-empty viewport');
    assert.ok(Math.abs(cleared.height-initial.height)<=1,'Clearing returns to the compact initial panel');
    assert.equal(await page.locator('.nf-search-input').evaluate(node=>document.activeElement===node),true);
    await page.locator('.nf-search-input').fill('无结果');
    await page.waitForFunction(()=>window.searchTest.pending.length===3); await page.evaluate(()=>window.searchTest.resolve([])); await page.waitForTimeout(250);
    assert.match(await page.locator('[role="status"]').textContent(),/没有找到“无结果”/);
    await page.locator('.nf-search-scope').filter({hasText:'标题'}).click(); await page.waitForFunction(()=>window.searchTest.pending.length===4);
    assert.equal(await page.evaluate(()=>window.searchTest.pending.at(-1).options.scope),'title'); await page.evaluate(()=>window.searchTest.reject());
    await page.locator('[role="alert"]').waitFor(); await page.locator('.nf-search-retry').click(); await page.waitForFunction(()=>window.searchTest.pending.length===5);
    await page.evaluate(()=>window.searchTest.resolve([]));
    await page.waitForFunction(()=>Boolean(document.querySelector('.nf-search-empty')));
    await page.waitForTimeout(250);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark')); assert.equal((await geometry()).background,'rgb(37, 43, 51)');
    assert.equal(await page.locator('.nf-search-viewport').evaluate(node=>node.clientHeight+1>=node.firstElementChild.getBoundingClientRect().height),true,'settled empty state must not clip its text');
    if(process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR) await page.screenshot({path:process.env.NOTEFLOW_SEARCH_SCREENSHOT_DIR+'/search-'+width+'-dark.png'});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.nf-search-viewport').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
    await page.setViewportSize({width,height:320}); await page.waitForTimeout(50);
    const short=await geometry(); assert.ok(short.bottom<=304.1); assert.equal(short.clipped,false);
    await page.emulateMedia({forcedColors:'active'});await page.locator('.nf-search-input').focus();
    assert.equal(await page.locator('.nf-search-input').evaluate(node=>getComputedStyle(node).outlineStyle),'solid','Forced colors retains a system focus outline');
    await page.locator('.nf-search-close').click(); await page.waitForFunction(()=>!document.querySelector('.nf-library-search'));
    reports.push({width,mobile,initial,results,longListScrollable:true,lastResultVisible:true,clearCollapses:true,shortViewport:true,dark:true,reducedMotion:true,forcedColors:true});
    await context.close();
  }
  assert.deepEqual(errors,[]); console.log(JSON.stringify({ok:true,offlineProductionComponent:true,networkBlocked:true,reports,errors}));
} finally { await browser.close(); }
