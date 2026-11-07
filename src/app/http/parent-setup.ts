/**
 * 家长端「还差几步」、备份、诊断信息。第一次打开家长端,家长要知道接下来做什么,不用开终端跑 doctor。
 *
 *   GET  /api/parent/setup          {steps: [{id, done, required, title, detail, commands?, grades?}]}
 *   POST /api/parent/setup/grade    {grade: 1-6}:档案没写学期时,按年级算出 school_start 写进档案
 *   GET  /api/parent/report         {text}:诊断信息(cli/report.ts,已抹掉名字和 key,给人先看再发)
 *   GET  /api/parent/backups        {dir, list: [...], commands}(给家长抄的命令,Windows 上带 .cmd)
 *   POST /api/parent/backups        现在备份一份
 *
 * 步骤用 doctor 的结果,不另查一遍;只挑家长要动手的那几项,说家长听得懂的话。别的(老师文件、技能)doctor --fix 能修,不打扰家长。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { schoolStartFor, setSchoolStart } from '../../memory/vault-notes.ts';
import { scanVault } from '../../memory/vault.ts';
import { readDevices } from '../../runtime/journal/kid-log.ts';
import { cliLine } from '../../shared/upgrade.ts';
import { redactHome } from '../workspace.ts';
import { BUILD } from '../build.ts';
import { backupsOf, listBackups, makeBackup } from '../cli/backup.ts';
import { doctorWorkspace } from '../cli/doctor.ts';
import { buildReport } from '../cli/report.ts';
import type { AppContext, RouteResult } from './app.ts';

export interface SetupStep {
  id: string;
  done: boolean;
  /** true = 不做孩子用不了;false = 建议 */
  required: boolean;
  title: string;
  detail: string;
  /** 要在这台电脑的终端里跑的 */
  commands?: string[];
  /** 这一步直接在页面上选年级 */
  grades?: boolean;
  link?: { href: string; text: string };
}

export async function setupSteps(ctx: AppContext): Promise<SetupStep[]> {
  const doc = await doctorWorkspace(ctx.ws.root, { probeEnv: true, firewall: false, now: ctx.now() });
  const by = (name: string) => doc.checks.find((c) => c.name === name);
  const devices = Object.keys(await readDevices(ctx.ws)).length;
  const https = Boolean(ctx.listen?.().https);
  const certOnDisk = by('https')?.ok === true;
  const profile = by('vault.profile');
  const steps: SetupStep[] = [
    { id: 'bailian', done: ctx.bailian.status().ready, required: true, title: '填百炼的 key', detail: '老师开口和写讲稿都靠它。在这一页下面「百炼」那块填,保存前会先试连。' },
    {
      id: 'https', done: https, required: true, title: '给平板签证书', detail: '平板上按住说话要 HTTPS。证书要在这台电脑上签一次,根证书还要装到平板上。',
      link: { href: 'https://github.com/TarsLab/cotutor/blob/main/docs/iPad与iPhone.md', text: '一步步的说明' },
      commands: (certOnDisk ? ['cotutor service restart'] : ['cotutor cert', 'cotutor service restart']).map((c) => cliLine(c)),
    },
    { id: 'tablet', done: devices > 0, required: true, title: '让孩子的平板连上', detail: '用平板的相机扫这一页上「扫码打开」的那张码。' },
  ];
  if (profile) steps.push({ id: 'semester', done: profile.ok, required: true, title: '告诉老师孩子几年级', detail: profile.ok ? profile.detail : '老师要知道现在是几年级哪个学期,才讲得对。', grades: !profile.ok });
  const access = by('server.access');
  if (access) steps.push({ id: 'pin', done: access.ok, required: false, title: '给家长端设个密码', detail: '现在连上家里网络的设备都能打开家长端。家长在旁边可以不设。', commands: [cliLine('cotutor pin')] });
  const sleep = by('mac.sleep') ?? by('windows.sleep');
  if (sleep) steps.push({ id: 'sleep', done: sleep.ok, required: false, title: '别让这台电脑睡着', detail: sleep.ok ? sleep.detail : sleep.fix ?? sleep.detail });
  return steps;
}

export async function parentSetupRoute(method: string, p: string, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
  if (p === '/api/parent/setup') {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    return { status: 200, json: { steps: await setupSteps(ctx) } };
  }
  if (p === '/api/parent/setup/grade') {
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    const grade = typeof body === 'object' && body !== null ? (body as { grade?: unknown }).grade : undefined;
    if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 1 || grade > 6) return { status: 400, json: { error: 'bad_request', message: '年级要 1 到 6' } };
    const found = (await scanVault(ctx.ws)).notes.find((n) => n.props.cotutor === 'profile');
    if (!found) return { status: 409, json: { error: 'no_profile', message: '还没有档案:在终端里跑 cotutor init 补一篇' } };
    if (found.props.school_start?.trim() || found.props.semester?.trim()) return { status: 409, json: { error: 'already_set', message: '档案里已经写了学期,要改就直接改档案' } };
    const file = join(ctx.ws.paths.vault, found.path);
    await writeFile(file, setSchoolStart(await readFile(file, 'utf8'), schoolStartFor(grade, ctx.now())));
    return { status: 200, json: { ok: true } };
  }
  if (p === '/api/parent/report') {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    const t = ctx.bailian.trouble();
    const text = await buildReport(ctx.ws, {
      now: ctx.now(),
      health: { version: BUILD.version, started: BUILD.started, mode: process.env.COTUTOR_SERVICE ? 'service' : 'foreground', scheme: ctx.listen?.().https ? 'https' : 'http', bailianTrouble: t, configError: ctx.configError },
    });
    return { status: 200, json: { text } };
  }
  if (p === '/api/parent/backups') {
    const target = { root: ctx.ws.root, vault: ctx.ws.paths.vault };
    if (method === 'POST') {
      try {
        const b = await makeBackup(target, { why: 'manual', version: BUILD.version, now: ctx.now() });
        return { status: 200, json: { ok: true, backup: b } };
      } catch (err) {
        return { status: 500, json: { error: 'backup_failed', message: err instanceof Error ? err.message : String(err) } };
      }
    }
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    return { status: 200, json: { dir: redactHome(backupsOf(ctx.ws.root)), list: await listBackups(ctx.ws.root), commands: { list: cliLine('cotutor backup list'), restore: cliLine('cotutor backup restore <名字> --yes') } } };
  }
  return null;
}
