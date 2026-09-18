/**
 * workspace骨架清单:init 建、doctor 查,同一张清单(两边各写一遍必然漂移)。
 * 布局见《cotutor-agent层设计.md》§2:
 *   cotutor.json / .claude/agents(老师文件,拷自本包 agents/,是家长的)/ .qwen/agents(相对链)/ .cotutor/shipped.json(出厂 hash)
 *   agents/<name>/(老师的家 = 会话 cwd)/ ledger/(产物账本)/ conversations/(对话索引与转录)
 * vault 侧(《obsidian仓库设计.md》):档案 / 课程表 / 日记 / 教材 / 计划 / 参考,init 只建档案与参考 README(缺了才写)
 */
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentFile } from '../lib/agent-file.ts';
import { CONFIG_SCHEMA_FILE, TTS_DEFAULT, cotutorJsonSchema } from '../schema/index.ts';
import { mkdir, writeFile } from 'node:fs/promises';

export const DIRS = ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents', 'scenes', 'bundles', 'snaps'] as const;
export const LEDGER_FILES = ['ledger/artifacts.jsonl'] as const;

/** 本包自带的老师文件目录(仓库检出与 npm 安装都在包根 agents/) */
export const PACKAGE_AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));
/** 本包版本(出厂件的 hash 记录带它,升级时知道基于哪版) */
export const PACKAGE_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;

export interface ShippedAgent {
  name: string;
  file: string;
  description: string;
}

export async function shippedAgents(dir = PACKAGE_AGENTS_DIR): Promise<ShippedAgent[]> {
  const out: ShippedAgent[] = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const file = join(dir, f);
    const { frontmatter } = parseAgentFile(await readFile(file, 'utf8'));
    if (frontmatter.name) out.push({ name: frontmatter.name, file, description: frontmatter.description ?? '' });
  }
  return out;
}

export const GITIGNORE = `# 转录日志体积大、可从对话索引重建关键信息;要留全档就删掉下面这行
conversations/**/*.log
# 配音可重新合成
conversations/**/*.mp3
# 回放(cotutor replay)是调提示词与 vault 时的对照,不是孩子的对话
evals/
# 课包与截图是 drawtell build / snap 的派生物,场景源在 scenes/
bundles/
snaps/
# 作业照片(孩子在老师页上拍的;paths.captures):体积大、只是这一轮的素材,认出的文字在日记里
captures/
node_modules/
.DS_Store
`;

/** 档案模板(paths.profile,缺了才写):cotutor: profile 的那篇,原文整篇进每个话题的第一条 */
export function profileTemplate(name: string): string {
  return `---
cotutor: profile
nickname: ${name}
birthday:
school_start:
city:
---

(这篇是孩子的档案,文件名、放哪都行,认的是上面的 cotutor: profile。school_start 写读一年级的年月,如 2025-09,老师据此知道现在是几年级哪个学期。)

(下面写孩子的情况:性格、喜欢什么、要避开什么。每位老师每个话题开头都会整篇读到。)
`;
}

/** 参考目录的 README(缺了才写) */
export const REFERENCE_README = `# 参考

这里放政策与你自己的笔记:讲某类题的偏好、薄弱点、忌讳、按题型整理的东西——随便建,机器只读不写。
让老师看到的办法:在档案或这位老师的入口文件(\`cotutor: subject\` 的那篇)里链过去(\`[[找规律填数]]\`);老师拿到路径,要用时自己读。
`;

export interface TutorTemplateInput {
  name: string;
  display: string;
  subject?: string;
  description?: string;
}

/**
 * 家长自己加老师时的文件模板:和出厂老师一样只有人设与这一科的做法;
 * 公共的守则(上下文包、三种回复、记忆段、不变的规矩)在机器技能 cotutor-tutor,应用每个话题第一条放进上下文包。
 */
export function tutorTemplate(t: TutorTemplateInput): string {
  const what = t.subject ? `${t.subject}的事` : '孩子问的事';
  const subject = t.subject ?? '这一科';
  return `---
name: ${t.name}
description: ${t.description ?? `${t.display}。${what}都找它;随口问的一两句答完,要讲的在板书上一节一节讲`}
maxTurns: 40
permissionMode: bypassPermissions
---
你是这个家的${t.display},对面是一个孩子,有时是家长。(在这里写这位老师的性子和讲法,一两句:比如「说话慢一点,爱打比方」。)

上下文包怎么看、三种回复、记忆段、不变的规矩,在每个话题第一条的 \`<cotutor-rules>\` 里,照着做;这里只写${t.display}自己的。

## ${subject}

(在这里写这一科特有的做法:讲之前要对一下什么、教材里查什么、什么题该用哪种卡。只写对哪个孩子、哪个学期都成立的;关于这个孩子、这学期的,写进 vault 里这一科的入口文件。)
`;
}

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  tutors: ShippedAgent[];
}

