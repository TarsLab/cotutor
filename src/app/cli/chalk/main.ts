/**
 * cotutor chalk:做小课堂的课包(2026-10-31 drawtell 并进来,原来的 drawtell CLI 只留做课包这五样;workspace、课包目录、音色都照 cotutor 的)。
 *   check <scene.ts|目录> [--no-types]       类型(内嵌 tsc)→ 求值 → 契约 + 笔顺 + 布局;有错 exit 1
 *   build <scene.ts|目录> [--out <dir>]      先 check,再出课包目录(scene.json + manifest.json),缺省 <workspace>/bundles/<id>/
 *   bake  <scene.ts|课包 id> [--bundles <dir>]                  画面烤成 bake.json(本机 Chrome 里跑一次 excalidraw)
 *   snap  <scene.ts|课包 id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>]   每步画完那一刻截图 + index.json,缺省 bundles 旁边的 snaps/<id>/;画面没烤顺手烤
 *   dub   <scene.ts|课包 id> [--voice <音色>] [--tutor <老师>] [--instruction <语气>] [--dry-run] [--bundles <dir>]   每步讲稿配音,回填 manifest
 * 给 .ts 的 bake / snap / dub 先 check + build;给课包 id 的直接用 bundles 里那份。--json 机器可读,路径脱敏。
 */
import { dirname, join, resolve } from 'node:path';
import { checkScene, type Finding } from '../../../chalk/check.ts';
import type { ChalkScene } from '../../../chalk/types.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome } from '../../workspace.ts';
import { buildBundle, readBundle } from './build.ts';
import { LoadError, NotFoundError, loadScene, loadSceneFiles, resolveSceneInput } from './load-scene.ts';
import { typecheckScene } from './typecheck.ts';

type Flags = Record<string, string | true>;

export const CHALK_USAGE = `用法:
  cotutor chalk check <scene.ts|目录> [--no-types] [--json]
  cotutor chalk build <scene.ts|目录> [--out <dir>] [--json]
  cotutor chalk bake <scene.ts|课包 id> [--bundles <dir>] [--json]
  cotutor chalk snap <scene.ts|课包 id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]
  cotutor chalk dub <scene.ts|课包 id> [--voice <音色>] [--tutor <老师>] [--instruction <语气>] [--dry-run] [--bundles <dir>] [--json]
课包缺省在 workspace 的 bundles/(--bundles 换);场景源与 --out / --bundles 的相对路径按当前目录。
`;

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

interface Report {
  command: string;
  file: string;
  exportName?: string;
  ok: boolean;
  findings: Finding[];
  bundle?: string;
  files?: string[];
  [extra: string]: unknown;
}

function report(json: boolean, r: Report): void {
  const errors = r.findings.filter((f) => f.level === 'error').length;
  const warnings = r.findings.filter((f) => f.level === 'warning').length;
  if (json) {
    process.stdout.write(`${JSON.stringify(redactDeep({ ...r, errors, warnings }), null, 2)}\n`);
    return;
  }
  process.stdout.write(`${r.ok ? `✓ ${r.file} — 通过` : `✗ ${r.file} — ${errors} 错误`}${warnings ? `,${warnings} 警告` : ''}\n`);
  for (const f of r.findings) process.stdout.write(`  [${f.level}] ${f.rule}: ${f.message}\n`);
  if (r.bundle) process.stdout.write(`  课包 → ${redactHome(r.bundle)}(${(r.files ?? []).map((p) => p.split('/').pop()).join(' + ')})\n`);
}

/** 场景源 → 过了 check 的场景;有错就报、exit 1、给 null */
async function checkedScene(command: string, file: string, json: boolean): Promise<{ scene: ChalkScene; findings: Finding[]; sourceDir: string } | null> {
  const input = await resolveSceneInput(file);
  const { raw, exportName } = input.kind === 'files' ? await loadSceneFiles(input.dir) : await loadScene(file);
  const { scene, findings } = checkScene(raw);
  if (!scene || findings.some((f) => f.level === 'error')) {
    report(json, { command, file, exportName, ok: false, findings });
    if (!json) process.stdout.write('  先改好上面的错误再重跑\n');
    process.exitCode = 1;
    return null;
  }
  return { scene, findings, sourceDir: input.kind === 'files' ? input.dir : dirname(resolve(file)) };
}

