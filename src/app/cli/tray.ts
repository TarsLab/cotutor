/**
 * 托盘图标(macOS 菜单栏、Windows 任务栏;Linux 没做,GNOME 缺省不显示托盘):家长不开终端也看得到服务好不好、点得开家长端。
 * 三层:
 *   node 进程(cotutor tray run,tray-run.ts 是它的轻入口):隔几秒问每个后台服务的 /api/health,判断状态,决定显示什么、要不要通知;这里全是能测的 TS。
 *   显示脚本(tray-mac.ts 的 JXA、tray-windows.ts 的 PowerShell,都是系统自带、不用签名):只管画和回报点击,不判断。
 *   登录项:macOS 一个 LaunchAgent,Windows 一条 Run 项 + wscript 隐藏启动器;service install 时一起装(--no-tray 不装,cotutor tray off 关掉并记住)。
 * 为什么不放在 serve 里:服务挂了图标也没了,就说不出「没在跑」;多个孩子时一台电脑也只该有一个图标。
 * 为什么不用 npm 的托盘库、Electron:见 docs/wip;systray2 只有 x86 的 Mac 二进制且没签名,Electron 要多下一百多 MB。
 * 状态:正常只有 logo(和菜单栏别的图标一样单色);有事才出状态点,橙 = 要处理,红 = 没在跑(logo 同时变淡)。正常 → 有事、→ 没在跑时通知一次,恢复不通知。
 * 「退出 cotutor」= 停掉所有后台服务并退出图标,下次登录自己回来;正开着电话时先问一声。
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_PORT } from '../../shared/default-port.ts';
import { UsageError } from '../../shared/errors.ts';
import { siteUrl } from '../../shared/site-url.ts';
import { isNewer } from '../../shared/upgrade.ts';
import { portHolder } from './port-holder.ts';
import { RUN_KEY, STARTUP_APPROVED_KEY, encodeLauncher, parseProcs, psArgs, runValue, startupDisabled, winCommandLine } from './service-windows.ts';
import { binPath, controlService, listServices, parseLaunchctlPrint, probeHealth, wscriptPath, xml, type Health, type InstalledService, type ServiceHost, launchdLoad, launchdUnload, stableNode } from './service.ts';
import { macTrayIcons, windowsTrayIcons } from './tray-icons.ts';
import { HELPER_NO_SESSION, TRAY_AUMID, TRAY_LABEL, TRAY_RUN_VALUE } from './tray-ids.ts';
import { MAC_TRAY_SCRIPT } from './tray-mac.ts';
import { WINDOWS_TRAY_SCRIPT, findTrayScript, trayLauncher } from './tray-windows.ts';

export { HELPER_NO_SESSION, TRAY_AUMID, TRAY_LABEL, TRAY_RUN_VALUE };

/** 多久问一次 */
export const TRAY_POLL_MS = 5_000;
/** 连着几次问不到才算没在跑:重起一下、网络抖一下不报 */
export const TRAY_STRIKES = 2;
/** 图标刚起来时服务可能还没起来:这么久里问不到算「正在启动」(Windows 登录后约一分钟才跑 Run 项) */
export const TRAY_START_GRACE_MS = 90_000;
/** 点了启动、重启以后等多久 */
export const TRAY_RESTART_GRACE_MS = 30_000;
/** 两次问之间隔太久 = 刚睡醒:网络还没回来,先别报 */
export const TRAY_WAKE_GAP_MS = 30_000;
export const TRAY_WAKE_GRACE_MS = 30_000;
const HOLDER_EVERY_MS = 60_000;
const HELPER_RESTART_MS = 10_000;
const LOG_MAX = 1024 * 1024;

export type TrayLevel = 'ok' | 'warn' | 'bad';
export type RowLevel = TrayLevel | 'starting';
export type TrayFix = { kind: 'open'; target: string } | { kind: 'restart' };

/** 一个服务这一轮问到的 */
export interface TrayProbe {
  name: string;
  kid: string;
  root: string;
  logDir: string | null;
  port: number;
  health: Health | null;
  /** 问不到时端口被谁占着(「nginx」);不知道 → null */
  holder: string | null;
}

