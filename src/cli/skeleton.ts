/**
 * workspace骨架清单:init 建、doctor 查,同一张清单(两边各写一遍必然漂移)。
 * 布局见《cotutor-agent层设计.md》§2:
 *   cotutor.json / .claude/agents(老师文件,拷自本包 agents/,是家长的;所有 CLI 都从这里拿老师正文)/ .cotutor/shipped.json(出厂 hash)
 *   agents/<name>/(老师的家 = 会话 cwd)/ ledger/(产物账本)/ conversations/(对话索引与转录)
 * vault 侧(《obsidian仓库设计.md》):档案 / 课程表 / 日记 / 教材 / 计划 / 参考,init 只建档案与参考 README(缺了才写)
 */
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentFile } from '../lib/agent-file.ts';
import { CONFIG_SCHEMA_FILE, TTS_DEFAULT, cotutorJsonSchema, type BoardCardKind } from '../schema/index.ts';
import { factoryRuntimes } from '../clis/index.ts';

import { mkdir, writeFile } from 'node:fs/promises';


export const DIRS = ['agents', 'ledger', 'conversations', '.claude/agents', 'bundles'] as const;
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
# 课包是 drawtell build 的派生物(小课堂的源在家长做课的地方)
bundles/
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
你是这个家的${t.display},对面是一个孩子。(在这里写这位老师的性子和讲法,一两句:比如「说话慢一点,爱打比方」。)

上下文包怎么看、三种回复、记忆段、不变的规矩,在每个话题第一条的 \`<cotutor-rules>\` 里,照着做;这里只写${t.display}自己的。

## ${subject}

(下面几节写这一科特有的做法,一条一句。只写对哪个孩子、哪个学期都成立的;关于这个孩子、这学期的,写进 vault 里这一科的入口文件。用不上的小节删掉。)

### 讲之前

(要对一下什么、教材里查什么。)

### 讲

(这一科怎么讲、什么内容用哪种卡。)

### 练

(一节末尾怎么问、用哪种卡。)

### 孩子这样说时

(孩子常见的说法或答偏了,怎么接。)
`;
}

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  tutors: ShippedAgent[];
}

/** 出厂老师的条目;cards = 板书写法里讲哪几种卡(《卡片协议.md》「谁拿到哪些卡」,2026-10-07),text 总在 */
const TUTOR_DEFAULTS: Record<string, { display: string; subject?: string; avatar: string; hidden?: boolean; runtime?: string; enabled?: boolean; cards?: BoardCardKind[]; policy?: { effort?: 'low' | 'medium' | 'high'; tools?: 'on' } }> = {
  // 数学多想一会儿:算错的代价大(别的老师用缺省 low)
  'math-tutor': { display: '数学老师', subject: '数学', avatar: '🧮', cards: ['text', 'choice', 'fill', 'image', 'lecture', 'canvas', 'code'], policy: { effort: 'medium' } },
  'chinese-tutor': { display: '语文老师', subject: '语文', avatar: '📚', cards: ['text', 'read', 'choice', 'fill', 'image', 'tianzige', 'lecture', 'canvas'] },
  'english-tutor': { display: '英语老师', subject: '英语', avatar: '🔤', cards: ['text', 'read', 'choice', 'fill', 'image', 'word', 'lecture'] },
  // 口播老师(《口播老师设计.md》§6):要 koubo 才有用,出厂关着;在要练的那个 workspace 里打开,upgrade 再装 koubo 的技能
  // 它每节都要跑 koubo 命令(进度、出题),孩子说的话也带工具
  'koubo-tutor': { display: '口播老师', subject: '口播', avatar: '🎙️', enabled: false, cards: ['text', 'read', 'record'], policy: { tools: 'on' } },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器替她拍板)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const tutors: Record<string, unknown> = {};
  for (const a of input.tutors) {
    const p = TUTOR_DEFAULTS[a.name];
    tutors[a.name] = p
      ? { display: p.display, ...(p.subject ? { subject: p.subject } : {}), avatar: p.avatar, enabled: p.enabled ?? true, ...(p.hidden ? { hidden: true } : {}), ...(p.runtime ? { runtime: p.runtime } : {}), ...(p.cards ? { cards: p.cards } : {}), ...(p.policy ? { policy: p.policy } : {}) }
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
    // 出厂运行时由各 CLI 的适配器给(src/clis/<cli>.ts 的 runtimes(),旗标为什么这么写的注释也在那里);缺省 claude
    runtimes: { default: 'claude', ...factoryRuntimes() },
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
