/**
 * 两个 CDP 探针进 pnpm test(2026-10-17):页面模板里约 8000 行 JS 以前只有「能 new Function 解析」一条自动化,行为全靠手跑 scripts/probe-*.mjs。
 * 挑了两个走 mock、不花钱、各十几秒的:probe-layout(排版:半宽、并排、不横滚、流式出卡不挪、页面没抛异常)与 probe-play(实录:播放位置、弹窗、家长端不发)。
 * 要本机 Chrome(CHROME 环境变量,或 /Applications/Google Chrome.app);没有就打一行跳过、算过,别的机器与 CI 不会因此红。COTUTOR_SKIP_PROBES=1 也跳过。
 * 探针自己起 mock(端口 8797)与无头 Chrome(CDP 9339),过了打「全过」、exit 0;这里只看退出码与那句话,没过把它的输出整个打出来。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (process.env.COTUTOR_SKIP_PROBES === '1') { console.log('skip:COTUTOR_SKIP_PROBES=1,探针不跑'); done(); }
if (!existsSync(chrome)) { console.log(`skip:没有 Chrome(${chrome}),探针不跑;装了 Chrome 或 export CHROME=<路径> 再跑`); done(); }

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
for (const name of ['probe-layout', 'probe-play']) {
  const r = spawnSync(process.execPath, [`${scripts}${name}.mjs`], { encoding: 'utf8', timeout: 180_000, env: { ...process.env, COTUTOR_PROBE_TIMEOUT: '150' } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0 && out.includes('全过');
  check(`${name}:全过`, ok, ok ? '' : `exit ${r.status}${r.signal ? ` ${r.signal}` : ''}\n${out.trim().split('\n').slice(-40).join('\n')}`);
}
done();
