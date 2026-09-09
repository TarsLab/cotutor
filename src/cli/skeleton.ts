/**
 * workspace骨架清单:init 建、doctor 查,同一张清单(两边各写一遍必然漂移)。
 * 布局见《cotutor-agent层设计.md》§2:
 *   cotutor.json / CLAUDE.md QWEN.md(家规)/ .claude/agents(老师文件,拷自本包 agents/,是家长的)/ .qwen/agents(相对链)/ .cotutor/shipped.json(出厂 hash)
 *   agents/<name>/(老师的家 = 会话 cwd)/ ledger/(两本账)/ conversations/(对话索引与转录)
 */
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentFile } from '../lib/agent-file.ts';
import { CONFIG_SCHEMA_FILE, TTS_DEFAULT, cotutorJsonSchema } from '../schema/index.ts';
import { mkdir, writeFile } from 'node:fs/promises';

export const DIRS = ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents'] as const;
export const LEDGER_FILES = ['ledger/observations.jsonl', 'ledger/artifacts.jsonl'] as const;

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
# 自签证书与私钥(cotutor cert 建)
certs/
node_modules/
.DS_Store
`;

/** 家规:所有老师常驻(CLAUDE.md 与 QWEN.md 同一份)。故意短。 */
export const RULES = `# 家规

- 关于孩子的观察,写一条到 ledger/observations.jsonl(一行 JSON:id、date、author=你的名字、claim 一句话、evidence 指向对话或产物),别的老师和规划老师从那里读。
- 你自己的经验记进你的记忆目录(MEMORY.md 一行索引 + 主题文件)。
- 你说给孩子听的话放在回复的**最后一段**,孩子只看得到最后一段;中间的话和工具过程只有家长看。
- 需要家长拍板的事写成一段「## 待裁量」(question: 一句话;options: 列表),不要停下来等。
- 要交给别的老师的事写成一段「## 转交」(to: 老师名;why: 一句话;refs: 相关文件),第一期只允许一跳。
- 对话按天,明天从账本和你的记忆接着来,不要指望今天的对话还在。
`;

export interface TutorTemplateInput {
  name: string;
  display: string;
  subject?: string;
  description?: string;
}

/**
 * 家长自己加老师时的文件模板:与出厂老师同一套约定(cwd、账本、家规、上下文包、问答 / 任务两种回复、
 * 最后一段给孩子、不评判、R5 前不造课件、待裁量段),只有第一句人设是这位老师自己的。
 */
export function tutorTemplate(t: TutorTemplateInput): string {
  const what = t.subject ? `${t.subject}的事` : '孩子问的事';
  return `---
name: ${t.name}
description: ${t.description ?? `${t.display}。${what}都找它;先一两句大白话回答,要画要讲的以后再出课件`}
maxTurns: 40
permissionMode: bypassPermissions
memory: project
---
你是这个家的${t.display},面对的是一个小学生和他的家长。cwd 是你的家(agents/${t.name}/),账本在 ../../ledger/,家规在 ../../CLAUDE.md。消息前面有一段 \`cotutor:\` 开头的上下文包(谁在说、几点、正在看什么、本周计划、最近观察),先看它再答。

(在这里写这位老师自己的性子和讲法:比如「说话慢一点,爱打比方」「英文后面跟中文」。一两句就够。)

回复只有两种,先分清:
- **问答**(缺省,孩子或家长随口问):这次回复就是一两句大白话,不超过三句;不用工具,不读账本(上下文包里已经给了),想到的就直接说。
- **任务**(消息前的上下文包里 \`from: system\`,或家长明确写了「出课包 / 补讲 / 记账 / 做计划」):按任务做,做完在最后一段报告结果。

现在还没有出课件的通道:**不要自己写 HTML 或任何课件文件**。要画要讲的,在最后一段对孩子说「这个要画给你看,等我准备好会出现在你的今天里」就够了。

你说给孩子听的话放在回复的**最后一段**;孩子只看得到最后一段,中间的话和工具过程只有家长看。永远不评价孩子答得对不对,不打分;把孩子的话当问题,不当答案。

记账与记忆(只在任务里做,问答不做):值得别的老师知道的观察,追加一行到 ../../ledger/observations.jsonl;你自己的经验记进你的记忆目录。
需要家长拍板的事写成一段「## 待裁量」(question: 一句话;options: 列表),不要停下来等。
`;
}

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  tutors: ShippedAgent[];
}

const TUTOR_DEFAULTS: Record<string, { display: string; subject?: string; avatar: string; hidden?: boolean }> = {
  'math-tutor': { display: '数学老师', subject: '数学', avatar: '🧮' },
  'chinese-tutor': { display: '语文老师', subject: '语文', avatar: '📚' },
  'reading-tutor': { display: '朗读老师', subject: '英语', avatar: '📖' },
  'homework-tutor': { display: '作业老师', avatar: '📷' },
  planner: { display: '规划老师', avatar: '🗓', hidden: true },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器替她拍板)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const tutors: Record<string, unknown> = {};
  for (const a of input.tutors) {
    const p = TUTOR_DEFAULTS[a.name];
    tutors[a.name] = p
      ? { display: p.display, ...(p.subject ? { subject: p.subject } : {}), avatar: p.avatar, enabled: true, ...(p.hidden ? { hidden: true } : {}) }
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
      claude: {
        run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '2'],
        resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '2'],
      },
      qwen: {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      },
    },
    tts: TTS_DEFAULT,
    _note:
      '一孩一 workspace 的政策文件,家长改这里;机器不会自动重建或覆盖,写坏了靠 git 回退,cotutor doctor 可体检。' +
      'tutors = 老师表(key 与 .claude/agents/<key>.md 的 name 一致):display 显示名、avatar、voice 用 voxtell 音色 id、enabled 开关、hidden 孩子端不露、policy 覆盖 policyDefaults。' +
      'policyDefaults 缺省:replyMaxChars 60、dailyMessages 30、dailyRegen 3、reviewGate false、contextPack {recent 10, planLines 10}。' +
      'paths = 角色映射:vault 指 Obsidian vault 根(一孩一 vault),photos/diary/plans/profile/timetable 相对 vault。' +
      'runtimes = 运行时,占位 {agent} {agentBody} {prompt} {session};政策旋钮(预算、时限、模型)写进模板。' +
      'tts = 配音命令,占位 {text} {voice} {out};老师没配 voice 就不合成,孩子端用浏览器的声。' +
      'server.https = {cert, key} 自签证书路径(相对 workspace 根);不配则看 certs/cert.pem + key.pem(cotutor cert 用 mkcert 建)。',
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/** 把 JSON Schema 写进 workspace(机器文件,每次 init / upgrade 都刷新) */
export async function writeSchemaFile(root: string): Promise<string> {
  const file = join(root, CONFIG_SCHEMA_FILE);
  await mkdir(join(root, '.cotutor'), { recursive: true });
  await writeFile(file, `${JSON.stringify(cotutorJsonSchema(), null, 2)}\n`);
  return file;
}
