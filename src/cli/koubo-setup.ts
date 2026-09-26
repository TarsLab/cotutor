/**
 * 口播老师开着时 workspace 要多的几样(《口播老师设计.md》§8;技能在 skills.ts 的 onlyWith 里,壳脚本每次都写):
 * - koubo 的工作区就是 workspace 根:跑一次 `koubo init <root>`(幂等补骨架,koubo.json 永不自动重建);
 * - .gitignore 补一行 takes/**\/*.wav(koubo 拷进来的录音;照 koubo 自己的缺省,体积大、私密)。
 * 口播老师关着就什么都不做。init 与 upgrade 都调;失败只报一行,不挡别的。
 */
import { execFile } from 'node:child_process';
import { access, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { KOUBO_SHIM, kouboBin, type SkillStep } from './skills.ts';

const execFileP = promisify(execFile);
const IGNORE_LINE = 'takes/**/*.wav';

export async function kouboTutorOn(root: string): Promise<boolean> {
  try {
    const cfg = JSON.parse(await readFile(join(root, 'cotutor.json'), 'utf8')) as { tutors?: Record<string, { enabled?: unknown }> };
    return cfg.tutors?.['koubo-tutor']?.enabled === true;
  } catch {
    return false;
  }
}

export async function setupKoubo(root: string): Promise<SkillStep[]> {
  if (!(await kouboTutorOn(root))) return [];
  const steps: SkillStep[] = [];
  const hadConfig = await access(join(root, 'koubo.json')).then(() => true, () => false);
  if (!kouboBin()) steps.push({ item: 'koubo.json', action: 'kept', note: 'node_modules 里没有 koubo(仓库根 pnpm install),口播老师的录音评不了' });
  else {
    try {
      await execFileP(join(root, KOUBO_SHIM), ['init', root, '--json'], { cwd: root, timeout: 30_000 });
      steps.push({ item: 'koubo.json', action: hadConfig ? 'exists' : 'created', note: hadConfig ? 'koubo 工作区已在(koubo init 补了缺的目录)' : 'koubo 的政策文件:填凭据、确认 cloud 段,koubo doctor --live 验' });
    } catch (err) {
      steps.push({ item: 'koubo.json', action: 'kept', note: `koubo init 没成:${(err as Error).message.split('\n')[0]}` });
    }
  }
  const gi = join(root, '.gitignore');
  const text = await readFile(gi, 'utf8').catch(() => null);
  if (text !== null && !text.split('\n').includes(IGNORE_LINE)) {
    await appendFile(gi, `${text.endsWith('\n') ? '' : '\n'}# koubo 拷进来的录音(口播老师):体积大、私密,评测 JSON 可以入库\n${IGNORE_LINE}\n`);
    steps.push({ item: '.gitignore', action: 'replaced', note: `补了 ${IGNORE_LINE}` });
  }
  return steps;
}
