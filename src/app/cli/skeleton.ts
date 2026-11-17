/**
 * workspace骨架清单:init 建、doctor 查,同一张清单(两边各写一遍必然漂移)。
 * workspace 布局:
 *   cotutor.json / .cotutor/shipped.json(出厂 hash)/ .agents/skills/(技能;.claude/skills 是指过去的链,给 Claude Code)
 *   agents/<name>/(老师的家 = 会话 cwd;activities/ 拷自本包 grades/grade-<n>/agents/<name>/,是家长的)
 *   ledger/(产物账本)/ conversations/(对话索引与转录)
 * vault 侧(《obsidian仓库设计.md》):档案 / 课程表 / 日记 / 教材 / 计划 / 参考,init 只建档案与参考 README(缺了才写);
 *   vault 不在 workspace 里,缺省是旁边的 <目录名>-vault/(旧版没写 paths.vault 的落在 workspace 根)
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_NAME_RE, CONFIG_SCHEMA_FILE, DEFAULT_PORT, DICTATION_DEFAULT, cotutorJsonSchema } from '../../schema/index.ts';
import { FACTORY_API_RUNTIMES } from '../../brain/index.ts';
import { DEFAULT_GRADE, PACKAGE_GRADES_DIR } from './grades.ts';

import { mkdir, writeFile } from 'node:fs/promises';


export const DIRS = ['agents', 'ledger', 'conversations', 'bundles'] as const;
export const LEDGER_FILES = ['ledger/artifacts.jsonl'] as const;

/** 默认年级的出厂老师目录;workspace 的操作用 workspaceGradePack 选来源 */
export const PACKAGE_AGENTS_DIR = join(PACKAGE_GRADES_DIR, `grade-${DEFAULT_GRADE}`, 'agents');
/** 本包版本(出厂件的 hash 记录带它,升级时知道基于哪版) */
export const PACKAGE_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;

export interface ShippedAgent {
  name: string;
  /** 包里这位老师的家 grades/grade-<n>/agents/<name>/(activity 在里面) */
  dir: string;
}

/** 出厂的老师:年级包 agents/ 下的每个目录(老师的家) */
export async function shippedAgents(dir = PACKAGE_AGENTS_DIR): Promise<ShippedAgent[]> {
  const out: ShippedAgent[] = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && AGENT_NAME_RE.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))) out.push({ name: e.name, dir: join(dir, e.name) });
  return out;
}

export const GITIGNORE = `# 转录日志体积大、可从对话索引重建关键信息;要留全档就删掉下面这行
conversations/**/*.log
# 配音可重新合成
conversations/**/*.mp3
# 回放(cotutor replay)是调提示词与 vault 时的对照,不是孩子的对话
evals/
# 做好的课(课包、视频课)与课包截图:体积大,源在家长做课的地方
bundles/
lectures/
snaps/
# 作业照片(孩子在老师页上拍的;paths.captures):体积大、只是这一轮的素材,认出的文字在日记里
captures/
# 家长在 workspace 里用 Claude Code 时它的个人设置
.claude/settings.local.json
# .cotutor/ 是机器文件(板书写法缓存、配音缓存、二维码、日志),只留出厂 hash 与 schema
.cotutor/*
!.cotutor/shipped.json
!.cotutor/cotutor.schema.json
node_modules/
.DS_Store
`;

/** 档案模板(paths.profile,缺了才写):cotutor: profile 的那篇,原文整篇进每个话题的第一条 */
export function profileTemplate(name: string, schoolStart?: string): string {
  return `---
cotutor: profile
nickname: ${name}
birthday:
school_start:${schoolStart ? ` ${schoolStart}` : ''}
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

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  /** 写进 paths.vault 的(~/… 或绝对路径);不给就不写,vault 落在 workspace 根(旧版的布局) */
  vault?: string;
  tutors: ShippedAgent[];
}

/** 出厂老师的条目;不写 avatar:三门主科用包里的出厂头像(src/app/http/avatars.ts) */
const TUTOR_DEFAULTS: Record<string, { display: string; description?: string; subject?: string; hidden?: boolean; runtime?: string; enabled?: boolean; policy?: { effort?: 'low' | 'medium' | 'high'; tools?: 'on' } }> = {
  // 数学多想一会儿:算错的代价大(别的老师用缺省 low);和语文老师一样走运行时 api(应用直连百炼,模型见 src/brain/api.ts 的 FACTORY_API_RUNTIMES)
  'math-tutor': { display: '数学老师', description: '数学老师。孩子拍数学作业、预习、复习都找它', subject: '数学', runtime: 'api', policy: { effort: 'medium' } },
  // 语文老师走 api,缺省 low 不想
  'chinese-tutor': { display: '语文老师', description: '语文老师。生字、词语、课文、看图说话都找它', subject: '语文', runtime: 'api' },
  // 英语也走 api,不走 api-flash:2026-10-31 api-flash 真跑英语四个 activity,13 次里 5 次第一轮只出一张拍照卡、没有讲稿(那时还有卡)(实时页嘴没话可念);max 在 Ray 上都过。
  // 想省钱改 api-flash,先跑 activity eval。medium 是给 flash 加的(low 偶尔不写讲稿或念规则,详见年级教学包验证记录)
  'english-tutor': { display: '英语老师', description: '英语老师。单词、句子、课文、口语课都找它', subject: '英语', runtime: 'api', policy: { effort: 'medium' } },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器代做)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const tutors: Record<string, unknown> = {};
  for (const a of input.tutors) {
    const p = TUTOR_DEFAULTS[a.name];
    tutors[a.name] = p
      ? { display: p.display, ...(p.description ? { description: p.description } : {}), ...(p.subject ? { subject: p.subject } : {}), enabled: p.enabled ?? true, ...(p.hidden ? { hidden: true } : {}), ...(p.runtime ? { runtime: p.runtime } : {}), ...(p.policy ? { policy: p.policy } : {}) }
      : { display: a.name, enabled: true };
  }
  const cfg = {
    $schema: CONFIG_SCHEMA_FILE,
    version: 1,
    title: input.name ? `${input.name}的老师们` : 'cotutor',
    kid: { slug: input.slug, ...(input.name ? { name: input.name } : {}) },
    server: { port: input.port ?? DEFAULT_PORT },
    paths: input.vault ? { vault: input.vault } : {},
    policyDefaults: {},
    tutors,
    // 缺省 api:应用直连百炼,家长端「首页」填一次按量 key + 业务空间 id 就能用;只有 API 运行时
    runtimes: { default: 'api', ...FACTORY_API_RUNTIMES },
    // 听写的拍照认词:模型与挑词要求(prompt 一行一个字符串)写进文件,家长看得见、改得动
    dictation: DICTATION_DEFAULT,
    // 字段说明不写在这里:一写进去就冻住(政策文件永不覆盖),$schema 指的 schema 文件每次 init / refresh 从 zod 的 .describe() 刷新
    _note: '一孩一 workspace 的政策文件,家长改这里,机器不覆盖(写坏了靠 git 回退,cotutor doctor 可体检);每个字段的说明在 $schema 指的 .cotutor/cotutor.schema.json,编辑器里悬停就能看到。',
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/** 把 JSON Schema 写进 workspace(机器文件,每次 init / refresh 都刷新) */
export async function writeSchemaFile(root: string): Promise<string> {
  const file = join(root, CONFIG_SCHEMA_FILE);
  await mkdir(join(root, '.cotutor'), { recursive: true });
  await writeFile(file, `${JSON.stringify(cotutorJsonSchema(), null, 2)}\n`);
  return file;
}
