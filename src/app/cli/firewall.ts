/**
 * Windows 防火墙放没放行 cotutor:平板连不上多半是它。Windows 只在第一次监听时弹一次「允许访问」,家长点了取消(或没看见)就再也连不上,
 * cotutor 什么都不说(2026-10-31 实测:服务在本机回 200,从局域网超时;网络是「专用」,没有 node 的规则,也没有端口的规则)。
 * 用 PowerShell 的 NetSecurity 命令查(输出与系统语言无关;netsh 的输出是本地化的,中文 Windows 上解析不了);查不了(没有 PowerShell、超时)就不报,不瞎猜。
 */
import { execFile } from 'node:child_process';

/** 查到的样子;配置名是 Domain / Private / Public,规则上的 Any 覆盖全部 */
export interface FirewallState {
  /** 连着的网络的类型(Get-NetConnectionProfile 的 NetworkCategory:Private / Public / DomainAuthenticated) */
  networks: string[];
  /** 防火墙开着的配置 */
  enabled: string[];
  /** 放行的规则(入站、允许、启用,按这个 node 或这个端口)各覆盖哪些配置,如 "Private"、"Private, Public"、"Any" */
  allowed: string[];
  /** 拦着这个 node 的规则覆盖哪些配置(家长在「允许访问」那一步点了取消,Windows 会建这种规则) */
  blocked: string[];
}

export interface FirewallVerdict {
  ok: boolean;
  detail: string;
  fix?: string;
}

const PS_TIMEOUT_MS = 20_000;

/** 查一次的 PowerShell 脚本;node 的路径与端口写进去(单引号里的单引号写两个) */
export function firewallScript(node: string, port: number): string {
  const q = (s: string): string => `'${s.replaceAll("'", "''")}'`;
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$node = ${q(node)}`,
    `$port = ${q(String(port))}`,
    '$nets = @(Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory })',
    "$on = @(Get-NetFirewallProfile | Where-Object { [string]$_.Enabled -eq 'True' } | ForEach-Object { [string]$_.Name })",
    // 规则里的程序可能写成 %ProgramFiles%\…,也可能是小写(Windows 弹窗建的):展开了比,-eq 本来就不分大小写
    '$byApp = @(Get-NetFirewallApplicationFilter | Where-Object { [Environment]::ExpandEnvironmentVariables([string]$_.Program) -eq $node } | Get-NetFirewallRule)',
    '$byPort = @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { @($_.LocalPort) -contains $port } | Get-NetFirewallRule)',
    "$live = { [string]$_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' }",
    "$allow = @(($byApp + $byPort) | Where-Object $live | Where-Object { [string]$_.Action -eq 'Allow' } | ForEach-Object { [string]$_.Profile })",
    "$block = @($byApp | Where-Object $live | Where-Object { [string]$_.Action -eq 'Block' } | ForEach-Object { [string]$_.Profile })",
    'ConvertTo-Json -Compress -InputObject @{ networks = $nets; enabled = $on; allowed = $allow; blocked = $block }',
  ].join('\n');
}

/** PowerShell 回的 JSON → 样子;一个元素的数组可能被拆成字符串,null 当空 */
export function parseFirewall(text: string): FirewallState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
  const r = raw as Record<string, unknown>;
  return { networks: list(r.networks), enabled: list(r.enabled), allowed: list(r.allowed), blocked: list(r.blocked) };
}

/** 平板连不连得进来,怎么修 */
export function judgeFirewall(s: FirewallState, port: number, node: string): FirewallVerdict {
  const nets = [...new Set(s.networks.map((n) => (n === 'DomainAuthenticated' ? 'Domain' : n)))];
  const covers = (rules: string[], profile: string): boolean => rules.some((r) => r.split(/,\s*/).some((p) => p === 'Any' || p === profile));
  const guarded = nets.filter((n) => s.enabled.includes(n));
  const allowCmd = `netsh advfirewall firewall add rule name="cotutor" dir=in action=allow protocol=TCP localport=${port} profile=private`;
  if (!nets.length) return { ok: true, detail: '没连上网络,查不了防火墙(连上 Wi-Fi 再跑一次 doctor)' };
  if (!guarded.length) return { ok: true, detail: `防火墙在连着的网络上关着(${nets.join('、')}),平板连得进来` };
  if (guarded.some((n) => covers(s.blocked, n))) {
    return {
      ok: false,
      detail: '防火墙拦着这个 node(多半是第一次起服务时「允许访问」点了取消):平板连不上,这台电脑上照常',
      fix: `管理员终端里先删拦截规则:netsh advfirewall firewall delete rule name=all dir=in program="${node}";再放行:${allowCmd}`,
    };
  }
  if (guarded.every((n) => covers(s.allowed, n))) return { ok: true, detail: `防火墙放行了(端口 ${port} 或这个 node)` };
  if (guarded.includes('Public') && !covers(s.allowed, 'Public')) {
    return {
      ok: false,
      detail: '这台电脑连的网络是「公用」,防火墙不让平板连进来;这台电脑上照常',
      fix: `设置 › 网络和 Internet › 这个网络的属性,改成「专用」;再在管理员终端里放行:${allowCmd}`,
    };
  }
  return { ok: false, detail: `防火墙没放行端口 ${port}:平板连不上,这台电脑上照常`, fix: `管理员终端(右键「终端」选「以管理员身份运行」)里跑:${allowCmd}` };
}

/** 真查一次(只在 Windows 上);查不了是 null */
export function probeFirewall(port: number, node: string = process.execPath): Promise<FirewallState | null> {
  const encoded = Buffer.from(firewallScript(node, port), 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: PS_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : parseFirewall(String(stdout)));
    });
  });
}
