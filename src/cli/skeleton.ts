/**
 * 工作区骨架清单:init 建、doctor 查,同一张清单(两边各写一遍必然漂移)。
 * 布局见《cotutor-agent层设计.md》§2:
 *   cotutor.json / CLAUDE.md QWEN.md(家规)/ .claude/agents(老师定义,拷自本包 agents/,是家长的)/ .qwen/agents(相对链)/ .cotutor/shipped.json(出厂 hash)
 *   agents/<name>/(老师的家 = 会话 cwd)/ ledger/(两本账)/ conversations/(会话索引与转录)
 */
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentFile } from '../lib/agent-file.ts';
import { TTS_DEFAULT } from '../schema/index.ts';

export const DIRS = ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents'] as const;
export const LEDGER_FILES = ['ledger/observations.jsonl', 'ledger/artifacts.jsonl'] as const;

/** 本包自带的老师定义目录(仓库检出与 npm 安装都在包根 agents/) */
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

export const GITIGNORE = `# 转录日志体积大、可从会话索引重建关键信息;要留全档就删掉下面这行
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

- 关于孩子的观察,写一条到 ledger/observations.jsonl(一行 JSON:id、date、author=你的名字、claim 一句话、evidence 指向会话或产物),别的老师和规划老师从那里读。
- 你自己的经验记进你的记忆目录(MEMORY.md 一行索引 + 主题文件)。
- 你说给孩子听的话放在回复的**最后一段**,孩子只看得到最后一段;中间的话和工具过程只有家长看。
- 需要家长拍板的事写成一段「## 待裁量」(question: 一句话;options: 列表),不要停下来等。
- 要交给别的老师的事写成一段「## 转交」(to: 老师名;why: 一句话;refs: 相关文件),第一期只允许一跳。
- 会话按天,明天从账本和你的记忆接着来,不要指望今天的对话还在。
`;

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  teachers: ShippedAgent[];
}

const TEACHER_PRESETS: Record<string, { display: string; subject?: string; avatar: string; hidden?: boolean }> = {
  'math-teacher': { display: '数学老师', subject: '数学', avatar: '🧮' },
  'chinese-teacher': { display: '语文老师', subject: '语文', avatar: '📚' },
  'reading-teacher': { display: '朗读老师', subject: '英语', avatar: '📖' },
  'homework-aide': { display: '作业助教', avatar: '📷' },
  planner: { display: '规划老师', avatar: '🗓', hidden: true },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器替她拍板)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const teachers: Record<string, unknown> = {};
  for (const a of input.teachers) {
    const p = TEACHER_PRESETS[a.name];
    teachers[a.name] = p
      ? { display: p.display, ...(p.subject ? { subject: p.subject } : {}), avatar: p.avatar, enabled: true, ...(p.hidden ? { hidden: true } : {}) }
      : { display: a.name, enabled: true };
  }
  const cfg = {
    version: 1,
    title: input.name ? `${input.name}的书房` : 'cotutor',
    kid: { slug: input.slug, ...(input.name ? { name: input.name } : {}) },
    server: { port: input.port ?? 5180 },
    paths: {},
    policyDefaults: {},
    teachers,
    agents: {
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
      'teachers = 老师表(key 与 .claude/agents/<key>.md 的 name 一致):display 显示名、avatar、voice 用 voxtell 音色 id、enabled 开关、hidden 孩子端不露、policy 覆盖 policyDefaults。' +
      'policyDefaults 缺省:replyMaxChars 60、dailyMessages 30、dailyRegen 3、reviewGate false、contextPack {recent 10, planLines 10}。' +
      'paths = 角色映射:vault 指 Obsidian vault 根(一孩一 vault),photos/diary/plans/profile/timetable 相对 vault。' +
      'agents = 运行时预设,占位 {agent} {agentBody} {prompt} {session};政策旋钮(预算、时限、模型)写进模板。' +
      'tts = 配音命令,占位 {text} {voice} {out};老师没配 voice 就不合成,孩子端用浏览器的声。' +
      'server.https = {cert, key} 自签证书路径(相对 workspace 根);不配则看 certs/cert.pem + key.pem(cotutor cert 用 mkcert 建)。',
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}
