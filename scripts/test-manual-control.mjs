import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const base = process.env.LAB_URL || 'http://127.0.0.1:3210';
const experiments = await (await fetch(base + '/api/lab/experiments')).json();
const experiment = experiments.find(e => e.plan?.scenarios.length === 16);
assert.ok(experiment, 'Generate an experiment before running this test');
const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(base + '/?experiment=' + experiment.id);
  await page.locator('.scenario-card').first().click();
  await page.getByRole('button', {name:'Open simulation',exact:true}).first().click();
  await page.getByRole('button', {name:/Manual operator control/}).click();
  const panel = page.locator('.manual-control');
  const update = panel.getByRole('button', {name:'Update from successful attempt'});
  assert.equal(await update.isDisabled(), true);
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/jobs'));
  await panel.getByRole('button', {name:'X plus',exact:true}).click();
  const queued = await (await response).json();
  await panel.getByRole('status').filter({hasText:'5 steps'}).waitFor();
  await page.waitForFunction(() => document.querySelector('.manual-control img')?.naturalWidth > 0);
  assert.equal(await update.isDisabled(), true);
  const rejected = await fetch(`${base}/api/lab/experiments/${experiment.id}/jobs`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'train',correction_job_id:queued.job_id}),
  });
  assert.equal(rejected.status,409);
  assert.match((await rejected.json()).error,/successful manual attempt/);
  await page.reload();
  await page.getByRole('button', {name:/Manual operator control/}).click();
  await panel.getByRole('button', {name:'Restore last attempt'}).click();
  await panel.getByRole('status').filter({hasText:'Last attempt restored'}).waitFor();
  await page.waitForFunction(() => document.querySelector('.manual-control img')?.naturalWidth > 0);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('Manual controls: native worker step, image, failure guard, restore, mobile passed.');
} finally { await browser.close(); }
