/**
 * 一个孩子的 workspace 解析好的样子(app/workspace.ts 的 loadWorkspace 给;从那边挪来,2026-10-29):根、从哪认出来的、cotutor.json、各角色的绝对路径、几个目录。
 * 类型放在 schema:运行层、记忆、场景都按它取自己要的那几样,不用去引命令行那一层。
 */
import { z } from 'zod';
import type { CotutorConfig, PathRole } from './config.ts';

/**
 * 技能目录,相对 workspace 根(2026-10-30 从 .claude/skills 挪来):Codex、Qwen Code 在 workspace 里对话时直接读它;
 * Claude Code 只认 .claude/skills,那里是一条指过来的相对链(init / upgrade 建)
 */
export const SKILLS_DIR = '.agents/skills';

/** 老师文件 agents/<name>.md(2026-10-30 从 .claude/agents 挪来):和老师的家 agents/<name>/ 并排,同包里的 grades/grade-<n>/agents/ */
export function tutorFilePath(agentsDir: string, name: string): string {
  return `${agentsDir}/${name}.md`;
}

/** workspace 是怎么找到的:--workspace / COTUTOR_WORKSPACE / cwd 祖先 / ~/.config/cotutor/config.json / ~/cotutor/ 唯一目录 */
export type RootSource = 'flag' | 'env' | 'cwd' | 'user-config' | 'home-single';

/**
 * sandbox(2026-11-04):手动试功能用的 workspace,从真的那个分出来;对话、照片、vault 的写入都留在它里面,不进孩子的记录。
 * 命令加 --sandbox 就换到它(src/app/cli/sandbox.ts),下游照常当一个 workspace 用。
 * 位置:真 workspace 旁边的 .sandbox/<目录名>/(~/cotutor/ray → ~/cotutor/.sandbox/ray);点开头,「~/cotutor 下唯一目录」的兜底看不见它。
 * 分的时候根下照拷,只跳过孩子的状态(SANDBOX_SKIP;.cotutor/ 只拷 SANDBOX_KEEP_MACHINE);vault 在 workspace 外面就整份拷到 sandbox 的 vault/。
 * cotutor.json 改几处:标题前加「试用 · 」(孩子端、家长端、扫码页都看得出)、端口 +1(和真的并排开)、paths 指进 sandbox、自动记账关掉(试出来的话题不值得花钱记)。
 * 标记 .cotutor/sandbox.json 最后写:有它才算分完;--fresh 只删带这个标记的目录。
 */
export const SANDBOX_DIR = '.sandbox';
export const SANDBOX_MARK = '.cotutor/sandbox.json';
/** 标题前缀:「试用 · Ray的老师们」 */
export const SANDBOX_TITLE = '试用';
/** 外面的 vault 拷进 sandbox 后的目录名(相对 sandbox 根) */
export const SANDBOX_VAULT = 'vault';
/** workspace 根下是孩子的状态、不拷进 sandbox 的;其余都算设置,照拷(拷多了无妨,拷少了试的就不像真的) */
export const SANDBOX_SKIP: readonly string[] = ['conversations', 'ledger', 'captures', 'talk', 'dictation', 'evals', 'snaps', '.cotutor', '.git', 'node_modules', '.DS_Store'];
/** .cotutor/ 里照拷的;其余是缓存、设备表、孩子端流水 */
export const SANDBOX_KEEP_MACHINE: readonly string[] = ['shipped.json', 'cotutor.schema.json'];

export const SandboxMarkSchema = z.object({
  from: z.string().min(1).describe('从哪个 workspace 分出来的(绝对路径)'),
  vault: z.string().min(1).describe('分的时候拷的是哪个 vault(绝对路径)'),
  forkedAt: z.string().min(1).describe('什么时候分的(ISO)'),
});
export type SandboxMark = z.infer<typeof SandboxMarkSchema>;

export interface Workspace {
  root: string;
  source: RootSource;
  config: CotutorConfig;
  /** 这是个 sandbox(根下有 .cotutor/sandbox.json)就有,记着从哪分出来的 */
  sandbox?: SandboxMark;
  /** 角色 → 绝对路径;vault 侧角色相对 vault 解析,没配 vault 就相对 workspace 根;captures 相对 workspace 根 */
  paths: Record<PathRole, string> & Record<string, string>;
  dirs: {
    /** 老师文件 <name>.md 与老师的家 <name>/(会话 cwd,activity 在里面) */
    agents: string;
    ledger: string;
    conversations: string;
    /** 技能 .agents/skills/ */
    skills: string;
    /** 课包(cotutor chalk build 的产物,小课堂与 lecture 卡从这里放;派生物,gitignore) */
    bundles: string;
    /** 首页:草稿、已发布、历史;publish 时才建,不进骨架 */
    home: string;
    /** 视频小课堂(第 4 步):lectures/<id>/lecture.md + video.mp4;家长在编程助手里做,不进骨架 */
    lectures: string;
    /** 配音的缓存(.cotutor/tts/,src/media/tts.ts):同一句同一个音色只合成一次;机器文件,gitignore */
    tts: string;
  };
  files: {
    config: string;
    artifacts: string;
  };
}
