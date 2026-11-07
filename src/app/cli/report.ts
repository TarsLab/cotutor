/**
 * 诊断信息(cotutor report、家长端「设置」里的「生成诊断信息」):出了问题时一次说清,发给开发者或帮忙的 AI 助手,不用来回问。
 * 不含孩子的对话、照片、录音、档案和 key。只收:版本和系统、服务状态、体检没过的、最近出错的那几轮的原因(不要孩子说了什么)、日志里报错的行、孩子端页面的报错。
 * 孩子的名字、key、业务空间、电脑名、IP、用户名一律抹掉(scrub),最后整篇再抹一遍。给人先看再发,不自动上传。
 */
import { arch, homedir, hostname, platform, release, userInfo } from 'node:os';
import { localDate } from '../../shared/time.ts';
import { dashscopeAuth } from '../../realtime/bailian.ts';
import { listDates, readIndex } from '../../runtime/journal/store.ts';
import { readKidLog } from '../../runtime/journal/kid-log.ts';
import { BUILD } from '../build.ts';
import type { Workspace } from '../workspace.ts';
import { listTutors } from '../../schema/config.ts';
import { doctorWorkspace } from './doctor.ts';
import { listBackups } from './backup.ts';
import { findService, realHost, tailLog, type Health } from './service.ts';
import { trayStatus } from './tray.ts';
import { computerName } from './serve.ts';

const DAYS = 7;
const MAX_LINE = 180;
const MAX_ERRORS = 15;
const LOG_ERROR = /error|fail|失败|没成|崩|exception|ENO[A-Z]+|EADDR|EPERM|EACCES/i;

const cut = (s: string, n = MAX_LINE): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 抹掉能认出这家人的东西。太短的(一个字的小名)不抹,不然满篇都被替换 */
export function scrub(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text.replace(/sk-[A-Za-z0-9._-]{4,}/g, 'sk-***').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (ip === '127.0.0.1' ? ip : '<IP>'));
  const home = homedir();
  if (home) out = out.split(home).join('$HOME');
  const list = [...new Set(secrets.filter((s): s is string => typeof s === 'string' && s.trim().length >= 2))].sort((a, b) => b.length - a.length);
  for (const s of list) out = out.split(s).join('<隐去>');
  return out;
}

/** 这家人的名字们 */
function secretsOf(ws: Workspace, env: NodeJS.ProcessEnv): string[] {
  const auth = dashscopeAuth(env);
  let user = '';
  try { user = userInfo().username; } catch { /* 没有也行 */ }
  const name = computerName();
  return [ws.config.kid.name, ws.config.kid.slug, ws.config.title, auth?.workspaceId, auth?.key, user, name, `${name}.local`, hostname()].filter((s): s is string => Boolean(s));
}

const DATE_N = (now: Date, n: number): string[] => Array.from({ length: n }, (_, i) => localDate(new Date(now.getTime() - i * 24 * 3600_000)));

/** 最近几天没成的那几轮:只要原因,不要内容 */
async function failedTurns(ws: Workspace, now: Date): Promise<string[]> {
  const out: string[] = [];
  const since = DATE_N(now, DAYS).at(-1) as string;
  for (const t of listTutors(ws.config)) {
    for (const date of (await listDates(ws, t.name).catch(() => [] as string[])).filter((d) => d >= since)) {
      const index = await readIndex(ws, t.name, date).catch(() => null);
      for (const m of index?.messages ?? []) if (m.result === 'error') out.push(`${date} ${t.name} ${cut(String(m.error ?? '没说原因'), 120)}`);
    }
  }
  return out.sort().reverse().slice(0, MAX_ERRORS);
}

/** 孩子端页面报的错:错误信息和位置,不要上下文(ctx 里可能有孩子正在做的) */
async function kidErrors(ws: Workspace, now: Date): Promise<string[]> {
  const rows = await readKidLog(ws, DATE_N(now, DAYS)).catch(() => []);
  const seen = new Map<string, number>();
  for (const r of rows) if (r.k === 'error') {
    const key = `${r.page} ${cut(r.msg, 120)} @ ${cut(r.where, 60)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].slice(-MAX_ERRORS).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
}

/** 服务日志里报错的行 */
async function logErrors(logDir: string | null): Promise<string[]> {
  if (!logDir) return [];
  const t = await tailLog(logDir, 400).catch(() => null);
  return (t?.lines ?? []).filter((l) => LOG_ERROR.test(l)).slice(-MAX_ERRORS).map((l) => cut(l));
}

export interface ReportOptions {
  /** 在跑的服务答的;没在跑 null */
  health: Health | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export async function buildReport(ws: Workspace, o: ReportOptions): Promise<string> {
  const now = o.now ?? new Date();
  const env = o.env ?? process.env;
  const host = realHost();
  const h = o.health;
  const lines: string[] = [];
  const section = (title: string, items: string[]): void => {
    lines.push('', `## ${title}`);
    lines.push(...(items.length ? items.map((s) => `- ${s}`) : ['- 没有']));
  };
  lines.push('# cotutor 诊断信息', '不含孩子的对话、照片、录音、档案和 key;孩子的名字、电脑名、IP 已隐去。', '');
  lines.push(`- 版本:${BUILD.version ?? '?'}${BUILD.commit ? `(从仓库跑的,${BUILD.commit.slice(0, 7)})` : ''}`);
  lines.push(`- 系统:${platform()} ${release()} ${arch()};Node ${process.version}`);
  lines.push(`- 时间:${now.toISOString()}`);

  const s = await findService(host, ws.root).catch(() => null);
  const tray = await trayStatus(host).catch(() => null);
  const running = h ? `在跑(${h.mode === 'service' ? '后台服务' : '终端里'},版本 ${h.version ?? '?'},起来于 ${h.started},走 ${h.scheme ?? '?'})` : '没答应';
  section('服务', [
    running,
    `后台服务:${s ? '装了' : '没装'}`,
    tray?.supported ? `图标:${tray.installed ? (tray.running ? '在跑' : '装了,没在跑') : '没装'}` : '图标:这个系统上没有',
    ...(h?.bailianTrouble ? [`百炼故障:${h.bailianTrouble.kind}(${h.bailianTrouble.why ?? ''})`] : []),
    ...(h?.configError ? [`配置:${cut(h.configError)}`] : []),
  ]);

  const doc = await doctorWorkspace(ws.root, { probeEnv: true, firewall: false, now, env }).catch(() => null);
  section('体检没过的', doc ? doc.checks.filter((c) => !c.ok).map((c) => `${c.required ? '必需' : '建议'} ${c.name}:${cut(c.detail, 140)}`) : ['体检没跑成']);

  const backups = await listBackups(ws.root).catch(() => []);
  section('备份', backups[0] ? [`最近一份 ${backups[0].at}(${backups[0].why}),共 ${backups.length} 份`] : ['还没有']);
  section(`最近 ${DAYS} 天没成的话题(只有原因)`, await failedTurns(ws, now));
  section('服务日志里报错的行', await logErrors(s?.logDir ?? null));
  section(`孩子端页面最近 ${DAYS} 天的报错`, await kidErrors(ws, now));
  return `${scrub(lines.join('\n'), secretsOf(ws, env))}\n`;
}
