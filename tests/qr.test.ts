/** 扫码页:编码器对 node-qrcode 的样本(逐格)、内联 SVG、页面编什么由服务端定(不看 Host)、?via=ip 的退路。 */
import { certCovers, listenInfo, localName } from '../src/cli/serve.ts';
import { encodeQR } from '../src/lib/qr.ts';
import { qrNotes, qrSvg } from '../src/lib/qr-svg.ts';
import { createMock } from '../src/server/mock.ts';
import { qrPage } from '../src/server/qr-page.ts';
import { check, done } from './_check.ts';

/** node-qrcode 1.5(字节模式、纠错 M、自动掩码)的输出,每行按位打成十六进制 */
const SAMPLES = [
  { text: 'https://ae86s-Mac.local:5180/', version: 3, mask: 2, rows: ['1fca3f7f', '10420141', '175f545d', '17591c5d', '1759eb5d', '105afd41', '1fd5557f', '16a600', '17cd6c7c', '9363371', '10660180', '802537a', '145a1eac', 'b99e3d1', '1e57f45c', '6a0a102', '16c46e2c', '1a2a3b95', '16e20474', '122c5732', '14fe1ff7', '15e11f', '1fc0f75c', '1053a510', '17516df5', '175e3f0c', '175f88fe', '104411ba', '1fd94614'] },
  // 版本 8:多块交错、长短块、版本信息都走到
  { text: 'x'.repeat(130), version: 8, mask: 2, rows: ['1fcbea106917f', '1040634ac8741', '175831f53e35d', '17542e906ba5d', '175becfec185d', '1057064794c41', '1fd555555557f', '12ac453e700', '17c6877c6b17c', '1cad12fac18ce', 'fde089f94e9b', '189cb5253e731', '1c78b4706b164', '1026cb5ac18ce', '144591cf94e9b', '12a44b6686731', '4d243b13f164', '102182db958ce', '14639c8d78e9b', '101e752d3e731', 'bc94b746b164', '1e941adec18ce', '7f08cff94ffb', '1910a9c53e711', '15b27d46b354', '19150646c191e', 'ff7607f94dfb', '182d49413e591', 'adafe946b234', '1084c4a2c1a6e', '17c66a4b94dcb', 'b1e64ec6a590', 'b460ba6c3235', '17910af069a6e', '1fd2089ac0dcb', 'c27214d3e591', '15f653a46b234', 'b2db6b2c1a6e', '8f5205b94dcb', 'e379d4d3e591', '1c6c6ffc6b3f4', '117ac6c1b1e', '1fcd10d794f5b', '1056d1c53e711', '175d447c6b1f4', '17586f62c193d', '175779fb94c68', '104eaf92866c1', '1fd137093f397'] },
];

for (const s of SAMPLES) {
  const qr = encodeQR(s.text);
  check(`编得出(${s.text.length} 字节)`, qr !== null);
  if (!qr) continue;
  check('版本', qr.version === s.version, `${qr.version}`);
  check('边长 = 版本 × 4 + 17', qr.size === s.version * 4 + 17 && qr.modules.length === qr.size);
  check('掩码与样本同一个', qr.mask === s.mask, `${qr.mask}`);
  const rows = qr.modules.map((row) => row.reduce((v, b) => (v << 1n) | (b ? 1n : 0n), 0n).toString(16));
  const bad = rows.findIndex((r, i) => r !== s.rows[i]);
  check('逐格对得上样本', bad === -1, `第 ${bad} 行 ${rows[bad]} ≠ ${s.rows[bad]}`);
}
check('版本 10 的上限 213 字节', encodeQR('u'.repeat(213))?.version === 10);
check('装不下返回 null,不抛', encodeQR('u'.repeat(214)) === null);
check('中文按 UTF-8 编', encodeQR('小明的老师团')?.version === 2);

