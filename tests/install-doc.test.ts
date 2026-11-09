/**
 * INSTALL.md 是 agent 一字不差照做的:里面出现的 cotutor 命令、子命令、旗标都要照命令表(src/app/cli/commands.ts)对得上,过期的步骤比没有更糟。
 * 要人做的步骤必须标「交给家长」;命令块里不能出现禁止项;读的 JSON 字段要真有。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const { checkCommandLine, topHelp } = await import('../src/app/cli/usage.ts');
const { commandSpec } = await import('../src/app/cli/commands.ts');
const root = join(import.meta.dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
const doc = read('INSTALL.md');

// ---- 代码里的命令:围栏块一行一条,行内代码整段 ----
const fenced = [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n')).map((l) => l.trim()).filter(Boolean);
const inline = [...doc.replace(/```[a-z]*\n[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
const commands = [...fenced, ...inline].filter((c) => /^cotutor\s/.test(c));

check('INSTALL.md 里确实有 cotutor 命令(解析没坏)', commands.length >= 10, String(commands.length));
// 命令、子命令、旗标、参数个数都照命令表查(和 cotutor 真跑时拦的是同一套)
for (const c of commands) check(`命令照命令表对得上:${c}`, checkCommandLine(c) === null, checkCommandLine(c) ?? '');
check('第 1 步说的 --workspace,doctor、service、open 都认;cert 不认(所以「除 cotutor cert 外」)', ['doctor', 'service', 'open'].every((c) => commandSpec(c)?.workspace) && !commandSpec('cert')?.workspace && doc.includes('除 `cotutor cert` 外'));

// ---- 禁止项:写在「不能做」里,命令块里不能出现 ----
const forbidden = /sudo\s+npm|upgrade\s+--force|cotutor\s+reset|git\s+clone|Set-ExecutionPolicy|rm\s+-rf/;
check('围栏命令块里没有禁止项', !fenced.some((l) => forbidden.test(l)), fenced.find((l) => forbidden.test(l)));
const banned = doc.slice(doc.indexOf('## 不能做'), doc.indexOf('## 1.'));
check('「不能做」写全:贴 key、clone、sudo、回出厂(reset)、删文件夹', ['API Key', 'git clone', 'sudo', 'cotutor reset', '删'].every((w) => banned.includes(w)), banned);

// ---- 要人做的步骤:每一样都要在「交给家长」那句旁边 ----
const handoffs = doc.split('\n').filter((_, i, all) => all.slice(Math.max(0, i - 2), i + 1).some((x) => x.includes('交给家长')));
for (const [what, word] of [['开机密码那步', 'mkcert -install'], ['百炼', '百炼'], ['平板的根证书', '根证书'], ['防火墙弹窗', '允许访问'], ['Linux 常驻', 'enable-linger'], ['装 Node', 'nodejs.org']] as const) {
  check(`交给家长:${what}`, handoffs.some((l) => l.includes(word)), word);
}
check('提醒家长:key 填在页面上,不贴进对话', doc.includes('不要贴到对话里'));

// ---- 家长端最后再开:第 6 步切到 HTTPS 后,第 4 步开的 http 页面打不开 ----
check('第 4 步带 --no-open', doc.slice(doc.indexOf('## 4.'), doc.indexOf('## 5.')).includes('cotutor service install --no-open'));
check('第 7 步再开', doc.slice(doc.indexOf('## 7.')).includes('跑 `cotutor open`'));

// ---- Windows 上照做会出错的两处(2026-11-07 真机):脚本策略、cmd.exe 不认 $HOME ----
check('说了 PowerShell 禁止运行脚本时用 .cmd,不改策略', doc.includes('`npm.cmd`') && doc.includes('`cotutor.cmd`') && doc.includes('不要改执行策略'));
check('用 doctor --fix,不叫 agent 自己抄 cmd(cmd.exe 不认里面的 $HOME;--fix 不经 shell)', doc.includes('cotutor doctor --fix') && !doc.includes('照原样跑'));
check('恢复备份要家长说了才做', banned.includes('backup restore'));
check('解决不了:跑 cotutor report,给家长去反馈', doc.includes('cotutor report') && doc.includes('/issues'));
check('cotutor cert 的 ! 行有去处', doc.includes('`cotutor cert` 输出里以 `!` 开头'));

// ---- 读的字段要真有:doctor 的 cmd / human,service status --json 的这些键 ----
const doctorSrc = read('src/app/cli/doctor.ts');
check('doctor 有 cmd 与 human 字段', /\bcmd\?: string/.test(doctorSrc) && /\bhuman\?: true/.test(doctorSrc));
const mainSrc = read('src/app/cli/main.ts');
for (const key of ['parentPage', 'tabletUrl', 'bailian', 'portHolder', 'version', 'cert']) {
  check(`service status --json 有 ${key}`, doc.includes(key) && new RegExp(`\\b${key}\\b:?`).test(mainSrc.slice(mainSrc.indexOf("if (sub === 'status')"))));
}
for (const key of ['present', 'coversName', 'serving']) check(`cert.${key}`, doc.includes(`cert.${key}`) && mainSrc.includes(`${key}:`));
for (const name of ['bailian', 'https', 'vault.profile', 'server.access', 'mac.sleep', 'windows.sleep']) check(`提到的体检项真有:${name}`, doc.includes(name) && doctorSrc.includes(`name: '${name}'`));

// ---- 指出去的文档还在 ----
const ipad = read('docs/iPad与iPhone.md');
check('iPad 文档在,第 3、4 节还是根证书与信任开关', existsSync(join(root, 'docs/iPad与iPhone.md')) && /^## 3\. .*根证书/m.test(ipad) && /^## 4\. .*信任/m.test(ipad));
check('README 有「数据与升级」', /^## 数据与升级/m.test(read('README.md')));

// ---- 入口:README 最上面一句可复制的话(不用输网址,走 npm),AGENTS 第一屏分流 ----
const readme = read('README.md');
const start = readme.indexOf('npx cotutor@latest guide');
check('README 在「五分钟用起来」开头放了给 AI 助手的那句,叫它跑 npx cotutor@latest guide', start > 0 && start < readme.indexOf('npm i -g cotutor'));
const web = readme.indexOf('https://cdn.jsdelivr.net/npm/cotutor@latest/INSTALL.md');
check('跑不了命令的聊天机器人:读 npm 包里那份(jsDelivr),紧跟在后面', web > start && web < readme.indexOf('npm i -g cotutor'));
check('README 不再让助手读 GitHub main 上的 INSTALL.md(main 可能比 npm 新)', !readme.includes('raw.githubusercontent.com/TarsLab/cotutor/main/INSTALL.md'));
check('INSTALL.md 随 npm 包发', (JSON.parse(read('package.json')) as { files: string[] }).files.includes('INSTALL.md'));
check('INSTALL.md 说了 npx 只是看,第 2 步照样装', doc.slice(0, doc.indexOf('## 不能做')).includes('npx cotutor@latest guide') && doc.includes('第 2 步照样要装'));
// cotutor guide 原样打印;第一行只有 ASCII(PowerShell 5.1 按代码页解管道,中文成乱码时这行还读得懂)
const guide = execFileSync(process.execPath, [join(root, 'bin', 'cotutor.js'), 'guide'], { encoding: 'utf8' });
const [head, ...rest] = guide.split('\n');
check('cotutor guide 打印的就是 INSTALL.md', rest.join('\n').trim() === doc.trim());
check('guide 第一行只有 ASCII,带版本号和文件位置', /^[\x20-\x7e]+$/.test(head) && head.includes(JSON.parse(read('package.json')).version) && head.includes('INSTALL.md'), head);
check('顶层帮助第一条就是 guide(助手先看最上面)', /安装与设置\n  guide /.test(topHelp()), topHelp().slice(0, 200));
check('手动装的 README:第一次装会打开,不用再跑 cotutor open', readme.includes('第一次装会打开家长端') && !/^cotutor open /m.test(readme));
check('AGENTS 第一屏分流:在家长的电脑上安装看 INSTALL.md', read('AGENTS.md').slice(0, 300).includes('INSTALL.md'));

done();
