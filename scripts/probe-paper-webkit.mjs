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
    const readRows = async (fraction) => {
      const png = await page.screenshot({ clip: bounds });
      return page.evaluate(async ({ rows, png, fraction }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + png;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const strip = ctx.getImageData(Math.floor(img.width * fraction), 0, 1, img.height).data;
        return rows.map(row => {
          const ys = [];
          for (let y = row - 22; y <= row + 10; y++) if (strip[4 * y] < 128) ys.push(y);
          if (!ys.length) throw Error('找不到第 ' + row + ' 行标线');
          return (ys[0] + ys.at(-1)) / 2;
        });
      }, { rows, png: png.toString('base64'), fraction });
    };
    for (const right of [false, true]) {
      await page.locator('#mirror').setChecked(right);
      const ridge = right ? .57 : .43, outside = right ? .47 : .53;
      const flat = await readRows(ridge), otherHalf = await readRows(outside);
      const face = await avatar.boundingBox(), cx = face.x + face.width / 2;
      let previous;
      for (const fraction of [.18, .82]) {
        await page.mouse.move(face.x + face.width * fraction, face.y + face.height * fraction);
        await page.mouse.down();
        await page.waitForTimeout(180); // 等长按进入说话态。
        const shift = (await readRows(ridge)).map((y, i) => y - flat[i]);
        assert(shift.slice(1, 4).every(d => d <= -4), '压痕内三条线都应上移: ' + shift);
        // SVG 按目标像素反查位移；同样远的两行上移后，分别远离、接近峰顶。
        assert(Math.min(-shift[1], -shift[3]) >= .65 * Math.max(-shift[1], -shift[3]), '上下两侧都应有同量级的弯曲: ' + shift);
        assert(shift[0] === 0 && shift[4] === 0, '上下超过四分之一页高应平整: ' + shift);
        assert.deepEqual(await readRows(outside), otherHalf, '中线以外的半页应平整');
        assert.equal((await page.locator('#teacher').innerText()).trim(), '松手发送');
        if (previous) assert.deepEqual(shift, previous, '按头像上下缘的谷底位置应一致');
        previous = shift;
        await page.mouse.move(cx, face.y - 120);
        await page.mouse.up();
        assert.deepEqual(await readRows(ridge), flat, '松手后每条线都要回到原位');
      }
    }
    console.log(viewport.width + '×' + viewport.height + ' 左右手、上下两侧位移通过');
    await page.close();
  }
} finally {
  await browser.close();
}
