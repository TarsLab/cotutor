/** 网页图标:三色 C 与老师头像的 SVG、PNG 现画(环的颜色在该在的地方、开口透明)、头像图缩小内联、页面引的与路由给的对得上(mock 与真服务)。 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-favicon-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { HOME_RING, faviconLinks, faviconPng, homeFaviconSvg, shrinkPng, tutorFaviconSvg } = await import('../src/lib/favicon.ts');
const { encodePng } = await import('../src/lib/icon.ts');
const { SUBJECT_COLORS } = await import('../src/lib/tutor-color.ts');
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

// ---- SVG ----
{
  const s = homeFaviconSvg();
  check('三色 C:三门主科色,顺时针从下起英语、语文、数学', HOME_RING.join() === [SUBJECT_COLORS['英语'], SUBJECT_COLORS['语文'], SUBJECT_COLORS['数学']].join() && s.indexOf(HOME_RING[0]) < s.indexOf(HOME_RING[1]) && s.indexOf(HOME_RING[1]) < s.indexOf(HOME_RING[2]));
  check('三色 C 脸空着(没有字、没有图)', s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.endsWith('</svg>') && !s.includes('<text') && !s.includes('<image'));

  const emoji = tutorFaviconSvg({ color: '#2f6fd6', avatar: '🧮', subject: '数学', display: '数学老师' });
  check('emoji 头像画进脸里,环是老师的颜色', emoji.includes('>🧮</text>') && emoji.includes('stroke="#2f6fd6"') && !emoji.includes(SUBJECT_COLORS['语文']));
  check('头像是图片路径但没读到:退回学科首字', tutorFaviconSvg({ color: '#2f6fd6', avatar: 'avatars/x.png', subject: '数学' }).includes('>数</text>'));
  check('没写头像也没学科:名字首字', tutorFaviconSvg({ color: '#0f7a8a', display: '科学老师' }).includes('>科</text>'));
  check('多字头像只画第一个字形', tutorFaviconSvg({ color: '#0f7a8a', avatar: '👩‍🔬老师' }).includes('>👩‍🔬</text>'));
  check('字要转义', tutorFaviconSvg({ color: '#0f7a8a', avatar: '<' }).includes('>&lt;</text>'));
  check('颜色不像颜色就用中性色(不进属性)', !tutorFaviconSvg({ color: '"/><script>', avatar: 'x' }).includes('<script>'));

  // 头像图:figshot 出的是 512×512 RGBA PNG,缩到 64×64 再内联
  const big = Buffer.alloc(512 * 512 * 4);
  for (let i = 0; i < 512 * 512; i++) big.set([0xe8, 0x74, 0x3b, 255], i * 4);
  const bigPng = encodePng(512, big, 4);
  const small = shrinkPng(bigPng, 64);
  check('PNG 缩到 64×64、颜色不变', small !== null && rgba(small).n === 64 && hex(rgba(small).at(32, 32)) === '#e8743b');
  const withImg = tutorFaviconSvg({ color: '#2f6fd6', avatar: 'avatars/m.png', image: { data: bigPng, type: 'image/png' } });
  check('图片头像内联成 data URI,剪成圆', withImg.includes('href="data:image/png;base64,') && withImg.includes('clip-path="url(#f)"') && !withImg.includes('<text'));
  check('内联的是缩过的(小于 20 KB)', withImg.length < 20_000, String(withImg.length));
  check('解不了的 PNG:小的原样内联', tutorFaviconSvg({ color: '#2f6fd6', image: { data: Buffer.from('not a png'), type: 'image/png' } }).includes('href="data:image/png;base64,'));
  check('别的格式太大就不画,退回首字', tutorFaviconSvg({ color: '#2f6fd6', subject: '数学', image: { data: Buffer.alloc(60_000), type: 'image/jpeg' } }).includes('>数</text>'));
}

// ---- PNG(给不认 SVG 的浏览器):只有环与白底圆,透明底 ----
{
  const png = faviconPng(HOME_RING);
  const img = rgba(png);
  const at = (x: number, y: number) => img.at(Math.round((x / 64) * 32), Math.round((y / 64) * 32));
  check('32 见方', img.n === 32);
  check('中间是白底圆、不透明', hex(at(32, 32)) === '#ffffff' && at(32, 32)[3] === 255);
  check('上面一段是数学', hex(at(32, 6)) === SUBJECT_COLORS['数学'], hex(at(32, 6)));
  check('左边一段是语文', hex(at(6, 32)) === SUBJECT_COLORS['语文'], hex(at(6, 32)));
  check('下面一段是英语', hex(at(32, 58)) === SUBJECT_COLORS['英语'], hex(at(32, 58)));
  check('右边开口透明', at(60, 32)[3] === 0 && at(1, 1)[3] === 0);
  check('同样的颜色走缓存', faviconPng(HOME_RING) === png);
  const one = rgba(faviconPng(['#c43c74']));
  check('老师的 PNG:一种颜色的环', hex(one.at(16, 3)) === '#c43c74' && hex(one.at(3, 16)) === '#c43c74' && one.at(16, 16)[3] === 255);
}

// ---- 页面引的两行 ----
{
  check('缺省两行:PNG 带 sizes 在前,SVG 在后', faviconLinks() === '<link rel="icon" id="fav-png" href="/favicon-32.png" sizes="32x32" type="image/png">\n<link rel="icon" id="fav-svg" href="/favicon.svg" type="image/svg+xml">');
  check('老师的带 ?tutor=', faviconLinks('math-tutor').includes('href="/favicon.svg?tutor=math-tutor"'));
}

// ---- mock:页面引了、路由给得出 ----
{
  const mock = createMock({ delayMs: 0 });
  for (const path of ['/', '/parent', '/dictation']) {
    const html = (await mock.route('GET', path)).html ?? '';
    check(`${path} 引了网页图标`, html.includes(faviconLinks()), path);
  }
  const kid = (await mock.route('GET', '/')).html ?? '';
  check('孩子端进老师 / 回首页换图标', kid.includes('const setFavicon') && kid.includes('unlock(); setFavicon(t);') && kid.includes('setFavicon(null);'));
  const svg = await mock.route('GET', '/favicon.svg');
  check('/favicon.svg 是三色 C、no-cache', svg.status === 200 && (svg.contentType ?? '').startsWith('image/svg+xml') && Buffer.from(svg.body!).toString() === homeFaviconSvg() && svg.cacheControl === 'no-cache');
  const math = Buffer.from((await mock.route('GET', '/favicon.svg?tutor=math-tutor')).body!).toString();
  check('?tutor= 是那位老师', math.includes(`stroke="${SUBJECT_COLORS['数学']}"`) && math.includes('<text'));
  check('查不到的老师给三色 C', Buffer.from((await mock.route('GET', '/favicon.svg?tutor=nobody')).body!).toString() === homeFaviconSvg());
  for (const path of ['/favicon-32.png', '/favicon.ico', '/favicon-32.png?tutor=english-tutor']) {
    const r = await mock.route('GET', path);
    check(`${path} 是 PNG`, r.status === 200 && r.contentType === 'image/png' && Buffer.from(r.body!).subarray(1, 4).toString('ascii') === 'PNG');
  }
}

// ---- 真服务:头像图从 workspace 里读,越界不读 ----
{
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const svg = async (q: string) => Buffer.from((await route('GET', '/favicon.svg' + q, ctx)).body!).toString();
  check('真服务:首页三色 C', (await svg('')) === homeFaviconSvg());
  check('真服务:emoji 头像', (await svg('?tutor=math-tutor')).includes('>🧮</text>'));
  mkdirSync(join(root, 'avatars'), { recursive: true });
  const face = Buffer.alloc(128 * 128 * 4, 200);
  writeFileSync(join(root, 'avatars', 'math-tutor.png'), encodePng(128, face, 4));
  check('PATCH 头像成图片', (await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { avatar: 'avatars/math-tutor.png' } } })).status === 200);
  check('真服务:图片头像内联', (await svg('?tutor=math-tutor')).includes('data:image/png;base64,'));
  await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { avatar: '../x.png' } } });
  check('越界不读,退回首字', (await svg('?tutor=math-tutor')).includes('>数</text>'));
  const png = await route('GET', '/favicon-32.png?tutor=math-tutor', ctx);
  check('真服务:PNG、no-cache', png.status === 200 && png.contentType === 'image/png' && png.cacheControl === 'no-cache');
  for (const path of ['/', '/parent/home', '/dev']) check(`真服务:${path} 引了`, ((await route('GET', path, ctx)).html ?? '').includes(faviconLinks()));
}

done();
