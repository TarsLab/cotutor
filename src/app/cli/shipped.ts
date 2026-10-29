/** 所有出厂件共用的来源记录;修改时保留其他种类的 hash。 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { UsageError } from '../workspace.ts';

export const SHIPPED_FILE = '.cotutor/shipped.json';

export interface ShippedManifest {
  /** 已安装的出厂教学包;旧版缺省按二年级迁移,与孩子当前年级分开。 */
  teachingPack?: { grade: number };
  /** 出厂 skill(drawtell 的四个领域 skill + 本包的机器件)的 hash,与 tutors 同一套机制(src/app/cli/skills.ts) */
  skills?: Record<string, { hash: string; version: string }>;
  /** 出厂主题(themes/<name>/)的目录 hash,同一套机制(src/app/cli/themes.ts) */
  themes?: Record<string, { hash: string; version: string }>;
  /** 出厂 activity(agents/<老师>/activities/<名>.md,键是「老师/名」),同一套机制(src/app/cli/activities.ts) */
  activities?: Record<string, { hash: string; version: string }>;
  version: string;
  tutors: Record<string, { hash: string; version: string }>;
}

export const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export async function readManifest(root: string): Promise<ShippedManifest> {
  let text: string;
  try { text = await readFile(join(root, SHIPPED_FILE), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: '0', tutors: {} };
    throw err;
  }
  try {
    const raw = JSON.parse(text) as ShippedManifest;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('顶层要是对象');
    if (raw.teachingPack !== undefined && (!raw.teachingPack || !Number.isInteger(raw.teachingPack.grade) || raw.teachingPack.grade < 1 || raw.teachingPack.grade > 6)) throw new Error('teachingPack.grade 要是 1–6 的整数');
    for (const key of ['tutors', 'activities', 'skills', 'themes'] as const) {
      const records = raw[key];
      if (records === undefined) continue;
      if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error(`${key} 要是对象`);
      for (const rec of Object.values(records)) {
        if (!rec || typeof rec.hash !== 'string' || typeof rec.version !== 'string') throw new Error(`${key} 的记录要有 hash 和 version`);
      }
    }
    return { ...raw, version: raw.version ?? '0', tutors: raw.tutors ?? {} };
  } catch (err) {
    throw new UsageError(`${join(root, SHIPPED_FILE)} 出厂记录用不了:${(err as Error).message}。请恢复或修复记录,不会重置 hash 或猜测年级。`);
  }
}

export async function writeManifest(root: string, m: ShippedManifest): Promise<void> {
  const file = join(root, SHIPPED_FILE);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ...m, _note: '出厂时老师文件的 hash,cotutor upgrade 据此分辨「没改过」与「改过」;机器写,不用手改' }, null, 2)}\n`);
  await rename(tmp, file);
}
