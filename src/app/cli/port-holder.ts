/** 谁在监听这个端口:port.ts(端口的规矩)和托盘(tray.ts)都用,单独一个文件,托盘进程才不用加载 workspace 与 zod */
import { psArgs } from './service-windows.ts';
import type { ServiceHost } from './service.ts';

export interface PortHolder { pid: number; name: string }

/** lsof -Fpc 的输出:一行 p<pid>,一行 c<命令名> */
export function parseLsof(out: string): PortHolder | null {
  const pid = /^p(\d+)$/m.exec(out)?.[1];
  const name = /^c(.+)$/m.exec(out)?.[1];
  return pid && name ? { pid: Number(pid), name } : null;
}

/**
 * 谁在监听(Windows):只认对端端口是 0,不看 State。2026-11-06 Windows 11 build 26300 上监听的 socket 状态是乱的:
 * netstat 显示 CLOSED、FIN_WAIT_1,-State Listen 查不到,读 State 还可能抛异常
 */
export function holderScript(port: number): string {
  return [
    `$c = Get-NetTCPConnection -LocalPort ${port} | Where-Object { $_.RemotePort -eq 0 } | Select-Object -First 1`,
    'if ($c) { $p = Get-Process -Id $c.OwningProcess; ConvertTo-Json -Compress @{ pid = [int]$c.OwningProcess; name = $p.ProcessName } }',
  ].join('\n');
}

/** 上面那段的输出;坏的、空的当不知道 */
export function parseHolder(text: string): PortHolder | null {
  try {
    const o = JSON.parse(text.trim()) as { pid?: unknown; name?: unknown };
    return typeof o.pid === 'number' && typeof o.name === 'string' && o.name ? { pid: o.pid, name: o.name } : null;
  } catch {
    return null;
  }
}

/** 谁在监听这个端口;查不到(别人的进程、没装 lsof)→ null */
export async function portHolder(host: Pick<ServiceHost, 'platform' | 'run'>, port: number): Promise<PortHolder | null> {
  if (host.platform === 'win32') return parseHolder((await host.run('powershell.exe', psArgs(holderScript(port)))).stdout);
  return parseLsof((await host.run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'])).stdout);
}
