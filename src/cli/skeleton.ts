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
import { boardSyntaxDoc, cardDocs, cardsIndexDoc } from '../cards/docs.ts';
import { mkdir, writeFile } from 'node:fs/promises';

export const DIRS = ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents', 'scenes', 'bundles', 'snaps'] as const;
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
# 课包与截图是 drawtell build / snap 的派生物,场景源在 scenes/
bundles/
snaps/
node_modules/
.DS_Store
`;

/** 家规:所有老师常驻(CLAUDE.md 与 QWEN.md 同一份)。故意短。 */
export const RULES = `# 家规

- 关于孩子的观察,写一条到 ledger/observations.jsonl(一行 JSON:id、date、author=你的名字、claim 一句话、evidence 指向对话或产物),别的老师和规划老师从那里读。
- 你自己的经验记进你的记忆目录(MEMORY.md 一行索引 + 主题文件)。
- 回复正文就是孩子看到的板书:普通段落是你说给孩子听的话(一行一句,会被念出来;想强调的词可以用方括号标出,不标也行;末句是问句就停下等孩子),围栏是板上的卡(围栏标签是卡的种类;卡上是名词,讲稿是动词;卡的写法在老师文件与 .cotutor/cards/ 里)。随口问答就一两句话,没有卡。板书写完就停,不再补话、不再用工具——孩子看到的只是这轮最后一段话。
- 对家长说的话写成一段「## 家长」;需要家长拍板的事写成一段「## 待裁量」(question: 一句话;options: 列表),不要停下来等;要交给别的老师的事写成一段「## 转交」(to: 老师名;why: 一句话;refs: 相关文件),第一期只允许一跳;**转交只写这个段,不要自己用 Task / 子代理去叫那位老师**——应用看到段会自动起她的一轮。这三个段放在正文末尾,孩子看不到。
- 对话按天,明天从账本和你的记忆接着来,不要指望今天的对话还在。
`;

export interface TutorTemplateInput {
  name: string;
  display: string;
  subject?: string;
  description?: string;
}

/**
 * 家长自己加老师时的文件模板:与出厂老师同一套约定(cwd、账本、家规、上下文包、问答 / 讲解 / 任务三种回复、
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
你是这个家的${t.display},面对的是一个小学生和他的家长。cwd 是你的家(agents/${t.name}/),账本在 ../../ledger/,家规在 ../../CLAUDE.md。消息前面有一段 \`cotutor:\` 开头的上下文包(谁在说、几点、正在看什么、本周计划、最近观察),先看它再答。

(在这里写这位老师自己的性子和讲法:比如「说话慢一点,爱打比方」「英文后面跟中文」。一两句就够。)

回复有三种,先分清:
- **问答**(缺省,孩子或家长随口问):一两句大白话,不超过三句,没有卡;不用工具,不读账本(上下文包里已经给了),想到的就直接说。
- **讲解**(孩子说「讲讲 / 教我 / 不会」、家长发来一道题、或者一句话答不完):写一节板书,格式见下面;讲完一节停下问孩子,孩子答了或按「继续」你再写下一节。
- **任务**(上下文包里 \`from: system\`,或家长明确写了「记账 / 做计划」):按任务做,做完在正文里报告结果。

现在没有别的课件通道:**不要写文件、不要造课件**,板书就是你的课件。

## 板书怎么写(讲解时)

回复正文就是孩子看到的板书,只有两种东西:

- **普通段落 = 你说的话。** 一行一句,每句会被念出来、显示在字幕行,所以不要写标题、列表、粗体、括号注释。想强调某个词可以用方括号标出来(那个词要在某张卡上出现);不标也行,板书后期会挑重点。末句写成问句就停下等孩子。
- **围栏 = 板上的卡。** 围栏的语言标签是卡的种类,正文按各种卡的写法。卡写在讲它的那句话前面,卡与话交错。
- **卡上是名词,讲稿是动词。** 卡上放要看的东西:定义、公式、题、图、原文、选项;你说的话写成讲稿,不要切成一张卡。卡里不写方括号。样子不用你管,后期会定。
- **板书写完就停。** 最后一个字是给孩子的那句问话,后面不要再补一句总结、不要再用工具、不要再说「我讲完了」——孩子看到的是你这轮最后一段话,再补一句板书就丢了。

卡有哪几种、各自怎么写,在 ../../.cotutor/板书语法.md(text / read / choice / fill / image…);第一次讲解前读一遍,之后不用再读。每种卡完整的协议(什么时候用、别用、反例、你会收回什么)在 ../../.cotutor/cards/<种类>.md,拿不准就读那一张。上下文包里 \`board: off\` 时只说话不出卡。

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

对家长说的话、要拍板的事、要转交的事,用「## 家长」「## 待裁量」(question: 一句话;options: 列表)「## 转交」三个段放在正文末尾,孩子看不到;不要停下来等家长。

记账与记忆(只在任务里做,问答和讲解不做):值得别的老师知道的观察,追加一行到 ../../ledger/observations.jsonl;你自己的经验记进你的记忆目录。
`;
}

export interface ConfigTemplateInput {
  slug: string;
  name?: string;
  port?: number;
  tutors: ShippedAgent[];
}