/** 一个服务现在的样子 */
export interface TrayRow {
  name: string;
  kid: string;
  logDir: string | null;
  level: RowLevel;
  /** 家长端地址;服务没答应 → null */
  url: string | null;
  /** 第二行小字 */
  detail: string;
  /** 有几件事要处理 */
  issues: number;
  fix: TrayFix | null;
  calls: number;
  /** npm 上有比装的新的版本 → 版本号;不算有事,不出状态点 */
  update: string | null;
}

export type TrayEntry =
  | { kind: 'info'; title: string; level?: TrayLevel }
  | { kind: 'sub'; title: string }
  | { kind: 'sep' }
  | { kind: 'action'; id: string; title: string; primary?: boolean };

export interface TrayShow {
  type: 'show';
  icon: TrayLevel;
  tip: string;
  menu: TrayEntry[];
}

export interface TrayNote { type: 'notify'; title: string; body: string }

const MAC_FULL_DISK = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** 跑了多久,给家长看 */
export function uptimeText(startedMs: number, now: number): string {
  const min = Math.max(0, (now - startedMs) / 60_000);
  if (min < 60) return '不到 1 小时';
  if (min < 48 * 60) return `${Math.floor(min / 60)} 小时`;
  return `${Math.floor(min / 1440)} 天`;
}

/** 服务在跑,但有事要家长处理:先后就是轻重,菜单上只说第一件 */
export function issuesOf(p: TrayProbe, o: { platform: NodeJS.Platform; version: string }): { text: string; fix: TrayFix }[] {
  const h = p.health;
  if (!h) return [];
  const url = siteUrl(h.scheme ?? 'https', 'localhost', p.port, '/parent/home');
  const out: { text: string; fix: TrayFix }[] = [];
  if (h.configError) out.push({ text: 'cotutor.json 写坏了:改的没生效', fix: { kind: 'open', target: p.root } });
  if (h.vault === 'denied') out.push(o.platform === 'darwin' ? { text: '读不到 vault:要给 node 开磁盘权限', fix: { kind: 'open', target: MAC_FULL_DISK } } : { text: '读不到 vault:看看这个目录的权限', fix: { kind: 'open', target: p.root } });
  else if (h.vault === 'missing') out.push({ text: 'vault 不在了:看看 cotutor.json 的 paths.vault', fix: { kind: 'open', target: p.root } });
  if (h.bailian === false) out.push({ text: '还没填百炼:老师们到不了', fix: { kind: 'open', target: url } });
  else if (h.bailianTrouble) out.push({ text: h.bailianTrouble.message, fix: { kind: 'open', target: url } });
  if (h.version && h.version !== o.version) out.push({ text: `在跑的是 ${h.version},装的是 ${o.version}:重启一下`, fix: { kind: 'restart' } });
  return out;
}

const rank = (l: RowLevel | undefined): number => (l === 'bad' ? 2 : l === 'warn' ? 1 : 0);

/** 记着每个服务上一轮的样子,算这一轮的样子和要不要通知;不碰任何系统,测试直接喂 */
export class TrayModel {
  private readonly mem = new Map<string, { row: TrayRow | null; level?: RowLevel; misses: number; graceUntil: number }>();
  private last = 0;
  // 版本每轮问:npm 升级时这个进程一直开着,记死了就把「都对了」报成「要重启」,把真要重启的放过去
  private readonly o: { platform: NodeJS.Platform; version: () => string };
  constructor(o: { platform: NodeJS.Platform; version: () => string }) { this.o = o; }

  /** 刚点了启动、重启:这一阵问不到是正常的 */
  expect(name: string, now: number): void {
    const m = this.mem.get(name);
    if (!m) return;
    m.row = null;
    m.misses = 0;
    m.graceUntil = now + TRAY_RESTART_GRACE_MS;
  }