/** .ts / 场景目录 → 先 check + build 进 bundles;课包 id → 读 bundles 里那份 */
async function sceneOrBundle(command: string, file: string, bundlesDir: string, json: boolean): Promise<{ scene: ChalkScene; findings: Finding[] } | null> {
  if (!file.endsWith('.ts')) return { scene: await readBundle(bundlesDir, file), findings: [] };
  const c = await checkedScene(command, file, json);
  if (!c) return null;
  await buildBundle(c.scene, join(bundlesDir, c.scene.id), c.sourceDir);
  return c;
}

export async function chalkCommand(args: string[], flags: Flags, opts: { workspace?: string; json: boolean }): Promise<void> {
  const [sub, file, ...extra] = args;
  const json = opts.json;
  if (!sub || flags.help === true) {
    process.stdout.write(CHALK_USAGE);
    return;
  }
  if (!file) throw new UsageError(`cotutor chalk ${sub} 要一个场景文件(或课包 id)。\n${CHALK_USAGE}`);
  if (extra.length) throw new UsageError(`多余的参数 '${extra[0]}'。\n${CHALK_USAGE}`);
  const bundlesOf = (): string => (str(flags.bundles) ? resolve(str(flags.bundles)!) : loadWorkspace(opts.workspace).dirs.bundles);
  try {
    switch (sub) {
      case 'check': {
        const input = await resolveSceneInput(file);
        // 类型先跑,错了也往下:一次拿全各层的问题;场景目录是 JSON,没有类型层
        const types = flags['no-types'] === true || input.kind === 'files' ? { ran: false, findings: [] } : await typecheckScene(file);
        let exportName: string | undefined;
        let structural: Finding[];
        try {
          const loaded = input.kind === 'files' ? await loadSceneFiles(input.dir) : await loadScene(file);
          exportName = loaded.exportName;
          structural = checkScene(loaded.raw).findings;
        } catch (err) {
          if (!(err instanceof LoadError)) throw err;
          structural = [{ level: 'error', rule: 'load', message: err.message }];
        }
        const findings = [...types.findings, ...structural];
        const ok = !findings.some((f) => f.level === 'error');
        report(json, { command: 'check', file, exportName, ok, findings, typesChecked: types.ran });
        if (!ok) process.exitCode = 1;
        return;
      }
      case 'build': {
        const c = await checkedScene('build', file, json);
        if (!c) return;
        const outDir = str(flags.out) ? resolve(str(flags.out)!) : join(bundlesOf(), c.scene.id);
        const files = await buildBundle(c.scene, outDir, c.sourceDir);
        report(json, { command: 'build', file, ok: true, findings: c.findings, bundle: outDir, files });
        return;
      }
      case 'bake': {
        const bundlesDir = bundlesOf();
        const s = await sceneOrBundle('bake', file, bundlesDir, json);
        if (!s) return;
        const { bakeBundles } = await import('./bake.ts');
        const [r] = await bakeBundles(bundlesDir, [s.scene.id]);
        if (json) process.stdout.write(`${JSON.stringify(redactDeep({ command: 'bake', file, ok: true, scene: s.scene.id, bake: r.file, elements: r.elements, bytes: r.bytes, findings: s.findings }), null, 2)}\n`);
        else {
          process.stdout.write(`✓ ${file} — ${r.elements} 个元素 → ${redactHome(r.file)}(${Math.round(r.bytes / 1024)} KB)\n`);
          for (const f of s.findings) process.stdout.write(`  [${f.level}] ${f.rule}: ${f.message}\n`);
        }
        return;
      }
      case 'snap': {
        const bundlesDir = bundlesOf();
        const s = await sceneOrBundle('snap', file, bundlesDir, json);
        if (!s) return;
        const { scene } = s;
        let step: number | undefined;
        if (flags.step !== undefined) {
          step = Number(flags.step);
          if (!Number.isInteger(step) || step < 0 || step > scene.steps.length) throw new UsageError(`--step 要 0–${scene.steps.length} 的整数(0 = 空板),拿到 '${String(flags.step)}'`);
        }
        const outDir = str(flags.out) ? resolve(str(flags.out)!) : join(dirname(bundlesDir), 'snaps', scene.id);
        // 截图要开浏览器,顺手把画面烤了(bake.json 没有或画面变了)
        const { bakeBundles, bakeIsFresh } = await import('./bake.ts');
        const baked = (await bakeIsFresh(join(bundlesDir, scene.id))) ? null : (await bakeBundles(bundlesDir, [scene.id]))[0];
        const { snapScene } = await import('./snap.ts');
        const cursor = flags['no-cursor'] !== true;
        const shots = await snapScene({ scene, bundlesDir, outDir, step, cursor });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep({ command: 'snap', file, ok: true, scene: scene.id, outDir, cursor, findings: s.findings, shots, ...(baked ? { bake: baked.file } : {}) }), null, 2)}\n`);
        else {
          process.stdout.write(`✓ ${file} — ${shots.length} 张 → ${redactHome(outDir)}/(${shots.map((x) => `step-${x.step}.png`).join(' ')} + index.json${step != null ? ',已合并' : ''}${cursor ? '' : ',无笔尖'})${baked ? `;画面烤好了 → ${redactHome(baked.file)}` : ''}\n`);
          for (const f of s.findings) process.stdout.write(`  [${f.level}] ${f.rule}: ${f.message}\n`);
        }
        return;
      }
      case 'dub': {
        const ws = loadWorkspace(opts.workspace);
        const bundlesDir = str(flags.bundles) ? resolve(str(flags.bundles)!) : ws.dirs.bundles;
        const tutor = str(flags.tutor) ?? 'math-tutor';
        const voice = str(flags.voice) ?? ws.config.tutors[tutor]?.voice;
        if (!voice) throw new UsageError(`没有音色:--voice <音色>,或 --tutor <老师>(缺省 math-tutor)在 cotutor.json 里配了卡的音色(工作台「音色」页挑)`);
        const s = await sceneOrBundle('dub', file, bundlesDir, json);
        if (!s) return;
        const { dubBundle } = await import('./dub.ts');
        const r = await dubBundle({ scene: s.scene, bundleDir: join(bundlesDir, s.scene.id), voice, instruction: str(flags.instruction), dryRun: flags['dry-run'] === true, cacheDir: ws.dirs.tts });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep({ command: 'dub', file, scene: s.scene.id, voice, findings: s.findings, ...r }), null, 2)}\n`);
        else {
          const failed = r.steps.filter((x) => x.error).length;
          process.stdout.write(`${r.ok ? '✓' : '✗'} ${s.scene.id} — ${r.dryRun ? '算账(没合成)' : r.ok ? '配音好了' : `${failed} 步没配上`}:${r.steps.length} 步,约 ${r.characters} 计费字符,要合成 ${r.steps.filter((x) => !x.kept).length} 步\n`);
          for (const st of r.steps) {
            const pc = r.pacing.find((p) => p.step === st.step);
            const pace = pc && pc.audioMs ? `  音 ${(pc.audioMs / 1000).toFixed(1)}s / 画 ${(pc.drawMs / 1000).toFixed(1)}s${pc.factor > 1 ? ` → 拉伸 ×${pc.factor.toFixed(1)}` : ''}${pc.audioMs / pc.drawMs > 5 ? '  ⚠ 超过封顶 5 倍:讲稿太长或这步画得太少' : ''}` : '';
            process.stdout.write(`  ${st.error ? '✗' : st.kept ? '=' : r.dryRun ? '+' : '↑'} step-${st.step}  ${st.characters} 字${pace}${st.error ? `  ${st.error}` : ''}\n`);
          }
          if (r.manifestUpdated) process.stdout.write('  manifest.json 已回填 audioSrc\n');
          for (const f of s.findings) process.stdout.write(`  [${f.level}] ${f.rule}: ${f.message}\n`);
        }
        if (!r.ok) process.exitCode = 1;
        return;
      }
      default:
        throw new UsageError(`cotutor chalk 没有 '${sub}'。\n${CHALK_USAGE}`);
    }
  } catch (err) {
    // 找不到场景 / 课包是用法问题;场景求值失败是场景的问题(exit 1)
    if (err instanceof NotFoundError) throw new UsageError(err.message);
    if (err instanceof LoadError) {
      report(json, { command: sub, file, ok: false, findings: [{ level: 'error', rule: 'load', message: err.message }] });
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
