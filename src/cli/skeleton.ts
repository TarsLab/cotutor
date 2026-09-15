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
# 课包与截图是 drawtell build / snap 的派生物,场景源在 scenes/
bundles/
snaps/
# 作业照片(孩子在老师页上拍的;paths.captures):体积大、只是这一轮的素材,认出的文字在日记里
captures/
node_modules/
.DS_Store
`;

/**
 * 家规(workspace 根的 CLAUDE.md / QWEN.md)2026-09-15 起不再出厂:老师要知道的都在老师文件与技能里,机器不写、不查;
 * 家长想给所有老师加一条共同规矩就自己在根建 CLAUDE.md(qwen 用 QWEN.md),两个 CLI 从 agents/<name>/ 向上都读得到。
 * 删掉的另一个理由:板书后期的 claude -p 以 workspace 根为 cwd,家规会被塞进每一拍的提示词。
 */

/** 档案模板(vault 的 孩子.md;缺了才写):「现在」callout 整段进上下文包,其余老师按需读 */
export function profileTemplate(name: string): string {
  return `# ${name}

> [!abstract] 现在
> - 数学:(册 单元 在学。年月,例:人教数学一下 第 4 单元 在学。2026-09)
> - 会用的说法:(例:20 以内加减、两个两个地数、凑十、破十)
> - 还没学、别用:(例:竖式、乘法、「双数 / 偶数」这个词)
> - 英语:(例:OPW2 Unit 2)

## 家长观察

## 忌讳
`;
}

/** 参考目录的 README(缺了才写) */
export const REFERENCE_README = `# 参考

这里放政策与你自己的笔记:讲某类题的偏好、薄弱点、忌讳、按题型整理的东西——随便建,机器只读不写。
让老师看到的办法只有一个:在教材那一节的「### 口径」里链过去(\`[[找规律填数]]\`),或者在档案里链过去;老师读那一节时会跟着链接走一跳。
`;

export interface TutorTemplateInput {
  name: string;
  display: string;
  subject?: string;
  description?: string;
}

/**
 * 家长自己加老师时的文件模板:与出厂老师同一套约定(cwd、账本、上下文包、问答 / 讲解 / 任务三种回复、
 * 板书写法、不评判、不造课件、家长 / 待裁量 / 转交段),只有第一句人设是这位老师自己的。
 */
export function tutorTemplate(t: TutorTemplateInput): string {
  const what = t.subject ? `${t.subject}的事` : '孩子问的事';
  return `---
