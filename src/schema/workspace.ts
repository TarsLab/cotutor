/**
 * 一个孩子的 workspace 解析好的样子(app/workspace.ts 的 loadWorkspace 给;从那边挪来,2026-10-29):根、从哪认出来的、cotutor.json、各角色的绝对路径、几个目录。
 * 类型放在 schema:运行层、记忆、场景都按它取自己要的那几样,不用去引命令行那一层。
 */
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

export interface Workspace {
  root: string;
  source: RootSource;
  config: CotutorConfig;
  /** 角色 → 绝对路径;vault 侧角色相对 vault 解析,没配 vault 就相对 workspace 根;captures 相对 workspace 根 */
  paths: Record<PathRole, string> & Record<string, string>;
  dirs: {
    /** 老师文件 <name>.md 与老师的家 <name>/(会话 cwd,activity 在里面) */
    agents: string;
    ledger: string;
    conversations: string;
    /** 技能 .agents/skills/ */
    skills: string;
    /** 课包(drawtell build 的产物,小课堂与 lecture 卡从这里放;派生物,gitignore) */
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
