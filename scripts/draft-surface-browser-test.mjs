// Production component + built CSS, synthetic store/services, fresh offline
// contexts. Never opens localhost, the app or an existing browser session.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const { chromium } = await import(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/AIDraftWorkspace.tsx', import.meta.url));
const assets = new URL('../dist/assets/', import.meta.url);
const cssFile = readdirSync(assets).find(name => /^index-.*\.css$/.test(name));
assert.ok(cssFile, 'run npm run build first');
const css = readFileSync(new URL(cssFile, assets), 'utf8');
const serviceNames = ['assembleNoteDraft','cancelNoteDraft','confirmDraftSection','createDraftSection','createNoteDraft','deleteDraftSection','generateAllDraftSections','generateDraftSection','getNoteDraft','restoreDraftSection','saveDraftToNotes','stopAllDraftSections','updateNoteDraft','updateDraftSection'];
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import Draft from ${JSON.stringify(component)};
const root=createRoot(document.getElementById('root'));
let revision=0;
const makeDraft=(status='outline_ready')=>({id:'synthetic-draft',topic:'Redis 学习笔记',title:'Redis 学习笔记',categoryId:null,bodyInstruction:'',draftConfig:{},outline:'## 认识 Redis',assembledContent:status==='assembled'?'# Redis 学习笔记\\n合成正文':'',status,
sections:[{id:'s1',title:'认识 Redis',sortOrder:0,level:2,outlineText:'## 认识 Redis',content:'## 缓存的基础\\n\\n这是用于离线组件检查的合成正文。',status:status==='generating'?'generating':'generated'},
{id:'s2',title:'数据类型与常用命令',sortOrder:1,level:2,outlineText:'## 数据类型与常用命令',content:'## 常用命令\\n\\n字符串、列表与集合。',status:'generated'},
{id:'s3',title:'过期策略与持久化',sortOrder:2,level:2,outlineText:'## 过期策略与持久化',content:'',status:'outline_only'}]});
const api={calls:[],draft:makeDraft(),failNext:null,render(){root.render(React.createElement(Draft,{key:revision}))},show(status){this.draft=makeDraft(status);slice.centerMode='draft';revision++;this.render()},async call(name,args){this.calls.push({name,args});if(this.failNext===name){this.failNext=null;throw new Error('合成失败，请重试')}const section=this.draft.sections.find(s=>s.id===args[1]);
if(name==='updateDraftSection')Object.assign(section,args[2]);
if(name==='confirmDraftSection')section.status='confirmed';
if(name==='deleteDraftSection')section.status='deleted';
if(name==='restoreDraftSection')section.status='generated';
if(name==='createDraftSection')this.draft.sections.push({id:'new',content:'',status:'outline_only',...args[1]});
if(name==='updateNoteDraft'){const update=args[1];Object.assign(this.draft,update);if(update.sectionOrder)this.draft.sections.forEach(s=>s.sortOrder=update.sectionOrder.indexOf(s.id))}
if(name==='assembleNoteDraft'){this.draft.status='assembled';this.draft.assembledContent=args[1]}
if(name==='generateAllDraftSections')this.draft.status='generating';
if(name==='stopAllDraftSections'){this.draft.status='outline_ready';this.draft.sections.forEach(s=>{if(s.status==='generating')s.status=s.content.trim()?'generated':'outline_only'})}
if(name==='saveDraftToNotes')return {draft:{...this.draft,status:'saved'},note:{id:'synthetic-note',title:args[1].title}};
return structuredClone(this.draft)}};
const slice={centerMode:'draft',draftSeed:'Redis 学习笔记',draftCommand:null,pendingCheckpoint:{id:'synthetic-checkpoint',checkpointType:'draft_workspace',payload:{draftId:'synthetic-draft'}},consumeDraftCommand(){},setActiveDraftContext(){},closeDraft(){api.calls.push({name:'closeDraft'});slice.centerMode='note';api.render()},dismissDraftWorkspace(){api.calls.push({name:'dismissDraftWorkspace'});slice.centerMode='note';api.render()}};
const workspace={treeData:[{id:'folder',name:'全栈开发',type:'folder',children:[]}],reloadWorkspace(...args){api.calls.push({name:'reloadWorkspace',args})}};
window.draftTest={api,slice,workspace}; api.render();`;
const bundled = await build({configFile:false,logLevel:'silent',plugins:[{
  name:'offline-draft-entry',
  enforce:'pre',
  resolveId(id, importer){
    if(id==='virtual:offline-draft')return '\0offline-draft';
    if(importer===component && id==='../store/selectors')return '\0draft-store';
    if(importer===component && ['../services/drafts','../services/aiStream','../services/agent','../services/memories'].includes(id))return '\0draft-mock:'+id;
  },
  load(id){
    if(id==='\0offline-draft')return entry;
    if(id==='\0draft-store')return 'export const useDraftSlice=()=>window.draftTest.slice; export const useWorkspaceSlice=()=>window.draftTest.workspace;';
    if(id==='\0draft-mock:../services/drafts')return serviceNames.map(name=>
      'export const '+name+'=(...args)=>window.draftTest.api.call('+JSON.stringify(name)+',args);').join('\n');
    if(id==='\0draft-mock:../services/aiStream')return 'export const generateNoteStream=()=>{throw new Error("unexpected generation")}';
    if(id==='\0draft-mock:../services/agent')return 'export const bindAgentCheckpoint=async()=>null; export const resolveAgentCheckpoint=async()=>null;';
    if(id==='\0draft-mock:../services/memories')return 'export const isMemoryEnabled=()=>false;';
  },
}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:offline-draft'}}});
const scripts=bundled.output.filter(item=>item.type==='chunk');assert.equal(scripts.length,1);
const source=scripts[0].code.replaceAll('</script','<\\/script');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE || undefined,headless:true});
const errors=[],requests=[],reports=[];
try {
  for(const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:320,height:800}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
    await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
    const page=await context.newPage();page.on('pageerror',err=>{errors.push(String(err));console.error('offline draft pageerror:',String(err))});
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>Boolean(window.draftTest));
    if(process.env.NOTEFLOW_TEST_TRACE==='1'){await page.waitForTimeout(300);console.error(await page.evaluate(()=>({calls:window.draftTest.api.calls,body:document.body.innerText.slice(0,600)})))}
    const shell=page.locator('.nf-draft-shell');
    await shell.locator('.nf-draft-revision').waitFor();await page.waitForTimeout(220);
    const measure=()=>shell.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),close=n.querySelector('.nf-draft-close'),c=getComputedStyle(close),outline=n.querySelector('aside');return {width:r.width,height:r.height,docWidth:document.documentElement.scrollWidth,border:s.borderWidth,background:s.backgroundColor,sidebarWidth:outline.getBoundingClientRect().width,close:{width:close.getBoundingClientRect().width,height:close.getBoundingClientRect().height,background:c.backgroundColor,radius:c.borderRadius,icon:getComputedStyle(close.querySelector('svg')).width},toolbar:getComputedStyle(n.querySelector('.nf-draft-toolbar')).display,lines:[n.querySelector('header'),outline,n.querySelector('.nf-draft-section-bar'),n.querySelector('footer')].map(e=>getComputedStyle(e).borderWidth)}});
    const initial=await measure();assert.equal(initial.docWidth,mobile?320:1440);assert.equal(initial.width,mobile?288:1240);assert.equal(initial.height,mobile?768:880);assert.equal(initial.border,'0px');assert.ok(initial.lines.every(x=>x==='0px'));assert.equal(initial.close.background,'rgba(0, 0, 0, 0)');assert.equal(initial.close.icon,'18px');assert.equal(initial.close.radius,'10px');assert.equal(initial.close.width,mobile?44:34);assert.equal(initial.toolbar,mobile?'none':'flex');if(!mobile)assert.equal(initial.sidebarWidth,282);
    const buttons=await shell.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>{const r=n.getBoundingClientRect(),p=n.closest('main').getBoundingClientRect();return {width:r.width,height:r.height,inside:r.left>=p.left && r.right<=p.right && r.top>=p.top && r.bottom<=p.bottom}}));
    assert.ok(buttons.every(b=>b.inside));if(mobile)assert.ok(buttons.every(b=>b.height>=44));
    await shell.getByRole('button',{name:'编辑',exact:true}).focus();await page.keyboard.press('Tab');assert.ok(await shell.getByRole('button',{name:'确认',exact:true}).evaluate(n=>n.matches(':focus-visible') && getComputedStyle(n).outlineStyle==='solid'));
    const field=page.locator('#draft-section-instruction');assert.equal(await field.evaluate(n=>getComputedStyle(n).resize),'none');
    if(mobile)assert.equal(await field.evaluate(n=>getComputedStyle(n).fontSize),'16px');
    await field.fill('一行\n二行\n三行\n四行\n五行\n六行\n七行');
    assert.equal(await field.evaluate(n=>n.getBoundingClientRect().height),104);assert.equal(await field.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    await field.fill('');assert.equal(await field.evaluate(n=>n.getBoundingClientRect().height),52);
    assert.ok(await shell.getByRole('button',{name:'按要求修改',exact:true}).isDisabled());
    await field.dispatchEvent('keydown',{key:'Escape',isComposing:true});assert.equal(await shell.count(),1);
    const rows=shell.getByRole('navigation',{name:'草稿章节目录'}).getByRole('button');await rows.nth(2).click();await shell.getByRole('button',{name:'生成正文',exact:true}).waitFor();await rows.nth(0).click();
    await shell.getByRole('button',{name:'编辑',exact:true}).click();await shell.getByRole('textbox',{name:'编辑 认识 Redis'}).fill('## 离线修改\n\n合成内容。');await shell.getByRole('button',{name:'保存修改',exact:true}).click();await shell.getByText('离线修改',{exact:true}).waitFor();
    await shell.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.draft.sections[0].status==='confirmed');
    if(!mobile){
      await shell.getByRole('button',{name:'全文要求',exact:true}).click();const requirements=page.getByRole('dialog',{name:'全文写作要求',exact:true});
      await requirements.getByRole('textbox').fill('只使用合成测试要求');await requirements.getByRole('button',{name:'应用到后续章节',exact:true}).click();await requirements.waitFor({state:'detached'});
      await shell.getByRole('button',{name:'目录管理',exact:true}).click();const manager=page.getByRole('dialog',{name:'目录管理',exact:true});
      await manager.getByRole('button',{name:'下移章节 认识 Redis',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.calls.some(c=>c.name==='updateNoteDraft' && c.args[1].sectionOrder));
      await manager.getByRole('button',{name:'删除章节 数据类型与常用命令',exact:true}).click();await manager.getByRole('button',{name:/数据类型与常用命令.*恢复/}).click();
      await manager.getByPlaceholder('添加一级章节').fill('合成新章节');await manager.getByRole('button',{name:'添加',exact:true}).click();
      await manager.getByRole('button',{name:'修改章节 合成新章节',exact:true}).click();await manager.getByRole('textbox',{name:'修改章节名称',exact:true}).fill('合成改名章节');await manager.getByRole('textbox',{name:'修改章节名称',exact:true}).press('Enter');await manager.getByRole('button',{name:'修改章节 合成改名章节',exact:true}).waitFor();
      await manager.getByPlaceholder('例如：减少基础内容，增加两个实战章节…').fill('只调整合成章节');
      await manager.getByRole('button',{name:'按要求重新规划',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'按新要求重做大纲？',exact:true});
      await confirmation.waitFor();assert.equal(await confirmation.evaluate(n=>getComputedStyle(n.parentElement).zIndex),'140');
      await confirmation.getByRole('button',{name:'保留正文',exact:true}).press('Escape');await confirmation.waitFor({state:'detached'});assert.equal(await manager.count(),1);
      await manager.locator('.nf-draft-close').click();
      await rows.filter({hasText:'认识 Redis'}).click();
    }
    await page.mouse.move(mobile?319:1439,mobile?799:999);await page.waitForTimeout(550);
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/noteflow-draft-soft-component-'+(mobile?'mobile':'desktop')+'.png'});
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await page.waitForTimeout(180);assert.equal((await measure()).background,'rgb(37, 43, 51)');
    assert.equal(await shell.locator('.nf-draft-chapter[aria-current]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(53, 62, 73)');
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/noteflow-draft-soft-component-'+(mobile?'mobile':'desktop')+'-dark.png'});
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await shell.evaluate(n=>getComputedStyle(n).animationName),'none');
    await page.evaluate(()=>window.draftTest.api.show('assembled'));await shell.locator('.nf-draft-revision').waitFor();await page.waitForTimeout(50);
    await shell.locator('footer').getByRole('button',{name:'保存为笔记',exact:true}).click();
    const save=page.getByRole('dialog',{name:'保存为笔记',exact:true});await save.waitFor();
    const centered=await save.locator('.nf-draft-panel').evaluate(n=>{const r=n.getBoundingClientRect();return {width:r.width,x:r.x,y:r.y,offset:Math.abs((r.left+r.right)/2-innerWidth/2)}});assert.ok(centered.offset<1);assert.equal(centered.width,mobile?288:460);
    await save.getByRole('textbox',{name:'笔记标题'}).fill('');assert.ok(await save.getByRole('button',{name:'确认保存',exact:true}).isDisabled());
    await save.getByRole('textbox',{name:'笔记标题'}).fill('离线保存验证');await save.getByRole('button',{name:'确认保存',exact:true}).click();await shell.waitFor({state:'detached'});
    assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='saveDraftToNotes' && c.args[1].confirm===true && c.args[1].title==='离线保存验证')));
    await page.evaluate(()=>window.draftTest.api.show('generating'));await shell.getByRole('button',{name:'停止',exact:true}).waitFor();await shell.getByRole('button',{name:'停止',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.calls.some(c=>c.name==='stopAllDraftSections'));
    if(!mobile){
      await page.evaluate(()=>window.draftTest.api.failNext='generateAllDraftSections');await shell.getByRole('button',{name:'全部生成',exact:true}).click();await shell.getByRole('alert').waitFor();
      await shell.getByRole('button',{name:'全部生成',exact:true}).click();await shell.getByRole('button',{name:'停止生成',exact:true}).waitFor();await shell.getByRole('button',{name:'停止生成',exact:true}).click();
    }
    await shell.locator('.nf-draft-close').click();await shell.waitFor({state:'detached'});assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='dismissDraftWorkspace')));
    reports.push({mobile,initial,centered,editing:true,confirmation:!mobile,directoryCRUD:!mobile,failureRetry:!mobile,saveMock:true,stopMock:true,dark:true,reducedMotion:true});await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,offlineProductionComponent:true,syntheticServices:true,networkBlocked:true,reports,errors},null,2));
}finally{await browser.close()}
