/**
 * cotutor tray run 的轻入口:bin/cotutor.js 直接到这里,不经 main.ts。
 * 托盘进程一直开着,main.ts 把所有命令都加载进来要多占近一百 MB(2026-11-06 量的,源码直跑 140 MB 对 63 MB);这里和 tray.ts 引的东西都不带 zod。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { realHost } from './service.ts';
import { realTrayDeps, runTray, trayDir, trayNote, traySupported, writeTrayFiles } from './tray.ts';

const version = (): string => (JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;

export async function main(argv: string[]): Promise<void> {
  const host = realHost();
  if (!traySupported(host.platform)) {
    process.stderr.write(`${host.platform} 上没做托盘图标\n`);
    process.exitCode = 0;
    return;
  }
  const at = argv.indexOf('--dir');
  const dir = at >= 0 && argv[at + 1] ? argv[at + 1] : trayDir(host);
  mkdirSync(dir, { recursive: true });
  const note = trayNote(dir);
  // 没接住的错误:记一笔再以非 0 退(macOS 上 launchd 隔 10 秒再起)
  const fatal = (what: string) => (err: unknown): void => {
    note(`${what}:${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  };
  process.on('uncaughtException', fatal('没接住的错误'));
  process.on('unhandledRejection', fatal('没接住的 Promise 错误'));
  const file = await writeTrayFiles(host.platform, dir);
  note(`起来了,node ${process.versions.node},pid ${process.pid}`);
  const code = await runTray(realTrayDeps(host, dir, file, version()));
  note(`退出 ${code}`);
  process.exit(code);
}
