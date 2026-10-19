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
const makeDraft=(status='outline_ready')=>({id:'synthetic-draft',topic:'Redis 学习笔记',title:'Redis 学习笔记',categoryId:null,bodyInstruction:'',draftConfig:{generationBrief:{title:'Redis 学习笔记',requirements:'面向初学者，重点讲缓存场景',rawRequest:'生成 Redis 学习笔记'}},outline:'## 认识 Redis',assembledContent:status==='assembled'?'# Redis 学习笔记\\n合成正文':'',status,
sections:[{id:'s1',title:'认识 Redis',sortOrder:0,level:2,outlineText:'## 认识 Redis',content:'## 缓存的基础\\n\\n这是用于离线组件检查的合成正文。',status:status==='generating'?'generating':'generated'},
{id:'s2',title:'数据类型与常用命令',sortOrder:1,level:2,outlineText:'## 数据类型与常用命令',content:'## 常用命令\\n\\n字符串、列表与集合。',status:'generated'},
{id:'s3',title:'过期策略与持久化',sortOrder:2,level:2,outlineText:'## 过期策略与持久化',content:'',status:'outline_only'}]});
const api={calls:[],draft:makeDraft(),failNext:null,holdNext:null,render(){root.render(React.createElement(Draft,{key:revision}))},reopen(){slice.centerMode='draft';this.render()},show(status){this.draft=makeDraft(status);slice.centerMode='draft';revision++;this.render()},async call(name,args){this.calls.push({name,args});if(this.holdNext===name){this.holdNext=null;await new Promise(resolve=>this.release=resolve)}if(this.failNext===name){this.failNext=null;throw new Error('合成失败，请重试')}const section=this.draft.sections.find(s=>s.id===args[1]);
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
const slice={centerMode:'draft',draftSeed:'Redis 学习笔记',draftCommand:null,pendingCheckpoint:{id:'synthetic-checkpoint',checkpointType:'draft_workspace',payload:{draftId:'synthetic-draft'}},consumeDraftCommand(){slice.draftCommand=null},setActiveDraftContext(value){api.context=value},closeDraft(outcome){api.calls.push({name:'closeDraft',outcome});slice.centerMode='note';api.render()},dismissDraftWorkspace(){api.calls.push({name:'dismissDraftWorkspace'});slice.centerMode='note';api.render()}};
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
  for(const {width,height,mobile} of [{width:1440,height:1000,mobile:false},{width:960,height:900,mobile:false},{width:736,height:900,mobile:true},{width:320,height:800,mobile:true}]) {
    const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
    await context.route('**/*',route=>{requests.push(route.request().url());return route.abort()});
    const page=await context.newPage();page.on('pageerror',err=>{errors.push(String(err));console.error('offline draft pageerror:',String(err))});
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module">'+source+'</script></body></html>');
    await page.waitForFunction(()=>Boolean(window.draftTest));
    if(process.env.NOTEFLOW_TEST_TRACE==='1'){await page.waitForTimeout(300);console.error(await page.evaluate(()=>({calls:window.draftTest.api.calls,body:document.body.innerText.slice(0,600)})))}
    const shell=page.locator('.nf-draft-shell');
    await shell.locator('.nf-draft-revision').waitFor();await page.waitForTimeout(220);
    const measure=()=>shell.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),close=n.querySelector('.nf-draft-close'),c=getComputedStyle(close),outline=n.querySelector('aside');return {width:r.width,height:r.height,docWidth:document.documentElement.scrollWidth,border:s.borderWidth,background:s.backgroundColor,sidebarWidth:outline.getBoundingClientRect().width,close:{width:close.getBoundingClientRect().width,height:close.getBoundingClientRect().height,background:c.backgroundColor,radius:c.borderRadius,icon:getComputedStyle(close.querySelector('svg')).width},toolbar:getComputedStyle(n.querySelector('.nf-draft-toolbar')).display,lines:[n.querySelector('header'),outline,n.querySelector('.nf-draft-section-bar'),n.querySelector('footer')].map(e=>getComputedStyle(e).borderWidth)}});
    const initial=await measure();assert.equal(initial.docWidth,width);assert.equal(initial.width,Math.min(1240,width-(width>=640?48:32)));assert.equal(initial.height,Math.min(880,height-(width>=640?48:32)));assert.equal(initial.border,'0px');assert.ok(initial.lines.every(x=>x==='0px'));assert.equal(initial.close.background,'rgba(0, 0, 0, 0)');assert.equal(initial.close.icon,'18px');assert.equal(initial.close.radius,'10px');assert.equal(initial.close.width,mobile?44:34);assert.equal(initial.toolbar,'flex');if(!mobile)assert.equal(initial.sidebarWidth,282);
    const buttons=await shell.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>{const r=n.getBoundingClientRect(),p=n.closest('main').getBoundingClientRect();return {width:r.width,height:r.height,inside:r.left>=p.left && r.right<=p.right && r.top>=p.top && r.bottom<=p.bottom}}));
    assert.ok(buttons.every(b=>b.inside));if(mobile)assert.ok(buttons.every(b=>b.height>=44));
    assert.equal(await shell.getByRole('button',{name:'编辑',exact:true}).count(),0);
    await shell.getByRole('button',{name:'重新生成',exact:true}).focus();await page.keyboard.press('Tab');assert.ok(await shell.getByRole('button',{name:'确认',exact:true}).evaluate(n=>n.matches(':focus-visible') && getComputedStyle(n).outlineStyle==='solid'));
    const field=page.locator('#draft-section-instruction');assert.equal(await field.evaluate(n=>getComputedStyle(n).resize),'none');
    const revision=shell.locator('.nf-draft-revision');
    assert.equal(await revision.locator('label').count(),0);
    assert.equal(await field.getAttribute('placeholder'),'告诉 AI 如何修改…');
    const inputGeometry=await revision.evaluate(el=>{const r=el.getBoundingClientRect(),button=el.querySelector('button').getBoundingClientRect();return {height:r.height,width:r.width,rightGap:r.right-button.right,sameRow:button.top>=r.top&&button.bottom<=r.bottom}});
    assert.equal(inputGeometry.height,mobile?52:44);assert(inputGeometry.width<=640);assert(inputGeometry.sameRow);assert(inputGeometry.rightGap<=6);
    const alignment=await shell.evaluate(n=>{
      const frames=[...n.querySelectorAll('.nf-draft-reading')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {left:r.left+parseFloat(s.paddingLeft),right:r.right-parseFloat(s.paddingRight)}});
      const revision=n.querySelector('.nf-draft-revision').getBoundingClientRect(),actions=n.querySelector('.nf-draft-footer-actions').getBoundingClientRect();
      return {frames,inputLeft:revision.left,inputTop:revision.top,inputBottom:revision.bottom,actionsLeft:actions.left,actionsTop:actions.top,actionsBottom:actions.bottom,actionsRight:actions.right,headerHeight:n.querySelector('header').getBoundingClientRect().height};
    });
    for(const frame of alignment.frames){assert(Math.abs(frame.left-alignment.frames[0].left)<1);assert(Math.abs(frame.right-alignment.frames[0].right)<1)}
    assert(Math.abs(alignment.inputLeft-alignment.frames[0].left)<1,'Revision starts on the same text column as the chapter title and prose');
    assert(Math.abs(alignment.actionsRight-alignment.frames[0].right)<1,'Footer actions end at the text column, not the modal edge');
    if(!mobile){assert(alignment.actionsLeft>=alignment.frames[0].left+inputGeometry.width);assert(Math.abs(alignment.inputTop-alignment.actionsTop)<1,'Input and actions share one row')}
    else assert(alignment.actionsTop>=alignment.inputBottom,'Narrow view wraps actions below without overlap');
    assert(alignment.headerHeight<=84,'Header no longer stacks a separate stage, steps, hint and progress strip');
    assert.equal(await shell.locator('.nf-draft-stage ol,.nf-draft-stage .nf-writing-hint,.nf-draft-progress-fill').count(),0);
    assert.equal(await shell.getByRole('progressbar',{name:'草稿正文生成进度'}).getAttribute('aria-valuetext'),'已生成 2 / 3 章');
    assert.equal(await shell.locator('aside').getByRole('button',{name:'目录管理',exact:true}).count(),1);
    assert.equal(await shell.locator('header').getByRole('button',{name:'目录管理',exact:true}).count(),0);
    await shell.locator('aside').getByRole('button',{name:'目录管理',exact:true}).click();
    const managerEntry=page.getByRole('dialog',{name:'目录管理',exact:true});
    await managerEntry.waitFor();
    const managerBounds=await managerEntry.locator('.nf-draft-panel').boundingBox();
    assert(managerBounds.x>=0&&managerBounds.x+managerBounds.width<=width,'Relocated directory manager fits every viewport');
    const outlineField=managerEntry.getByRole('textbox',{name:'大纲调整要求',exact:true});
    const addField=managerEntry.getByRole('textbox',{name:'添加一级章节',exact:true});
    const inlineBars=managerEntry.locator('.nf-draft-inline-entry');
    assert.deepEqual(await inlineBars.evaluateAll(nodes=>nodes.map(n=>Math.round(n.getBoundingClientRect().height))),[mobile?52:44,mobile?52:44]);
    for(const bar of await inlineBars.all())assert(await bar.evaluate(n=>{const r=n.getBoundingClientRect(),b=n.querySelector('button').getBoundingClientRect();return b.left>r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom}),'Add and replan buttons stay inside their input rows');
    assert.equal(await managerEntry.getByText('说明需要增删或强化的内容，AI 会重新规划全部章节。',{exact:true}).count(),0);
    assert(await managerEntry.getByRole('button',{name:'按要求重新规划',exact:true}).isDisabled());
    const callsBefore=await page.evaluate(()=>window.draftTest.api.calls.length);
    await addField.fill('输入法草稿');
    await addField.dispatchEvent('keydown',{key:'Enter',isComposing:true});await addField.dispatchEvent('keydown',{key:'Enter',keyCode:229});
    assert.equal(await page.evaluate(()=>window.draftTest.api.calls.length),callsBefore,'Confirming IME text does not add a chapter');
    await addField.fill('');
    await outlineField.fill('七行要求\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行');
    assert.equal(await outlineField.evaluate(n=>n.getBoundingClientRect().height),mobile?96:88);
    assert.equal(await outlineField.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    assert.equal(await outlineField.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    await outlineField.fill('');
    assert.equal(await outlineField.evaluate(n=>n.getBoundingClientRect().height),mobile?24:22);
    assert.equal(await page.evaluate(()=>window.draftTest.api.calls.length),callsBefore,'Editing instructions alone never regenerates an outline');
    await managerEntry.getByRole('button',{name:'修改章节 过期策略与持久化',exact:true}).click();
    const longChapter='进阶方向：多阶段构建、CI/CD 集成与 Kubernetes 衔接';
    await managerEntry.getByRole('textbox',{name:'修改章节名称',exact:true}).fill(longChapter);
    await managerEntry.getByRole('textbox',{name:'修改章节名称',exact:true}).press('Enter');
    await managerEntry.getByRole('button',{name:'修改章节 '+longChapter,exact:true}).waitFor();
    assert(await managerEntry.locator('.nf-draft-directory-row').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)),'Long titles and row actions do not create horizontal overflow');
    if(width<480)assert.equal(await managerEntry.locator('.nf-draft-directory-name').last().evaluate(n=>getComputedStyle(n).whiteSpace),'normal');
    await managerEntry.locator('header h2').click();
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await managerEntry.locator('.nf-draft-panel').screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/directory-'+width+'.png'});
    const lightFieldColor=await outlineField.evaluate(n=>getComputedStyle(n).color);
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    assert.equal(await managerEntry.locator('.nf-draft-panel').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(37, 43, 51)');
    assert.notEqual(await outlineField.evaluate(n=>getComputedStyle(n).color),lightFieldColor);
    assert.equal(await inlineBars.last().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(45, 53, 64)');
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await managerEntry.locator('.nf-draft-panel').screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/directory-'+width+'-dark.png'});
    await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    await managerEntry.locator('header').getByRole('button',{name:'关闭目录管理',exact:true}).click();
    await managerEntry.waitFor({state:'detached'});
    await shell.locator('header h1').click();
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/workbench-'+width+'.png'});
    assert.equal(await shell.locator('.nf-writing-label').textContent(),'正文待完善');
    await field.fill('关闭重开后保留的合成修改要求');
    assert.equal(await field.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    await shell.locator('.nf-draft-close').click();await shell.waitFor({state:'detached'});
    await page.evaluate(()=>window.draftTest.api.reopen());await field.waitFor();
    assert.equal(await field.inputValue(),'关闭重开后保留的合成修改要求');
    if(mobile)assert.equal(await field.evaluate(n=>getComputedStyle(n).fontSize),'16px');
    await field.fill('一行\n二行\n三行\n四行\n五行\n六行\n七行');
    assert.equal(await field.evaluate(n=>n.getBoundingClientRect().height),mobile?96:88);assert.equal(await field.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    await field.fill('');assert.equal(await field.evaluate(n=>n.getBoundingClientRect().height),mobile?24:22);
    assert.ok(await shell.getByRole('button',{name:'按要求修改',exact:true}).isDisabled());
    await field.dispatchEvent('keydown',{key:'Escape',isComposing:true});assert.equal(await shell.count(),1);
    const rows=shell.getByRole('navigation',{name:'草稿章节目录'}).getByRole('button');await rows.nth(2).click();await shell.getByRole('button',{name:'生成正文',exact:true}).waitFor();await rows.nth(0).click();
    await shell.getByText('缓存的基础',{exact:true}).waitFor();
    await shell.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.draft.sections[0].status==='confirmed');
    await shell.getByRole('button',{name:'正文补充要求',exact:true}).click();const requirements=page.getByRole('dialog',{name:'正文补充要求',exact:true});
    await requirements.getByText('面向初学者，重点讲缓存场景',{exact:true}).waitFor();
    const supplementField=requirements.getByRole('textbox',{name:'正文补充要求',exact:true});
    assert.equal((await requirements.boundingBox()).width,Math.min(344,width-32),'The supplement stays a small popover, including intermediate viewports');
    assert.equal(await supplementField.getAttribute('placeholder'),'补充正文写法…');
    assert.equal(await supplementField.evaluate(n=>n.getBoundingClientRect().height),mobile?68:64);
    assert.equal(await supplementField.evaluate(n=>getComputedStyle(n).resize),'none');
    assert((await requirements.boundingBox()).height<=280,'The empty supplement panel is a compact editor, not stacked instruction cards');
    assert.equal(await requirements.locator('.nf-draft-initial-requirements').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
    await supplementField.fill('一行\n二行\n三行\n四行\n五行\n六行\n七行\n八行');
    assert.equal(await supplementField.evaluate(n=>n.getBoundingClientRect().height),mobile?164:152);
    assert.equal(await supplementField.evaluate(n=>getComputedStyle(n).overflowY),'auto');
    assert.equal(await supplementField.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    await supplementField.fill('');assert.equal(await supplementField.evaluate(n=>n.getBoundingClientRect().height),mobile?68:64);
    await requirements.getByRole('textbox').fill('每章增加一个完整示例');
    const callsBeforeRewrite=await page.evaluate(()=>window.draftTest.api.calls.length);
    await requirements.getByRole('button',{name:'重写已生成章节',exact:true}).click();
    const rewriteConfirm=page.getByRole('dialog',{name:'按正文补充要求重写 2 个章节？',exact:true});
    await rewriteConfirm.waitFor();await rewriteConfirm.getByRole('button',{name:'暂不重写',exact:true}).click();
    await rewriteConfirm.waitFor({state:'detached'});
    assert(await requirements.isVisible(),'Cancelling a rewrite must preserve the supplement panel');
    assert.equal(await supplementField.inputValue(),'每章增加一个完整示例');
    await page.waitForFunction(()=>document.activeElement?.id==='draft-body-supplement');
    assert.equal(await page.evaluate(()=>window.draftTest.api.calls.length),callsBeforeRewrite,'Cancellation does not save requirements or queue generation');
    const reqGeometry=await requirements.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}});
    assert(reqGeometry.left>=0 && reqGeometry.right<=reqGeometry.width && reqGeometry.bottom<=reqGeometry.height);
    await requirements.evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})))});
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await requirements.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/supplement-panel-'+width+'.png'});
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));
    assert.equal(await requirements.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(37, 43, 51)');
    assert.equal(await supplementField.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(45, 53, 64)');
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await requirements.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/supplement-panel-'+width+'-dark.png'});
    await page.evaluate(()=>document.documentElement.classList.remove('theme-dark'));
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/supplement-'+(mobile?'mobile':'desktop')+'.png'});
    await requirements.getByRole('button',{name:'保存补充',exact:true}).click();await requirements.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.draftTest.api.draft.draftConfig.generationBrief.requirements),'面向初学者，重点讲缓存场景');
    assert.equal(await page.evaluate(()=>window.draftTest.api.draft.bodyInstruction),'每章增加一个完整示例');
    assert.equal(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='generateAllDraftSections')),false,'saving a supplement must not rewrite existing body');
    await shell.getByRole('button',{name:'正文补充要求',exact:true}).click();assert.equal(await requirements.getByRole('textbox').inputValue(),'每章增加一个完整示例');
    await requirements.getByRole('textbox').fill('未保存的改动');await requirements.getByRole('button',{name:'关闭正文补充要求',exact:true}).click();
    await shell.getByRole('button',{name:'正文补充要求',exact:true}).click();assert.equal(await requirements.getByRole('textbox').inputValue(),'每章增加一个完整示例');
    await requirements.getByRole('textbox').fill('');await requirements.getByRole('button',{name:'保存补充',exact:true}).click();await requirements.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.draftTest.api.draft.bodyInstruction),'');
    assert.equal(await page.evaluate(()=>window.draftTest.api.draft.draftConfig.generationBrief.requirements),'面向初学者，重点讲缓存场景');
    if(!mobile){
      await shell.getByRole('button',{name:'目录管理',exact:true}).click();const manager=page.getByRole('dialog',{name:'目录管理',exact:true});
      await manager.getByRole('button',{name:'下移章节 认识 Redis',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.calls.some(c=>c.name==='updateNoteDraft' && c.args[1].sectionOrder));
      await manager.getByRole('button',{name:'删除章节 数据类型与常用命令',exact:true}).click();await manager.getByRole('button',{name:/数据类型与常用命令.*恢复/}).click();
      await manager.getByPlaceholder('添加一级章节').fill('合成新章节');await manager.getByRole('button',{name:'添加',exact:true}).click();
      await manager.getByRole('button',{name:'修改章节 合成新章节',exact:true}).click();await manager.getByRole('textbox',{name:'修改章节名称',exact:true}).fill('合成改名章节');await manager.getByRole('textbox',{name:'修改章节名称',exact:true}).press('Enter');await manager.getByRole('button',{name:'修改章节 合成改名章节',exact:true}).waitFor();
      await manager.getByRole('textbox',{name:'大纲调整要求',exact:true}).fill('只调整合成章节');
      await manager.getByRole('button',{name:'按要求重新规划',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'按新要求重做大纲？',exact:true});
      await confirmation.waitFor();assert.equal(await confirmation.evaluate(n=>getComputedStyle(n.parentElement).zIndex),'140');
      await confirmation.getByRole('button',{name:'保留正文',exact:true}).press('Escape');await confirmation.waitFor({state:'detached'});assert.equal(await manager.count(),1);
      await manager.locator('.nf-draft-close').click();
      await rows.filter({hasText:'认识 Redis'}).click();
    }
    await page.mouse.move(mobile?319:1439,mobile?799:999);await page.waitForTimeout(550);
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/noteflow-draft-soft-component-'+(mobile?'mobile':'desktop')+'.png'});
    await page.evaluate(()=>document.documentElement.classList.add('theme-dark'));await page.waitForTimeout(180);assert.equal((await measure()).background,'rgb(37, 43, 51)');
    assert.equal(await shell.locator('.nf-draft-chapter[aria-current]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(54, 63, 74)','Draft selection consumes the shared dark selected surface');
    if(process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR)await page.screenshot({path:process.env.NOTEFLOW_DRAFT_SCREENSHOT_DIR+'/noteflow-draft-soft-component-'+(mobile?'mobile':'desktop')+'-dark.png'});
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await shell.evaluate(n=>getComputedStyle(n).animationName),'none');
    await page.evaluate(()=>window.draftTest.api.show('assembled'));await shell.locator('.nf-draft-revision').waitFor();await page.waitForTimeout(50);
    await shell.locator('footer').getByRole('button',{name:'保存为笔记',exact:true}).click();
    const save=page.getByRole('dialog',{name:'保存为笔记',exact:true});await save.waitFor();
    const centered=await save.locator('.nf-draft-panel').evaluate(n=>{const r=n.getBoundingClientRect();return {width:r.width,x:r.x,y:r.y,offset:Math.abs((r.left+r.right)/2-innerWidth/2)}});assert.ok(centered.offset<1);assert.equal(centered.width,Math.min(460,width-32));
    await save.getByRole('textbox',{name:'笔记标题'}).fill('');assert.ok(await save.getByRole('button',{name:'确认保存',exact:true}).isDisabled());
    await save.getByRole('textbox',{name:'笔记标题'}).fill('离线保存验证');
    await page.evaluate(()=>window.draftTest.api.failNext='saveDraftToNotes');
    await save.getByRole('button',{name:'确认保存',exact:true}).click();await save.getByRole('alert').waitFor();
    assert.equal(await save.getByRole('textbox',{name:'笔记标题'}).inputValue(),'离线保存验证');
    assert.equal(await page.evaluate(()=>window.draftTest.api.context.stage),'assembled','save failure must not offer outline regeneration');
    await page.evaluate(()=>window.draftTest.api.holdNext='saveDraftToNotes');
    await save.getByRole('button',{name:'确认保存',exact:true}).click();
    await save.getByRole('button',{name:'正在保存…',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.draftTest.api.context.stage),'saving');
    assert.equal(await shell.locator('.nf-writing-label').textContent(),'正在保存为笔记');
    assert.ok(await save.getByRole('button',{name:'正在保存…',exact:true}).isDisabled());
    for(const action of ['stop','cancel']){
      await page.evaluate(action=>{const a=window.draftTest;a.slice.draftCommand={id:'during-save-'+action,action};a.api.render()},action);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>window.draftTest.api.context.stage),'saving','chat commands must not unlock an in-flight save');
      assert.ok(await save.getByRole('button',{name:'正在保存…',exact:true}).isDisabled());
    }
    await page.evaluate(()=>window.draftTest.api.release());await shell.waitFor({state:'detached'});
    assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='closeDraft' && c.outcome?.status==='resolved' && c.outcome.draftId==='synthetic-draft')));
    assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='saveDraftToNotes' && c.args[1].confirm===true && c.args[1].title==='离线保存验证')));
    await page.evaluate(()=>window.draftTest.api.show('generating'));await shell.getByRole('button',{name:'停止',exact:true}).waitFor();await shell.getByRole('button',{name:'停止',exact:true}).click();await page.waitForFunction(()=>window.draftTest.api.calls.some(c=>c.name==='stopAllDraftSections'));
    if(!mobile){
      await page.evaluate(()=>window.draftTest.api.failNext='generateAllDraftSections');await shell.getByRole('button',{name:'全部生成',exact:true}).click();await shell.getByRole('alert').waitFor();
      await shell.getByRole('button',{name:'全部生成',exact:true}).click();await shell.getByRole('button',{name:'停止生成',exact:true}).waitFor();await shell.getByRole('button',{name:'停止生成',exact:true}).click();
      await page.evaluate(()=>window.draftTest.api.failNext='cancelNoteDraft');
      const discard=async()=>{await shell.getByRole('button',{name:'更多草稿操作',exact:true}).click();await shell.getByRole('button',{name:'放弃草稿',exact:true}).click();await page.getByRole('dialog',{name:'退出当前 AI 草稿？',exact:true}).getByRole('button',{name:'退出',exact:true}).click()};
      await discard();await shell.getByRole('alert').waitFor();
      assert.equal(await shell.isVisible(),true,'failed discard keeps the draft available');
      assert.notEqual(await page.evaluate(()=>window.draftTest.api.context.stage),'failed');
      await discard();await shell.waitFor({state:'detached'});
      assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='closeDraft' && c.outcome?.status==='cancelled')));
      await page.evaluate(()=>window.draftTest.api.show('outline_ready'));await shell.waitFor();
    }
    await shell.locator('.nf-draft-close').click();await shell.waitFor({state:'detached'});assert.ok(await page.evaluate(()=>window.draftTest.api.calls.some(c=>c.name==='dismissDraftWorkspace')));
    reports.push({width,mobile,initial,alignment,centered,compactHeader:true,sharedReadingColumn:true,footerSingleDesktopRow:true,directoryByOutline:true,manualEditRemoved:true,confirmation:!mobile,directoryCRUD:!mobile,failureRetry:!mobile,dismissReopenPreservesInput:true,saveFailureRetry:true,savingDistinct:true,discardFailureRetry:!mobile,terminalOutcome:true,saveMock:true,stopMock:true,dark:true,reducedMotion:true});await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({ok:true,offlineProductionComponent:true,syntheticServices:true,networkBlocked:true,reports,errors},null,2));
}finally{await browser.close()}
