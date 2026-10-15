/**
 * 探针别留孤儿(2026-10-15):探针的 CDP send 没有超时,回包不来就卡在 await 上;node 手里攥着 Chrome 子进程的句柄不会退,
 * finally 里的 kill 永远走不到——外面的 shell 被收掉以后 node 成了孤儿,无头 Chrome 挂了两天:它和平时用的是同一个 Chrome.app,
 * Dock 上点它只激活这个没窗口的实例,右键退出也不理。
 * 所以探针从这里拿 spawn(同 node:child_process 的):起的子进程都记着,进程退出、收到 SIGINT / SIGTERM / SIGHUP、
 * 看门狗到点(缺省 10 分钟,COTUTOR_PROBE_TIMEOUT 秒数改)时一并杀掉。detached 起的(--keep)与 unref() 过的是要留着的,不管。
 * 临时目录从 probeDir 拿:超时、被杀时等子进程退了再删(正常收尾仍是探针自己的 finally;带 --keep 不删)。
 */
import { spawn as rawSpawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

const kids = new Set();
const dirs = [];
const killAll = () => { for (const c of kids) { try { c.kill(); } catch {} } };
/** 超时、被杀:杀子进程,等它们退(最多 3 秒,Chrome 退前还在写 profile),删临时目录,退出 */
const abort = async (code) => {
  const left = [...kids];
  killAll();
  await Promise.race([Promise.all(left.map((c) => new Promise((r) => { if (c.exitCode !== null || c.signalCode !== null) r(); else c.once('exit', r); }))), new Promise((r) => setTimeout(r, 3000))]);
  if (!process.argv.includes('--keep')) for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
};

export function probeDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export function spawn(cmd, args, opts = {}) {
  const c = rawSpawn(cmd, args, opts);
  if (!opts.detached) {
    kids.add(c);
    c.once('exit', () => kids.delete(c));
    const unref = c.unref.bind(c);
    c.unref = () => { kids.delete(c); unref(); };
  }
  return c;
}

process.once('exit', killAll);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(s, () => abort(128 + constants.signals[s]));

const limit = Number(process.env.COTUTOR_PROBE_TIMEOUT) || 600;
setTimeout(() => { console.log(`✗ 探针 ${limit} 秒没跑完,杀掉子进程退出(COTUTOR_PROBE_TIMEOUT 改上限)`); abort(1); }, limit * 1000).unref();