  update(probes: TrayProbe[], now: number): { rows: TrayRow[]; notes: TrayNote[] } {
    const woke = this.last > 0 && now - this.last > TRAY_WAKE_GAP_MS;
    this.last = now;
    const rows: TrayRow[] = [];
    const notes: TrayNote[] = [];
    const multi = probes.length > 1;
    for (const p of probes) {
      let m = this.mem.get(p.name);
      if (!m) {
        m = { row: null, misses: 0, graceUntil: now + TRAY_START_GRACE_MS };
        this.mem.set(p.name, m);
      }
      if (woke) m.graceUntil = Math.max(m.graceUntil, now + TRAY_WAKE_GRACE_MS);
      let row: TrayRow;
      if (p.health) {
        m.misses = 0;
        m.graceUntil = 0;
        row = this.healthy(p, now);
      } else {
        m.misses++;
        if (now < m.graceUntil) row = m.row ?? this.placeholder(p, 'starting', '');
        else if (m.misses < TRAY_STRIKES && m.row && m.row.level !== 'starting') row = m.row;
        else row = this.placeholder(p, 'bad', p.holder ? `端口 ${p.port} 被占着:${p.holder} 在用` : '孩子的平板现在打不开');
      }
      const prev = m.level;
      // 第一次看到就是「要处理」不通知(每次登录都弹太烦,菜单里看得到);变差才通知
      if (rank(row.level) > rank(prev) && !(row.level === 'warn' && (prev === undefined || prev === 'starting'))) notes.push(noteFor(row, multi, this.o.platform));
      m.level = row.level;
      m.row = row;
      rows.push(row);
    }
    for (const name of [...this.mem.keys()]) if (!probes.some((p) => p.name === name)) this.mem.delete(name);
    return { rows, notes };
  }

  private healthy(p: TrayProbe, now: number): TrayRow {
    const h = p.health as Health;
    const installed = this.o.version();
    const issues = issuesOf(p, { platform: this.o.platform, version: installed });
    const started = Date.parse(h.started);
    const running = h.mode === 'foreground' ? '在终端里跑,关了终端就停' : `已运行 ${uptimeText(Number.isNaN(started) ? now : started, now)}`;
    return {
      name: p.name,
      kid: p.kid,
      logDir: p.logDir,
      level: issues.length ? 'warn' : 'ok',
      url: siteUrl(h.scheme ?? 'https', 'localhost', p.port, '/parent/home'),
      detail: issues.length ? issues[0].text : `${running} · 版本 ${h.version ?? '?'}`,
      issues: issues.length,
      fix: issues[0]?.fix ?? null,
      calls: h.calls ?? 0,
      // 和装的比,不只和在跑的比:程序已经换上新版、只差重启时,再说「有新版本」就错了
      update: isNewer(h.latest, installed) ? (h.latest as string) : null,
    };
  }

  private placeholder(p: TrayProbe, level: RowLevel, detail: string): TrayRow {
    return { name: p.name, kid: p.kid, logDir: p.logDir, level, url: null, detail, issues: 0, fix: null, calls: 0, update: null };
  }
}

const titleOf = (r: TrayRow, multi: boolean): string => {
  if (!multi) return r.level === 'ok' ? 'cotutor 正常' : r.level === 'warn' ? `有 ${r.issues} 件事要处理` : r.level === 'bad' ? '后台服务没在跑' : 'cotutor 正在启动';
  return `${r.kid} · ${r.level === 'ok' ? '正常' : r.level === 'warn' ? `有 ${r.issues} 件事要处理` : r.level === 'bad' ? '没在跑' : '正在启动'}`;
};

// 点通知回不到这里(Mac 的来源是系统的脚本程序;Windows 的 PowerShell 5.1 接不了 WinRT 的事件),只能请家长去点图标
const iconHint = (platform: NodeJS.Platform): string => (platform === 'darwin' ? '点菜单栏的 cotutor 图标看看' : '点任务栏的 cotutor 图标看看');

/** 有新版本的通知:每个版本最多一次,记在托盘目录,重起、重新登录不再弹 */
export function updateNote(version: string, platform: NodeJS.Platform): TrayNote {
  return { type: 'notify', title: `cotutor 有新版本 ${version}`, body: iconHint(platform) };
}

function noteFor(r: TrayRow, multi: boolean, platform: NodeJS.Platform): TrayNote {
  const hint = iconHint(platform);
  const who = multi ? r.kid : 'cotutor ';
  if (r.level === 'bad') return { type: 'notify', title: `${who}${multi ? '的' : ''}后台服务没在跑`, body: `孩子的平板现在打不开,${hint}` };
  return { type: 'notify', title: `${who}有 ${r.issues} 件事要处理`, body: `${r.detail},${hint}` };
}

