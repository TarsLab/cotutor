/**
 * 端口的规矩:新 workspace 只在 cotutor init 选一次,写进 cotutor.json,以后不变。
 * 不变是因为平板上的主屏幕图标、页面存的设置都绑在「协议 + 主机 + 端口」上:换一次,平板要重新扫码、重加图标。所以运行时被占了只报错说清楚,不像 Vite 那样自动换下一个。
 * 依次试 443(地址里不用写端口)、8443、8445…:系统不让用、被占着、留给了别的孩子就看下一个,不按系统写分支。
 *   macOS 普通用户绑得上 0.0.0.0:443,绑 127.0.0.1:443 反而不行(Mojave 起如此,苹果没写文档,2026-11-06 在 27.2 上试过);Linux 默认 1024 以下要 root,落到 8443。
 * 隔一个号给 sandbox 留的:它的端口是真 workspace 的 +1。
 * 旧 workspace 写着什么就是什么;cotutor.json 没写端口的走 DEFAULT_PORT,不跟着这里变。
 */
import { createConnection, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '../../schema/index.ts';
import { holderScript, parseHolder, parseLsof, portHolder, type PortHolder } from './port-holder.ts';
import { probeHealth, type ServiceHost } from './service.ts';
import { CONFIG_FILE, USER_CONFIG, UsageError, expandPath, homeWorkspaces, readJson } from '../workspace.ts';

export const PORT_CANDIDATES: readonly number[] = [443, ...Array.from({ length: 9 }, (_, i) => 8443 + i * 2)];

/** sandbox 用哪个端口 */
export const sandboxPort = (port: number): number => (port === 65535 ? port - 1 : port + 1);

export type PortState = 'free' | 'busy' | 'denied';

/**
 * 真绑一下就放开,看系统让不让用这个端口(被占主要靠 portState 先问的那一声)。Windows 上绑通配地址会弹防火墙的窗(还会立刻建 Block 规则),探一下不该弹,所以绑 127.0.0.1,那边也没有低端口的限制;
 * macOS 反过来,只能绑通配;别的系统同 macOS
 */
export function tryBind(port: number, platform: NodeJS.Platform = process.platform): Promise<PortState> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EACCES' ? 'denied' : 'busy'));
    s.listen(port, platform === 'win32' ? '127.0.0.1' : '0.0.0.0', () => s.close(() => resolve('free')));
  });
}

/** 本机这个端口上有人答应吗 */
export function answersLocally(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const c = createConnection({ host: '127.0.0.1', port });
    const finish = (yes: boolean): void => { c.destroy(); resolve(yes); };
    c.setTimeout(timeoutMs, () => finish(false));
    c.once('connect', () => finish(true));
    c.once('error', () => finish(false));
  });
}

/** 先问一声再绑:别的程序只占着 127.0.0.1:443 时,绑 0.0.0.0:443 照样成功(2026-11-06 macOS、Windows 都试过),光绑看不出被占 */
export async function portState(port: number): Promise<PortState> {
  return (await answersLocally(port)) ? 'busy' : tryBind(port);
}

export interface PortChoice {
  port: number;
  skipped: { port: number; why: PortState | 'taken' }[];
}

/** taken:别的 workspace 写着的端口,连同它们的 sandbox 都让开;选不出来报用法错误 */
export async function choosePort(taken: Iterable<number>, probe: (port: number) => Promise<PortState> = portState, candidates: readonly number[] = PORT_CANDIDATES): Promise<PortChoice> {
  const used = new Set<number>();
  for (const p of taken) { used.add(p); used.add(sandboxPort(p)); }
  const skipped: PortChoice['skipped'] = [];
  for (const port of candidates) {
    if (used.has(port) || used.has(sandboxPort(port))) { skipped.push({ port, why: 'taken' }); continue; }
    const state = await probe(port);
    if (state === 'free') return { port, skipped };
    skipped.push({ port, why: state });
  }
  throw new UsageError(`端口 ${candidates.join('、')} 都用不了:cotutor init 加 --port <n> 指定一个`);
}

/** init 里 cotutor.json 那一行的说明 */
export function choiceNote(c: PortChoice): string {
  const WHY = { busy: '被占着', denied: '这个系统不让普通用户用', taken: '留给了另一个孩子', free: '' };
  const first = c.skipped[0];
  const head = c.port === 443 ? '端口 443,地址里不用写端口' : `端口 ${c.port}${first ? `(${first.port} ${WHY[first.why]})` : ''}`;
  return `${head};选定了就不再变,改了平板要重新扫码`;
}

/** 这台电脑上别的 workspace 写着的端口(~/cotutor/ 下的,加上用户配置指的那个):还没起的也要让开 */
export function knownPorts(): number[] {
  const roots = new Set(homeWorkspaces());
  try {
    const user = readJson(USER_CONFIG) as { workspace?: unknown } | null;
    if (typeof user?.workspace === 'string' && user.workspace) roots.add(expandPath(user.workspace, homedir()));
  } catch { /* 用户配置坏了 doctor 去报 */ }
  const ports: number[] = [];
  for (const root of roots) {
    try {
      const raw = readJson(join(root, CONFIG_FILE)) as { server?: { port?: unknown } } | null;
      if (!raw) continue;
      ports.push(typeof raw.server?.port === 'number' ? raw.server.port : DEFAULT_PORT);
    } catch { /* 配置坏了:那边 doctor 去报,这里当它没有 */ }
  }
  return ports;
}

export { holderScript, parseHolder, parseLsof, portHolder, type PortHolder };

export interface Holder {
  /** 「nginx(pid 12)」;不知道是谁 → null */
  text: string | null;
  cotutor: 'service' | 'serve' | null;
}

export async function whoHolds(host: Pick<ServiceHost, 'platform' | 'run'>, port: number): Promise<Holder> {
  const h = await probeHealth(port);
  const pid = h?.pid ? `(pid ${h.pid})` : '';
  if (h) return h.mode === 'service' ? { text: `cotutor 的后台服务${pid}`, cotutor: 'service' } : { text: `另一个 cotutor serve${pid}`, cotutor: 'serve' };
  const p = await portHolder(host, port);
  return { text: p ? `${p.name}(pid ${p.pid})` : null, cotutor: null };
}

const CHANGE_PORT = '要换端口就改 cotutor.json 的 server.port,平板要重新扫码、重加主屏幕图标';

/** serve 绑不上时那句话;service = 后台服务里(不重试,说怎么腾) */
export function bindFailure(code: 'EACCES' | 'EADDRINUSE', port: number, who: Holder | null, service: boolean): string {
  if (code === 'EACCES') {
    const head = `系统不让这个用户监听端口 ${port}(Linux 上 1024 以下要管理员权限,Windows 上可能落在系统保留的端口段)`;
    return service ? `${head},后台服务先不起。${CHANGE_PORT},然后 cotutor service start` : `${head}。--port 临时换一个;${CHANGE_PORT}`;
  }
  const head = `端口 ${port} 被占着${who?.text ? `:${who.text} 在用` : ''}`;
  if (service) return who?.cotutor ? `${head},后台服务先不起;关掉它以后 cotutor service start` : `${head},后台服务先不起;腾出来以后 cotutor service start。${CHANGE_PORT}`;
  if (who?.cotutor === 'service') return `${head}。要在终端里调试先 cotutor service stop(cotutor service status 看状态);也可以 --port 临时换一个`;
  if (who?.cotutor === 'serve') return `${head}。关掉那个终端里的它;也可以 --port 临时换一个`;
  return `${head}。关掉它,或 --port 临时换一个;${CHANGE_PORT}`;
}
