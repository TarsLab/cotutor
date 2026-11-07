/**
 * cotutor doctor --fix:把体检里能自动修的(带 cmd 的那些:幂等、不碰孩子的数据、不用人输东西)一条条跑掉,修完再查,直到没有可修的;要人来的留给人。
 * cmd 是给人和 agent 看的字符串(路径写成 $HOME,用户名不传出去),这里拆成参数直接起进程,不经 shell:Windows 的 cmd.exe 不认 $HOME,脚本策略也拦不到这里。
 * 只跑 cotutor 和 git:cmd 是我们自己写的,但万一哪天有一条写错了,不该变成任意命令。
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { DoctorReport } from './doctor.ts';
import { binPath } from './service.ts';

/** 按空格拆,双引号里的算一段;$HOME 换成真的家目录 */
export function parseCmd(cmd: string, home: string = homedir()): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (const ch of cmd) {
    if (ch === '"') { quoted = !quoted; has = true; continue; }
    if (ch === ' ' && !quoted) { if (has) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
    has = true;
  }
  if (has) out.push(cur);
  return out.map((a) => a.replaceAll('$HOME', home));
}

export interface FixDeps {
  doctor(): Promise<DoctorReport>;
  run(argv: string[]): Promise<{ code: number; out: string }>;
  print(line: string): void;
}

const ROUNDS = 12;

/** 修到没有可修的;同一条命令只跑一次,修不好的不反复试。回最后那次体检 */
export async function runFixes(d: FixDeps): Promise<DoctorReport> {
  const tried = new Set<string>();
  let report = await d.doctor();
  for (let i = 0; i < ROUNDS; i++) {
    const next = report.checks.find((c) => !c.ok && c.cmd && !tried.has(c.cmd));
    if (!next?.cmd) break;
    tried.add(next.cmd);
    const argv = parseCmd(next.cmd);
    if (argv[0] !== 'cotutor' && argv[0] !== 'git') {
      d.print(`! ${next.name}:不认识这条命令,没跑:${next.cmd}`);
      continue;
    }
    const r = await d.run(argv);
    d.print(`${r.code === 0 ? '✓' : '✗'} ${next.name}:${next.cmd}`);
    if (r.code !== 0) for (const l of r.out.trim().split('\n').slice(-4)) d.print(`    ${l}`);
    report = await d.doctor();
  }
  return report;
}

/** 真的跑:cotutor 用现在这个 node 和 bin,不靠 PATH */
export function runArgv(argv: string[]): Promise<{ code: number; out: string }> {
  const [cmd, args] = argv[0] === 'cotutor' ? [process.execPath, [binPath(), ...argv.slice(1)]] : [argv[0], argv.slice(1)];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stderr?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', (err) => resolve({ code: 1, out: `${out}${err.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}