/** 这一轮显示什么 */
export function trayShow(rows: TrayRow[]): TrayShow {
  const multi = rows.length > 1;
  const worst = rows.reduce<TrayRow | null>((a, r) => (!a || rank(r.level) > rank(a.level) ? r : a), null);
  const level = (worst?.level ?? 'ok') as RowLevel;
  const menu: TrayEntry[] = [];
  for (const r of rows) {
    menu.push({ kind: 'info', title: titleOf(r, multi), ...(r.level === 'starting' ? {} : { level: r.level }) });
    if (r.detail && (!multi || r.level !== 'ok')) menu.push({ kind: 'sub', title: r.detail });
    if (!multi) menu.push({ kind: 'sep' });
    const act = (what: string, title: string, primary = false): void => { menu.push({ kind: 'action', id: `${what}:${r.name}`, title, ...(primary ? { primary } : {}) }); };
    if (r.level === 'ok' || r.level === 'warn') {
      if (r.level === 'warn') act('fix', '看看怎么修', true);
      act('open', '打开家长端');
      if (!multi) menu.push({ kind: 'sep' });
      act('restart', '重启服务');
      act('logs', '看日志');
    } else if (r.level === 'bad') {
      act('start', '启动服务', true);
      act('logs', '看日志');
    } else act('logs', '看日志');
    menu.push({ kind: 'sep' });
  }
  // 版本是这台电脑的事,几个孩子也只说一行;点了去家长端,升级的命令写在那里
  const newer = rows.find((r) => r.update);
  if (newer) {
    menu.push({ kind: 'action', id: `update:${newer.name}`, title: `有新版本 ${newer.update},看怎么升级` });
    menu.push({ kind: 'sep' });
  }
  menu.push({ kind: 'action', id: 'quit', title: '退出 cotutor' });
  return { type: 'show', icon: level === 'starting' ? 'ok' : level, tip: worst ? titleOf(worst, multi) : 'cotutor', menu };
}

export interface HelperMessage { type: string; id?: string; yes?: boolean; message?: string }

export interface TrayHelper {
  send(m: unknown): void;
  /** 关 stdin:显示脚本读到头自己退 */
  close(): void;
}

export interface TrayDeps {
  platform: NodeJS.Platform;
  /** 现在装的是哪个版本:每轮问,程序可能刚被 npm 换了 */
  version(): string;
  /** 已经通知过的新版本 */
  updateSeen(): string | null;
  setUpdateSeen(version: string): void;
  now(): number;
  list(): Promise<InstalledService[]>;
  /** 读 cotutor.json:孩子叫什么、哪个端口 */
  inspect(s: InstalledService): Promise<{ kid: string; port: number }>;
  probe(port: number): Promise<Health | null>;
  holder(port: number): Promise<string | null>;
  control(root: string, what: 'start' | 'stop' | 'restart'): Promise<unknown>;
  open(target: string): void;
  spawnHelper(on: { message(m: HelperMessage): void; exit(code: number | null): void }): TrayHelper;
  note(text: string): void;
  pollMs?: number;
  helperRestartMs?: number;
}

export const QUIT_CONFIRM = {
  id: 'quit',
  title: '孩子正在和老师通话',
  body: '现在退出会挂断这通电话,孩子的平板也打不开了,下次登录这台电脑后自动恢复。确定退出吗?',
  yes: '退出',
  no: '先不退出',
};

