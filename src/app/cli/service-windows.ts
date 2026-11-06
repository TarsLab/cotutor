/**
 * cotutor service 在 Windows 上要的几样(service.ts 接这里):
 *   登录时起来:写用户自己的注册表 HKCU\...\Run(不要管理员)。不用计划任务:登录触发对普通令牌可能要管理员,缺省还有 3 天超时、低优先级要逐项改。
 *   没有窗口:Run 里是 wscript.exe 跑一个 JScript 启动器,WScript.Shell.Run(命令, 0) 起 node,控制台藏着;node 的子进程跟着用这个藏着的控制台,不另弹窗。
 *     不用 conhost --headless(2026-11-06 Windows 11 build 26300 上直接以 0 退、node 根本没起,本来也没写进文档);不用 VBScript(微软在逐步下线);不用 powershell -WindowStyle Hidden(会闪一下)。
 *   崩了再起:看护进程 cotutor service run(service.ts 的 runKeeper,一个 node),起 serve,非 0 隔 10 秒再起,0 不起,和 launchd、systemd 同样的说法。
 *   停:按命令行找这个 workspace 的看护进程与 serve(PowerShell,输出不随系统语言变),taskkill /T /F。
 * 这里全是拼字符串与读输出的纯函数,真跑在 service.ts。
 */

/** 一个参数写进命令行(CommandLineToArgvW 的规矩:引号前的反斜杠翻倍再转义引号,结尾的反斜杠翻倍) */
export function winQuote(a: string): string {
  if (a && !/[\s"]/.test(a)) return a;
  let out = '"';
  let slashes = 0;
  for (const ch of a) {
    if (ch === '\\') { slashes++; continue; }
    if (ch === '"') { out += `${'\\'.repeat(slashes * 2 + 1)}"`; slashes = 0; continue; }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

export const winCommandLine = (args: string[]): string => args.map(winQuote).join(' ');

/** 启动器的内容:wscript 跑它,藏着窗口起 args;第二行记着 args,找服务时读回来 */
export function windowsLauncher(args: string[], root: string): string {
  return `// cotutor service install 写的;改了会被下次 install 盖掉。卸掉:cotutor service uninstall --workspace ${root.replace(/[\r\n]/g, ' ')}
// args: ${JSON.stringify(args)}
new ActiveXObject("WScript.Shell").Run(${JSON.stringify(winCommandLine(args))}, 0, false);
`;
}

/** 启动器存成 UTF-16 带 BOM:wscript 按这个读,路径里的中文才对(UTF-8 它按系统代码页读) */
export const encodeLauncher = (text: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

/** 读服务文件:带 UTF-16 的 BOM 就按它解,别的按 UTF-8 */
export function decodeServiceFile(buf: Buffer): string {
  return buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
}

/** 从启动器里读回 args;不是启动器 → null */
export function launcherArgs(text: string): string[] | null {
  const m = /^\/\/ args: (\[.*\])\s*$/m.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/**
 * 任务管理器「启动应用」里关掉一条,Run 项还在,只在这里记一笔:值的第一个字节单数 = 关了(02 开、03 关;2026-11-06 那台机器上 Docker Desktop 就是 03)。
 * 那里显示的名字是 wscript.exe 的文件描述(Microsoft ® Windows Based Script Host),不是 Run 项的名字,看不出是 cotutor,所以要靠 service status 来说
 */
export const STARTUP_APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

/** reg query 这个值的输出:被关掉了没有(没这个值 = 没关) */
export function startupDisabled(regQuery: string): boolean {
  const m = /REG_BINARY\s+([0-9a-fA-F]{2})/.exec(regQuery);
  return m ? (Number.parseInt(m[1], 16) & 1) === 1 : false;
}

/** Run 里写的那条 */
export const runValue = (wscript: string, file: string): string => `"${wscript}" //B //Nologo "${file}"`;

/** 跑一段 PowerShell 的参数:编码传进去不用管引号,输出定成 UTF-8,关掉进度(第一次用模块时它往 stderr 写一堆) */
export function psArgs(script: string): string[] {
  const full = `[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ProgressPreference='SilentlyContinue'\n$ErrorActionPreference='SilentlyContinue'\n${script}`;
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')];
}

/** 找这个 workspace 的看护进程(service run)与它起的 serve(带 --log-dir;终端里的 cotutor serve 不算) */
export function findProcsScript(root: string): string {
  return [
    `$root = '${root.replaceAll("'", "''")}'`,
    `$found = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $c = $_.CommandLine; $c -and $c.Contains($root) -and ($c.Contains(' service run ') -or ($c.Contains(' serve ') -and $c.Contains('--log-dir'))) })`,
    `ConvertTo-Json -Compress -InputObject @($found | ForEach-Object { @{ pid = $_.ProcessId; keeper = $_.CommandLine.Contains(' service run ') } })`,
  ].join('\n');
}

export interface WinProc { pid: number; keeper: boolean }

/** 上面那段的输出;坏的、空的当没有 */
export function parseProcs(text: string): WinProc[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim() || '[]');
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((x) => {
    const o = x as { pid?: unknown; keeper?: unknown };
    return typeof o.pid === 'number' ? [{ pid: o.pid, keeper: o.keeper === true }] : [];
  });
}

/**
 * 拦着闲置睡眠(同 macOS 的 caffeinate -i):SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) 之后等 serve 退出。
 * 状态跟着这个线程走:进程被杀或 serve 没了就撤掉
 */
export function awakeScript(pid: number): string {
  return [
    `$t = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name Awake -Namespace Cotutor -PassThru`,
    '[void]$t::SetThreadExecutionState([uint32]2147483649)',
    `Wait-Process -Id ${pid}`,
  ].join('\n');
}

/**
 * powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE:接着电源几秒没人碰就睡(0 = 不睡);读不出 → null。
 * 输出的字随系统语言变,只认顺序:最后两个十六进制是接电源、用电池(前面三个是最小、最大、步长)
 */
export function winAcSleepSeconds(powercfg: string): number | null {
  const hex = [...powercfg.matchAll(/0x([0-9a-fA-F]{8})/g)].map((m) => Number.parseInt(m[1], 16));
  return hex.length >= 2 ? hex[hex.length - 2] : null;
}
