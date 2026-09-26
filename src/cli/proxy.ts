/**
 * 老师进程的代理(src/lib/proxy.ts 说为什么):cotutor.json 的 proxy 记家长的选择——代理地址 / false(选了不用)/ 不写(还没选)。
 * init 探到本机有代理、又还没选过,就问一句(终端里);cotutor proxy 以后随时改。serve 热重载 cotutor.json,改了不用重起。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROXY_URL_RE, detectProxy, type DetectedProxy } from '../lib/proxy.ts';
import { CONFIG_FILE } from './workspace.ts';

export type ProxyChoice = string | false;

async function readRaw(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')) as Record<string, unknown>;
}

/** cotutor.json 现在的选择;没写 → undefined;读不了 → undefined */
export async function proxyOf(root: string): Promise<ProxyChoice | undefined> {
  try {
    const v = (await readRaw(root)).proxy;
    return typeof v === 'string' || v === false ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 写进 cotutor.json(只动 proxy 这一个键,别的原样) */
export async function setProxy(root: string, choice: ProxyChoice): Promise<void> {
  if (typeof choice === 'string' && !PROXY_URL_RE.test(choice)) throw new Error(`代理地址要形如 http://127.0.0.1:7890(也认 https / socks5),拿到 ${choice}`);
  const raw = await readRaw(root);
  raw.proxy = choice;
  await writeFile(join(root, CONFIG_FILE), `${JSON.stringify(raw, null, 2)}\n`);
}

export interface ProxyStep {
  item: string;
  action: 'created' | 'exists' | 'kept';
  note?: string;
}

/**
 * init 用:还没选过才动。given = 命令行给的(--proxy <url> / --no-proxy);没给且探到了代理,有 ask 就问(终端里),没有就只提示。
 * 返回 init 的一步;什么都不用做 → null
 */
export async function chooseProxyOnInit(root: string, opts: { given?: ProxyChoice; ask?: (d: DetectedProxy) => Promise<boolean | null>; home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ProxyStep | null> {
  const before = await proxyOf(root);
  if (opts.given !== undefined) {
    await setProxy(root, opts.given);
    return { item: 'cotutor.json proxy', action: 'created', note: opts.given ? `老师(claude)走 ${opts.given}` : '选了不走代理' };
  }
  if (before !== undefined) return { item: 'cotutor.json proxy', action: 'exists', note: before ? `老师(claude)走 ${before}` : '选过不走代理' };
  const found = detectProxy({ home: opts.home, env: opts.env });
  if (!found) return null;
  const later = { item: 'cotutor.json proxy', action: 'kept' as const, note: `本机有代理 ${found.url}(${found.source}),还没选;要老师走它:cotutor proxy on,不用:cotutor proxy off` };
  if (!opts.ask) return later;
  const yes = await opts.ask(found);
  if (yes === null) return later;
  await setProxy(root, yes ? found.url : false);
  return { item: 'cotutor.json proxy', action: 'created', note: yes ? `老师(claude)走 ${found.url}` : '选了不走代理(以后 cotutor proxy on 再开)' };
}
