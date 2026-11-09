/**
 * 帮助与参数检查,都从命令表(commands.ts)来:顶层帮助只列命令和一句话,参数、例子在 cotutor <命令> --help。
 * 纯函数、不碰 I/O:技能生成(app/skills/*-doc.ts)和测试都 import 它,不能把 CLI 带进去。
 */
import { COMMANDS, GROUP_TITLE, commandSpec, type CommandSpec, type FlagSpec, type Group } from './commands.ts';

const WORKSPACE_DESC = '哪个孩子的 cotutor 文件夹(缺省:COTUTOR_WORKSPACE → 当前目录往上找 → ~/.config/cotutor/config.json → ~/cotutor/ 下唯一的那个)';
const SANDBOX_DESC = '在试用副本里跑(旁边的 .sandbox/,写的东西不进孩子的记录;--fresh 重新分一份)';

/** 顶层帮助;all 时连开发与调试的命令也列 */
export function topHelp(opts: { all?: boolean } = {}): string {
  const groups: Group[] = opts.all ? ['setup', 'daily', 'custom', 'debug'] : ['setup', 'daily', 'custom'];
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const out = ['cotutor — 家里的 AI 老师团', '', '用法:cotutor <命令> [选项]'];
  for (const g of groups) {
    out.push('', GROUP_TITLE[g]);
    for (const c of COMMANDS.filter((x) => x.group === g && !x.hidden)) out.push(`  ${pad(c.name, width)}${c.summary}`);
  }
  out.push(
    '',
    '常用选项:',
    '  --workspace <目录>  选哪个孩子(缺省自动找)',
    '  --json              机器可读的输出',
    '  --sandbox           在试用副本里跑,不进孩子的记录',
    '  --version           版本号',
    '各命令认哪些,看它的帮助;不认的选项、多余的参数都报错,不会悄悄忽略。',
    '退出码:0 成功 · 1 没通过(体检、检查有要改的) · 2 用法错 · 4 内部错误',
    '',
    '参数和例子:cotutor <命令> --help',
  );
  if (!opts.all) out.push(`开发与调试的命令(${COMMANDS.filter((c) => c.group === 'debug' && !c.hidden).map((c) => c.name).join('、')}):cotutor --help --all`);
  return `${out.join('\n')}\n`;
}

/** 一条命令的全部选项(连同它认的全局选项),帮助和检查共用 */
function flagsOf(c: CommandSpec, opts: { place?: boolean } = {}): FlagSpec[] {
  const out: FlagSpec[] = [...(c.flags ?? [])];
  const place = opts.place !== false;
  if (c.workspace) out.push({ name: 'workspace', value: '<目录>', desc: WORKSPACE_DESC, ...(place ? {} : { hidden: true }) });
  if (c.sandbox) out.push({ name: 'sandbox', desc: SANDBOX_DESC, ...(place ? {} : { hidden: true }) }, { name: 'fresh', desc: '', hidden: true });
  if (c.json) out.push({ name: 'json', desc: '机器可读的输出', ...(Array.isArray(c.json) ? { subs: c.json as readonly string[] } : {}) });
  return out;
}

/** 终端里占几格:中文、全角两格 */
const cells = (s: string): number => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const pad = (s: string, width: number): string => s + ' '.repeat(Math.max(0, width - cells(s)));
/** 帮助里旗标说明前面的 [install];'' 是不带子命令的那种 */
const subsTag = (subs: readonly string[]): string => `[${subs.map((s) => (s === '' ? '不带子命令' : s)).join('、')}] `;
/** 报错里说「只给谁用」 */
const subsWho = (c: CommandSpec, subs: readonly string[]): string => subs.map((s) => (s === '' ? `cotutor ${c.name}(不带子命令)` : `${c.name} ${s}`)).join('、');

/** cotutor <命令> --help;place: false 不列 --workspace / --sandbox(技能参考里统一说一次) */
export function commandHelp(name: string, opts: { place?: boolean } = {}): string {
  const c = commandSpec(name);
  if (!c) return topHelp();
  const out = [`cotutor ${c.name} — ${c.summary}`, '', '用法:', ...c.usage.map((u) => `  ${u}`)];
  const shown = flagsOf(c, opts).filter((f) => !f.hidden);
  if (shown.length) {
    const label = (f: FlagSpec): string => `--${f.name}${f.value ? ` ${f.value}` : ''}`;
    const width = Math.min(26, Math.max(...shown.map((f) => cells(label(f)))) + 2);
    out.push('', '选项:');
    for (const f of shown) {
      const l = label(f);
      out.push(`  ${cells(l) >= width ? `${l}\n  ${' '.repeat(width)}` : pad(l, width)}${f.subs ? subsTag(f.subs) : ''}${f.desc}`);
    }
  }
  if (c.notes?.length) out.push('', '说明:', ...c.notes.map((n) => `  - ${n}`));
  if (c.effects?.length) out.push('', '注意:', ...c.effects.map((n) => `  - ${n}`));
  out.push('', '例子:', ...c.examples.map((e) => `  ${e}`));
  return `${out.join('\n')}\n`;
}