check('localName 补 .local', localName('ae86s-Mac') === 'ae86s-Mac.local' && localName('ae86s-Mac.local') === 'ae86s-Mac.local');
check('读不了的证书当作不认', certCovers('/no/such.pem', 'a.local') === false);

// 内联 SVG:边长 = 版本 3 的 29 格 + 两边各四格静区
const svg = qrSvg('https://ae86s-Mac.local:5180/') ?? '';
check('SVG 连静区', svg.includes('viewBox="0 0 37 37"') && svg.includes('<path d="M'));
check('装不下 → null', qrSvg('u'.repeat(214)) === null);
check('HTTPS 说证书', qrNotes(true).some((n) => n.includes('证书信任设置')));
check('HTTP 说 cotutor cert,不说信任', qrNotes(false).some((n) => n.includes('cotutor cert')) && !qrNotes(false).some((n) => n.includes('证书信任设置')));

// 扫码页
const info = { name: 'https://ae86s-Mac.local:5180/', ip: 'https://192.168.1.9:5180/', https: true };
const page = qrPage('小明 & <老师团>', info);
check('标题转义', page.includes('小明 &amp; &lt;老师团&gt;') && !page.includes('<老师团>'));
check('默认编主机名那条,地址印在码下面', page.includes('>https://ae86s-Mac.local:5180/</p>') && page.includes(svg));
check('留一条换数字地址的退路', page.includes('href="/qr?via=ip"'));
const byIp = qrPage('t', info, 'ip');
check('?via=ip 编 IP,能换回来', byIp.includes('>https://192.168.1.9:5180/</p>') && byIp.includes(qrSvg(info.ip) as string) && byIp.includes('href="/qr"'));
const offline = qrPage('t', { ...info, ip: null }, 'ip');
check('没有局域网地址:仍编主机名,不给退路', offline.includes('>https://ae86s-Mac.local:5180/</p>') && !offline.includes('via=ip'));
// 家长那张(《家长板书页设计.md》§2.1):编家长端 /parent,标「家长看」,能换回孩子那张;孩子那张页脚有去家长那张的链接;两张互换时带着现在的地址种类
const parent = qrPage('t', info, 'name', 'parent');
check('?to=parent 编家长端,能换回孩子那张', parent.includes('>https://ae86s-Mac.local:5180/parent</p>') && parent.includes(qrSvg('https://ae86s-Mac.local:5180/parent') as string) && parent.includes('家长看') && parent.includes('href="/qr"') && parent.includes('href="/qr?via=ip&to=parent"'));
check('孩子那张页脚有家长那张;IP 那张换过去仍是 IP', qrPage('t', info).includes('href="/qr?to=parent"') && byIp.includes('href="/qr?via=ip&to=parent"') && !offline.includes('via=ip'));
check('HTTP 的说明', qrPage('t', { ...info, name: 'http://a.local:80/', https: false }).includes('cotutor cert'));
check('没有脚本,打印只留卡面', !page.includes('<script') && page.includes('@media print'));

// 路由:编什么由服务端定,不看请求的 Host(家长是从 localhost 打开这一页的)
const mock = createMock({ title: '小明的老师们' });
check('没起端口 → 404', (await mock.route('GET', '/qr')).status === 404);
mock.listen = () => info;
const r = await mock.route('GET', '/qr');
check('/qr 200', r.status === 200 && (r.html ?? '').includes('>https://ae86s-Mac.local:5180/</p>') && !(r.html ?? '').includes('localhost'));
check('/qr?via=ip', ((await mock.route('GET', '/qr?via=ip')).html ?? '').includes('>https://192.168.1.9:5180/</p>'));
const li = listenInfo(true, 5180);
check('listenInfo:主机名那条带 .local 与真端口', li.name === `https://${localName()}:5180/` && (li.ip === null || /^https:\/\/\d+\.\d+\.\d+\.\d+:5180\/$/.test(li.ip)), JSON.stringify(li));
check('孩子端不露扫码页的入口', !((await mock.route('GET', '/')).html ?? '').includes('/qr'));

done();
