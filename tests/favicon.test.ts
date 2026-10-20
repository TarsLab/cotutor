/**
 * 网页图标:所有页面都是 cotutor 的双 C(《产品规划.md》拍板 20、23)——logo 的几何(logo.ts)、SVG 与页面里的 logo 同一份、
 * PNG 现画(两个 C 的颜色在该在的地方、纸色圆底、圆外透明)、页面引的与路由给的对得上、哪一页都不再跟着老师换图标(mock 与真服务)。
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-favicon-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { faviconLinks, faviconPng, faviconSvg } = await import('../src/lib/favicon.ts');
const { LOGO_BIG, LOGO_CLAY, LOGO_INK, LOGO_PAPER, LOGO_SMALL, logoBody, logoGeom, logoHit, ringDash } = await import('../src/lib/logo.ts');
const { brandLogo } = await import('../src/server/brand.ts');
const { createMock } = await import('../src/server/mock.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

/** 只认 encodePng 写的 RGBA(filter 0) */
function rgba(png: Buffer): { n: number; at: (x: number, y: number) => number[] } {
  check('PNG 签名、带 alpha', png.subarray(1, 4).toString('ascii') === 'PNG' && png[25] === 6);
  const n = png.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let off = 8; off < png.length; ) {
    const len = png.readUInt32BE(off);
    if (png.toString('ascii', off + 4, off + 8) === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return { n, at: (x, y) => [...raw.subarray(y * (n * 4 + 1) + 1 + x * 4, y * (n * 4 + 1) + 1 + x * 4 + 4)] };
}
const hex = (c: number[]) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

// ---- logo 的几何(100 见方,开口朝右 72°) ----
{
  check('描 80% 留 20%', ringDash(40) === '201.06 251.33');
  check('24 px 以下用加粗那一档,大号小 C 侧头', logoGeom(24) === LOGO_SMALL && logoGeom(25) === LOGO_BIG && LOGO_BIG.tilt === 28 && LOGO_SMALL.tilt === 0);
  check('大 C:上、左、下都在环上', logoHit(50, 10, LOGO_SMALL) === 'out' && logoHit(10, 50, LOGO_SMALL) === 'out' && logoHit(50, 90, LOGO_SMALL) === 'out');
  check('大 C 右边是开口', logoHit(90, 50, LOGO_SMALL) === null);
  check('开口两端是圆头', logoHit(50 + 40 * Math.cos(Math.PI / 5) + 5, 50 + 40 * Math.sin(Math.PI / 5), LOGO_SMALL) === 'out');
  check('小 C:上、左在环上,右边开口,圆心空着', logoHit(50, 33, LOGO_SMALL) === 'in' && logoHit(33, 50, LOGO_SMALL) === 'in' && logoHit(67, 50, LOGO_SMALL) === null && logoHit(50, 50, LOGO_SMALL) === null);
  // 侧头 28°:开口转到右下,正右边那点落回环上
  check('大号小 C 侧头:开口转到右下', logoHit(50 + 19 * Math.cos((28 * Math.PI) / 180), 50 + 19 * Math.sin((28 * Math.PI) / 180), LOGO_BIG) === null && logoHit(50, 31, LOGO_BIG) === 'in');
}

// ---- SVG:与页面里的 logo 同一份几何 ----
{
  const s = faviconSvg();
  check('SVG:纸色圆底 + 加粗那一档的两个 C(墨色、陶土色)', s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.includes(`r="50" fill="${LOGO_PAPER}"`) && s.includes(logoBody(LOGO_SMALL, { outer: LOGO_INK, inner: LOGO_CLAY })) && s.endsWith('</svg>'));
  check('页面里 16 px 的 logo 是同一份几何', brandLogo({ size: 16, outer: LOGO_INK, inner: LOGO_CLAY }).includes(logoBody(LOGO_SMALL, { outer: LOGO_INK, inner: LOGO_CLAY })));
  check('没有字、没有图', !s.includes('<text') && !s.includes('<image'));
}

// ---- PNG(Safari 这些不认 SVG 的):纸色圆底,圆外透明 ----
{
  const png = faviconPng();
  const img = rgba(png);
  // 100 见方 → 32 px;两个 C 缩到 0.86
  const at = (u: number, v: number) => img.at(Math.floor((u / 100) * 32), Math.floor((v / 100) * 32));
  const k = 0.86;
  check('32 见方', img.n === 32);
  check('上面、左边是墨色的大 C', hex(at(50, 50 - 40 * k)) === LOGO_INK.toLowerCase() && hex(at(50 - 40 * k, 50)) === LOGO_INK.toLowerCase(), hex(at(50, 50 - 40 * k)));
  check('里面是陶土色的小 C', hex(at(50, 50 - 17 * k)) === LOGO_CLAY.toLowerCase(), hex(at(50, 50 - 17 * k)));
  check('圆心是纸色、不透明', hex(at(50, 50)) === LOGO_PAPER.toLowerCase() && at(50, 50)[3] === 255);
  check('右边开口是纸色', hex(at(50 + 40 * k, 50)) === LOGO_PAPER.toLowerCase() && at(50 + 40 * k, 50)[3] === 255);
  check('圆外透明', img.at(0, 0)[3] === 0 && img.at(31, 31)[3] === 0);
  check('走缓存', faviconPng() === png);
}

// ---- 页面引的两行 ----
check('两行:PNG 带 sizes 在前,SVG 在后', faviconLinks() === '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">');

// ---- mock:页面引了、不跟着老师换、路由给得出 ----
{
  const mock = createMock({ delayMs: 0 });
  // mock 没有口语课;/talk 在下面真服务那段
  for (const path of ['/', '/parent', '/dictation', '/dictation?lang=en']) {
    const html = (await mock.route('GET', path)).html ?? '';
    check(`${path} 引了网页图标`, html.includes(faviconLinks()), path);
    check(`${path} 不跟着老师换图标`, !html.includes('setFavicon') && !html.includes('favicon.svg?') && !html.includes('favicon-32.png?'), path);
  }
  const svg = await mock.route('GET', '/favicon.svg');
  check('/favicon.svg 是双 C、no-cache', svg.status === 200 && (svg.contentType ?? '').startsWith('image/svg+xml') && Buffer.from(svg.body!).toString() === faviconSvg() && svg.cacheControl === 'no-cache');
  check('带 ?tutor= 也是同一个', Buffer.from((await mock.route('GET', '/favicon.svg?tutor=math-tutor')).body!).toString() === faviconSvg());
  for (const path of ['/favicon-32.png', '/favicon.ico']) {
    const r = await mock.route('GET', path);
    check(`${path} 是 PNG`, r.status === 200 && r.contentType === 'image/png' && Buffer.from(r.body!).subarray(1, 4).toString('ascii') === 'PNG');
  }
}

// ---- 真服务 ----
{
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const svg = await route('GET', '/favicon.svg', ctx);
  check('真服务:双 C', Buffer.from(svg.body!).toString() === faviconSvg());
  const png = await route('GET', '/favicon-32.png', ctx);
  check('真服务:PNG、no-cache', png.status === 200 && png.contentType === 'image/png' && png.cacheControl === 'no-cache');
  for (const path of ['/', '/parent', '/parent/home', '/dev', '/talk', '/dictation']) {
    const html = (await route('GET', path, ctx)).html ?? '';
    check(`真服务:${path} 引了、不跟着老师换`, html.includes(faviconLinks()) && !html.includes('setFavicon'), path);
  }
}

done();
