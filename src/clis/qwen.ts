/**
 * Qwen Code(`qwen`,0.25 起)的适配器(《agent层设计.md》拍板 15)。输出与 claude 同族(stream-json.ts),出入的地方:
 * - **隔离的家**:不用 `--bare`(它不读任何配置、不认 `--core-tools`、自带 read_file / edit / run_shell_command 一套)。
 *   `QWEN_HOME` 指 workspace 的 `.cotutor/qwen/home/`(不改 HOME),里面的 settings.json 由这里生成:模型供应商(key 只写环境变量名)、
 *   关掉它自己的记忆整理(不然一轮跑完在后台用 write_file 写文件)、使用统计、遥测、防休眠。会话落在 `.cotutor/qwen/runtime/`。
 * - **工具**:`{toolArgs}` 展开成 `--core-tools` + `--exclude-tools`;不带 = 工具表为空,只读 = read_file / glob / grep_search。
 *   模板带 `--approval-mode default`:shell、写、读 workspace 外都被拒(`--yolo` 会放行 workspace 外的读)。
 * - **思考量**:没有旗标;按 effort 指一份系统配置(`QWEN_CODE_SYSTEM_SETTINGS_PATH`,`model.reasoningEffort`)。
 * - **key**:起进程时 `DASHSCOPE_API_KEY` 先看环境,没有就从本机 `~/.qwen/settings.json` 的 env 现读,只进子进程的环境,不落盘。
 * - 没有钱数,只报 token;超时(退出码 55)不吐 result;每轮一条 goal_state 事件(读法里不出事件)。
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Policy, Runtime } from '../schema/index.ts';
import { parseStreamJson, streamJsonUserMessage } from './stream-json.ts';
import type { CliAdapter, ToolKind, ToolSet } from './types.ts';

const KINDS: Record<string, ToolKind> = {
  read_file: 'read',
  read_many_files: 'read',
  zoom_image: 'read',
  list_directory: 'read',
  run_shell_command: 'shell',
  glob: 'search',
  grep_search: 'search',
  edit: 'edit',
  write_file: 'edit',
  notebook_edit: 'edit',
  skill: 'skill',
};

/** 只读那轮给的核心工具(读文件含图片、按名找、按内容找) */
const READ_TOOLS = ['read_file', 'glob', 'grep_search'];
/** `--core-tools` 管不到的非核心工具,要一个个排除(0.25 的 system/init 里出现过的;ask_user_question 与计划模式那两个是不加 --bare 时才有的,2026-10-09 真跑里核对出来) */
const NON_CORE = ['agent', 'skill', 'list_agents', 'task_stop', 'send_message', 'record_artifact', 'get_goal', 'update_goal', 'tool_call', 'tool_search', 'report_findings', 'enter_worktree', 'exit_worktree', 'ask_user_question', 'enter_plan_mode', 'exit_plan_mode'];

/** workspace 里归 qwen 的目录(机器文件,prepare 每次对一遍) */
export const QWEN_DIR = '.cotutor/qwen';
const homeOf = (root: string): string => join(root, QWEN_DIR, 'home');
const effortFile = (root: string, level: string): string => join(root, QWEN_DIR, `effort-${level}.json`);

/** 政策 effort → 模型的思考档:low 不想(孩子在等);qwen3.7 系列只有开关,none 以外都是开 */
const EFFORT: Record<Policy['effort'], string> = { low: 'none', medium: 'low', high: 'xhigh' };
/**
 * 带工具的轮次(作业照片、记账)至少想一点:2026-10-09 真跑,同一道照片题 none 那次 read_file 都没调、请孩子说是哪页;
 * low 那次读了图、认出题目(11 秒)。孩子随口的话不带工具,不想照旧(3–6 秒)
 */
const levelOf = (effort: Policy['effort'], tools: ToolSet): string => (tools === 'on' && EFFORT[effort] === 'none' ? 'low' : EFFORT[effort]);

