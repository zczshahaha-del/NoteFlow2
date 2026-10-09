// Real production conversation component/CSS, fresh contexts, synthetic state.
// Every network request is blocked; no localhost, profile, model or account access.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const component = repo + '/src/components/AIPanel.tsx';
const markdown = repo + '/src/utils/chatMarkdown.ts';
const cssName = readdirSync(repo + '/dist/assets').find(name => /^index-.*\.css$/.test(name));
assert.ok(cssName, 'run npm run build first');
const css = readFileSync(repo + '/dist/assets/' + cssName, 'utf8');
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Panel from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));const noop=()=>{};
const chat={chatMessages:[],chatLoading:false,chatSessions:[],chatSessionsLoading:false,newChatSession:noop,switchChatSession:noop,renameChatSession:noop,deleteChatSession:noop,sendMessage:noop,stopGeneration:noop,chatSelection:null,clearChatSelection:noop};
const editor={activeEditPreview:null,createEditPreviewRequest:noop,applyEditPreviewRequest:noop,cancelEditPreviewRequest:noop,focusChatSource(source){api.sources.push(source)}};
const draft={centerMode:'note',activeDraftContext:null,pendingCheckpoint:null,setActiveDraftContext:noop,closeDraft:noop,openPendingEditPreview:noop,openPendingDraft:noop,requestDraftCommand:noop};
const agent={agentSessionId:null,agentTask:null,agentRunHistory:[],agentTaskDetailOpen:false};
const workspace={selectedFileId:null,treeData:[],reloadWorkspace:noop};
let key=0;const api={chat,editor,draft,agent,workspace,metrics:[],samples:[],sources:[],stops:0,copies:[],copyMode:'success',currentText:'',render(){root.render(React.createElement(React.StrictMode,null,React.createElement(Panel)))},
begin(history=0){this.metrics=[];this.samples=[];this.currentText='';chat.chatLoading=true;chat.chatMessages=[];for(let i=0;i<history;i++)chat.chatMessages.push({id:'h-'+i,role:'assistant',text:'## 合成历史 '+i+'\\n\\n历史内容 **完整保留**。'});chat.chatMessages.push({id:'live-'+(++key),role:'assistant',text:'',streamState:'streaming'});this.render()},
chunk(delta,complete=false){chat.chatMessages=chat.chatMessages.map((m,i)=>i===chat.chatMessages.length-1?{...m,text:m.text+delta,streamState:complete?'completed':'streaming'}:m);chat.chatLoading=!complete;this.render()},
replace(text,status='streaming',sources){chat.chatMessages=chat.chatMessages.map((m,i)=>i===chat.chatMessages.length-1?{...m,text,streamState:status,sources}:m);chat.chatLoading=status==='streaming';this.render()},
history(text){chat.chatLoading=false;chat.chatMessages=[{id:'loaded-'+(++key),role:'assistant',text}];this.render()},
clear(){chat.chatLoading=false;chat.chatMessages=[];this.render()}};
chat.stopGeneration=()=>{api.stops++;chat.chatLoading=false;chat.chatMessages=chat.chatMessages.map(m=>m.streamState==='streaming'?{...m,streamState:'stopped'}:m);api.render()};
// In-memory clipboard substitute: no system clipboard access in browser tests.
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text){api.copies.push(text);if(api.copyMode==='denied')throw new Error('synthetic denial');if(api.copyMode==='pending')await new Promise(resolve=>{api.finishCopy=resolve})}}});
document.execCommand=command=>{if(command!=='copy'||api.copyMode!=='fallback')return false;api.copies.push(document.querySelector('[data-message-copy-fallback]').value);return true};
window.presentationTest=api;api.render();`;
const result=await build({root:repo,configFile:false,logLevel:'silent',plugins:[{
  name:'isolated-chat-presentation',enforce:'pre',
  resolveId(id,importer){if(id==='virtual:chat-presentation')return '\0chat-presentation';if(importer===component&&id==='../store/selectors')return '\0chat-selectors'},
  load(id){if(id==='\0chat-presentation')return entry;if(id==='\0chat-selectors')return 'export const useChatSlice=()=>window.presentationTest.chat;export const useEditorSlice=()=>window.presentationTest.editor;export const useDraftSlice=()=>window.presentationTest.draft;export const useAgentSlice=()=>window.presentationTest.agent;export const useWorkspaceSlice=()=>window.presentationTest.workspace;'},
  transform(source,id){if(id===markdown)return source.replace('export function renderChatMarkdown(', 'function originalRenderChatMarkdown(')+'\nexport function renderChatMarkdown(text,count=0,options){const html=originalRenderChatMarkdown(text,count,options);const api=window.presentationTest;api.metrics.push({history:text.startsWith("## 合成历史"),length:text.length});if(!text.startsWith("## 合成历史")){api.currentText=text;api.samples.push({time:performance.now(),length:text.length})}return html;}';}
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:chat-presentation'}}});
const chunks=result.output.filter(item=>item.type==='chunk');assert.equal(chunks.length,1);
const source=chunks[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const errors=[],requests=[],reports=[];
try{
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:320,height:700}:{width:600,height:850},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,timezoneId:'Asia/Shanghai'});
    await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
    const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'#root{width:100%;max-width:500px;height:95vh;display:flex}#root>aside{flex:1;min-width:0}</style></head><body><div id="root"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>Boolean(window.presentationTest));

    // The real history search signals focus without an inner frame or baseline.
    await page.evaluate(()=>{const a=window.presentationTest;a.agent.agentSessionId='history-current';a.chat.chatSessions=[
      {id:'history-current',title:'当前对话',updatedAt:'2026-10-10T02:49:00+08:00'},
      {id:'history-other',title:'资料整理',updatedAt:'2026-10-10T02:50:00+08:00'},
    ];a.render()});
    const historyTrigger=page.locator('button[aria-haspopup="menu"]');
    const historyMenu=page.locator('.nf-history-menu');
    await historyTrigger.click();
    const historySearch=historyMenu.getByPlaceholder('搜索历史对话');
    await historySearch.waitFor();
    await historyMenu.evaluate(async n=>Promise.all(n.getAnimations().map(a=>a.finished)));
    const settleHistorySearch=()=>historySearch.evaluate(async n=>Promise.all(n.parentElement.getAnimations({subtree:true}).map(a=>a.finished)));
    await settleHistorySearch();
    const historySearchStyle=await historySearch.evaluate(n=>{const s=getComputedStyle(n),field=getComputedStyle(n.parentElement);return {focused:document.activeElement===n,focusVisible:n.matches(':focus-visible'),outline:s.outlineStyle,shadow:s.boxShadow,background:field.backgroundColor,fieldOutline:field.outlineStyle,fieldShadow:field.boxShadow,icon:getComputedStyle(n.parentElement.querySelector('svg')).color,radius:field.borderRadius,height:n.getBoundingClientRect().height}});
    console.log(JSON.stringify({mobile,historySearchStyle}));
    assert.equal(historySearchStyle.focused,true);
    assert.equal(historySearchStyle.outline,'none','normal search focus has no inner rectangle');
    assert.equal(historySearchStyle.shadow,'none','normal search focus has no baseline');
    assert.equal(historySearchStyle.fieldOutline,'none');
    assert.equal(historySearchStyle.fieldShadow,'none','no replacement outer ring');
    assert.equal(historySearchStyle.radius,'9px');
    assert.equal(historySearchStyle.background,'rgb(227, 232, 238)','the whole existing field softly changes fill on focus');
    assert.equal(historySearchStyle.icon,'rgb(48, 53, 60)','the search icon makes keyboard focus recognizable without adding lines');
    const rootFontSize=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
    assert.equal(historySearchStyle.height,mobile?44:2.25*rootFontSize,'preserve existing h-9 sizing and coarse-pointer minimum');
    assert.equal(await historySearch.getAttribute('aria-label'),'搜索历史对话');
    const historySearchBox=await historySearch.boundingBox();
    assert.equal(await historyMenu.locator('.nf-history-row').count(),2);
    await historySearch.fill('资料');assert.equal(await historyMenu.locator('.nf-history-row').count(),1);
    assert.equal(await historyMenu.locator('.nf-history-name').textContent(),'资料整理');
    await historySearch.fill('不存在');await historyMenu.getByText('没有找到对话',{exact:true}).waitFor();
    assert.deepEqual(await historySearch.boundingBox(),historySearchBox,'filtering does not move the search input');
    await historySearch.fill('');
    await page.keyboard.press('Tab');
    await settleHistorySearch();
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n).boxShadow),'none');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor),'rgb(236, 239, 242)','blur restores the original fill');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement.querySelector('svg')).color),'rgb(126, 135, 145)');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'solid','other menu controls keep keyboard focus');
    await page.keyboard.press('Shift+Tab');assert.equal(await historySearch.evaluate(n=>document.activeElement===n),true);
    await settleHistorySearch();
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor),'rgb(227, 232, 238)');
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    await settleHistorySearch();
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n).boxShadow),'none');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor),'rgb(65, 75, 88)');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement.querySelector('svg')).color),'rgb(233, 237, 242)');
    await page.keyboard.press('Tab');await settleHistorySearch();
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor),'rgb(54, 63, 74)');
    await page.keyboard.press('Shift+Tab');await settleHistorySearch();
    await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    await settleHistorySearch();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await historyMenu.evaluate(n=>getComputedStyle(n).animationName),'none');
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n.parentElement).transitionDuration),'0s');
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await historySearch.evaluate(n=>getComputedStyle(n).outlineStyle),'solid','forced colors retain system focus without relying on shadows');
    await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});
    await historyMenu.evaluate(async n=>Promise.all(n.getAnimations().map(a=>a.finished)));
    assert.deepEqual(await historySearch.boundingBox(),historySearchBox);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),mobile?320:600);
    if(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR){
      mkdirSync(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR,{recursive:true});
      await historyMenu.screenshot({path:process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR+'/history-search-'+(mobile?'mobile':'desktop')+'.png'});
    }
    // Read-only diagnostic of a separate existing issue, not a passing IME guard.
    await historySearch.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const historyImeEscapeCloses=await historyTrigger.getAttribute('aria-expanded')==='false';
    if(historyImeEscapeCloses){
      await historyMenu.waitFor({state:'detached'});await historyTrigger.click();await historySearch.waitFor();
      await historyMenu.evaluate(async n=>Promise.all(n.getAnimations().map(a=>a.finished)));
    }
    await page.keyboard.press('Escape');
    assert.equal(await historyTrigger.getAttribute('aria-expanded'),'false');
    assert.equal(await historyTrigger.evaluate(n=>document.activeElement===n),true);
    await historyMenu.waitFor({state:'detached'});
    await page.evaluate(()=>{const a=window.presentationTest;a.agent.agentSessionId=null;a.chat.chatSessions=[];a.render()});
    const full='这是模拟整段数据到达时的连续输出。'.repeat(18)+'👩🏽‍💻🇨🇳e\u0301👨‍👩‍👧‍👦结束。';
    await page.evaluate(()=>window.presentationTest.begin(10));
    await page.getByText('正在思考',{exact:true}).waitFor();
    assert.equal(await page.locator('.nf-chat-message-actions button').last().isDisabled(),true);
    assert.equal(await page.locator('.nf-chat-message-actions').last().getAttribute('aria-hidden'),'true');
    await page.waitForTimeout(100);
    await page.evaluate(()=>{window.presentationTest.metrics=[];window.presentationTest.samples=[]});
    await page.evaluate(text=>window.presentationTest.chunk(text,true),full);
    await page.waitForFunction(()=>window.presentationTest.currentText.length>0);
    const first=await page.evaluate(()=>window.presentationTest.currentText.length);
    assert.ok(first<full.length, 'complete answer in one React batch must not jump straight to full');
    assert.equal(await page.getByText('正在思考',{exact:true}).count(),0);
    await page.getByRole('button',{name:'停止生成',exact:true}).waitFor();
    const input=page.getByRole('textbox',{name:'消息输入框'});
    await input.fill('保留草稿');await input.focus();
    await page.waitForTimeout(100);
    assert.equal(await input.inputValue(),'保留草稿');assert.equal(await input.evaluate(n=>document.activeElement===n),true);
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full,{timeout:1600});
    await page.getByRole('button',{name:'发送',exact:true}).waitFor();
    const stats=await page.evaluate(text=>{const a=window.presentationTest;const boundaries=new Set([0,...Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),s=>s.index+s.segment.length)]);return {first:a.samples[0].length,updates:a.samples.length,historyParses:a.metrics.filter(m=>m.history).length,monotonic:a.samples.every((s,i)=>!i||s.length>=a.samples[i-1].length),unicodeSafe:a.samples.every(s=>boundaries.has(s.length)),tailMs:a.samples.at(-1).time-a.samples[0].time}},full);
    assert.ok(stats.updates>8);assert.equal(stats.historyParses,0);assert.equal(stats.monotonic,true);assert.equal(stats.unicodeSafe,true);assert.ok(stats.tailMs<1200);
    const calls=await page.evaluate(()=>window.presentationTest.samples.length);await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>window.presentationTest.samples.length),calls,'completed queue has no residual animation');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),mobile?320:600);

    // Stop while the transport is active: reveal all received content and cancel once.
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text),full);
    await page.getByRole('button',{name:'停止生成',exact:true}).click();
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full);
    assert.equal(await page.evaluate(()=>window.presentationTest.stops),1);
    await page.getByRole('button',{name:'发送',exact:true}).waitFor();
    // Stop a local completion tail: do not cancel an already-finished backend run.
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text,true),full);
    await page.getByRole('button',{name:'停止生成',exact:true}).click();
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full);
    assert.equal(await page.evaluate(()=>window.presentationTest.stops),1);

    // Old frame callbacks cannot write into the newly selected conversation.
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text),full);
    await page.evaluate(()=>window.presentationTest.history('新会话的既有回答，不重复打字。'));
    await page.getByText('新会话的既有回答，不重复打字。',{exact:true}).waitFor();
    await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>window.presentationTest.currentText),'新会话的既有回答，不重复打字。');

    // Canonical replacement, failure, and final Markdown actions remain immediate/correct.
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text),full);
    const canonical='引用校验后的 **正确正文**【1】\n\n```python\nprint("ok")\n```';
    const citation={noteId:'synthetic-note',noteTitle:'合成来源',sectionId:null,sectionTitle:null,sourceType:'note',snippet:'合成片段',score:1};
    await page.evaluate(({text,citation})=>window.presentationTest.replace(text,'completed',[citation]),{text:canonical,citation});
    await page.getByText('正确正文',{exact:true}).waitFor();
    await page.locator('[data-chat-citation="1"]').click();assert.equal(await page.evaluate(()=>window.presentationTest.sources.at(-1).noteId),'synthetic-note');
    await page.locator('[data-language-toggle]').click();await page.locator('[data-language-option="javascript"]').click();
    assert.equal(await page.locator('.chat-code-block').getAttribute('data-language'),'javascript');
    await page.evaluate(()=>window.presentationTest.replace('合成失败，请重试','failed'));
    await page.getByText('合成失败，请重试',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).count(),0);

    // Reduced motion and background updates flush without replay or queued tails.
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text,true),full);
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full);
    assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>window.presentationTest.begin());await page.getByText('正在思考',{exact:true}).waitFor();
    await page.evaluate(text=>window.presentationTest.chunk(text),full);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full);
    await page.evaluate(()=>window.presentationTest.chunk('后台新增文字',true));
    await page.waitForFunction(text=>window.presentationTest.currentText===text,full+'后台新增文字');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).count(),0);

    // Reading history must not be forced back down by incoming display frames.
    await page.evaluate(()=>window.presentationTest.begin(30));await page.getByText('正在思考',{exact:true}).waitFor();
    // Copy footers lengthen history; wait for real arrival, not a fixed animation guess.
    await page.waitForFunction(()=>{const n=document.querySelector('.ai-message-list');return n.scrollHeight-n.scrollTop-n.clientHeight<2},null,{timeout:2500});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('.ai-message-list').evaluate(n=>{n.scrollTo({top:0,behavior:'instant'});n.dispatchEvent(new Event('scroll'))});
    await page.evaluate(text=>window.presentationTest.chunk(text,true),full);
    await page.waitForTimeout(150);
    assert.ok(await page.locator('.ai-message-list').evaluate(n=>n.scrollTop<=1),'reading at the top stays put within a native pixel rounding margin');
    await page.getByRole('button',{name:'回到底部',exact:true}).waitFor();
    const jump=page.getByRole('button',{name:'回到底部',exact:true});
    await page.waitForTimeout(180);
    const jumpGeometry=await jump.evaluate(n=>{const r=n.getBoundingClientRect(),thread=n.closest('.nf-chat-thread').getBoundingClientRect(),composer=document.querySelector('.nf-chat-composer').getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(n).borderRadius,center:r.x+r.width/2,threadCenter:thread.x+thread.width/2,bottom:r.bottom,composerTop:composer.top,text:n.textContent,title:n.getAttribute('title')}});
    assert.equal(jumpGeometry.width,mobile?44:34);assert.equal(jumpGeometry.height,jumpGeometry.width);
    assert.equal(jumpGeometry.radius,'50%');assert.equal(jumpGeometry.text,'');assert.equal(jumpGeometry.title,null);
    assert.ok(Math.abs(jumpGeometry.center-jumpGeometry.threadCenter)<1);assert.ok(jumpGeometry.bottom<jumpGeometry.composerTop);
    if(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR){
      mkdirSync(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR,{recursive:true});
      await page.locator('#root').screenshot({path:process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR+'/chat-jump-'+(mobile?'mobile':'desktop')+'.png'});
    }
    const stableComposer=await input.boundingBox();
    await page.evaluate(()=>{const a=window.presentationTest;a.jumpStates=[];const node=document.querySelector('.nf-chat-jump');a.jumpObserver=new MutationObserver(()=>a.jumpStates.push(node.dataset.visible));a.jumpObserver.observe(node,{attributes:true,attributeFilter:['data-visible']})});
    await jump.click();
    await page.waitForFunction(()=>{const n=document.querySelector('.ai-message-list');return n.scrollHeight-n.scrollTop-n.clientHeight<2},null,{timeout:3000});
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.nf-chat-jump').getAttribute('data-visible'),'false');
    assert.equal(await page.locator('.nf-chat-jump-button').isDisabled(),true);
    assert.equal(await page.locator('.ai-message-list').evaluate(n=>document.activeElement===n),true,'jump focus stays on history, not hidden button or mobile composer');
    assert.deepEqual(await input.boundingBox(),stableComposer,'overlay never changes composer geometry');
    const jumpStates=await page.evaluate(()=>{window.presentationTest.jumpObserver.disconnect();return window.presentationTest.jumpStates});
    assert.ok(jumpStates.length>0);assert.ok(jumpStates.every(s=>s==='false'),'smooth arrival must not hide then re-show the arrow');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('.ai-message-list').evaluate(n=>{n.scrollTo({top:0,behavior:'instant'});n.dispatchEvent(new Event('scroll'))});
    await jump.waitFor();
    const reducedJump=await page.locator('.nf-chat-jump').evaluate(n=>getComputedStyle(n).transitionDuration);
    assert.ok(reducedJump.split(',').every(duration=>parseFloat(duration)<=0.0001),'reduced motion permits only the global near-zero transition override');
    await jump.click();
    await page.waitForFunction(()=>document.querySelector('.nf-chat-jump').dataset.visible==='false');
    await page.waitForFunction(()=>{const n=document.querySelector('.ai-message-list');return n.scrollHeight-n.scrollTop-n.clientHeight<2});
    // Native scroll events settle after an immediate reduced-motion jump.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('.ai-message-list').evaluate(n=>{n.scrollTo({top:0,behavior:'instant'});n.dispatchEvent(new Event('scroll'))});
    await jump.waitFor();await jump.click();
    await page.locator('.ai-message-list').hover();await page.mouse.wheel(0,-500);
    await page.evaluate(()=>window.presentationTest.chunk('取消回到底部后保留阅读位置',true));
    await page.waitForTimeout(180);
    assert.ok(await page.locator('.ai-message-list').evaluate(n=>n.scrollTop<n.scrollHeight-n.clientHeight-96),'manual wheel cancels a live jump and incoming text must not force the user back down');

    // An older wide answer must not add a horizontal bar above the composer.
    const columns=Array.from({length:24},(_,i)=>'字段'+i);
    const wideTable='| '+columns.join(' | ')+' |\n| '+columns.map(()=>'---').join(' | ')+' |\n| '+columns.map((_,i)=>'值'+i).join(' | ')+' |';
    const longCode='const result = "'+ 'code-keeps-its-own-horizontal-scroll-'.repeat(12)+'";';
    const rich='完整表格与代码应在各自区域滚动。\n\n'+wideTable+'\n\n```javascript\n'+longCode+'\n```\n\n'+('https://fixture.invalid/long-path-'.repeat(16))+'\n\n<img alt="合成宽图" width="1200" height="100" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22100%22%3E%3C/svg%3E">';
    await page.evaluate(({rich})=>{const a=window.presentationTest;a.chat.chatLoading=false;a.chat.chatMessages=[{id:'wide-history',role:'assistant',text:rich},...Array.from({length:16},(_,i)=>({id:'scroll-'+i,role:'assistant',text:'合成历史内容，保留正常纵向滚动。'})),{id:'plain-last',role:'assistant',text:'我还是老样子，待命中 😁\n\n没有具体任务的时候，我就是闲着等你开口。你要是有事就直接说，没事也可以随便聊两句。'}];a.render()},{rich});
    await page.getByText('完整表格与代码应在各自区域滚动。',{exact:true}).waitFor();
    const scrollSurface=await page.locator('.ai-message-list').evaluate(n=>{
      const style=getComputedStyle(n),bar=getComputedStyle(n,'::-webkit-scrollbar');
      const edge=n.getBoundingClientRect().left+n.clientWidth;
      const contentFits=[...n.querySelectorAll('.nf-chat-message,.chat-markdown,.chat-table-scroll,.rendered-code-block,img')].every(x=>x.getBoundingClientRect().right<=edge+1);
      return {clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,overflowX:style.overflowX,barWidth:bar.width,barHeight:bar.height,contentFits};
    });
    console.log(JSON.stringify({mobile,scrollSurface}));
    // Allow only a scrollbar-sized counting residual; check actual content bounds separately.
    assert.ok(scrollSurface.scrollWidth<=scrollSurface.clientWidth+parseFloat(scrollSurface.barWidth)+1,'wide history must not overflow beyond the native scrollbar gutter');
    assert.equal(scrollSurface.contentFits,true,'message, image, code and table viewports must fit without clipping');
    assert.equal(scrollSurface.overflowX,'hidden','the conversation itself must not expose a horizontal scrollbar');
    assert.ok(scrollSurface.scrollHeight>scrollSurface.clientHeight,'vertical history scrolling must remain available');
    assert.equal(scrollSurface.barWidth,'5px');assert.equal(scrollSurface.barHeight,'5px');
    const table=page.locator('.chat-table-scroll');
    await table.focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('.chat-table-scroll')?.scrollLeft>0);
    assert.equal(await table.getAttribute('aria-label'),'表格');
    assert.equal(await table.locator('th').count(),24);assert.equal(await table.locator('td').count(),24);
    const code=page.locator('.rendered-code-block pre');
    const codeScroll=await code.evaluate(n=>{n.scrollLeft=n.scrollWidth;return {left:n.scrollLeft,width:n.clientWidth,total:n.scrollWidth,text:n.textContent}});
    assert.ok(codeScroll.total>codeScroll.width);assert.ok(codeScroll.left>0);assert.equal(codeScroll.text.trim(),longCode);
    assert.equal(await page.locator('.ai-message-list').evaluate(n=>n.scrollLeft),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),mobile?320:600);
    // Default, hover, dark and forced-colors scrollbar states stay scoped.
    const defaultThumb=await page.locator('.ai-message-list').evaluate(n=>getComputedStyle(n,'::-webkit-scrollbar-thumb').backgroundColor);
    await page.locator('.ai-message-list').hover();
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    const darkThumb=await page.locator('.ai-message-list').evaluate(n=>getComputedStyle(n,'::-webkit-scrollbar-thumb').backgroundColor);
    assert.notEqual(darkThumb,defaultThumb);
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await page.locator('.ai-message-list').evaluate(n=>getComputedStyle(n).scrollbarColor),'auto');
    assert.notEqual(await page.locator('.ai-message-list').evaluate(n=>getComputedStyle(n,'::-webkit-scrollbar-thumb').backgroundColor),'rgba(0, 0, 0, 0)');
    await page.emulateMedia({forcedColors:'none'});await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    if(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR){
      mkdirSync(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR,{recursive:true});
      await page.locator('.ai-message-list').evaluate(n=>n.scrollTo({top:n.scrollHeight,behavior:'instant'}));
      await page.waitForTimeout(80);
      await page.locator('#root').screenshot({path:process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR+'/chat-scroll-'+(mobile?'mobile':'desktop')+'.png'});
    }

    // Both message roles: exact raw text, stable icon feedback, retry and lifecycle.
    const userText='请解释这段代码\n保留换行 👩🏽‍💻';
    const replyText='这是 **完整回复**。\n\n```python\nprint("合成测试")\n```';
    await page.evaluate(({userText,replyText})=>{const a=window.presentationTest;a.chat.chatMessages=[{id:'copy-user',role:'user',text:userText,createdAt:'2026-10-10T02:49:00+08:00'},{id:'copy-reply',role:'assistant',text:replyText,createdAt:'2026-10-10T02:50:00+08:00'}];a.chat.chatLoading=false;a.render()},{userText,replyText});
    const userCopy=page.getByRole('button',{name:'复制消息',exact:true}),replyCopy=page.getByRole('button',{name:'复制回复',exact:true});
    await userCopy.waitFor();await replyCopy.waitFor();
    await input.fill('复制时保留草稿');
    const copyInputBox=await input.boundingBox(),copyBox=await userCopy.boundingBox();
    assert.equal(copyBox.width,mobile?44:26);assert.equal(copyBox.height,copyBox.width);
    assert.equal(await userCopy.locator('svg').getAttribute('width'),'14');
    assert.equal(await replyCopy.locator('svg').getAttribute('width'),'14');
    assert.equal((await userCopy.locator('svg').boundingBox()).width,14);
    assert.equal((await replyCopy.locator('svg').boundingBox()).height,14);
    await input.focus();await page.mouse.move(599,1);await page.waitForTimeout(150);
    assert.equal(await userCopy.evaluate(n=>getComputedStyle(n).opacity),mobile?'1':'0');
    assert.equal(await page.locator('[data-role="user"] time').evaluate(n=>getComputedStyle(n).opacity),mobile?'1':'0');
    if(!mobile){
      const messageRow=page.locator('.nf-chat-message-row').filter({has:page.locator('.nf-chat-message--user')});
      await messageRow.hover();await page.waitForTimeout(150);
      assert.equal(await userCopy.evaluate(n=>getComputedStyle(n).opacity),'1');
      assert.equal(await page.locator('[data-role="user"] time').evaluate(n=>getComputedStyle(n).opacity),'1');
      assert.deepEqual(await userCopy.boundingBox(),copyBox,'hover cannot move the copy target');
      await page.mouse.move(599,1);await page.waitForTimeout(150);
      assert.equal(await userCopy.evaluate(n=>getComputedStyle(n).opacity),'0');
      assert.equal(await page.locator('[data-role="user"] time').evaluate(n=>getComputedStyle(n).opacity),'0');
    }
    const alignments=await page.evaluate(()=>{const user=document.querySelector('.nf-chat-message--user').getBoundingClientRect(),userCopy=document.querySelector('[aria-label="复制消息"]').getBoundingClientRect(),userTime=document.querySelector('[data-role="user"] time').getBoundingClientRect(),reply=document.querySelector('.nf-chat-message--assistant').getBoundingClientRect(),replyCopy=document.querySelector('[aria-label="复制回复"]').getBoundingClientRect(),replyTime=document.querySelector('[data-role="assistant"] time').getBoundingClientRect();return {userRight:user.right,userCopyRight:userCopy.right,userGap:userCopy.left-userTime.right,replyLeft:reply.left,replyCopyLeft:replyCopy.left,replyGap:replyTime.left-replyCopy.right}});
    assert.ok(Math.abs(alignments.userRight-alignments.userCopyRight)<1);
    assert.ok(Math.abs(alignments.replyLeft-alignments.replyCopyLeft)<1,'reply action starts with copy, aligned to the reply content');
    assert.equal(alignments.replyGap,6,'reply time is immediately after copy');assert.equal(alignments.userGap,6,'user time stays before copy');
    assert.deepEqual(await page.locator('.nf-chat-message-actions time').allTextContents(),['2:49','2:50']);
    assert.equal(await userCopy.getAttribute('title'),null);assert.equal(await replyCopy.getAttribute('title'),null);

    // The reference's small dark hint: only the copy trigger, no native title.
    const tooltip=page.locator('.nf-chat-copy-tooltip[role="tooltip"]');
    if(!mobile){
      await page.mouse.move(599,1);await input.focus();await page.waitForTimeout(300);
      assert.equal(await tooltip.count(),0);
      // Measure inside the browser: Playwright hover auto-waits are not timer evidence.
      await userCopy.evaluate(n=>{
        window.copyHintTiming={};
        n.addEventListener('mouseenter',()=>{window.copyHintTiming.entered=performance.now()},{once:true});
        const observer=new MutationObserver(()=>{
          if(document.querySelector('.nf-chat-copy-tooltip')&&window.copyHintTiming.entered!==undefined){
            window.copyHintTiming.delay=performance.now()-window.copyHintTiming.entered;observer.disconnect();
          }
        });observer.observe(document.body,{childList:true});
      });
      await page.locator('.nf-chat-message-row').filter({has:userCopy}).hover();await userCopy.hover();
      await tooltip.filter({hasText:'复制消息'}).waitFor();
      const measuredHintDelay=await page.evaluate(()=>window.copyHintTiming.delay);
      assert.ok(measuredHintDelay>=280&&measuredHintDelay<1000,`hint respects its 300ms delay (${measuredHintDelay}ms)`);
      await tooltip.evaluate(async n=>Promise.all(n.getAnimations().map(a=>a.finished)));
      const hintStyle=await tooltip.evaluate(n=>{const s=getComputedStyle(n);return {width:s.width,height:s.height,radius:s.borderRadius,font:s.fontSize,background:s.backgroundColor,color:s.color,position:s.position,portal:!n.closest('.nf-ai-conversation')}});
      assert.deepEqual(hintStyle,{width:'72px',height:'30px',radius:'10px',font:'12px',background:'rgb(32, 33, 36)',color:'rgb(255, 255, 255)',position:'fixed',portal:true});
      assert.equal(await userCopy.getAttribute('aria-describedby'),await tooltip.getAttribute('id'));
      const hintBox=await tooltip.boundingBox();
      assert.ok(hintBox.x>=8&&hintBox.x+hintBox.width<=592);
      assert.ok(Math.abs(hintBox.y+hintBox.height+8-copyBox.y)<1,'hint sits just above its trigger');
      assert.deepEqual(await input.boundingBox(),copyInputBox);assert.deepEqual(await userCopy.boundingBox(),copyBox);
      await tooltip.hover();await page.waitForTimeout(180);
      assert.equal(await tooltip.textContent(),'复制消息','moving into the hint keeps it readable');
      assert.equal(await page.locator('[data-role="user"] time').evaluate(n=>getComputedStyle(n).opacity),'1');
      await page.mouse.move(599,1);await page.waitForTimeout(300);
      assert.equal(await tooltip.count(),0);assert.equal(await userCopy.evaluate(n=>getComputedStyle(n).opacity),'0');
      await page.locator('.nf-chat-message-row').filter({has:replyCopy}).hover();await replyCopy.hover();
      await tooltip.filter({hasText:'复制回复'}).waitFor();
      await tooltip.evaluate(async n=>Promise.all(n.getAnimations().map(a=>a.finished)));
      if(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR){
        const box=await tooltip.boundingBox();
        const x=Math.max(0,box.x-14),y=Math.max(0,box.y-12);
        await page.screenshot({path:process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR+'/chat-copy-hint.png',clip:{x,y,width:Math.min(200,600-x),height:90}});
      }
      await page.keyboard.press('Escape');assert.equal(await tooltip.count(),0);
      await page.mouse.move(599,1);await page.waitForTimeout(300);
    }else{
      await userCopy.hover();await page.waitForTimeout(350);
      assert.equal(await tooltip.count(),0,'coarse/touch input does not require a hover hint or an extra tap');
      await page.mouse.move(319,1);
    }
    await page.keyboard.press('Tab');await userCopy.focus();assert.notEqual(await userCopy.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    await page.waitForTimeout(150);assert.equal(await userCopy.evaluate(n=>getComputedStyle(n).opacity),'1');
    assert.equal(await page.locator('[data-role="user"] time').evaluate(n=>getComputedStyle(n).opacity),'1');
    await tooltip.filter({hasText:'复制消息'}).waitFor();
    await page.keyboard.press('Escape');assert.equal(await tooltip.count(),0);
    assert.equal(await userCopy.evaluate(n=>document.activeElement===n),true,'Escape closes the hint without discarding the action focus');
    await page.emulateMedia({reducedMotion:'reduce'});await input.focus();await userCopy.focus();
    await tooltip.waitFor();assert.equal(await tooltip.evaluate(n=>getComputedStyle(n).animationName),'none');
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await tooltip.evaluate(n=>getComputedStyle(n).boxShadow),'none');
    assert.notEqual(await tooltip.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});
    await page.locator('.ai-message-list').evaluate(n=>n.dispatchEvent(new Event('scroll')));
    assert.equal(await tooltip.count(),0,'scroll dismisses portaled hints');
    await input.focus();await userCopy.focus();await tooltip.waitFor();
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));assert.equal(await tooltip.count(),0);
    await input.focus();await userCopy.focus();await tooltip.waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制消息"]').dataset.copyState==='copied');
    assert.equal(await page.evaluate(()=>window.presentationTest.copies.at(-1)),userText);
    assert.equal(await tooltip.textContent(),'已复制','an open hint reflects successful copying');
    assert.equal(await replyCopy.getAttribute('data-copy-state'),'idle');
    await page.locator('.nf-chat-message-row').filter({has:replyCopy}).hover();await replyCopy.click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制回复"]').dataset.copyState==='copied');
    assert.equal(await page.evaluate(()=>window.presentationTest.copies.at(-1)),replyText);
    assert.equal(await input.inputValue(),'复制时保留草稿');assert.deepEqual(await input.boundingBox(),copyInputBox);
    assert.deepEqual(await userCopy.boundingBox(),copyBox,'success check does not move its action target');
    if(!mobile){
      await page.mouse.move(599,1);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="复制回复"]')).opacity==='0',null,{timeout:800});
      assert.equal(await replyCopy.evaluate(n=>getComputedStyle(n).opacity),'0','mouse-out hides even a mouse-focused copy action');
      assert.equal(await page.locator('[data-role="assistant"] time').evaluate(n=>getComputedStyle(n).opacity),'0','time hides together with copy');
      assert.equal(await tooltip.count(),0);
    }
    await page.waitForFunction(()=>[...document.querySelectorAll('.nf-chat-copy')].every(n=>n.dataset.copyState==='idle'),null,{timeout:2000});
    assert.equal(await page.getByText('已复制',{exact:true}).count(),0);
    await page.evaluate(()=>window.presentationTest.copyMode='pending');
    await page.keyboard.press('Tab');await replyCopy.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制回复"]').dataset.copyState==='copying');
    assert.equal(await replyCopy.evaluate(n=>document.activeElement===n),true,'a pending clipboard write must not discard keyboard focus');
    const pendingWrites=await page.evaluate(()=>window.presentationTest.copies.length);
    await replyCopy.evaluate(n=>n.click());
    assert.equal(await page.evaluate(()=>window.presentationTest.copies.length),pendingWrites);
    await page.evaluate(()=>window.presentationTest.finishCopy());
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制回复"]').dataset.copyState==='copied');
    await page.evaluate(()=>window.presentationTest.copyMode='denied');await page.locator('.nf-chat-message-row').filter({has:replyCopy}).hover();await replyCopy.click();
    await page.getByRole('alert').filter({hasText:'复制失败，请重试'}).waitFor();
    assert.equal(await replyCopy.getAttribute('data-copy-state'),'error');assert.deepEqual(await input.boundingBox(),copyInputBox);
    const errorUserCopyBox=await userCopy.boundingBox();
    await userCopy.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制消息"]').dataset.copyState==='error');
    assert.deepEqual(await userCopy.boundingBox(),errorUserCopyBox,'user-side retry feedback must not shift the copy target');
    await page.evaluate(()=>{const a=window.presentationTest;a.copyMode='fallback';Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})});
    await page.locator('.nf-chat-message-row').filter({has:replyCopy}).hover();await replyCopy.click();await page.waitForFunction(()=>document.querySelector('[aria-label="复制回复"]').dataset.copyState==='copied');
    assert.equal(await page.evaluate(()=>window.presentationTest.copies.at(-1)),replyText);
    assert.equal(await page.locator('[data-message-copy-fallback]').count(),0);
    assert.equal(await replyCopy.evaluate(n=>document.activeElement===n),true);assert.equal(await input.inputValue(),'复制时保留草稿');
    await userCopy.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[aria-label="复制消息"]').dataset.copyState==='copied');
    if(process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR){
      await page.waitForTimeout(1250);await input.focus();
      if(!mobile) await page.locator('.nf-chat-message-row').filter({has:replyCopy}).hover();
      await page.locator('#root').screenshot({path:process.env.NOTEFLOW_CHAT_SCREENSHOT_DIR+'/chat-actions-'+(mobile?'mobile':'desktop')+'.png'});
    }
    await page.evaluate(()=>window.presentationTest.clear());await page.waitForTimeout(350);
    assert.equal(await page.locator('.nf-chat-message').count(),0);
    assert.equal(await tooltip.count(),0,'clearing the conversation removes all hint portals and pending timers');
    reports.push({mobile,historySearchSoftFocus:true,historySearchStyle,historySearchFilter:true,historySearchFocusReturn:true,historyImeEscapeCloses,singleChunkTyping:true,stats,stop:true,completedTailStop:true,switchHistory:true,canonicalReplacement:true,markdownActions:true,reducedMotion:true,backgroundFlush:true,readingPosition:true,inputStable:true,scrollSurface,wideContentLocalScroll:true,jumpGeometry,jumpStable:true,bothRoleCopy:true,smallHoverCopy:true,timeTogether:true,copyKeyboard:true,copyTooltip:true,tooltipDelayHoverBridge:true,tooltipNoLayoutShift:true,tooltipEscapeScrollResize:true,tooltipReducedMotionForcedColors:true,pendingCopyFocus:true,copyFeedbackStable:true,copyFailureRetry:true,copyFallback:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,productionComponent:true,networkBlocked:true,strictMode:true,reports,errors},null,2));
}finally{await browser.close()}