const TUTOR_DEFAULTS: Record<string, { display: string; subject?: string; avatar: string; hidden?: boolean; runtime?: string; enabled?: boolean }> = {
  'math-tutor': { display: '数学老师', subject: '数学', avatar: '🧮' },
  'chinese-tutor': { display: '语文老师', subject: '语文', avatar: '📚' },
  'reading-tutor': { display: '朗读老师', subject: '英语', avatar: '📖' },
  'scene-maker': { display: '画图老师', avatar: '🎨', hidden: true, runtime: 'claude-scene' },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器替她拍板)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const tutors: Record<string, unknown> = {};
  for (const a of input.tutors) {
    const p = TUTOR_DEFAULTS[a.name];
    tutors[a.name] = p
      ? { display: p.display, ...(p.subject ? { subject: p.subject } : {}), avatar: p.avatar, enabled: p.enabled ?? true, ...(p.hidden ? { hidden: true } : {}), ...(p.runtime ? { runtime: p.runtime } : {}) }
      : { display: a.name, enabled: true };
  }
  const cfg = {
    $schema: CONFIG_SCHEMA_FILE,
    version: 1,
    title: input.name ? `${input.name}的老师们` : 'cotutor',
    kid: { slug: input.slug, ...(input.name ? { name: input.name } : {}) },
    server: { port: input.port ?? 5180 },
    paths: {},
    policyDefaults: {},
    tutors,
    runtimes: {
      default: 'claude',
      // --setting-sources project(2026-09-15):老师只读 workspace 的 .claude/,~/.claude 的技能(obsidian-cli 之类)/ hooks / additionalDirectories / 插件都不进老师会话;
      // 代价是 ~/.claude/settings.json 的 env(代理)也不进,serve 要从有代理的 shell 起,doctor env.userSettings 点名
      // 普通老师不许派子代理(--disallowedTools Agent):claude 会把 .claude/agents/ 里的老师文件当可派的子代理,老师自己去叫 scene-maker 就把预算烧在自己这轮里;画图作业由场景卡起
      claude: {
        run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--disallowedTools', 'Agent', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
        resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--disallowedTools', 'Agent', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
      },
      qwen: {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      },
      // 场景作业(scene-maker):分钟级、几美元一个,预算与时限比问答大;老师条目 runtime 指到它
      'claude-scene': {
        run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '8'],
        resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '8'],
      },
      'qwen-scene': {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '25m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '25m'],
      },
      // 板书后期(policy post.runtime):快模型、无工具、整块 JSON 出,几秒几厘;没有 resume 的事,写同一条。
      // 2026-09-15 量过:--disallowedTools 只禁调用、工具定义照发,一拍输入 27K;--tools "" 去工具定义(→ 6.7K)、--disable-slash-commands 去技能索引、
      // --system-prompt 换掉 claude 自己的系统提示与子代理列表(→ 514,就是提示词本身)。样本 8 拍质量不变,p95 7.0s → 3.8s,费用 1/4
      'claude-fast': {
        run: ['claude', '-p', '{prompt}', '--model', 'haiku', '--setting-sources', 'project', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--system-prompt', '你是板书后期,只回补丁。', '--max-budget-usd', '0.2'],
        resume: ['claude', '-p', '{prompt}', '--model', 'haiku', '--setting-sources', 'project', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--system-prompt', '你是板书后期,只回补丁。', '--max-budget-usd', '0.2'],
      },
    },
    tts: TTS_DEFAULT,
    // 字段说明不写在这里:一写进去就冻住(政策文件永不覆盖),$schema 指的 schema 文件每次 init / upgrade 从 zod 的 .describe() 刷新
    _note: '一孩一 workspace 的政策文件,家长改这里,机器不覆盖(写坏了靠 git 回退,cotutor doctor 可体检);每个字段的说明在 $schema 指的 .cotutor/cotutor.schema.json,编辑器里悬停就能看到。',
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/** 把 JSON Schema 写进 workspace(机器文件,每次 init / upgrade 都刷新);板书语法表出厂成技能 cotutor-board,见 skills.ts `writeBoardSkill` */
export async function writeSchemaFile(root: string): Promise<string> {
  const file = join(root, CONFIG_SCHEMA_FILE);
  await mkdir(join(root, '.cotutor'), { recursive: true });
  await writeFile(file, `${JSON.stringify(cotutorJsonSchema(), null, 2)}\n`);
  return file;
}
