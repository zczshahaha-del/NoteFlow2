import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const dir=path.dirname(fileURLToPath(import.meta.url));
assert(process.env.NOTEFLOW_VISUALIZE_RENDERER && process.env.NOTEFLOW_PLAYWRIGHT_MODULE);
const output=await mkdtemp(path.join(tmpdir(),'noteflow-draft-brief-'));
const html=path.join(output,'review.html');
const render=spawnSync('python3',[process.env.NOTEFLOW_VISUALIZE_RENDERER,path.join(dir,'noteflow-draft-brief.source.html'),html],{encoding:'utf8'});
assert.equal(render.status,0,render.stderr);
const {chromium}=await import(pathToFileURL(process.env.NOTEFLOW_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true,executablePath:process.env.NOTEFLOW_BROWSER_EXECUTABLE});
const results=[];
try {
  for(const width of [736,320]){
    const context=await browser.newContext({viewport:{width,height:1400},deviceScaleFactor:2,hasTouch:width===320,colorScheme:'light'});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://**',route=>route.abort());await page.route('https://**',route=>route.abort());
    await page.goto(pathToFileURL(html).href);
    const frame=page.frameLocator('iframe');
    for(const [design,label] of [['paper','轻纸一体'],['soft','柔和分区']]){
      if(design==='soft') {await frame.locator('.viz-carousel-picker summary').click();await frame.locator('.viz-carousel-options').getByRole('button',{name:label,exact:true}).click();}
      const stage=frame.locator(`[data-design="${design}"]`);
      const title=stage.getByRole('textbox',{name:'标题',exact:true});
      const requirements=stage.getByRole('textbox',{name:'要求',exact:true});
      const action=stage.locator('.nfb-action');
      await title.waitFor({state:'visible'});
      assert.equal(await title.inputValue(),'《两小儿辩日》教案');assert.equal(await requirements.inputValue(),'');
      assert.equal(await stage.locator('.nfb-fields').getByText('拟定结构').count(),0);
      await stage.screenshot({path:path.join(output,`${design}-${width}.png`)});
      await title.fill('');await action.click();assert(await stage.getByRole('alert').isVisible());
      await title.fill('《两小儿辩日》课堂教案');
      await title.press('Enter');assert(await requirements.evaluate(el=>el===document.activeElement));
      await requirements.fill('突出课堂提问与学生讨论，不需要代码。');await action.click();
      assert.equal(await stage.locator('.nfb-outline-title').textContent(),'《两小儿辩日》课堂教案');
      assert.equal(await stage.locator('.nfb-outline-requirements').textContent(),'突出课堂提问与学生讨论，不需要代码。');
      await requirements.fill('增加板书设计。');
      assert(await stage.locator('.nfb-changed').isVisible());
      assert.equal(await stage.locator('.nfb-outline-requirements').textContent(),'突出课堂提问与学生讨论，不需要代码。');
      await action.click();await stage.locator('.nfb-outline-requirements').filter({hasText:/^增加板书设计。$/}).waitFor({state:'visible'});assert.equal(await stage.locator('.nfb-outline-requirements').textContent(),'增加板书设计。');
      await action.click();assert(!(await stage.locator('.nfb-outline').isVisible()));await action.click();assert(await stage.locator('.nfb-outline').isVisible());
      await requirements.fill('较长的要求，保留段落与可编辑内容。\n'.repeat(15));
      const geometry=await stage.evaluate(el=>{
        const textarea=el.querySelector('textarea');const button=el.querySelector('button');const field=el.querySelector('input');
        return {fits:el.scrollWidth<=el.clientWidth,height:button.getBoundingClientRect().height,textSize:parseFloat(getComputedStyle(textarea).fontSize),noInnerScroll:textarea.scrollHeight<=textarea.clientHeight+2,inputWidth:field.getBoundingClientRect().width};
      });
      assert(geometry.fits && geometry.noInnerScroll && geometry.inputWidth>100,JSON.stringify(geometry));if(width===320)assert(geometry.height>=44 && geometry.textSize>=16);
      await requirements.fill('');await title.fill('《两小儿辩日》教案');await action.click();await action.click();
      await stage.locator('.nfb-response').click();
      await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
      await stage.screenshot({path:path.join(output,`${design}-dark-${width}.png`)});
      await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
      results.push({width,design,emptyGuard:true,twoEditableFields:true,requestSnapshot:true,oldOutlineProtected:true,longRequirements:true,darkReducedMotion:true,...geometry});
    }
    assert.deepEqual(errors,[]);await context.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify({output,results,realNetwork:false,productChanges:false},null,2));
