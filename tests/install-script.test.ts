/**
 * 一行安装脚本(install.sh、install.ps1)与 README 的卸载说明:家长照着粘贴,写错了就是装不上。
 * 不真装(真装在发版验证时两台电脑各跑一次);这里查:语法、不用 sudo 不改策略、Node 版本跟 engines 一致、Windows 用 .cmd、镜像退路、随 npm 包发出去、文档里的命令都在。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const root = join(import.meta.dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
const sh = read('install.sh');
const ps = read('install.ps1');
const pkg = JSON.parse(read('package.json')) as { engines: { node: string }; files: string[] };
const readme = read('README.md');
const { checkCommandLine } = await import('../src/app/cli/usage.ts');

if (process.platform !== 'win32') {
  let ok = true;
  try { execFileSync('sh', ['-n', join(root, 'install.sh')]); } catch { ok = false; }
  check('install.sh:sh 能解析', ok);
}
const [maj, min] = (/>=\s*(\d+)\.(\d+)/.exec(pkg.engines.node) ?? []).slice(1);
check('Node 的版本要求和 package.json 的 engines 一样', sh.includes(`NEED_MAJOR=${maj}`) && sh.includes(`NEED_MINOR=${min}`) && ps.includes(`$needMajor = ${maj}`) && ps.includes(`$needMinor = ${min}`), pkg.engines.node);
const code = (s: string): string => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
// 只看真的会跑的命令:提示语里说「不用 sudo」「跑 winget install」是给人看的
const runs = (s: string): string => code(s).replace(/(say|die|Say|Stop-Here) +("[^"]*"|'[^']*')/g, '');
check('不用 sudo、不改执行策略、不替家长装 Node', !/(^|[;&|(]\s*)sudo\b/m.test(runs(sh)) && !/Set-ExecutionPolicy|-ExecutionPolicy/.test(code(ps)) && !/winget install|brew install/.test(runs(sh) + runs(ps)), runs(sh).match(/.*sudo.*/)?.[0] ?? '');
check('Windows 一律用 .cmd(PowerShell 缺省策略拦 .ps1)', !/(^|[\s(&])npm\s/m.test(code(ps)) && !/(^|[\s(&])cotutor\s/m.test(code(ps).replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')) && ps.includes('npm.cmd') && ps.includes('cotutor.cmd'));
check('npm 连不上:两边都退到国内镜像', sh.includes('registry.npmmirror.com') && ps.includes('registry.npmmirror.com'));
check('Mac 全局目录写不了:换到家目录,不用 sudo', sh.includes('.npm-global') && sh.includes('npm config set prefix'));
check('带了孩子的信息:建文件夹、装后台服务', /cotutor init "\$slug"/.test(sh) && sh.includes('cotutor service install') && ps.includes("@('init', $args[0])") && ps.includes('service install'));
check('随 npm 包发出去(jsDelivr 从包里取)', ['install.sh', 'install.ps1'].every((f) => pkg.files.includes(f)));
check('README 给了 Mac、Windows 的一行和 GitHub 的退路', readme.includes('raw.githubusercontent.com/TarsLab/cotutor/main/install.sh') && readme.includes('raw.githubusercontent.com/TarsLab/cotutor/main/install.ps1') && readme.includes('cdn.jsdelivr.net/npm/cotutor@latest/install.sh'));
// 国内连 GitHub raw 常超时、被重置(2026-11-07 在 Windows 上七次只通一次),jsDelivr 每次都通:先给 jsDelivr
check('README 先给 jsDelivr,GitHub 是退路', readme.indexOf('cdn.jsdelivr.net/npm/cotutor@latest/install.sh') < readme.indexOf('raw.githubusercontent.com/TarsLab/cotutor/main/install.sh') && readme.indexOf('cdn.jsdelivr.net/npm/cotutor@latest/install.ps1') < readme.indexOf('raw.githubusercontent.com/TarsLab/cotutor/main/install.ps1'));
check('Windows 从 jsDelivr 取时按 UTF-8 解开(jsDelivr 不标 charset,irm 会把中文读成乱码)', readme.includes('[Text.Encoding]::UTF8.GetString((iwr -useb https://cdn.jsdelivr.net/npm/cotutor@latest/install.ps1).Content)') && !/irm https:\/\/cdn\.jsdelivr/.test(readme + ps));
check('脚本里自己写的地址和 README 一致', sh.includes('https://raw.githubusercontent.com/TarsLab/cotutor/main/install.sh') && ps.includes('https://raw.githubusercontent.com/TarsLab/cotutor/main/install.ps1'));

// ---- 卸载 ----
const un = readme.slice(readme.indexOf('## 卸载'), readme.indexOf('## 开发'));
check('README 有卸载说明,先说孩子的记录不会被碰', un.length > 200 && un.indexOf('找不回来') < un.indexOf('```'));
for (const c of ['cotutor service uninstall']) check(`卸载用的命令照命令表对得上:${c}`, un.includes(c) && checkCommandLine(c) === null);
check('卸载说明不叫人删孩子的 cotutor 文件夹', !/rm -rf|Remove-Item/.test(un));
check('还留着的都说了在哪:key 与证书、日志、根证书、平板、防火墙', ['.config/cotutor', 'Library/Logs/cotutor', 'LOCALAPPDATA', 'mkcert -uninstall', '描述文件', '防火墙'].every((w) => un.includes(w)), un);

done();
