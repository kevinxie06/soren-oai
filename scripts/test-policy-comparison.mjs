import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  page.setDefaultTimeout(90000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await mkdir('artifacts/comparison/screenshots',{recursive:true});
  for (const [task,route,render] of [['heart','showcase','Surgical rendering'],['stitch','suturing','Surgical rendering']]) {
    if (process.argv[2] && process.argv[2] !== task) continue;
    await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:3002'}/${route}`);
    await page.getByRole('button',{name:'Simulation geometry',exact:true}).click();
    await page.getByRole('button',{name:/^Current version.*20\/20/}).waitFor();
    const response = page.waitForResponse(r=>r.url().endsWith(`/motion/${task}-old.json`));
    await page.getByRole('button',{name:/^Old version/}).click();
    const old = await (await response).json();
    const slider=page.getByRole('slider');
    await page.waitForFunction(expected=>Number(document.querySelector('input[type=range]')?.max)===expected,old.duration_s);
    assert.equal(await slider.inputValue(),'0');
    assert.ok(!old.result.success);
    await page.locator(`a[download][href="/motion/${task}-old.json"]`).waitFor();
    await slider.focus(); await page.keyboard.press('End');
    if(task==='heart') {
      assert.match(await page.locator('.result-pill').innerText(),/failed/i);
      assert.match(await page.locator('.playback-note').innerText(),/Empty attempt complete/);
    }
    else {
      assert.match(await page.locator('.suture-result').innerText(),/failed.*donor overtravel/i);
      assert.ok(Number(await page.getByTestId('wound-gap').innerText().then(s=>s.replace('mm','')))>5);
    }
    await page.getByRole('button',{name:'Original simulation',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    assert.ok((await page.locator('video').getAttribute('src')).includes(`${task}-old.mp4`));
    await page.getByRole('button',{name:render,exact:true}).click();
    if(task==='heart') await page.locator('.motion-canvas[data-scene-ready="true"]').waitFor();
    else await page.getByTestId('room-status').filter({hasText:'Scanned patient'}).waitFor();
    await page.screenshot({path:`artifacts/comparison/screenshots/${task}-old.png`,fullPage:true});
    await page.getByRole('button',{name:'Simulation geometry',exact:true}).click();
    const currentResponse=page.waitForResponse(r=>r.url().endsWith(`/motion/${task}.json`));
    await page.getByRole('button',{name:/^Current version/}).click();
    const current=await (await currentResponse).json();
    await page.waitForFunction(expected=>Number(document.querySelector('input[type=range]')?.max)===expected,current.duration_s);
    assert.equal(await slider.inputValue(),'0'); assert.ok(current.result.success);
    await page.locator(`a[download][href="/motion/${task}.json"]`).waitFor();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:1440,height:1100});
    console.log(`${task}: old/current switch, outcomes, matching video/export, old robot rendering, restart and mobile passed.`);
  }
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
