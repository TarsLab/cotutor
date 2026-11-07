/** 版本比较与升级步骤:服务、托盘(轻入口,不带 zod)、家长端、doctor 共用 */

/** 升级程序的三步。分开写不用 &&:Windows 默认的 PowerShell 5.1 不认 &&;顺序是先换文件再重起,新代码不会读到旧文件;restart 顺手把图标也换上新代码 */
export const UPGRADE_STEPS = ['npm i -g cotutor', 'cotutor upgrade', 'cotutor service restart'] as const;

/** 给家长看的那份。Windows 上带 .cmd:PowerShell 缺省禁止跑脚本,不带后缀找到的是被拦的 .ps1,第一条就报错;.cmd 在 PowerShell 和 cmd.exe 里都能跑(2026-11-07 真机) */
export function upgradeSteps(platform: NodeJS.Platform = process.platform): string[] {
  return UPGRADE_STEPS.map((s) => (platform === 'win32' ? s.replace(' ', '.cmd ') : s));
}

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 正式版的版本号。预发布不算;从网上拿来的还要显示给家长,其余一律不认 */
export function isPlainVersion(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 32 && PLAIN.test(v);
}

/** a 比 b 新;任一边不是正式版的版本号 → false,宁可不提醒 */
export function isNewer(a: unknown, b: unknown): boolean {
  if (!isPlainVersion(a) || !isPlainVersion(b)) return false;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
