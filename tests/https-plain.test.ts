/**
 * 同一个端口既认 https 又认 http(src/app/cli/serve.ts 的 httpAndHttps、plainHandler):用 https 时,
 * http 那一面只给根证书(平板扫码装证书,还不信任 https)、别的都跳到 https;私钥永远不给;实时老师的 WebSocket 照走 https。
 * 用 tests/fixtures/tls 的测试证书真起一个 serve。
 */
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-https-plain-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const fx = join(import.meta.dirname, 'fixtures', 'tls');
mkdirSync(join(home, '.config', 'cotutor', 'certs'), { recursive: true });
copyFileSync(join(fx, 'cert.pem'), join(home, '.config', 'cotutor', 'certs', 'cert.pem'));
copyFileSync(join(fx, 'key.pem'), join(home, '.config', 'cotutor', 'certs', 'key.pem'));
const caroot = join(home, 'mkcert');
mkdirSync(caroot);
const CA = '-----BEGIN CERTIFICATE-----\nZQ-PUBLIC-ROOT\n-----END CERTIFICATE-----\n';
writeFileSync(join(caroot, 'rootCA.pem'), CA);
writeFileSync(join(caroot, 'rootCA-key.pem'), 'ZQ-PRIVATE-KEY-NEVER-SERVE');
process.env.CAROOT = caroot;

const { serveWorkspace } = await import('../src/app/cli/serve.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { rootCaFile, defaultCaRoot } = await import('../src/app/cli/root-ca.ts');
const { PARENT_HOME_PAGE } = await import('../src/ui/parent/parent-home-page.ts');

type Got = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
const get = (secure: boolean, port: number, path: string, headers: Record<string, string> = {}): Promise<Got> => new Promise((resolve, reject) => {
  const req = (secure ? httpsRequest : httpRequest)({ host: '127.0.0.1', port, path, headers: { host: `localhost:${port}`, ...headers }, rejectUnauthorized: false, timeout: 5000 }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c: string) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
  });
  req.on('upgrade', (res) => resolve({ status: res.statusCode ?? 101, headers: res.headers, body: '' }));
  req.on('error', reject);
  req.end();
});

check('根证书:CAROOT 里的 rootCA.pem;私钥不认', (await rootCaFile()) === join(caroot, 'rootCA.pem'));
check('根证书:没有 CAROOT 时看 mkcert 的缺省目录', defaultCaRoot('darwin', {}, '/h') === join('/h', 'Library', 'Application Support', 'mkcert') && defaultCaRoot('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\h') === join('C:\\L', 'mkcert') && defaultCaRoot('linux', {}, '/h') === join('/h', '.local', 'share', 'mkcert'));
check('根证书:哪儿都没有 → null(不抛)', (await rootCaFile({ env: { CAROOT: join(home, 'nope') }, home: join(home, 'nobody'), askMkcert: async () => { throw new Error('no mkcert'); } })) === null);

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const r = await serveWorkspace({ workspace: root, port: 0, awake: false });
try {
  check('起来了,走 https', r.https === true && r.port > 0);
  const s = await get(true, r.port, '/api/health');
  check('https:照常', s.status === 200 && JSON.parse(s.body).ok === true, s.body.slice(0, 80));
  const ca = await get(false, r.port, '/ca.crt');
  check('同一个端口的 http:给根证书,类型让平板当描述文件装', ca.status === 200 && ca.body === CA && ca.headers['content-type'] === 'application/x-x509-ca-cert', JSON.stringify(ca.headers));
  check('http 给的只有根证书:私钥一个字都不出现', !ca.body.includes('PRIVATE') && (await get(false, r.port, '/ca')).body === CA);
  for (const p of ['/rootCA-key.pem', '/ca.crt/../rootCA-key.pem', '/api/health', '/']) {
    const x = await get(false, r.port, p);
    check(`http 的别的路径:跳到 https,不给东西(${p})`, x.status === 301 && !x.body.includes('PRIVATE') && String(x.headers.location).startsWith(`https://localhost:${r.port}`), JSON.stringify(x));
  }
  check('跳的时候带着原来的路径和参数(切到 https 以前开着的页面刷新就回去)', (await get(false, r.port, '/?tutor=math-tutor')).headers.location === `https://localhost:${r.port}/?tutor=math-tutor`);
  const up = await get(true, r.port, '/api/live/nope-tutor/ws', { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' });
  check('实时老师的 WebSocket 照走 https(升级请求到得了,没有这位老师回 404)', up.status === 404, JSON.stringify(up));
} finally {
  r.server.close();
}
check('家长端「扫码打开」:有证书时多一格「装证书」,说清三步,不给打印', PARENT_HOME_PAGE.includes("['ca', '装证书']") && PARENT_HOME_PAGE.includes('证书信任设置') && PARENT_HOME_PAGE.includes('ca ? null : h('));

done();