const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const toggle = { thinking: true, toggleOnly: true, disableField: 'enable_thinking' };
const tiers = { thinking: true, efforts: ['low', 'medium', 'xhigh'], defaultEffort: 'xhigh', disableField: 'reasoning_effort' };
/** 出厂模型(2026-10-09 五个模型 7 道真题对比:不想时 2–8 秒,讲得准也细;3.7-plus 快但浅,3.8-flash 不想时把盘算写进讲稿) */
export const QWEN_DEFAULT_MODEL = 'qwen3.8-max';

/** 百炼(DashScope)上能用的几个;运行时模板的 -m 选其中一个 */
const MODELS = [
  { id: 'qwen3.7-plus', capabilities: { reasoning: toggle }, generationConfig: { contextWindowSize: 1_000_000, modalities: { image: true } } },
  { id: 'qwen3.7-max', capabilities: { reasoning: toggle }, generationConfig: { contextWindowSize: 1_000_000 } },
  { id: 'qwen3.8-flash', capabilities: { reasoning: tiers }, generationConfig: { contextWindowSize: 1_000_000, modalities: { image: true, video: true } } },
  { id: 'qwen3.8-max', capabilities: { reasoning: tiers }, generationConfig: { contextWindowSize: 1_000_000, modalities: { image: true, video: true } } },
];

/** 隔离的家里那份 settings.json(没有 key,只写环境变量名) */
export function qwenHomeSettings(): Record<string, unknown> {
  return {
    $version: 4,
    security: { auth: { selectedType: 'openai' } },
    model: { name: QWEN_DEFAULT_MODEL },
    modelProviders: { openai: MODELS.map((m) => ({ ...m, baseUrl: DASHSCOPE, envKey: 'DASHSCOPE_API_KEY' })) },
    memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: { disableAutoUpdate: true, disableUpdateNag: true, preventSystemSleep: false },
  };
}

/** 这几份机器文件:绝对路径 → 内容 */
export function qwenFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {
    // 整个目录不进 git:会话记录(runtime/)是对话原文,同 conversations/ 只留本机;其余都是这里每次重新生成的
    [join(root, QWEN_DIR, '.gitignore')]: '# qwen 的隔离家目录与会话记录(cotutor 生成,对话原文只留本机)\n*\n',
    [join(homeOf(root), 'settings.json')]: `${JSON.stringify(qwenHomeSettings(), null, 2)}\n`,
  };
  for (const level of new Set(Object.values(EFFORT))) files[effortFile(root, level)] = `${JSON.stringify({ $version: 4, model: { reasoningEffort: level } }, null, 2)}\n`;
  return files;
}

