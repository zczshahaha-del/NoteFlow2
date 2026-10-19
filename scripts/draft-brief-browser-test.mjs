// Real AIPanel + store + hidden draft workspace, isolated browser and synthetic
// generation/HTTP only. Never sends a user message or reads the current account.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
const {chromium}=await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const repo=fileURLToPath(new URL('../',import.meta.url));
const workspace=path.join(repo,'src/components/AIDraftWorkspace.tsx');
const assets=path.join(repo,'dist/assets');
const css=readFileSync(path.join(assets,readdirSync(assets).find(n=>/^index-.*\.css$/.test(n))),'utf8');
const output=mkdtempSync(path.join(tmpdir(),'noteflow-brief-implemented-'));
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import Panel from ${JSON.stringify(path.join(repo,'src/components/AIPanel.tsx'))};
import Draft from ${JSON.stringify(workspace)};
import{useAppStore as store}from ${JSON.stringify(path.join(repo,'src/store/index.tsx'))};
const original='给我生成一份关于两小儿辩日的一份教案';const seed='《两小儿辩日》教案';
const f={calls:[],requests:[],hold:false,fail:false,writeFail:false,store,root:null,draft:null,
checkpoint:{id:'cp-brief',checkpointType:'draft_workspace',status:'waiting_user_confirm',sessionId:'session-brief',runId:'run-brief',payload:{seed,rawRequest:original}},
async generate(p){this.requests.push(p);if(this.hold)await new Promise(r=>this.release=r);if(this.fail){this.fail=false;throw new Error('合成大纲失败，已有内容未改动')}if(p.signal.aborted)throw new DOMException('aborted','AbortError');p.onDelta('## 教学目标\\n\\n## 教学过程\\n\\n## 课堂小结');},
mount(){this.root=createRoot(document.getElementById('root'));this.root.render(React.createElement(React.StrictMode,null,React.createElement(Panel),React.createElement(Draft)))}};
window.briefTest=f;
window.fetch=async(input,options={})=>{const url=String(input),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;f.calls.push({url,method,body});const result=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
if(url.includes('/bind')){Object.assign(f.checkpoint.payload,body.payload||{});if(body.draftId)f.checkpoint.payload.draftId=body.draftId;return result({checkpoint:structuredClone(f.checkpoint)});}
if(url==='/api/note-drafts'&&method==='POST'){if(f.writeFail){f.writeFail=false;return result({error:{message:'合成保存失败'}},503);}f.draft={...body,id:'draft-brief',status:'outline_ready',bodyInstruction:'',assembledContent:'',sections:body.sections.map((s,i)=>({...s,id:'section-'+i,content:'',status:'outline_only'}))};return result({draft:structuredClone(f.draft)});}
if(url==='/api/note-drafts/draft-brief'&&method==='GET')return result({draft:structuredClone(f.draft)});
if(url==='/api/note-drafts/draft-brief'&&method==='PUT'){f.draft={...f.draft,...body,topic:body.generationBrief?.title||f.draft.topic,draftConfig:{...f.draft.draftConfig,...(body.generationBrief?{generationBrief:body.generationBrief}: {})},sections:body.sections?body.sections.map((s,i)=>({...s,id:'new-section-'+i,content:'',status:'outline_only'})):f.draft.sections};return result({draft:structuredClone(f.draft)});}
if(url.includes('/chat-sessions'))return result({sessions:[]});if(url.includes('/checkpoints/latest'))return result({checkpoint:f.checkpoint});if(url.includes('/runs/latest'))return result({task:null});if(url.includes('/runs'))return result({tasks:[]});throw new Error('Unexpected synthetic HTTP '+url);};
store.setState({hydratedUserId:'synthetic',chatLoading:false,centerMode:'note',treeData:[],fileContents:{},selectedFileId:null,agentSessionId:'session-brief',draftSeed:seed,pendingCheckpoint:structuredClone(f.checkpoint),
activeDraftContext:{id:'',title:seed,topic:seed,stage:'configuring',busy:false,statusText:'',errorText:'',completedSections:0,totalSections:0},
chatMessages:[{id:'u-brief',role:'user',text:original},{id:'a-brief',role:'assistant',text:'你可以调整标题和要求，再生成大纲。',draftCard:{seed,title:seed,requirements:'',rawRequest:original,checkpointId:'cp-brief'}}]});f.mount();`;
const built=await build({configFile:false,logLevel:'silent',plugins:[{name:'brief-isolated-entry',enforce:'pre',resolveId(id,importer){if(id==='virtual:brief-entry')return '\0brief-entry';if(importer===workspace && id==='../services/aiStream')return '\0brief-generator';},load(id){if(id==='\0brief-entry')return entry;if(id==='\0brief-generator')return'export const generateNoteStream=p=>window.briefTest.generate(p);';}}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:brief-entry'}}});
const chunks=built.output.filter(item=>item.type==='chunk');assert.equal(chunks.length,1);
const browser=await chromium.launch({headless:true,executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined});
const results=[];
try{for(const width of [1280,736,320]){
const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===320});const page=await context.newPage();const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{external.push(route.request().url());return route.abort();});
await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'#root{width:min(100%,480px);height:950px;margin:auto}</style></head><body><div id="root"></div><script type="module">'+chunks[0].code.replaceAll('</script','<\\/script')+'</script></body></html>');
const card=page.getByRole('region',{name:'AI 笔记草稿',exact:true});await card.waitFor();
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert.equal(await page.evaluate(()=>window.briefTest.requests.length),0,'legacy cards without manualOutline must also wait for confirmation in StrictMode');
assert.equal(await card.getByRole('textbox',{name:'草稿标题'}).inputValue(),'《两小儿辩日》教案');
assert.equal(await card.getByRole('textbox',{name:'草稿要求'}).inputValue(),'');
assert.equal(await card.getByText('先看大纲，再生成正文').count(),0);assert.equal(await card.locator('footer svg').count(),0);
assert.equal(await card.locator('footer button').textContent(),'生成大纲');
await card.screenshot({path:path.join(output,'card-'+width+'.png')});
const title=card.getByRole('textbox',{name:'草稿标题'}),requirements=card.getByRole('textbox',{name:'草稿要求'});
await title.fill('');await card.getByRole('button',{name:'生成大纲',exact:true}).click();await card.getByText('请先填写标题。').waitFor();
await title.fill('《两小儿辩日》教学设计');await title.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await page.evaluate(()=>window.briefTest.requests.length),0);
await title.press('Enter');assert(await requirements.evaluate(el=>el===document.activeElement));await requirements.fill('用一课时完成，重点安排课堂讨论。');
await page.evaluate(()=>{window.briefTest.hold=true;const s=window.briefTest.store.getState();s.generateDraftBrief('a-brief');s.generateDraftBrief('a-brief');});
await page.waitForFunction(()=>window.briefTest.requests.length===1);assert(await title.isDisabled());
await page.evaluate(()=>{window.briefTest.hold=false;window.briefTest.release();});
await card.getByRole('button',{name:'查看大纲',exact:true}).waitFor();
const initial=await page.evaluate(()=>({request:window.briefTest.requests[0],draft:window.briefTest.draft,card:window.briefTest.store.getState().chatMessages.at(-1).draftCard}));
assert.equal(initial.request.topic,'《两小儿辩日》教学设计');assert(initial.request.extraRequest.includes('用一课时完成，重点安排课堂讨论。'));assert(initial.request.extraRequest.includes('给我生成一份关于两小儿辩日的一份教案'));assert.equal(initial.draft.draftConfig.rawRequest,'给我生成一份关于两小儿辩日的一份教案');assert.equal(initial.draft.draftConfig.generationBrief.requirements,'用一课时完成，重点安排课堂讨论。');
await requirements.fill('增加板书设计。');assert.equal(await page.evaluate(()=>window.briefTest.requests.length),1);assert.equal(await page.evaluate(()=>window.briefTest.draft.draftConfig.generationBrief.requirements),'用一课时完成，重点安排课堂讨论。');
await page.evaluate(()=>{window.briefTest.fail=true;});await card.getByRole('button',{name:'重新生成大纲',exact:true}).click();await card.getByText('合成大纲失败，已有内容未改动').waitFor();assert.equal(await page.evaluate(()=>window.briefTest.draft.draftConfig.generationBrief.requirements),'用一课时完成，重点安排课堂讨论。');
await card.getByRole('button',{name:'重新生成大纲',exact:true}).click();await card.getByRole('button',{name:'查看大纲',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.briefTest.draft.draftConfig.generationBrief.requirements),'增加板书设计。');
// An existing body requires explicit confirmation before replacement.
await page.evaluate(()=>{const f=window.briefTest;f.draft.sections[0].content='合成已有正文';f.draft.sections[0].status='generated';f.store.setState({activeDraftContext:{...f.store.getState().activeDraftContext,hasBody:true,completedSections:1}});});
await requirements.fill('改成另一份讨论方案');const before=await page.evaluate(()=>window.briefTest.requests.length);await card.getByRole('button',{name:'重新生成大纲',exact:true}).click();const dialog=page.getByRole('dialog',{name:'按新要求重做大纲？',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'保留内容',exact:true}).click();assert.equal(await page.evaluate(()=>window.briefTest.requests.length),before);
assert.equal(await page.evaluate(()=>window.briefTest.draft.sections[0].content),'合成已有正文');
await card.getByRole('button',{name:'重新生成大纲',exact:true}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'重新生成',exact:true}).click();await card.getByRole('button',{name:'查看大纲',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.briefTest.requests.length),before+1);assert.equal(await page.evaluate(()=>window.briefTest.draft.sections[0].content),'');
// Simulate rehydrating server checkpoint/card metadata, without another model call.
await page.evaluate(()=>{const f=window.briefTest;f.root.unmount();const brief=f.checkpoint.payload.draftBrief;f.store.setState({pendingCheckpoint:structuredClone(f.checkpoint),activeDraftContext:null,chatMessages:[{id:'a-brief',role:'assistant',text:'',draftCard:{seed:'《两小儿辩日》教案',checkpointId:'cp-brief',draftId:f.draft.id,...brief,manualOutline:true,generatedBrief:f.checkpoint.payload.generatedBrief}}]});f.mount();});
await card.getByRole('button',{name:'查看大纲',exact:true}).waitFor();assert.equal(await requirements.inputValue(),'改成另一份讨论方案');assert.equal(await page.evaluate(()=>window.briefTest.requests.length),before+1);
const geometry=await card.evaluate(el=>({fits:el.getBoundingClientRect().right<=innerWidth,width:el.getBoundingClientRect().width,buttonHeight:el.querySelector('footer button').getBoundingClientRect().height,bg:getComputedStyle(el).backgroundColor,text:getComputedStyle(el.querySelector('input')).color}));assert(geometry.fits);if(width===320)assert(geometry.buttonHeight>=44);
await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await card.screenshot({path:path.join(output,'card-dark-'+width+'.png')});await page.emulateMedia({reducedMotion:'reduce'});
// New draft save failure retains both editable fields and can be retried.
await page.evaluate(()=>{const f=window.briefTest;f.root.unmount();f.draft=null;f.writeFail=true;f.store.getState().startDraft('《两小儿辩日》教案');f.mount();});const newCard=card.last();const newRequirements=newCard.getByRole('textbox',{name:'草稿要求'});await newCard.getByRole('button',{name:'生成大纲',exact:true}).waitFor();await newRequirements.fill('保存失败后仍保留的要求');await newCard.getByRole('button',{name:'生成大纲',exact:true}).click();await newCard.getByText('合成保存失败',{exact:false}).waitFor();assert.equal(await newRequirements.inputValue(),'保存失败后仍保留的要求');await newCard.getByRole('button',{name:'重新生成大纲',exact:true}).click();await newCard.getByRole('button',{name:'查看大纲',exact:true}).waitFor();
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({viewportWidth:width,manualApproval:true,snapshot:true,doubleClick:true,failedRegenerationPreserves:true,confirmedReplacement:true,checkpointRestore:true,saveFailureRetry:true,...geometry});await context.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output,results,realModel:false,realData:false},null,2));
