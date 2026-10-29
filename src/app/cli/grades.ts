/** 年级包只负责出厂来源;运行时继续读 workspace 里的家长文件。 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from './shipped.ts';
import { UsageError } from '../workspace.ts';

export const DEFAULT_GRADE = 2;
/** 历史出厂内容永远归二年级,不能随未来新安装的默认年级变化。 */
export const LEGACY_GRADE = 2;
export const PACKAGE_GRADES_DIR = fileURLToPath(new URL('../../../grades/', import.meta.url));
export interface GradePack { grade: number; dir: string; agentsDir: string }

/** 不把任意字符串拼进路径。缺文件的包不算可安装。 */
export async function gradePacks(base = PACKAGE_GRADES_DIR): Promise<GradePack[]> {
  const entries = await readdir(base, { withFileTypes: true });
  const packs: GradePack[] = [];
  for (const e of entries) {
    const match = /^grade-([1-6])$/.exec(e.name);
    if (!e.isDirectory() || !match) continue;
    const dir = join(base, e.name);
    const agentsDir = join(dir, 'agents');
    const required = ['chinese-tutor', 'math-tutor', 'english-tutor'];
    if (!(await stat(join(dir, 'README.md')).catch(() => null))?.isFile()) continue;
    if (!(await Promise.all(required.map(async (name) =>
      (await stat(join(agentsDir, `${name}.md`)).catch(() => null))?.isFile()
      && (await stat(join(agentsDir, name, 'activities')).catch(() => null))?.isDirectory(),
    ))).every(Boolean)) continue;
    packs.push({ grade: Number(match[1]), dir, agentsDir });
  }
  return packs.sort((a, b) => a.grade - b.grade);
}

export async function requireGradePack(grade: number, base = PACKAGE_GRADES_DIR): Promise<GradePack> {
  if (!Number.isInteger(grade) || grade < 1 || grade > 6) throw new UsageError('年级要是 1–6 的整数,如 --grade 2');
  const packs = await gradePacks(base);
  const pack = packs.find((p) => p.grade === grade);
  if (!pack) throw new UsageError(`本包没有完整的 ${grade} 年级教学包;可用年级:${packs.map((p) => p.grade).join('、') || '无'}。不会自动使用其他年级。`);
  return pack;
}

/** 没有来源字段的旧版内容来自现在的二年级包;不据此修改孩子档案。 */
export async function workspaceGradePack(root: string): Promise<GradePack> {
  const manifest = await readManifest(root);
  return requireGradePack(manifest.teachingPack?.grade ?? LEGACY_GRADE);
}
