/**
 * INSTALL.md 是 agent 一字不差照做的:里面出现的 cotutor 命令、子命令、旗标都要在 USAGE 里有,过期的步骤比没有更糟。
 * 要人做的步骤必须标「交给家长」;命令块里不能出现禁止项;读的 JSON 字段要真有。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const { USAGE } = await import('../src/app/cli/usage.ts');
const root = join(import.meta.dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
const doc = read('INSTALL.md');
const usageLines = USAGE.split('\n').filter((l) => /^\s+cotutor /.test(l));

// ---- 代码里的命令:围栏块一行一条,行内代码整段 ----
const fenced = [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n')).map((l) => l.trim()).filter(Boolean);
const inline = [...doc.replace(/```[a-z]*\n[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
const commands = [...fenced, ...inline].filter((c) => /^cotutor\s/.test(c));

/** 这条命令在 USAGE 里对应的行;没有就说明命令过期了 */
function linesFor(cmd: string): string[] {
  return usageLines.filter((l) => new RegExp(`cotutor ${cmd.replace(/[-]/g, '\\-')}(\\s|$)`).test(l));
}

check('INSTALL.md 里确实有 cotutor 命令(解析没坏)', commands.length >= 10, String(commands.length));
for (const c of commands) {
  const args = c.split(/\s+/).slice(1);
  // cotutor --version | --help 写在同一行
  const lines = args[0].startsWith('-') ? usageLines.filter((l) => l.includes(args[0])) : linesFor(args[0]);
  check(`命令在 USAGE 里:${c}`, lines.length > 0);
  if (!lines.length) continue;
  const sub = args[1];
  // 第二个词是子命令(service install、tray on):占位符 <…>、旗标不算;init 的 <slug> 这种本来就是占位符
  if (sub && !sub.startsWith('-') && !sub.startsWith('<')) {
    check(`子命令在 USAGE 里:${c}`, lines.some((l) => new RegExp(`(^|[\\s|])${sub}(\\s|$)`).test(l)));
  }
  for (const flag of args.filter((a) => a.startsWith('--'))) {
    const name = flag.split('=')[0];
    check(`旗标在 USAGE 里:${c} 的 ${name}`, lines.some((l) => l.includes(name)));
  }
}
check('第 1 步说的 --workspace,doctor、service 都认', linesFor('doctor').some((l) => l.includes('--workspace')) && linesFor('service').some((l) => l.includes('--workspace')));

// ---- 禁止项:写在「不能做」里,命令块里不能出现 ----
const forbidden = /sudo\s+npm|upgrade\s+--force|git\s+clone|Set-ExecutionPolicy|rm\s+-rf/;
check('围栏命令块里没有禁止项', !fenced.some((l) => forbidden.test(l)), fenced.find((l) => forbidden.test(l)));
const banned = doc.slice(doc.indexOf('## 不能做'), doc.indexOf('## 1.'));
check('「不能做」写全:贴 key、clone、sudo、--force、删文件夹', ['API Key', 'git clone', 'sudo', 'upgrade --force', '删'].every((w) => banned.includes(w)), banned);

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
check('说了 cmd.exe 里 $HOME 要换', doc.includes('cmd.exe') && doc.includes('%USERPROFILE%'));
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

// ---- 入口:README 最上面一句可复制的话,AGENTS 第一屏分流 ----
const readme = read('README.md');
const start = readme.indexOf('https://raw.githubusercontent.com/TarsLab/cotutor/main/INSTALL.md');
check('README 在「五分钟用起来」开头放了给 AI 助手的那句', start > 0 && start < readme.indexOf('npm i -g cotutor'));
check('手动装的 README:第一次装会打开,不用再跑 cotutor open', readme.includes('第一次装会打开家长端') && !/^cotutor open /m.test(readme));
check('AGENTS 第一屏分流:在家长的电脑上安装看 INSTALL.md', read('AGENTS.md').slice(0, 300).includes('INSTALL.md'));

done();