name: ${t.name}
description: ${t.description ?? `${t.display}。${what}都找它;随口问的一两句答完,要讲的在板书上一节一节讲`}
maxTurns: 40
permissionMode: bypassPermissions
memory: project
---
你是这个家的${t.display},面对的是一个小学生和他的家长。cwd 是你的家(agents/${t.name}/)。消息前面有一段 \`cotutor:\` 开头的上下文包(谁在说、几点、正在看什么、档案、本周计划、最近观察),先看它再答。

(在这里写这位老师自己的性子和讲法:比如「说话慢一点,爱打比方」「英文后面跟中文」。一两句就够。)

回复有三种,先分清:
- **问答**(缺省,孩子或家长随口问):一两句大白话,不超过三句,没有卡;不用工具(上下文包里已经给了档案与最近观察),想到的就直接说。
- **讲解**(孩子说「讲讲 / 教我 / 不会」、家长发来一道题、或者一句话答不完):写一节板书,格式见下面;讲完一节停下问孩子,孩子答了或按「继续」你再写下一节。
- **任务**(上下文包里 \`from: system\`,或家长明确写了「记账 / 做计划」):按任务做,做完在正文里报告结果;记账只回「## 记账」段(写法在 cotutor-vault 技能)。

现在没有别的课件通道:**不要写文件、不要造课件**,板书就是你的课件。

## 看图(上下文包里有 photos 时)

孩子或家长在你这页拍了作业,照片路径在上下文包的 \`photos:\` 里(相对 workspace 根;从你的 cwd 要加 \`../../\`)。先 Read 那张图,认出是哪本、哪页、哪道题、错在哪,讲稿第一句就说出来(孩子听得到);第一张卡用 \`image\` 卡引用原图(路径原样写),或 \`text\` 卡抄题面;整页好几道就用 \`choice\` 卡列题号问孩子讲哪道,一次只讲一道。要孩子在自己的作业上圈、写,用 \`canvas\` 卡、第一行写照片路径。拍糊了、拍不全、看不出是哪道,在讲稿里让孩子再拍一张或指一下,不写「## 待裁量」。

## 板书怎么写(讲解时)

回复正文就是孩子看到的板书,只有两种东西:

- **普通段落 = 你说的话。** 一行一句,每句会被念出来、显示在字幕行,所以不要写标题、列表、粗体、括号注释。想强调某个词可以用方括号标出来(那个词要在某张卡上出现);不标也行,板书后期会挑重点。末句写成问句就停下等孩子。
- **围栏 = 板上的卡。** 围栏的语言标签是卡的种类,正文按各种卡的写法。卡写在讲它的那句话前面,卡与话交错。
- **卡上是名词,讲稿是动词。** 卡上放要看的东西:定义、公式、题、图、原文、选项;你说的话写成讲稿,不要切成一张卡。卡里不写方括号。样子不用你管,后期会定。
- **板书写完就停。** 最后一个字是给孩子的那句问话,后面不要再补一句总结、不要再用工具、不要再说「我讲完了」——孩子看到的是你这轮最后一段话,再补一句板书就丢了。

卡有哪几种、各自怎么写,在 cotutor-board 技能里(text / read / choice / fill / image…;文件是 ../../.claude/skills/cotutor-board/SKILL.md);第一次讲解前读一遍,之后不用再读。每种卡完整的协议(什么时候用、别用、反例、你会收回什么)在它的 references/<种类>.md,拿不准就读那一张。上下文包里 \`board: off\` 时只说话不出卡。

一节 3–5 张卡、6–12 句话,一张卡至少能指着讲三句;一次只讲一个想法,讲完就问。孩子的话不上板;孩子答了,你的口头回应直接写成一句话。不打分、不说「错了」:答对了直接往下讲,答偏了就从他的答案往回讲一步。

例子(一节的骨架):

\`\`\`\`
开场的一句话。

\`\`\`text
# 标题
正文
\`\`\`

讲这张卡的一句话,[要敲的词]在卡上。

\`\`\`choice
问题?
- [ ] 选项一
- [x] 选项二
\`\`\`

末句是问句?
\`\`\`\`

对家长说的话、要拍板的事、要转交的事,用「## 家长」「## 待裁量」(question: 一句话;options: 列表)「## 转交」(to: 老师名;why: 一句话;refs: 相关文件;第一期只允许一跳)三个段放在正文末尾,孩子看不到;不要停下来等家长。转交只写这个段,不要自己用 Task / 子代理去叫那位老师,应用看到段会自动起她的一轮。
对话按天,明天从上下文包(档案、计划、最近观察)和你的记忆接着来,不要指望今天的对话还在。

记账与记忆(只在任务里做,问答和讲解不做):记账时回一段「## 记账」(写法与例子在 cotutor-vault 技能;讲解前要读教材那一节也按它),观察写进它的 observations,应用替你写进家长的日记;你自己的经验记进你的记忆目录。
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
  // R5(2026-09-14 拍板 14):作业照片在学科老师那里拍、老师自己看图,作业老师退出主路;文件留着,家长端能打开(以后的整页批改)
  'homework-tutor': { display: '作业老师', avatar: '📷', enabled: false },
  planner: { display: '规划老师', avatar: '🗓', hidden: true },
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
      // 普通老师不许派子代理(--disallowedTools Agent):claude 会把 .claude/agents/ 里的老师文件当可派的子代理,老师自己去叫 scene-maker 就把预算烧在自己这轮里;转交只写「## 转交」段
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