/** 主循环:问状态、发给显示脚本、接点击;都退了才返回退出码。0 = 不用再起(点了退出、没有服务了、没有桌面) */
export function runTray(d: TrayDeps): Promise<number> {
  return new Promise((resolve) => {
    const model = new TrayModel({ platform: d.platform, version: d.version });
    const pollMs = d.pollMs ?? TRAY_POLL_MS;
    const holders = new Map<string, { at: number; who: string | null }>();
    let helper: TrayHelper | null = null;
    let shown = '';
    let rows: TrayRow[] = [];
    let services: InstalledService[] = [];
    let stopping = false;
    let ticking = false;
    let again = false;
    let timer: NodeJS.Timeout | null = null;
    let finished = false;

    const finish = (code: number): void => {
      if (finished) return;
      finished = true;
      stopping = true;
      if (timer) clearTimeout(timer);
      resolve(code);
    };
    const quitAll = async (): Promise<void> => {
      stopping = true;
      if (timer) clearTimeout(timer);
      for (const s of services) {
        try { await d.control(s.root, 'stop'); } catch (err) { d.note(`停 ${s.name} 没成:${String(err)}`); }
      }
      d.note('退出:服务都停了');
      if (helper) { helper.send({ type: 'quit' }); helper.close(); }
      // 显示脚本不退也不等它
      setTimeout(() => finish(0), 3000).unref();
    };
    const control = (name: string, what: 'start' | 'restart'): void => {
      const s = services.find((x) => x.name === name);
      if (!s) return;
      model.expect(name, d.now());
      void d.control(s.root, what).catch((err: unknown) => {
        d.note(`${what} ${name} 没成:${String(err)}`);
        helper?.send({ type: 'notify', title: 'cotutor 没起来', body: err instanceof UsageError ? err.message : '看看日志' });
      }).finally(() => { void tick(); });
      void tick();
    };
    const onClick = (id: string): void => {
      d.note(`点了 ${id}`);
      if (id === 'quit') {
        if (rows.some((r) => r.calls > 0)) helper?.send({ type: 'confirm', ...QUIT_CONFIRM });
        else void quitAll();
        return;
      }
      const at = id.indexOf(':');
      const what = id.slice(0, at);
      const r = rows.find((x) => x.name === id.slice(at + 1));
      if (!r) return;
      if ((what === 'open' || what === 'update') && r.url) d.open(r.url);
      else if (what === 'logs' && r.logDir) d.open(r.logDir);
      else if (what === 'start' || what === 'restart') control(r.name, what);
      else if (what === 'fix' && r.fix) {
        if (r.fix.kind === 'restart') control(r.name, 'restart');
        else d.open(r.fix.target);
      }
    };
    const startHelper = (): void => {
      helper = d.spawnHelper({
        message(m) {
          if (m.type === 'ready') { shown = ''; void tick(); }
          else if (m.type === 'click' && m.id) onClick(m.id);
          else if (m.type === 'confirm' && m.id === 'quit' && m.yes) void quitAll();
          else if (m.type === 'error') d.note(`显示脚本:${m.message ?? ''}`);
        },
        exit(code) {
          helper = null;
          if (stopping) { finish(0); return; }
          if (code === HELPER_NO_SESSION) { d.note('这个会话没有桌面,不显示图标'); finish(0); return; }
          d.note(`显示脚本退了(${code ?? '?'}),隔一会儿再起`);
          setTimeout(() => { if (!stopping) startHelper(); }, d.helperRestartMs ?? HELPER_RESTART_MS).unref();
        },
      });
    };
    const tick = async (): Promise<void> => {
      if (stopping) return;
      if (ticking) { again = true; return; }
      ticking = true;
      if (timer) clearTimeout(timer);
      try {
        services = await d.list();
        if (!services.length) {
          // 服务都卸了:图标也没事可做
          stopping = true;
          d.note('没有后台服务了,退出');
          if (helper) { helper.send({ type: 'quit' }); helper.close(); }
          setTimeout(() => finish(0), 3000).unref();
          return;
        }
        const now = d.now();
        const probes: TrayProbe[] = [];
        for (const s of services) {
          const w = await d.inspect(s);
          const health = await d.probe(w.port);
          let holder: string | null = null;
          if (!health) {
            const c = holders.get(s.name);
            if (c && now - c.at < HOLDER_EVERY_MS) holder = c.who;
            else {
              holder = await d.holder(w.port);
              holders.set(s.name, { at: now, who: holder });
            }
          } else holders.delete(s.name);
          probes.push({ name: s.name, kid: w.kid, root: s.root, logDir: s.logDir, port: w.port, health, holder });
        }
        const r = model.update(probes, d.now());
        rows = r.rows;
        const show = trayShow(rows);
        const text = JSON.stringify(show);
        if (helper && text !== shown) {
          helper.send(show);
          shown = text;
          d.note(`显示:${show.icon} ${show.tip}`);
        }
        for (const n of r.notes) { helper?.send(n); d.note(`通知:${n.title}`); }
        const newer = rows.find((x) => x.update)?.update;
        if (newer && helper && newer !== d.updateSeen()) {
          const n = updateNote(newer, d.platform);
          helper.send(n);
          d.setUpdateSeen(newer);
          d.note(`通知:${n.title}`);
        }
      } catch (err) {
        d.note(`这一轮出错:${String(err)}`);
      } finally {
        ticking = false;
        if (!stopping) {
          if (again) { again = false; void tick(); }
          else timer = setTimeout(() => { void tick(); }, pollMs);
        }
      }
    };
    startHelper();
  });
}

// ---- 真的那一套:文件放哪、怎么起显示脚本、登录项 ----

