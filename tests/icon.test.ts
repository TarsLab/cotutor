/** 主屏幕图标与 manifest:iPad「添加到主屏幕」用的两样——PNG 现画(尺寸 / 签名 / 像素对得上)、清单是 standalone。 */
import { inflateSync } from 'node:zlib';
import { createMock } from '../src/server/mock.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../src/lib/icon.ts';
import { check, done } from './_check.ts';

/** 极简 PNG 解码:只认本模块写出来的那种(8 位真彩、filter 0) */
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
  const png = appIconPng(180);
  const img = decode(png);
  check('180 见方', img.w === 180 && img.h === 180);
  const near = (a: [number, number, number], b: [number, number, number]) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
  check('四角是橙底(--accent)', near(img.at(2, 2), [0xe8, 0x74, 0x3b]) && near(img.at(177, 177), [0xe8, 0x74, 0x3b]), img.at(2, 2).join());
  check('中间偏上是纸色面板(--card)', near(img.at(90, 72), [0xff, 0xfd, 0xf8]), img.at(90, 72).join());
  check('第二条讲稿线是墨色(--ink)', near(img.at(90, 90), [0x2b, 0x2b, 0x2b]), img.at(90, 90).join());
  check('圆角抗锯齿:边上有中间色', (() => {
    for (let y = 25; y < 40; y++) {
      const [r, g, b] = img.at(28, y);
      if (!near([r, g, b], [0xe8, 0x74, 0x3b]) && !near([r, g, b], [0xff, 0xfd, 0xf8])) return true;
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
  for (const href of ['/manifest.webmanifest', '/icon-180.png', '/icon-192.png']) {
    check(`页面引了 ${href}`, page.includes(`href="${href}"`));
    const r = await mock.route('GET', href);
    check(`${href} 给得出`, r.status === 200, JSON.stringify(r.status));
    if (href.endsWith('.png')) check(`${href} 是 PNG`, r.contentType === 'image/png' && Buffer.from(r.body!).subarray(1, 4).toString('ascii') === 'PNG');
    else check('清单的 content-type', (r.contentType ?? '').startsWith('application/manifest+json'));
  }
  check('没登记的尺寸 404', (await mock.route('GET', '/icon-64.png')).status === 404);
  check('尺寸表就这三个', ICON_SIZES.join() === '180,192,512');
}

done();
