import assert from 'node:assert/strict';
import { build } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.NOTEFLOW_PLAYWRIGHT_MODULE || 'playwright');
const component = fileURLToPath(new URL('../src/components/MemoryConsole.tsx', import.meta.url));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import MemoryConsole from ${JSON.stringify(component)};
let version=1,mission='只记住用户长期学习偏好。';window.requests=[];window.changed=0;
window.fetch=async(input,init={})=>{const p=String(input).replace('/api/memory-console','');window.requests.push({path:p,method:init.method||'GET'});let body={};
if(!p)body={engine:'hindsight',mission,ruleVersion:version,history:[{version:0,mission:'旧规则'}],jobs:[{id:'j',status:'succeeded'}]};
else if(p==='/preview')body={facts:['用户希望通俗解释 Go。']};
else if(p==='/rules'){version++;mission=JSON.parse(init.body).mission;body={version};}
else if(p==='/graph')body={nodes:[{id:'m1',text:'用户学习 Go',document_id:'s1'},{id:'m2',text:'用户喜欢通俗解释',document_id:'s1'}],edges:[{source:'m1',target:'m2',linkType:'semantic'}]};
else if(p==='/source/s1')body={ruleVersion:1,createdAt:'2026-10-31',document:{original_text:'我刚开始学习 Go，希望通俗解释。'}};
else if(p==='/legacy')body={memories:[{id:'old',content:'用户喜欢例子',suggested:true,status:'active'}]};
else if(p==='/import')body={submitted:1};
return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});};
createRoot(document.getElementById('root')).render(React.createElement(MemoryConsole,{onChange(){window.changed++;}}));`;
const result = await build({ configFile:false,logLevel:'silent',plugins:[{name:'entry',resolveId(id){if(id==='virtual:entry')return '\0entry';},load(id){if(id==='\0entry')return entry;}}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:entry',output:{codeSplitting:false}}}});
const js=result.output.filter(i=>i.type==='chunk').map(i=>i.code).join('\n').replaceAll('</script','<\\/script');
const assetDir=new URL('../dist/assets/',import.meta.url);
const css=readdirSync(assetDir).filter(n=>/^index-.*\.css$/.test(n)).map(n=>readFileSync(new URL(n,assetDir),'utf8')).join('\n')+'\n'+result.output.filter(i=>i.type==='asset'&&i.fileName.endsWith('.css')).map(i=>i.source).join('\n');
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE||undefined,headless:true});
const output=mkdtempSync(join(tmpdir(),'noteflow-memory-console-'));
try{
 for(const width of [736,320]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<style>${css}body{margin:20px;font:14px system-ui;color:#37352f}textarea{box-sizing:border-box}#root{max-width:640px;margin:auto}</style><div id="root" class="nf-settings-system"></div><script type="module">${js}</script>`);
  await page.getByText('自建记忆库 · Hindsight').waitFor();
  await page.getByText('记忆规则',{exact:false}).first().click();
  await page.getByLabel('记忆抽取规则').fill('只记住长期目标和偏好。');
  await page.getByRole('button',{name:'试运行',exact:true}).click();
  await page.getByText('用户希望通俗解释 Go。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保存规则',exact:true}).click();
  await page.getByText('规则已更新，仅影响新内容。').waitFor();
  await page.getByLabel('恢复历史记忆规则').selectOption('0');
  assert.equal(await page.getByLabel('记忆抽取规则').inputValue(),'旧规则');
  await page.getByText('记忆关系',{exact:true}).click();
  await page.getByRole('button',{name:'用户学习 Go',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByText('查看来源',{exact:true}).click();
  await page.getByText('我刚开始学习 Go，希望通俗解释。',{exact:true}).waitFor();
  await page.getByText('原有记忆 · 导入预览',{exact:true}).click();
  await page.getByRole('button',{name:'导入所选 1 条'}).click();
  await page.getByText('已提交 1 条整理，请刷新处理状态。').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(output,`${width}.png`),fullPage:true});
  await page.close();
 }
 console.log(JSON.stringify({ok:true,widths:[736,320],rules:true,preview:true,history:true,graphKeyboard:true,provenance:true,import:true,syntheticOnly:true,output}));
}finally{await browser.close();}