/** 技能里的命令参考:这几条命令各自的帮助;--workspace、--sandbox 在开头说一次 */
export function commandsReference(names: readonly string[]): string {
  return [
    '这些命令都认 --workspace <目录>(在 workspace 根跑可以不写)和 --sandbox(在试用副本里跑,不进孩子的记录)。',
    ...names.map((n) => commandHelp(n, { place: false }).trimEnd()),
  ].join('\n\n');
}

/** 编辑距离,给打错的字找最像的 */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // 两个字母打反了(josn → json)算一步
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let score = Infinity;
  for (const c of candidates) {
    const s = c.startsWith(word) || word.startsWith(c) ? 1 : distance(word, c);
    if (s < score) { score = s; best = c; }
  }
  return score <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

/** 不认识的命令:一句话,带最像的那个 */
export function unknownCommand(cmd: string): string {
  const near = closest(cmd, COMMANDS.filter((c) => !c.hidden).map((c) => c.name));
  return `没有 '${cmd}' 这条命令${near ? `,是不是 cotutor ${near}?` : ''}`;
}

/**
 * 照命令表检查参数:不认识的旗标、用错子命令的旗标、不认识的子命令、多余的参数。
 * 通过返回 null,不通过返回一句话(调用方补「看 cotutor <命令> --help」)。命令本身认不认识由调用方先判。
 */
export function checkArgs(c: CommandSpec, positionals: readonly string[], flags: Readonly<Record<string, string | true>>): string | null {
  const sub = positionals[0];
  if (c.subs && (sub !== undefined || c.subRequired) && !c.subs.includes(sub ?? '') && !c.hiddenSubs?.includes(sub ?? '')) {
    const near = sub === undefined ? undefined : closest(sub, c.subs);
    return `${c.name} 后面跟 ${c.subs.join(' / ')}${c.subRequired ? ' 之一' : ''}${sub === undefined ? '' : `,不认识 '${sub}'`}${near ? `,是不是 ${near}?` : ''}`;
  }
  if (positionals.length > c.maxArgs) {
    const extra = positionals[c.maxArgs];
    return c.maxArgs === 0 ? `${c.name} 不带参数,多了 '${extra}'` : `多余的参数 '${extra}':${c.name} 最多 ${c.maxArgs} 个${extra.includes(' ') ? '(带空格的值要加引号)' : ''}`;
  }
  const known = flagsOf(c);
  const actualSub = c.subs?.includes(sub ?? '') || c.hiddenSubs?.includes(sub ?? '') ? (sub ?? '') : '';
  for (const key of Object.keys(flags)) {
    // --sandbox / --fresh 由 main 自己说清楚(这条命令为什么不用试用副本),这里不抢
    if (key === 'help' || key === 'all' || key === 'version' || key === 'sandbox' || key === 'fresh') continue;
    const f = known.find((x) => x.name === key);
    if (!f) {
      const near = closest(key, known.filter((x) => !x.hidden).map((x) => x.name));
      return `${c.name} 不认识 --${key}${near ? `,是不是 --${near}?` : ''}`;
    }
    if (f.subs && !f.subs.includes(actualSub)) return `--${key} 只给 ${subsWho(c, f.subs)} 用`;
    if (f.value && flags[key] === true && key !== 'force') return `--${key} 要一个值:--${key} ${f.value}`;
  }
  return null;
}

/** 一行 cotutor 命令(文档、测试里写的)照命令表对不对得上;对得上返回 null */
export function checkCommandLine(line: string): string | null {
  const words = line.trim().split(/\s+/);
  if (words[0] !== 'cotutor' && words[0] !== 'cotutor.cmd') return `不是 cotutor 命令:${line}`;
  const [cmd, ...rest] = words.slice(1);
  if (cmd === '--version' || cmd === '--help') return null;
  const c = commandSpec(cmd);
  if (!c) return unknownCommand(cmd);
  if (rest.includes('--help')) return null;
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!w.startsWith('--')) { positionals.push(w); continue; }
    const key = w.slice(2).split('=')[0];
    const spec = flagsOf(c).find((f) => f.name === key);
    if (spec?.value && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) flags[key] = rest[++i];
    else flags[key] = true;
  }
  return checkArgs(c, positionals, flags);
}

/** 旧名:顶层帮助 */
export const USAGE = topHelp();