/** 本机 qwen 配好的百炼 key(~/.qwen/settings.json 的 env);读不到就是 null */
export function localDashscopeKey(home = homedir()): string | null {
  try {
    const s = JSON.parse(readFileSync(join(home, '.qwen', 'settings.json'), 'utf8')) as { env?: Record<string, unknown> };
    const k = s.env?.DASHSCOPE_API_KEY;
    return typeof k === 'string' && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/** 别处的设置会盖掉家里选的模型与供应商,起进程时去掉 */
const FOREIGN = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'QWEN_MODEL'];

export const qwen: CliAdapter = {
  name: 'qwen',
  parse: parseStreamJson,
  stdinMessage: streamJsonUserMessage,
  toolList: (set) => (set === 'on' ? READ_TOOLS.join(',') : ''),
  // --core-tools 是白名单,不带时也要给一个(给空等于不限),再把它排除掉;非核心工具不归 --core-tools 管,总要排除。
  // 只读那轮把 workspace 根与 vault 加进可读范围:会话 cwd 是老师目录,作业照片(captures/)与教材在它外面,读外面要征得同意——
  // 消息走 stdin 时它就停在那儿等,一直等到 --max-wall-time(2026-10-09 真跑,开了思考的那次读照片挂住)
  toolArgs: (set: ToolSet, { readDirs }) =>
    set === 'on'
      ? ['--core-tools', READ_TOOLS.join(','), '--exclude-tools', NON_CORE.join(','), ...readDirs.flatMap((d) => ['--include-directories', d])]
      : ['--core-tools', 'read_file', '--exclude-tools', ['read_file', ...NON_CORE].join(',')],
  toolKind: (name) => KINDS[name] ?? 'other',
  expectedTools: (set) => (set === 'on' ? READ_TOOLS : []),
  planEnv: ({ root, effort, tools }): Record<string, string> =>
    root ? { QWEN_HOME: homeOf(root), QWEN_RUNTIME_DIR: join(root, QWEN_DIR, 'runtime'), QWEN_CODE_SYSTEM_SETTINGS_PATH: effortFile(root, levelOf(effort, tools)) } : {},
  async prepare(root) {
    for (const [file, text] of Object.entries(qwenFiles(root))) {
      if ((await readFile(file, 'utf8').catch(() => null)) === text) continue;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
    }
  },
  env: (env) => {
    const out: NodeJS.ProcessEnv = { ...env, QWEN_USAGE_STATISTICS_ENABLED: 'false', QWEN_CODE_MODELS_DEV: 'off', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1' };
    for (const k of FOREIGN) delete out[k];
    if (!out.DASHSCOPE_API_KEY) {
      const key = localDashscopeKey(out.HOME || homedir());
      if (key) out.DASHSCOPE_API_KEY = key;
    }
    return out;
  },
  // 0.21 时代的出厂模板(消息进 argv、--yolo、只追加系统提示,不流式);拍板 15 换掉。头一版追加的是 {agentBody},板书写法放在话题第一条(拍板 11 之前)。
  // 最后一版是拍板 15 当天的 qwen3.7-plus,同日换成 qwen3.8-max
  retired: {
    qwen: [
      {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      },
      {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{systemBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{systemBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      },
      (() => {
        const f = ['-m', 'qwen3.7-plus', '--system-prompt', '{systemBody}', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--approval-mode', 'default', '{toolArgs}', '--max-wall-time', '10m'];
        return { run: ['qwen', ...f], resume: ['qwen', '--resume', '{session}', ...f] };
      })(),
    ],
  },
  check: ({ version, env }) => {
    const v = /(\d+)\.(\d+)\.(\d+)/.exec(version);
    const old = !v || Number(v[1]) === 0 && Number(v[2]) < 25;
    const key = Boolean(env.DASHSCOPE_API_KEY) || localDashscopeKey(env.HOME || homedir()) !== null;
    return [
      { name: 'version', ok: !old, detail: old ? `qwen ${version || '?'}:要 0.25 起(关工具的旗标、隔离的家、思考量配置都按 0.25 定的)` : `qwen ${version}`, fix: old ? 'qwen update(或 brew upgrade qwen-code)' : undefined },
      { name: 'key', ok: key, detail: key ? '百炼 key 拿得到(环境变量 DASHSCOPE_API_KEY,或本机 ~/.qwen/settings.json 的 env)' : '拿不到百炼 key:老师进程起来就会 401', fix: key ? undefined : '在起 serve 的 shell 里 export DASHSCOPE_API_KEY,或先在终端跑一次 qwen 配好百炼' },
    ];
  },
  runtimes: (): Record<string, Runtime> => {
    // 消息走 stdin(预热能用;数组旗标 --core-tools 之类会吞掉跟在后面的消息,不进 argv 正好避开);-m 选模型(家里那份 settings.json 列着的);
    // {systemBody} = 老师正文 + 板书写法,整份换掉 qwen 自己的系统提示;{toolArgs} 由适配器展开;--approval-mode default:shell、写、读 workspace 外都拒
    const flags = ['-m', QWEN_DEFAULT_MODEL, '--system-prompt', '{systemBody}', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--approval-mode', 'default', '{toolArgs}', '--max-wall-time', '10m'];
    return { qwen: { stdin: 'stream-json', run: ['qwen', ...flags], resume: ['qwen', '--resume', '{session}', ...flags] } };
  },
};
