/**
 * 读 activity 文件(从 app/cli/activities.ts 拆出来,2026-10-29,行为不变):在哪、每位老师有哪几个、按「名=值」的参数拼成一次跑。
 * 运行层每轮都要读,所以不放在命令行那一层;装、升级、还原、检查仍在 app/cli/activities.ts。
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseActivity, resolveParams } from './activity.ts';
import type { ActivityRun } from '../schema/index.ts';
import { UsageError } from '../shared/errors.ts';

export const ACTIVITIES_DIR = 'activities';

export interface ActivityRef {
  tutor: string;
  name: string;
  /** 文件的绝对路径 */
  file: string;
}

/** 例子文件(cotutor activity eval 用):和 activity 放在一起,`<名>.例子.md`;跟着 activity 一起出厂,检查时不当 activity */
export const EXAMPLES_SUFFIX = '.例子';

/** 某个根下(包的 agents/,或 workspace 的 agents/)每位老师的 activities/*.md;examples = 连例子文件一起(出厂、升级用) */
export async function listActivities(agentsDir: string, tutor?: string, opts: { examples?: boolean } = {}): Promise<ActivityRef[]> {
  const out: ActivityRef[] = [];
  const tutors = tutor ? [tutor] : (await readdir(agentsDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const t of tutors) {
    const dir = join(agentsDir, t, ACTIVITIES_DIR);
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) if (opts.examples || !f.slice(0, -3).endsWith(EXAMPLES_SUFFIX)) out.push({ tutor: t, name: f.slice(0, -3), file: join(dir, f) });
  }
  return out;
}

/** workspace 里那份的位置(就是这个名字,不认改过的名;装、升级、写都用它) */
export function activityFile(root: string, tutor: string, name: string): string {
  return join(root, 'agents', tutor, ACTIVITIES_DIR, `${name}.md`);
}

/**
 * 改过名的出厂 activity:旧名 → 新名。2026-11-03 批改 → 检查作业(孩子端方砖上的字)。
 * upgrade 把 workspace 里的旧文件挪成新名(src/app/cli/activities.ts);旧草稿里的 `activity 批改`、旧话题记的名字照样认(activityName)
 */
export const ACTIVITY_RENAMES: Readonly<Record<string, string>> = { 批改: '检查作业' };

/**
 * 这个名字在这位老师家里实际是哪个文件:有同名的就是它;旧名的文件挪走了认新名;新名的还没有(没 upgrade 过)认旧名。都没有 → 原样
 * (读的时候用:跑话题、首页检查、方砖;lint 的 fileName 也要用这个,不然 name 对不上)
 */
export function activityName(root: string, tutor: string, name: string): string {
  const has = (n: string): boolean => existsSync(activityFile(root, tutor, n));
  if (has(name)) return name;
  const to = ACTIVITY_RENAMES[name];
  if (to && has(to)) return to;
  const from = Object.keys(ACTIVITY_RENAMES).find((k) => ACTIVITY_RENAMES[k] === name);
  if (from && has(from)) return from;
  return name;
}

/** 读的时候找的那份:认改过的名(activityName) */
export function findActivityFile(root: string, tutor: string, name: string): string {
  return activityFile(root, tutor, activityName(root, tutor, name));
}

export async function activityRunFor(root: string, tutor: string, name: string, raw = ''): Promise<ActivityRun> {
  const file = findActivityFile(root, tutor, name);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) throw new UsageError(`${file} 不在;cotutor activity check ${tutor} 看这位老师有哪些`);
  const params: Record<string, string> = {};
  for (const pair of raw.split(/[;；]/).map((x) => x.trim()).filter(Boolean)) {
    // 值可以有几行(口语课的口语单)
    const m = /^([^=]+)=([\s\S]*)$/.exec(pair);
    if (!m) throw new UsageError(`--param 写成「名=值」,几个用 ; 隔开,如 --param '词=播种、羞愧;最多画=1'(「${pair}」不对)`);
    params[m[1].trim()] = m[2].trim();
  }
  const r = resolveParams(parseActivity(text).activity, params);
  if (r.issues.length) throw new UsageError(r.issues.join(';'));
  return { name, params: r.values };
}
