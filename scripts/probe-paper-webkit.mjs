#!/usr/bin/env node
/**
 * 在 WebKit 的桌面和 iPad 尺寸样张上量压纸后的像素。样张位于屏幕中段，能检出滤镜误用屏幕坐标的问题。
 * PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-paper-webkit.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { VOICE_GALLERY_PAGE } from '../src/ui/dev/voice-gallery-page.ts';

const playwrightRoot = process.env.PLAYWRIGHT_CORE;
if (!playwrightRoot) throw Error('请设置 PLAYWRIGHT_CORE 为含 node_modules/playwright-core 的目录');
const { webkit } = createRequire(import.meta.url)(join(playwrightRoot, 'node_modules/playwright-core'));
const browser = await webkit.launch();
try {
  for (const viewport of [{ width: 744, height: 1047 }, { width: 1047, height: 744 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.setContent(VOICE_GALLERY_PAGE);
    const avatar = page.locator('#teacher .vb-av'), paper = page.locator('#paper');
    const bounds = await paper.boundingBox();
    const rows = await paper.evaluate(el => {
      const paper = el.getBoundingClientRect(), face = document.querySelector('#teacher .vb-av').getBoundingClientRect();
      const cy = face.y + face.height / 2 - paper.y;
      const rows = [-.28, -.10, 0, .10, .28].map(d => Math.round(cy + d * paper.height));
      el.replaceChildren();
      el.style.background = 'white';
      for (const y of rows) {
        const line = document.createElement('div');
        line.style.cssText = 'position:absolute;inset-inline:0;height:2px;background:black;top:' + y + 'px';
        el.append(line);
      }
      return rows;
    });
    const readRows = async (columns) => {
      const png = await page.screenshot({ clip: bounds });
      return page.evaluate(async ({ rows, png, columns }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + png;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return columns.map(fraction => {
          const strip = ctx.getImageData(Math.floor(img.width * fraction), 0, 1, img.height).data;
          return rows.map(row => {
            const ys = [];
            for (let y = row - 10; y <= row + 24; y++) if (strip[4 * y] < 128) ys.push(y);
            if (!ys.length) throw Error('找不到第 ' + row + ' 行标线');
            return (ys[0] + ys.at(-1)) / 2;
          });
        });
      }, { rows, png: png.toString('base64'), columns });
    };
    for (const right of [false, true]) {
      await page.locator('#mirror').setChecked(right);
      const face = await avatar.boundingBox(), cx = face.x + face.width / 2;
      const origin = (cx - bounds.x) / bounds.width;
      const columns = [.20, .45, .70, .85, 1, 1.15].map(t => origin + (.5 - origin) * t);
      const flat = await readRows(columns);
      let previous;
      for (const fraction of [.18, .82]) {
        await page.mouse.move(face.x + face.width * fraction, face.y + face.height * fraction);
        await page.mouse.down();
        await page.waitForTimeout(180); // 等长按进入说话态。
        const bent = await readRows(columns);
        const shift = bent.map((column, x) => column.map((y, i) => y - flat[x][i]));
        const [near, slope, shoulder, crest, middle, beyond] = shift.map(column => column[2]);
        assert(near > slope && slope > shoulder && shoulder >= crest && near >= 12, '从谷底向峰顶逐渐回升: ' + shift);
        assert(shift[0][1] >= 3 && shift[0][3] >= 3, '指下的上下两侧都应下沉: ' + shift[0]);
        assert(Math.abs(crest) <= 1 && middle === 0 && beyond === 0, '页中线附近应宽平: ' + shift);
        assert(shift.every(col => col[0] === 0 && col[4] === 0), '竖向半页以外应平整');
        assert.equal((await page.locator('#teacher').innerText()).trim(), '松手发送');
        if (previous) assert.deepEqual(shift, previous, '按头像上下缘的谷底位置应一致');
        previous = shift;
        await page.mouse.move(cx, face.y - 120);
        await page.mouse.up();
        assert.deepEqual(await readRows(columns), flat, '松手后每条线都要回到原位');
      }
    }
    const scene = page.locator('#scene');
    for (const name of ['按着在说', '老师在想', '在看你的图片', '孩子在说']) {
      const option = scene.locator('option').filter({ hasText: name }).first();
      await scene.selectOption(await option.getAttribute('value'));
      const themed = await avatar.evaluate(el => {
        const face = el.querySelector('.av'), ring = face.querySelector('.ring circle');
        face.style.color = '#6845ad';
        return getComputedStyle(ring).stroke === getComputedStyle(face).color;
      });
      assert(themed, name + '的 C 环应跟随老师的自定义色');
    }
    console.log(viewport.width + '×' + viewport.height + ' 左右手、上下两侧位移通过');
    await page.close();
  }
} finally {
  await browser.close();
}
