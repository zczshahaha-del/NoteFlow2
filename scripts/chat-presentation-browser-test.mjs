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
let key=0;const api={chat,editor,draft,agent,workspace,metrics:[],samples:[],sources:[],stops:0,currentText:'',render(){root.render(React.createElement(React.StrictMode,null,React.createElement(Panel)))},
begin(history=0){this.metrics=[];this.samples=[];this.currentText='';chat.chatLoading=true;chat.chatMessages=[];for(let i=0;i<history;i++)chat.chatMessages.push({id:'h-'+i,role:'assistant',text:'## 合成历史 '+i+'\\n\\n历史内容 **完整保留**。'});chat.chatMessages.push({id:'live-'+(++key),role:'assistant',text:'',streamState:'streaming'});this.render()},
chunk(delta,complete=false){chat.chatMessages=chat.chatMessages.map((m,i)=>i===chat.chatMessages.length-1?{...m,text:m.text+delta,streamState:complete?'completed':'streaming'}:m);chat.chatLoading=!complete;this.render()},
replace(text,status='streaming',sources){chat.chatMessages=chat.chatMessages.map((m,i)=>i===chat.chatMessages.length-1?{...m,text,streamState:status,sources}:m);chat.chatLoading=status==='streaming';this.render()},
history(text){chat.chatLoading=false;chat.chatMessages=[{id:'loaded-'+(++key),role:'assistant',text}];this.render()},
clear(){chat.chatLoading=false;chat.chatMessages=[];this.render()}};
chat.stopGeneration=()=>{api.stops++;chat.chatLoading=false;chat.chatMessages=chat.chatMessages.map(m=>m.streamState==='streaming'?{...m,streamState:'stopped'}:m);api.render()};
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
    const context=await browser.newContext({viewport:mobile?{width:320,height:700}:{width:600,height:850},deviceScaleFactor:1});
    await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'#root{width:100%;max-width:500px;height:95vh;display:flex}#root>aside{flex:1;min-width:0}</style></head><body><div id="root"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>Boolean(window.presentationTest));
    const full='这是模拟整段数据到达时的连续输出。'.repeat(18)+'👩🏽‍💻🇨🇳e\u0301👨‍👩‍👧‍👦结束。';
    await page.evaluate(()=>window.presentationTest.begin(10));
    await page.getByText('正在思考',{exact:true}).waitFor();
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
    await page.waitForTimeout(800);
    await page.locator('.ai-message-list').evaluate(n=>{n.scrollTo({top:0,behavior:'instant'});n.dispatchEvent(new Event('scroll'))});
    await page.evaluate(text=>window.presentationTest.chunk(text,true),full);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.ai-message-list').evaluate(n=>n.scrollTop),0);
    await page.getByRole('button',{name:'回到底部',exact:true}).waitFor();

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
    await page.evaluate(()=>window.presentationTest.clear());await page.waitForTimeout(100);
    assert.equal(await page.locator('.nf-chat-message').count(),0);
    reports.push({mobile,singleChunkTyping:true,stats,stop:true,completedTailStop:true,switchHistory:true,canonicalReplacement:true,markdownActions:true,reducedMotion:true,backgroundFlush:true,readingPosition:true,inputStable:true,scrollSurface,wideContentLocalScroll:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,productionComponent:true,networkBlocked:true,strictMode:true,reports,errors},null,2));
}finally{await browser.close()}