const TUTOR_DEFAULTS: Record<string, { display: string; subject?: string; avatar: string; hidden?: boolean; runtime?: string }> = {
  'math-tutor': { display: '数学老师', subject: '数学', avatar: '🧮' },
  'chinese-tutor': { display: '语文老师', subject: '语文', avatar: '📚' },
  'reading-tutor': { display: '朗读老师', subject: '英语', avatar: '📖' },
  'homework-tutor': { display: '作业老师', avatar: '📷' },
  planner: { display: '规划老师', avatar: '🗓', hidden: true },
  'scene-maker': { display: '画图老师', avatar: '🎨', hidden: true, runtime: 'claude-scene' },
};

/** cotutor.json 模板:只在文件不存在时写入;政策文件永不自动重建或覆盖(家长的决定不由机器替她拍板)。 */
export function configTemplate(input: ConfigTemplateInput): string {
  const tutors: Record<string, unknown> = {};
  for (const a of input.tutors) {
    const p = TUTOR_DEFAULTS[a.name];
    tutors[a.name] = p
      ? { display: p.display, ...(p.subject ? { subject: p.subject } : {}), avatar: p.avatar, enabled: true, ...(p.hidden ? { hidden: true } : {}), ...(p.runtime ? { runtime: p.runtime } : {}) }
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
      // 普通老师不许派子代理(--disallowedTools Agent):claude 会把 .claude/agents/ 里的老师文件当可派的子代理,老师自己去叫 scene-maker 就把预算烧在自己这轮里;转交只写「## 转交」段
      claude: {
        run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--disallowedTools', 'Agent', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
        resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--disallowedTools', 'Agent', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
      },
      qwen: {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      },
      // 场景作业(scene-maker):分钟级、几美元一个,预算与时限比问答大;老师条目 runtime 指到它
      'claude-scene': {
        run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '8'],
        resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '8'],
      },
      'qwen-scene': {
        run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '25m'],
        resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{agentBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '25m'],
      },
      // 板书后期(policy post.runtime):快模型、无工具、整块 JSON 出,几秒几厘;没有 resume 的事,写同一条
      'claude-fast': {
        run: ['claude', '-p', '{prompt}', '--model', 'haiku', '--output-format', 'json', '--disallowedTools', 'Agent,Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit', '--max-budget-usd', '0.2'],
        resume: ['claude', '-p', '{prompt}', '--model', 'haiku', '--output-format', 'json', '--disallowedTools', 'Agent,Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,NotebookEdit', '--max-budget-usd', '0.2'],
      },
    },
    tts: TTS_DEFAULT,
    _note:
      '一孩一 workspace 的政策文件,家长改这里;机器不会自动重建或覆盖,写坏了靠 git 回退,cotutor doctor 可体检。' +
      'tutors = 老师表(key 与 .claude/agents/<key>.md 的 name 一致):display 显示名、avatar、voice 用 voxtell 音色 id、enabled 开关、hidden 孩子端不露、policy 覆盖 policyDefaults。' +
      'policyDefaults 缺省:replyMaxChars 60(每句)、dailyMessages 30、dailyRegen 3、reviewGate false、contextPack {recent 10, planLines 10}、board auto(off = 只说话不出卡)、post {mode auto, runtime claude-fast, timeoutMs 4000}(板书后期:快模型划重点 / 排版 / 定样子;off = 素版)。' +
      'paths = 角色映射:vault 指 Obsidian vault 根(一孩一 vault),photos/diary/plans/profile/timetable 相对 vault。' +
      'runtimes = 运行时,占位 {agent} {agentBody} {prompt} {session};政策旋钮(预算、时限、模型)写进模板;老师条目的 runtime 可指定用哪个(scene-maker 用 claude-scene:预算 8 美元)。scenes.dailyMax(缺省 2)= 每天最多起几个场景作业。' +
      'tts = 配音命令,占位 {text} {voice} {out};老师没配 voice 就不合成,孩子端用浏览器的声。' +
      'server.https = {cert, key} 只给这个 workspace 用的证书路径(相对 workspace 根);不配则用机器级 ~/.config/cotutor/certs/(cotutor cert 用 mkcert 建,所有 workspace 共用)。',
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

/** 把 JSON Schema 写进 workspace(机器文件,每次 init / upgrade 都刷新) */
/** 给老师看的板书语法表:从卡的注册表现生成,机器文件,init / upgrade 每次刷新;老师文件正文让老师讲解前读它 */
export const SYNTAX_FILE = '.cotutor/板书语法.md';

export const CARDS_DOC_DIR = '.cotutor/cards';

/** 语法表 + 逐张协议 .cotutor/cards/<kind>.md + README.md(索引):都是机器文件,init / upgrade 每次刷新;老师与 skill 按需 @ 单张 */
export async function writeSyntaxFile(root: string): Promise<string> {
  const file = join(root, SYNTAX_FILE);
  await mkdir(join(root, CARDS_DOC_DIR), { recursive: true });
  await writeFile(file, boardSyntaxDoc());
  await writeFile(join(root, CARDS_DOC_DIR, 'README.md'), cardsIndexDoc());
  for (const d of cardDocs()) await writeFile(join(root, CARDS_DOC_DIR, `${d.kind}.md`), d.md);
  return file;
}

export async function writeSchemaFile(root: string): Promise<string> {
  const file = join(root, CONFIG_SCHEMA_FILE);
  await mkdir(join(root, '.cotutor'), { recursive: true });
  await writeFile(file, `${JSON.stringify(cotutorJsonSchema(), null, 2)}\n`);
  return file;
}