export const traySupported = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'win32';

type HostPaths = Pick<ServiceHost, 'platform' | 'home' | 'env'>;

/** 显示脚本、图标、日志放哪 */
export function trayDir(host: HostPaths): string {
  if (host.platform === 'win32') return join(host.env.LOCALAPPDATA || join(host.home, 'AppData', 'Local'), 'cotutor', 'tray');
  return join(host.home, 'Library', 'Application Support', 'cotutor', 'tray');
}

const offMark = (dir: string): string => join(dir, 'off');
const plistFile = (host: HostPaths): string => join(host.home, 'Library', 'LaunchAgents', `${TRAY_LABEL}.plist`);
const launcherFile = (dir: string): string => join(dir, 'start.js');

/** 图标改了画法就改这个数,已经写过的会重写 */
const ASSETS_VERSION = 1;

/** 写显示脚本(每次起来都写,升级后马上生效)和图标(版本变了才画,画一次要几百毫秒) */
export async function writeTrayFiles(platform: NodeJS.Platform, dir: string): Promise<string> {
  const icons = join(dir, 'icons');
  await mkdir(icons, { recursive: true });
  const stamp = join(icons, `v${ASSETS_VERSION}`);
  if (!existsSync(stamp)) {
    const all = platform === 'win32' ? windowsTrayIcons() : macTrayIcons();
    for (const [name, png] of Object.entries(all)) await writeFile(join(icons, name), png);
    await writeFile(stamp, '');
  }
  if (platform === 'win32') {
    const file = join(dir, 'tray.ps1');
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(WINDOWS_TRAY_SCRIPT, 'utf8')]));
    return file;
  }
  const file = join(dir, 'tray.js');
  await writeFile(file, MAC_TRAY_SCRIPT);
  return file;
}

/** 起显示脚本 */
export function spawnTrayHelper(platform: NodeJS.Platform, file: string, dir: string, note: (t: string) => void, on: { message(m: HelperMessage): void; exit(code: number | null): void }): TrayHelper {
  const env = { ...process.env, COTUTOR_TRAY_DIR: dir };
  const child: ChildProcess = platform === 'win32'
    ? spawn('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env })
    : spawn('/usr/bin/osascript', ['-l', 'JavaScript', file], { stdio: ['pipe', 'pipe', 'pipe'], env });
  child.once('error', (err) => { note(`显示脚本起不来:${err.message}`); });
  child.once('exit', (code) => on.exit(code));
  child.stdin?.on('error', () => undefined);
  if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => {
    try { on.message(JSON.parse(line) as HelperMessage); } catch { note(`显示脚本:${line}`); }
  });
  if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => { if (line.trim()) note(`显示脚本:${line}`); });
  return {
    send(m) { child.stdin?.write(`${JSON.stringify(m)}\n`); },
    close() { child.stdin?.end(); },
  };
}

/**
 * 打开地址或目录用什么命令。windowsHide 不弹黑窗口。
 * detached 不能省:Windows 上非 detached 的子进程在「父进程退出就杀」的 job 里(libuv),cotutor open、service install 起完马上退,cmd 还没把地址交给浏览器就被一起杀了。
 * 退出码是 0、地址也打印了,就是没打开,也不报错(2026-11-07 真机);托盘进程一直开着,所以光点图标看不出来。
 */
