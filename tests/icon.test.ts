/** 主屏幕图标与 manifest:iPad「添加到主屏幕」用的两样——PNG 现画(尺寸 / 签名 / 双 C 的像素对得上)、清单是 standalone。 */
import { inflateSync } from 'node:zlib';
import { createMock } from '../src/app/mock/mock.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../src/ui/shared/icon.ts';
import { LOGO_CLAY } from '../src/ui/shared/logo.ts';
import { check, done } from './_check.ts';

/** 极简 PNG 解码:只认本模块写出来的那种(8 位真彩、filter 0) */
const hex = (h: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];

function decode(png: Buffer): { w: number; h: number; at: (x: number, y: number) => [number, number, number] } {
  check('PNG 签名', png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');
  check('IHDR 在第一块', png.subarray(12, 16).toString('ascii') === 'IHDR');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  check('8 位真彩无 alpha', png[24] === 8 && png[25] === 2);
  let off = 8;
  const idat: Buffer[] = [];
  let sawEnd = false;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('ascii');
    const data = png.subarray(off + 8, off + 8 + len);
    // 每块的 CRC 都得对
    const crc = png.readUInt32BE(off + 8 + len);
    check(`${type} 的 CRC`, crc === crc32(png.subarray(off + 4, off + 8 + len)));
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = true;
    off += len + 12;
  }
  check('有 IEND 且没有多余字节', sawEnd && off === png.length);
  const raw = inflateSync(Buffer.concat(idat));
  check('像素数据的长度', raw.length === h * (w * 3 + 1), `${raw.length}`);
  return {
    w,
    h,
    at: (x, y) => {
      const k = y * (w * 3 + 1) + 1 + x * 3;
      check('每行 filter 都是 0', raw[y * (w * 3 + 1)] === 0);
      return [raw[k], raw[k + 1], raw[k + 2]];
    },
  };
}

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ -1) >>> 0;
}

{
  // 双 C:陶土色底、白线,两个 C 占 100 见方画布的 0.62,大号那一档(小 C 侧头 28°)
  const png = appIconPng(180);
  const img = decode(png);
  check('180 见方', img.w === 180 && img.h === 180);
  const near = (a: [number, number, number], b: [number, number, number]) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  const clay = hex(LOGO_CLAY);
  const white: [number, number, number] = [255, 255, 255];
  const soft = clay.map((v) => Math.round(v + (255 - v) * 0.75)) as [number, number, number];
  // 100 见方的坐标 → 像素(两个 C 缩到 0.62,围着中心)
  const at = (u: number, v: number) => img.at(Math.floor((50 + (u - 50) * 0.62) * 1.8), Math.floor((50 + (v - 50) * 0.62) * 1.8));
  const deg = (a: number, r: number): [number, number] => [50 + r * Math.cos((a * Math.PI) / 180), 50 + r * Math.sin((a * Math.PI) / 180)];
  check('四角是陶土色', near(img.at(2, 2), clay) && near(img.at(177, 177), clay), img.at(2, 2).join());
  check('中间是陶土色', near(at(50, 50), clay), at(50, 50).join());
  check('上面、左边是白的大 C', near(at(50, 10), white) && near(at(10, 50), white), at(50, 10).join());
  check('右边开口是陶土色', near(at(90, 50), clay), at(90, 50).join());
  check('小 C 淡一档的白', near(at(50, 31), soft), at(50, 31).join());
  check('小 C 侧头 28°:开口在右下', near(at(...deg(28, 19)), clay) && near(at(...deg(0, 19)), soft), at(...deg(28, 19)).join());
  check('抗锯齿:环边上有中间色', (() => {
    for (let y = 0; y < 90; y++) {
      const c = img.at(90, y);
      if (!near(c, clay) && !near(c, white)) return true;
    }
    return false;
  })());
  check('同一尺寸走缓存(同一个 buffer)', appIconPng(180) === png);
  check('512 也画得出来', decode(appIconPng(512)).w === 512);
  check('尺寸有上下限', decode(appIconPng(4)).w === 16 && decode(appIconPng(9999)).w === 1024);
}

{
  const m = webManifest('小明的老师们');
  check('清单是 standalone、从首页起', m.display === 'standalone' && m.start_url === '/' && m.scope === '/');
  check('名字用标题', m.name === '小明的老师们' && m.short_name === '小明的老师们');
  check('标题空了兜底', webManifest('  ').name === 'cotutor');
  check('图标列 192 / 512(180 是 apple-touch-icon,不进清单)', JSON.stringify(m.icons) === JSON.stringify([{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }]));
}

{
  // 页面 + 路由:meta / link 指到哪,哪就得给得出东西
  const mock = createMock({ delayMs: 0 });
  const page = (await mock.route('GET', '/')).html ?? '';
  check('页面没留占位符', !page.includes('__TITLE__') && !page.includes('__SHORT__'));
  check('主屏幕三件套 meta 都在', page.includes('name="apple-mobile-web-app-capable" content="yes"') && page.includes('apple-mobile-web-app-status-bar-style') && page.includes('name="apple-mobile-web-app-title" content="小明的老师们"'));
  // 页面只引清单;主屏幕图标从清单里取。不写 apple-touch-icon:Safari 标签有它就不用网页图标(见 favicon.test)
  check('页面没有 apple-touch-icon', !page.includes('apple-touch-icon'));
  for (const href of ['/manifest.webmanifest', '/icon-180.png', '/icon-192.png']) {
    if (href === '/manifest.webmanifest') check(`页面引了 ${href}`, page.includes(`href="${href}"`));
    const r = await mock.route('GET', href);
    check(`${href} 给得出`, r.status === 200, JSON.stringify(r.status));
    if (href.endsWith('.png')) check(`${href} 是 PNG`, r.contentType === 'image/png' && Buffer.from(r.body!).subarray(1, 4).toString('ascii') === 'PNG');
    else check('清单的 content-type', (r.contentType ?? '').startsWith('application/manifest+json'));
  }
  check('没登记的尺寸 404', (await mock.route('GET', '/icon-64.png')).status === 404);
  check('尺寸表就这三个', ICON_SIZES.join() === '180,192,512');
}

done();
