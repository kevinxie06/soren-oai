import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  for(const route of ['showcase','suturing']) {
    const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(60000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:3002/${route}`);
    await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.camera==='room');
    for(const [label,id] of [['Patient','patient'],['Operative field','field'],['Macro','macro'],['Overhead','overhead'],['Room view','room']]){
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(id=>document.querySelector('canvas')?.dataset.camera===id,id);
      assert.equal(await page.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
    }
    for(const mode of ['Pan','Orbit']) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      await page.waitForFunction(mode=>document.querySelector('canvas')?.dataset.navigation===mode,mode.toLowerCase());
    }
    assert.equal(await page.getByLabel('Playback speed').locator('option').count(),5);
    await page.getByRole('button',{name:'Simulation geometry',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.camera==='macro');
    assert.equal(await page.getByRole('button',{name:'Room view',exact:true}).count(),0);
    await page.getByRole('button',{name:'Overhead',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.camera==='overhead');
    await page.getByRole('button',{name:'Original simulation',exact:true}).click();
    assert.equal(await page.getByRole('group',{name:'Camera views',exact:true}).count(),0);
    await page.getByRole('button',{name:'Surgical rendering',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.camera==='room');
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const buttons=await page.locator('.procedure-camera-controls button').all();
    for(const button of buttons){const box=await button.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390);}
    assert.deepEqual(errors,[]);console.log(`PASS ${route}: camera presets, navigation, speeds, modes and mobile controls`);
    await page.close();
  }
} finally {await browser.close();}
