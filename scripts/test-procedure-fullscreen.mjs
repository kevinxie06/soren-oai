import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const route of ['showcase','suturing']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:3002/${route}`);
  await page.locator('canvas').waitFor();
  for(const mode of ['Surgical rendering','Simulation geometry','Original simulation']){
   await page.getByRole('button',{name:mode,exact:true}).click();
   await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();
   await page.waitForFunction(()=>document.fullscreenElement?.hasAttribute('data-procedure-player'));
   await page.getByRole('button',{name:'Exit fullscreen',exact:true}).waitFor();
   assert.ok(await page.getByRole('slider',{name:'Playback position'}).isVisible());
   const bounds=await page.locator('[data-procedure-player]').boundingBox();
   assert.ok(bounds.height>=890);
   await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
   await page.waitForFunction(()=>!document.fullscreenElement);
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${route}: enter/exit fullscreen in all 3 modes, playback controls retained`);
  await page.close();
 }
}finally{await browser.close();}
