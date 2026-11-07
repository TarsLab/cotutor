/**
 * 发布前的出厂检查:体检的是**要发的那份**(dist + grades/),不是仓库里直跑的 src。
 * bin 在仓库内优先走 src,所以 dist 的坏掉在本地跑不出来;prepublishOnly 在 build 之后跑这个。
 * 跑法:pnpm build && node --experimental-strip-types scripts/smoke.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
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
const { main } = await import(new URL('../dist/app/cli/main.js', import.meta.url).href) as { main: (argv: string[]) => Promise<void> };
const write = process.stdout.write;
let out = '';
process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
try {
  await main(['--version']);
} finally {
  process.stdout.write = write;
}
need(out.trim() === pkg.version, `dist 的 --version 报 ${JSON.stringify(out)},应是 ${pkg.version}`);

// 3. 老师定义从 dist 出发要能找到,且随包发出去(init 靠它拷贝)
const { PACKAGE_AGENTS_DIR } = await import(new URL('../dist/app/cli/skeleton.js', import.meta.url).href) as { PACKAGE_AGENTS_DIR: string };
need(PACKAGE_AGENTS_DIR === join(root, 'grades', 'grade-2', 'agents'), `dist 算出的 agents 目录是 ${PACKAGE_AGENTS_DIR}`);
const shipped = existsSync(PACKAGE_AGENTS_DIR) ? readdirSync(PACKAGE_AGENTS_DIR).filter((f) => f.endsWith('.md')) : [];
need(shipped.length >= 3, `agents/ 里只有 ${shipped.length} 份老师定义`);
// 每个声明的年级都要完整,所有 activity 与对话例子都必须可解析。
const { gradePacks, PACKAGE_GRADES_DIR } = await import(new URL('../dist/app/cli/grades.js', import.meta.url).href) as typeof import('../src/app/cli/grades.ts');
const { listActivities } = await import(new URL('../dist/app/cli/activities.js', import.meta.url).href) as typeof import('../src/app/cli/activities.ts');
const { lintActivity } = await import(new URL('../dist/runtime/activity.js', import.meta.url).href) as typeof import('../src/runtime/activity.ts');
const { parseExamples } = await import(new URL('../dist/app/activity-eval-rules.js', import.meta.url).href) as typeof import('../src/app/activity-eval-rules.ts');
const packs = await gradePacks();
const declared = readdirSync(PACKAGE_GRADES_DIR).filter((d) => /^grade-[1-6]$/.test(d));
need(packs.length === declared.length && packs.length > 0, 'grades/ 有不完整的年级包(README、三位老师、activities 目录)');
for (const pack of packs) {
  for (const ref of await listActivities(pack.agentsDir, undefined, { examples: true })) {
    const text = readFileSync(ref.file, 'utf8');
    const issues = ref.name.endsWith('.例子') ? parseExamples(text).issues : lintActivity(text, { fileName: ref.name, tutorCards: [] }).issues;
    need(issues.length === 0, `${ref.file}: ${issues.map((i) => i.text).join(';')}`);
  }
}
need(existsSync(join(root, 'themes', 'default', 'theme.json')) && existsSync(join(root, 'themes', 'default', 'kid.css')), 'themes/default/ 不全(出厂主题:theme.json + kid.css)');
// 注册了的每种卡都要有协议与样式(包里 cards/<kind>/),从 dist 算出的卡目录找
const { CARD_KINDS } = await import(new URL('../dist/board/cards/index.js', import.meta.url).href) as typeof import('../src/board/cards/index.ts');
const { PACKAGE_CARDS_DIR } = await import(new URL('../dist/board/cards/docs.js', import.meta.url).href) as typeof import('../src/board/cards/docs.ts');
for (const { name } of CARD_KINDS) {
  need(existsSync(join(PACKAGE_CARDS_DIR, name, 'card.md')) && existsSync(join(PACKAGE_CARDS_DIR, name, 'card.css')), `cards/${name}/ 不全(card.md + card.css)`);
}

// 4. 舞台包打过了(dist/stage 不在 git 里;没打的话孩子端重卡舞台开不了)
const { STAGE_DIR, FONTS_DIR } = await import(new URL('../dist/app/http/stage.js', import.meta.url).href) as { STAGE_DIR: string; FONTS_DIR: string };
const stageFiles = ['index.html', 'stage.js', 'stage.css'];
for (const f of stageFiles) need(existsSync(join(STAGE_DIR, f)), `舞台包缺 dist/stage/${f}(pnpm run build:stage)`);
// 2026-09-11 起舞台包是拆开的:stage.js 只有二十来 K,肉在 chunk-*.js 里(excalidraw 的懒加载块),
// 所以按整包大小与 chunk 个数判断「打全了没有」,不看入口文件本身
const stageJs = existsSync(STAGE_DIR) ? readdirSync(STAGE_DIR).filter((f) => f.endsWith('.js')) : [];
const stageKb = Math.round(stageJs.reduce((n, f) => n + statSync(join(STAGE_DIR, f)).size, 0) / 1024);
need(stageJs.length > 10, `dist/stage 里只有 ${stageJs.length} 个 js,拆包后应该有上百个 chunk(pnpm run build:stage)`);
need(stageKb > 3000, `dist/stage 的 js 合计只有 ${stageKb} KB,不像打全了`);

// 5. 出厂技能都在包里;舞台的字体在包里
const { SHIPPED_SKILLS, skillSourceDir } = await import(new URL('../dist/app/cli/skills.js', import.meta.url).href) as {
  SHIPPED_SKILLS: readonly { name: string }[];
  skillSourceDir: (s: { name: string }) => string;
};
for (const s of SHIPPED_SKILLS) need(existsSync(join(skillSourceDir(s), 'SKILL.md')), `包里没有 skills/${s.name}/SKILL.md`);
// 字体要在包里:npm 装的没有 excalidraw(只在打包时用),dist/stage/fonts/ 缺了 /stage/fonts/ 就 404,舞台里中文字形回退
need(FONTS_DIR === join(STAGE_DIR, 'fonts') + sep && existsSync(FONTS_DIR) && readdirSync(FONTS_DIR).length > 3, `字体不在舞台包里(${FONTS_DIR});pnpm run build:stage 会拷进 dist/stage/fonts/`);
// 运行时依赖里不能有只在打包时用的:装出来会多 260 个包、220 MB
const runtimeDeps = Object.keys((pkg as { dependencies?: Record<string, string> }).dependencies ?? {});
for (const d of ['@excalidraw/excalidraw', 'react', 'react-dom']) need(!runtimeDeps.includes(d), `${d} 在 dependencies 里:它只在打包舞台时用,放 devDependencies`);

// 5b. cotutor chalk check 的类型层:场景里的 import type … from 'cotutor/chalk' 映射到包内的 dist/chalk/types.d.ts(src/app/cli/chalk/typecheck.ts)
need(existsSync(join(root, 'dist', 'chalk', 'types.d.ts')), 'dist/chalk/types.d.ts 不在,chalk check 的类型层不跑');

// 6. 依赖不能带 link:(link 的包发出去装不上)
const deps = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies;
for (const [name, range] of Object.entries(deps)) {
  need(!/^(link|file|workspace):/.test(range), `dependencies 里 ${name} 还是 ${range},发版前要换成版本号`);
}
// 依赖要的 peer 也得在 dependencies 里:留给 npm 自己挑会来回换(excalidraw 认 react 19、它带的 radix 只认到 18,npm i 一直不结束;pnpm 不犯,本地看不出)
for (const name of Object.keys(deps)) {
  const dep = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  for (const peer of Object.keys(dep.peerDependencies ?? {})) {
    if (!dep.peerDependenciesMeta?.[peer]?.optional) need(peer in deps, `${name} 要的 peer ${peer} 不在 dependencies 里(npm 装的人自己挑版本,可能装不完)`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('出厂检查不过,别发');
  process.exit(1);
}
console.log(`出厂检查通过:cotutor ${pkg.version},${shipped.length} 位老师,${Object.keys(pkg.exports).length} 个 export,舞台包 ${stageKb} KB`);
