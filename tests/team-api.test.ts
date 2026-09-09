/** 家长页背后的接口:新老师 / 老师文件读写 / 删老师、设置页的 paths / server / tts 补丁、JSON Schema、doctor 认嵌套与 API 层错误。 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-team-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { doctorWorkspace, explainLlmFailure } = await import('../src/cli/doctor.ts');
const { cotutorJsonSchema, CotutorConfigSchema } = await import('../src/schema/index.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));

  // ---- JSON Schema ----
  const js = cotutorJsonSchema() as { properties: Record<string, { description?: string }>; required: string[] };
  check('schema 有顶层字段与说明', ['$schema', 'version', 'tutors', 'runtimes', 'tts', 'paths', '_note'].every((k) => k in js.properties) && js.required.includes('runtimes') && String(js.properties.tutors.description).includes('老师表'));
  const cfgRaw = JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8')) as { $schema: string };
  check('模板首键 $schema 指向 workspace 里的 schema 文件', cfgRaw.$schema === '.cotutor/cotutor.schema.json' && existsSync(join(root, '.cotutor', 'cotutor.schema.json')));
  check('带 $schema 的配置照样过契约', CotutorConfigSchema.safeParse(cfgRaw).success);

  // ---- 新老师 ----
  const bad = await route('POST', '/api/tutors', ctx, { name: 'Bad Name', display: 'x' });
  check('坏名 400', bad.status === 400, JSON.stringify(bad.json));
  const added = await route('POST', '/api/tutors', ctx, { name: 'science-tutor', display: '科学老师', subject: '科学', avatar: '🔬' });
  check('POST 201,进表、文件、目录', added.status === 201 && ctx.ws.config.tutors['science-tutor']?.subject === '科学' && existsSync(join(root, '.claude', 'agents', 'science-tutor.md')) && existsSync(join(root, 'agents', 'science-tutor')), JSON.stringify(added.json));
  check('重名 409', (await route('POST', '/api/tutors', ctx, { name: 'science-tutor', display: 'x' })).status === 409);
  const cfg = (await route('GET', '/api/config', ctx)).json as { shipped: string[]; paths: Record<string, string>; resolvedPaths: Record<string, string>; tts: { say: string[] } };
  check('config 回报出厂名单与路径', cfg.shipped.length === 5 && !cfg.shipped.includes('science-tutor') && typeof cfg.resolvedPaths.vault === 'string' && cfg.tts.say[0] === 'voxtell');

  // ---- 老师文件读写 ----
  const f = (await route('GET', '/api/tutors/science-tutor/file', ctx)).json as { text: string; state: string };
  check('读自家老师文件 state=own', f.state === 'own' && f.text.includes('name: science-tutor'));
  const renamed = await route('PUT', '/api/tutors/science-tutor/file', ctx, { text: f.text.replace('name: science-tutor', 'name: other') });
  check('改 name 被拒', renamed.status === 400, JSON.stringify(renamed.json));
  const put = await route('PUT', '/api/tutors/science-tutor/file', ctx, { text: f.text.replace('(在这里写', '说话慢一点。(在这里写') });
  check('PUT 写回', put.status === 200 && readFileSync(join(root, '.claude', 'agents', 'science-tutor.md'), 'utf8').includes('说话慢一点'));
  const shippedFile = (await route('GET', '/api/tutors/math-tutor/file', ctx)).json as { state: string };
  check('出厂老师 state=latest', shippedFile.state === 'latest');
  const mathFile = (await route('GET', '/api/tutors/math-tutor/file', ctx)).json as { text: string };
  await route('PUT', '/api/tutors/math-tutor/file', ctx, { text: mathFile.text + '\n温柔。\n' });
  check('改过出厂老师 → custom', ((await route('GET', '/api/tutors/math-tutor/file', ctx)).json as { state: string }).state === 'custom');
  check('没这位老师 404', (await route('GET', '/api/tutors/nobody/file', ctx)).status === 404);

  // ---- 删老师 ----
  check('出厂老师不能删', (await route('DELETE', '/api/tutors/math-tutor', ctx)).status === 400);
  const del = await route('DELETE', '/api/tutors/science-tutor', ctx);
  check('自家老师删掉:表里没了,文件改名保留', del.status === 200 && !ctx.ws.config.tutors['science-tutor'] && !existsSync(join(root, '.claude', 'agents', 'science-tutor.md')) && readdirSync(join(root, '.claude', 'agents')).some((n) => n.startsWith('science-tutor.md.removed-')), JSON.stringify(del.json));

  // ---- 设置页补丁 ----
  const p1 = await route('PATCH', '/api/config', ctx, { paths: { vault: 'vault', timetable: '课程表.md', diary: null }, server: { port: 5199, https: { cert: 'certs/a.pem', key: 'certs/b.pem' } }, tts: { say: ['node', '/x/voxtell.js', 'say', '{text}', '--voice', '{voice}', '-o', '{out}'] } });
  check('paths / server / tts 能改', p1.status === 200 && ctx.ws.config.paths.vault === 'vault' && ctx.ws.config.server.port === 5199 && ctx.ws.config.server.https?.cert === 'certs/a.pem' && ctx.ws.config.tts.say[1] === '/x/voxtell.js', JSON.stringify(p1.json));
  const p2 = await route('PATCH', '/api/config', ctx, { server: { https: null } });
  check('https 置 null 即删', p2.status === 200 && ctx.ws.config.server.https === undefined && ctx.ws.config.server.port === 5199);
  check('kid 仍不让改', (await route('PATCH', '/api/config', ctx, { kid: { slug: 'x' } })).status === 422);
  check('坏 tts 拒', (await route('PATCH', '/api/config', ctx, { tts: { say: [] } })).status === 422);

  // ---- doctor:嵌套环境、API 层错误的修复指南 ----
  const nested = await doctorWorkspace(root, { probeEnv: false, env: { CLAUDECODE: '1' } });
  check('CLAUDECODE 在 → env.nested 提醒 unset', nested.checks.some((c) => c.name === 'env.nested' && !c.ok && !c.required && c.fix?.includes('unset CLAUDECODE')));
  check('普通终端没有 env.nested', !(await doctorWorkspace(root, { probeEnv: false, env: {} })).checks.some((c) => c.name === 'env.nested'));
  check('模型不认 → 加 --model', explainLlmFailure('API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.251 or newer is required', ['claude']).includes('--model'));
  check('嵌套 → unset', explainLlmFailure('nested session', ['claude']).includes('unset'));
  check('没登录 → 登录', explainLlmFailure('Not logged in', ['qwen']).includes('qwen 登录'));
  // --live 走假 CLI(第一位开着的老师),看它能把结果摆出来
  const node = process.execPath;
  const fakeCli = new URL('./_fake-cli.ts', import.meta.url).pathname;
  await route('PATCH', '/api/config', ctx, { runtimes: { default: 'claude' } });
  const raw = JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8')) as Record<string, unknown>;
  (raw.runtimes as Record<string, unknown>).claude = { run: [node, '--experimental-strip-types', '--no-warnings', fakeCli, '--agent', '{agent}', '{prompt}'], resume: [node, fakeCli, '--resume', '{session}', '{prompt}'] };
  (raw.runtimes as Record<string, unknown>).broken = { run: [node, '--experimental-strip-types', '--no-warnings', fakeCli, '--fail', '{prompt}'], resume: [node, fakeCli, '{prompt}'] };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(root, 'cotutor.json'), JSON.stringify(raw, null, 2));
  const live = await doctorWorkspace(root, { probeEnv: false, env: {}, live: true });
  check('--live 起假 CLI 成功 → live.claude ✓', live.checks.some((c) => c.name === 'live.claude' && c.ok && c.detail.includes('回了')), JSON.stringify(live.checks.filter((c) => c.name.startsWith('live'))));
  check('没人配 voice → live.tts 跳过', live.checks.some((c) => c.name === 'live.tts' && c.ok && c.detail.includes('不探')));
  (raw.runtimes as Record<string, unknown>).default = 'broken';
  writeFileSync(join(root, 'cotutor.json'), JSON.stringify(raw, null, 2));
  const live2 = await doctorWorkspace(root, { probeEnv: false, env: {}, live: true });
  check('--live 失败 → 摆出原因与指南', live2.checks.some((c) => c.name === 'live.broken' && !c.ok && c.detail.includes('error_max_turns') && c.fix), JSON.stringify(live2.checks.filter((c) => c.name.startsWith('live'))));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
