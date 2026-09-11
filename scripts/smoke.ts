/**
 * 发布前的出厂检查:体检的是**要发的那份**(dist + agents/),不是仓库里直跑的 src。
 * bin 在仓库内优先走 src,所以 dist 的坏掉在本地跑不出来;prepublishOnly 在 build 之后跑这个。
 * 跑法:pnpm build && node --experimental-strip-types scripts/smoke.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
  exports: Record<string, { types?: string; default?: string } | string>;
};
const problems: string[] = [];
const need = (ok: unknown, what: string): void => void (ok || problems.push(what));

// 1. exports 与 bin 指到的文件都在(打错一个字,消费者 import 才炸)
for (const [sub, target] of Object.entries(pkg.exports)) {
  for (const f of typeof target === 'string' ? [target] : [target.types, target.default]) {
    if (f) need(existsSync(join(root, f)), `exports "${sub}" 指向的 ${f} 不在`);
  }
}
for (const [name, f] of Object.entries(pkg.bin)) need(existsSync(join(root, f)), `bin "${name}" 指向的 ${f} 不在`);

// 2. dist 的入口真能跑,--version 报的是版本号(旗标解析回归过一次)
const { main } = await import(new URL('../dist/cli/main.js', import.meta.url).href) as { main: (argv: string[]) => Promise<void> };
const write = process.stdout.write;
let out = '';
process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
try {
  await main(['--version']);
} finally {
  process.stdout.write = write;
}
need(out.trim() === pkg.version, `dist 的 --version 报 ${JSON.stringify(out)},应是 ${pkg.version}`);

// 3. 老师定义从 dist 出发要能找到,且随包发出去(init 靠它建链)
const { PACKAGE_AGENTS_DIR } = await import(new URL('../dist/cli/skeleton.js', import.meta.url).href) as { PACKAGE_AGENTS_DIR: string };
need(PACKAGE_AGENTS_DIR === join(root, 'agents/'), `dist 算出的 agents 目录是 ${PACKAGE_AGENTS_DIR}`);
const shipped = existsSync(PACKAGE_AGENTS_DIR) ? readdirSync(PACKAGE_AGENTS_DIR).filter((f) => f.endsWith('.md')) : [];
need(shipped.length >= 5, `agents/ 里只有 ${shipped.length} 份老师定义`);

// 4. 舞台包打过了(dist/stage 不在 git 里;没打的话孩子端重卡舞台开不了)
const { STAGE_DIR, FONTS_DIR } = await import(new URL('../dist/server/stage.js', import.meta.url).href) as { STAGE_DIR: string; FONTS_DIR: string };
const stageFiles = ['index.html', 'stage.js', 'stage.css'];
for (const f of stageFiles) need(existsSync(join(STAGE_DIR, f)), `舞台包缺 dist/stage/${f}(pnpm run build:stage)`);
// 2026-09-11 起舞台包是拆开的:stage.js 只有二十来 K,肉在 chunk-*.js 里(excalidraw 的懒加载块),
// 所以按整包大小与 chunk 个数判断「打全了没有」,不看入口文件本身
const stageJs = existsSync(STAGE_DIR) ? readdirSync(STAGE_DIR).filter((f) => f.endsWith('.js')) : [];
const stageKb = Math.round(stageJs.reduce((n, f) => n + statSync(join(STAGE_DIR, f)).size, 0) / 1024);
need(stageJs.length > 10, `dist/stage 里只有 ${stageJs.length} 个 js,拆包后应该有上百个 chunk(pnpm run build:stage)`);
need(stageKb > 3000, `dist/stage 的 js 合计只有 ${stageKb} KB,不像打全了`);

// 5. 运行期要的两个外部件:drawtell CLI(壳脚本 .cotutor/drawtell 指过去)与 excalidraw 字体(/stage/fonts/ 现取,不进包)
const { drawtellBin, packageSkillsDir, SHIPPED_SKILLS } = await import(new URL('../dist/cli/skills.js', import.meta.url).href) as {
  drawtellBin: () => string | null;
  packageSkillsDir: () => string | null;
  SHIPPED_SKILLS: readonly string[];
};
const bin = drawtellBin();
need(bin && existsSync(bin), `node_modules 里没有 drawtell 的 bin(${bin ?? '解析不到包'});场景作业跑不了`);
const skillsDir = packageSkillsDir();
need(skillsDir && existsSync(skillsDir), `node_modules 里没有 drawtell-skills 的 skills/(${skillsDir ?? '解析不到包'})`);
if (skillsDir) for (const s of SHIPPED_SKILLS) need(existsSync(join(skillsDir, s, 'SKILL.md')), `drawtell-skills 缺 ${s}/SKILL.md`);
need(existsSync(FONTS_DIR), `node_modules 里没有 excalidraw 的字体目录(${FONTS_DIR});/stage/fonts/ 会 404,舞台里中文字形回退`);

// 6. 依赖不能带 link:(link 的包发出去装不上)
const deps = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies;
for (const [name, range] of Object.entries(deps)) {
  need(!/^(link|file|workspace):/.test(range), `dependencies 里 ${name} 还是 ${range},发版前要换成版本号`);
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('出厂检查不过,别发');
  process.exit(1);
}
console.log(`出厂检查通过:cotutor ${pkg.version},${shipped.length} 位老师,${Object.keys(pkg.exports).length} 个 export,舞台包 ${stageKb} KB`);
