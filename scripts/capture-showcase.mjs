import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  page.setDefaultTimeout(90000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.SHOWCASE_URL || 'http://127.0.0.1:3002/showcase');
  await page.locator('.motion-canvas[data-scene-ready="true"]').waitFor();
  await mkdir('artifacts/showcase', {recursive:true});
  for (const [name, button] of [['desktop','Room view'], ['patient','Patient'], ['operative','Operative field']]) {
    await page.getByRole('button', {name:button, exact:true}).click();
    await page.waitForTimeout(800);
    await page.screenshot({path:`artifacts/showcase/${name}.png`, fullPage:true});
    console.log(`Captured ${name}`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