export function openCommand(platform: NodeJS.Platform, target: string): { cmd: string; args: string[]; options: SpawnOptions } {
  const [cmd, args] = platform === 'darwin' ? ['/usr/bin/open', [target]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : ['xdg-open', [target]];
  return { cmd: cmd as string, args: args as string[], options: { stdio: 'ignore', windowsHide: true, detached: true } };
}

export function openTarget(platform: NodeJS.Platform, target: string): void {
  const { cmd, args, options } = openCommand(platform, target);
  const child = spawn(cmd, args, options);
  child.on('error', () => undefined);
  child.unref();
}

/** 日志:一个文件,过 1 MB 换一次,只留上一份 */
export function trayNote(dir: string): (text: string) => void {
  const file = join(dir, 'tray.log');
  return (text) => {
    try {
      try { if (statSync(file).size > LOG_MAX) renameSync(file, `${file}.1`); } catch { /* 还没有 */ }
      appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
    } catch { /* 写不了日志不能把图标带倒 */ }
  };
}

/** 孩子叫什么、哪个端口:只读这两样,不加载 zod(托盘进程常驻,要轻);读不了就用服务名和缺省端口 */
export async function inspectService(s: InstalledService): Promise<{ kid: string; port: number }> {
  try {
    const c = JSON.parse(await readFile(join(s.root, 'cotutor.json'), 'utf8')) as { kid?: { name?: unknown; slug?: unknown }; server?: { port?: unknown } };
    const kid = typeof c.kid?.name === 'string' && c.kid.name ? c.kid.name : typeof c.kid?.slug === 'string' && c.kid.slug ? c.kid.slug : s.name;
    return { kid, port: typeof c.server?.port === 'number' ? c.server.port : DEFAULT_PORT };
  } catch {
    return { kid: s.name, port: DEFAULT_PORT };
  }
}

/** 真的依赖,给 runTray */
export function realTrayDeps(host: ServiceHost, dir: string, file: string, version: () => string): TrayDeps {
  const note = trayNote(dir);
  const seenFile = join(dir, 'update-seen');
  return {
    platform: host.platform,
    version,
    updateSeen: () => { try { return readFileSync(seenFile, 'utf8').trim() || null; } catch { return null; } },
    // 写不了就当没记住:最坏多弹一次
    setUpdateSeen: (v) => { try { writeFileSync(seenFile, `${v}\n`); } catch { /* 见上 */ } },
    note,
    now: () => Date.now(),
    list: () => listServices(host),
    inspect: inspectService,
    probe: (port) => probeHealth(port),
    holder: async (port) => (await portHolder(host, port))?.name ?? null,
    control: (root, what) => controlService(host, root, what),
    open: (target) => openTarget(host.platform, target),
    spawnHelper: (on) => spawnTrayHelper(host.platform, file, dir, note, on),
  };
}

/** 登录项跑的命令 */
export const trayArgs = (host: HostPaths, o: { node?: string; bin?: string } = {}): string[] => [o.node ?? stableNode(process.execPath), o.bin ?? binPath(), 'tray', 'run', '--dir', trayDir(host)];

/** macOS 的 LaunchAgent:登录就起,崩了拉起,以 0 退(点了退出)不拉 */
export function trayPlist(args: string[], dir: string, path: string): string {
  const str = (v: string): string => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- cotutor tray on 写的;改了会被下次盖掉。关掉:cotutor tray off -->
<plist version="1.0">
<dict>
  <key>Label</key>${str(TRAY_LABEL)}
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    ${str(a)}`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${str(path)}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key>${str(join(dir, 'launchd.log'))}
  <key>StandardErrorPath</key>${str(join(dir, 'launchd.log'))}
</dict>
</plist>
`;
}

async function stopWindowsTray(host: ServiceHost, dir: string): Promise<void> {
  const procs = parseProcs((await host.run('powershell.exe', psArgs(findTrayScript(dir)))).stdout);
  for (const p of procs) await host.run('taskkill.exe', ['/PID', String(p.pid), '/T', '/F']);
}

/** 装上并起来;已经装过就照现在的 node、bin 重写一遍再起(升级后新代码才生效)。started = false:登录项写好了,这个会话里起不来,下次登录出现 */
export async function installTray(host: ServiceHost, o: { node?: string; bin?: string } = {}): Promise<{ file: string; started: boolean }> {
  if (!traySupported(host.platform)) throw new UsageError(`${host.platform} 上没做托盘图标:cotutor service status 看状态`);
  const dir = trayDir(host);
  await mkdir(dir, { recursive: true });
  await rm(offMark(dir), { force: true });
  const args = trayArgs(host, o);
  if (host.platform === 'win32') {
    await stopWindowsTray(host, dir);
    const file = launcherFile(dir);
    await writeFile(file, encodeLauncher(trayLauncher(winCommandLine(args))));
    const reg = await host.run('reg.exe', ['add', RUN_KEY, '/v', TRAY_RUN_VALUE, '/t', 'REG_SZ', '/d', runValue(wscriptPath(host), file), '/f']);
    if (reg.code !== 0) throw new UsageError(`写登录项没成:${(reg.stderr || reg.stdout).trim()}`);
    await host.run('reg.exe', ['delete', STARTUP_APPROVED_KEY, '/v', TRAY_RUN_VALUE, '/f']);
    const r = await host.run(wscriptPath(host), ['//B', '//Nologo', file]);
    return { file, started: r.code === 0 };
  }
  const file = plistFile(host);
  await mkdir(join(host.home, 'Library', 'LaunchAgents'), { recursive: true });
  await launchdUnload(host, `gui/${host.uid}/${TRAY_LABEL}`);
  await writeFile(file, trayPlist(args, dir, host.env.PATH ?? '/usr/bin:/bin'));
  const r = await launchdLoad(host, file);
  return { file, started: r.code === 0 };
}

/** 卸掉:停下、删登录项。remember = 家长说不要(以后 service install 也不再装) */
export async function removeTray(host: ServiceHost, o: { remember?: boolean } = {}): Promise<boolean> {
  if (!traySupported(host.platform)) return false;
  const dir = trayDir(host);
  const had = (await trayStatus(host)).installed;
  if (host.platform === 'win32') {
    await stopWindowsTray(host, dir);
    await host.run('reg.exe', ['delete', RUN_KEY, '/v', TRAY_RUN_VALUE, '/f']);
    await host.run('reg.exe', ['delete', STARTUP_APPROVED_KEY, '/v', TRAY_RUN_VALUE, '/f']);
    await host.run('reg.exe', ['delete', `HKCU\\Software\\Classes\\AppUserModelId\\${TRAY_AUMID}`, '/f']);
    await host.run('reg.exe', ['delete', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${TRAY_AUMID}`, '/f']);
    await rm(launcherFile(dir), { force: true });
  } else {
    await host.run('launchctl', ['bootout', `gui/${host.uid}/${TRAY_LABEL}`]);
    await rm(plistFile(host), { force: true });
  }
  if (o.remember) {
    await mkdir(dir, { recursive: true });
    await writeFile(offMark(dir), '');
  }
  return had;
}

export interface TrayStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  pid: number | null;
  /** 家长关掉过(cotutor tray off) */
  off: boolean;
  /** Windows:下次登录还会不会起来;别的系统 null */
  autostart: boolean | null;
}

export async function trayStatus(host: ServiceHost): Promise<TrayStatus> {
  if (!traySupported(host.platform)) return { supported: false, installed: false, running: false, pid: null, off: false, autostart: null };
  const dir = trayDir(host);
  const off = existsSync(offMark(dir));
  if (host.platform === 'win32') {
    const installed = existsSync(launcherFile(dir));
    const procs = parseProcs((await host.run('powershell.exe', psArgs(findTrayScript(dir)))).stdout);
    const autostart = installed && (await host.run('reg.exe', ['query', RUN_KEY, '/v', TRAY_RUN_VALUE])).code === 0 && !startupDisabled((await host.run('reg.exe', ['query', STARTUP_APPROVED_KEY, '/v', TRAY_RUN_VALUE])).stdout);
    return { supported: true, installed, running: procs.length > 0, pid: procs[0]?.pid ?? null, off, autostart };
  }
  const installed = existsSync(plistFile(host));
  const r = await host.run('launchctl', ['print', `gui/${host.uid}/${TRAY_LABEL}`]);
  const st = r.code === 0 ? parseLaunchctlPrint(r.stdout) : { running: false, pid: null };
  return { supported: true, installed, running: st.running, pid: st.pid, off, autostart: null };
}

/** service install 时跟着装:没做的系统、家长关掉过都跳过;返回给人看的结果 */
export async function ensureTray(host: ServiceHost, o: { node?: string; bin?: string } = {}): Promise<'unsupported' | 'off' | 'started' | 'later'> {
  if (!traySupported(host.platform)) return 'unsupported';
  if (existsSync(offMark(trayDir(host)))) return 'off';
  return (await installTray(host, o)).started ? 'started' : 'later';
}

/** service restart 时:图标进程也换上新代码(升级后跑的就是这条)。没开图标的不动,不能把 --no-tray 的装回来 */
export async function refreshTray(host: ServiceHost): Promise<boolean> {
  if (!traySupported(host.platform)) return false;
  if (!(await trayStatus(host)).installed) return false;
  await installTray(host);
  return true;
}

/** 服务卸完了:图标也撤(不算家长说不要,以后再装服务还会带上) */
export async function dropTrayIfNoServices(host: ServiceHost): Promise<boolean> {
  if (!traySupported(host.platform)) return false;
  if ((await listServices(host)).length) return false;
  return removeTray(host);
}
