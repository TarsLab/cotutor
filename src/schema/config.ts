/**
 * cotutor.json:每个 workspace 一份,一孩一 workspace。承接 drawtell.json 的做法——
 * `paths` 角色映射 + `runtimes` 的 {run, resume} 命令模板——再加老师表与政策。
 * 字段归属铁律:老师的 .md 文件里只有 name / description / maxTurns / permissionMode / memory + 正文;
 * 人设(display / avatar / voice)、政策、开关全在这里。老师团页只改本文件,永不改链进来的定义文件。
 */
import { z } from 'zod';

/** 回复形式阶梯(《cotutor产品规划.md》):L0 确定性资源 / L1 口答 / L2 快卡 / L3 补讲 / L4 整包 */
export const REPLY_FORMS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type ReplyForm = (typeof REPLY_FORMS)[number];

export const PolicySchema = z.object({
  /** 老师说给孩子听的每一句的字数上限;超出在句末截断(《cotutor契约草案.md》§4;板书后按句算) */
  replyMaxChars: z.number().int().positive().describe('老师说给孩子听的每一句的字数上限(板书讲稿一行一句,按句截);超出在句末截断'),
  /** 每孩每日消息上限;超限老师头像灰掉 */
  dailyMessages: z.number().int().nonnegative().describe('孩子每日可发消息条数(家长发的不算);到了头像灰'),
  /** 每日重生上限 */
  dailyRegen: z.number().int().nonnegative().describe('每日重生上限'),
  /** 验收开关:false = 产物直接给孩子(缺省);true = 先经家长验收 */
  reviewGate: z.boolean().describe('验收开关:true = 产物先经家长验收才给孩子;false = 直接给(缺省)'),
  /** 这位老师可用的回复形式 */
  forms: z.array(z.enum(REPLY_FORMS)).describe('这位老师可用的回复形式:L0 确定性资源 / L1 口答 / L2 快卡 / L3 补讲 / L4 整包'),
  /** 上下文包的三个数:最近观察条数(从日记的「- 观察:」行抽,最近 14 天)、计划行数、档案与入口文件原文各带多少字 */
  contextPack: z.object({
    recent: z.number().int().nonnegative().describe('上下文包带最近几条观察(最近 14 天日记里本学科的「- 观察:」行,取最新的)'),
    planLines: z.number().int().nonnegative().describe('上下文包带本周计划里这位老师的前几行'),
    entryChars: z.number().int().positive().describe('档案与这位老师的入口文件(vault 里 cotutor: subject 那篇)原文各最多带多少字;超出截断并在上下文包里注明'),
  }),
  /** 板书开关:auto = 老师判断要不要出卡(缺省);off = 只说话不出卡 */
  board: z.enum(['auto', 'off']).describe('板书:auto = 讲题讲概念时老师出卡(缺省);off = 只说话不出卡'),
  /** 场景作业(scene-maker 做课包,$3–5 / 10–15 分钟一个):每天最多起几个;配在 scene-maker 身上或 policyDefaults */
  scenes: z.object({ dailyMax: z.number().int().nonnegative().describe('每天最多起几个场景作业(一个 ≈ 一轮问答的 30 倍费用)') }),
  /** 板书后期(《卡片重设计评估.md》§五 §六):一节跑完,快模型定标注 / 排版 / 样子;off = 素版(机械规则) */
  post: z.object({
    mode: z.enum(['auto', 'off']).describe('板书后期:auto = 有卡就让快模型划重点、排版、定样子(缺省);off = 素版'),
    runtime: z.string().min(1).describe('后期用的运行时(runtimes 里的键,缺省 claude-fast:haiku、无工具)'),
    timeoutMs: z.number().int().positive().describe('等一拍的后期最多几毫秒(缺省 10000;只有第一拍在关键路径上,后面的拍在前一拍播的时候跑),超时这拍素版、不重来'),
  }),
});
export type Policy = z.infer<typeof PolicySchema>;

/** 政策补丁:老师条目与 policyDefaults 都是补丁,逐层盖在 POLICY_DEFAULTS 上 */
export const PolicyPatchSchema = z.object({
  replyMaxChars: PolicySchema.shape.replyMaxChars.optional(),
  dailyMessages: PolicySchema.shape.dailyMessages.optional(),
  dailyRegen: PolicySchema.shape.dailyRegen.optional(),
  reviewGate: PolicySchema.shape.reviewGate.optional(),
  forms: PolicySchema.shape.forms.optional(),
  contextPack: z.object({ recent: z.number().int().nonnegative().optional(), planLines: z.number().int().nonnegative().optional(), entryChars: z.number().int().positive().optional() }).optional(),
  board: PolicySchema.shape.board.optional(),
  scenes: z.object({ dailyMax: z.number().int().nonnegative().optional() }).optional(),
  post: z.object({ mode: z.enum(['auto', 'off']).optional(), runtime: z.string().min(1).optional(), timeoutMs: z.number().int().positive().optional() }).optional(),
});
export type PolicyPatch = z.infer<typeof PolicyPatchSchema>;

/** 2026-09-08 拍板的缺省:60 字、30 条/日、3 次重生、验收关、上下文包各 10(档案 / 入口文件原文各 4000 字,2026-09-17) */
export const POLICY_DEFAULTS: Policy = {
  replyMaxChars: 60,
  dailyMessages: 30,
  dailyRegen: 3,
  reviewGate: false,
  forms: ['L0', 'L1', 'L3', 'L4'],
  contextPack: { recent: 10, planLines: 10, entryChars: 4000 },
  board: 'auto',
  scenes: { dailyMax: 2 },
  post: { mode: 'auto', runtime: 'claude-fast', timeoutMs: 10000 },
};

/** agent 名:与 .claude/agents/<name>.md 的 frontmatter name 一致,小写字母数字连字符 */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const TutorSchema = z.object({
  /** 显示名(孩子端头像下的字、计划文件的 H2 标题) */
  display: z.string().min(1).describe('显示名:孩子端头像下的字,计划文件的 H2 标题'),
  subject: z.string().optional().describe('学科:与课程表的学科列、观察的 subject、vault 入口文件的 subject 属性对齐即归到这位老师'),
  /** 头像:一个 emoji 或图片相对路径 */
  avatar: z.string().optional().describe('头像:一个 emoji,或 workspace 根以内的图片相对路径(如 avatars/math-tutor.png;figshot pick --workspace 会写这个)'),
  /** voxtell 音色 id(2026-09-08 拍板);没有 = 用 voxtell 缺省 */
  voice: z.string().optional().describe('voxtell 音色 id(voxtell voices 可查);不配就不配音,孩子端用浏览器的声'),
  enabled: z.boolean().default(true).describe('开关:false 时两端都不见'),
  /** 孩子端不露(规划老师、记账员这类) */
  hidden: z.boolean().default(false).describe('孩子端不露(规划老师这类只和家长打交道的)'),
  policy: PolicyPatchSchema.optional().describe('覆盖 policyDefaults 的字段,没写的继承'),
  /** 这位老师用哪个运行时(runtimes 里的键);不配用 runtimes.default。scene-maker 这种要更大预算与时限的配一个自己的 */
  runtime: z.string().optional().describe('这位老师用的运行时(runtimes 里的键;不配用 default)——预算、时限不同的老师配自己的'),
});
export type Tutor = z.infer<typeof TutorSchema>;

/**
 * 运行时:一个 CLI 一组 {run, resume} 命令模板。占位符:
 * {agent} 老师名 / {agentBody} 老师文件正文(给没有 --agent 的 CLI 塞系统提示)/ {prompt} 消息 / {session} 会话 id。
 * 政策旋钮(预算、轮数、模型)写进模板,换 agent 只换运行时。
 */
export const RuntimeSchema = z.object({ run: z.array(z.string()).min(1), resume: z.array(z.string()).min(1) });
export type Runtime = z.infer<typeof RuntimeSchema>;

export const RuntimesSchema = z.object({ default: z.string().min(1) }).catchall(RuntimeSchema);

/**
 * 配音运行时:老师说完,应用把 kidText 合成一段音频给孩子端播。占位符 {text} {voice} {out}(输出文件路径)。
 * 命令要把音频写到 {out};没配、没装、失败 → 这条没有音频,孩子端退回浏览器自带的合成声。
 */
export const TTS_VOICES_DEFAULT = ['voxtell', 'voices', '--json'];
export const TtsSchema = z.object({
  say: z.array(z.string()).min(1),
  /** 列音色的命令(家长端音色页据此列表 + 试听);stdout 是 JSON:{voices: [{voice, name, gender?, age?, trait?, scene?, lang?}]} 或直接是数组 */
  voices: z.array(z.string()).min(1).default(TTS_VOICES_DEFAULT),
});
export type Tts = z.infer<typeof TtsSchema>;
export const TTS_DEFAULT: Tts = { say: ['voxtell', 'say', '{text}', '--voice', '{voice}', '--json', '-o', '{out}'], voices: TTS_VOICES_DEFAULT };

/**
 * paths 里 CLI 认识的角色;其余角色原样保留给应用层。vault 侧角色相对 vault 解析,没配 vault 就相对 workspace 根;
 * captures(应用拍的作业照片)是 workspace 侧,相对 workspace 根(《obsidian仓库设计.md》§5:vault 里存文字不存图)。
 * 缺省是中文名(2026-09-14):vault 是家长在 Obsidian 里看的,目录名要像人写的。
 */
export const PATH_ROLES = ['vault', 'diary', 'plans', 'profile', 'timetable', 'textbooks', 'reference', 'captures'] as const;
export type PathRole = (typeof PATH_ROLES)[number];
/** 相对 workspace 根(不是 vault)的角色 */
export const WORKSPACE_ROLES: readonly PathRole[] = ['captures'];
export const ROLE_DEFAULTS: Record<PathRole, string> = {
  vault: '.',
  diary: '日记',
  plans: '计划',
  profile: '孩子.md',
  timetable: '课程表.md',
  textbooks: '教材',
  reference: '参考',
  captures: 'captures',
};

/** vault 的写入政策(《obsidian仓库设计.md》§4):话题打分 ≥ keepScore 才把摘要与骨架沉淀进日记;孩子问的话总是记 */
export const VaultPolicySchema = z.object({
  keepScore: z.number().int().min(1).max(5).default(4).describe('话题打几星(1–5)起才值得记:记账时摘要与讲解骨架进日记;低于它只记孩子问的话'),
});
export type VaultPolicy = z.infer<typeof VaultPolicySchema>;

export const CotutorConfigSchema = z
  .object({
    version: z.literal(1),
    /** 孩子端标题,无品牌 */
    title: z.string().default('cotutor').describe('孩子端标题,无品牌'),
    kid: z.object({
      /** 短名,进路径 ~/cotutor/<slug>/,不是真名 */
      slug: z.string().regex(AGENT_NAME_RE),
      name: z.string().optional(),
      grade: z.string().optional(),
      /** 孩子端用哪个主题(themes/<name>/);缺省 default(出厂主题,init 拷进 workspace) */
      theme: z.string().regex(AGENT_NAME_RE).default('default').describe('孩子端的主题:themes/<名字>/(theme.json + kid.css);cotutor add-theme <名字> 拷一份出厂的来改'),
    }),
    server: z
      .object({
        port: z.number().int().min(1).max(65535).default(5180),
        /** 只给这个 workspace 用的证书(相对 workspace 根),是例外;不配则用机器级 ~/.config/cotutor/certs/(cotutor cert 会建,所有 workspace 共用;iPad 上录音要 HTTPS) */
        https: z.object({ cert: z.string().min(1), key: z.string().min(1) }).optional(),
      })
      .default({ port: 5180 }),
    paths: z.record(z.string(), z.string()).default({}).describe('角色 → 目录:vault 指 Obsidian vault 根;diary / plans / profile / timetable / textbooks / reference 相对 vault(缺省 日记 / 计划 / 孩子.md / 课程表.md / 教材 / 参考),不配 vault 就相对 workspace 根;profile 只是 init 新建档案的位置,老师按 cotutor: profile 属性找;captures(作业照片)相对 workspace 根'),
    vault: VaultPolicySchema.default({ keepScore: 4 }).describe('vault 的写入政策:keepScore 话题打几星起才把摘要沉淀进日记(缺省 4)'),
    policyDefaults: PolicyPatchSchema.default({}).describe('所有老师的政策缺省;没写的用出厂缺省(60 字 / 30 条 / 3 次 / 验收关 / L0,L1,L3,L4 / 10,10,8)'),
    tutors: z.record(z.string().regex(AGENT_NAME_RE), TutorSchema).default({}).describe('老师表:键 = .claude/agents/<键>.md 的 frontmatter name;人设、开关、政策都在这里,老师文件里只有正文'),
    runtimes: RuntimesSchema.describe('运行时:default 指一个键;每个运行时 {run, resume} 命令模板,占位 {agent} {agentBody} {prompt} {session};模型、预算、时限写在这里'),
    tts: TtsSchema.default(TTS_DEFAULT).describe('配音命令模板:say 合成一句(占位 {text} {voice} {out});voices 列音色(stdout JSON),家长端音色页据此列表与试听'),
  })
  .superRefine((c, ctx) => {
    if (!(c.runtimes.default in c.runtimes) || c.runtimes.default === 'default') {
      ctx.addIssue({
        code: 'custom',
        path: ['runtimes', 'default'],
        message: `运行时 "${c.runtimes.default}" 不存在;runtimes 里要有同名的 {run, resume}`,
      });
    }
  });
export type CotutorConfig = z.infer<typeof CotutorConfigSchema>;

/** 老师的有效政策 = POLICY_DEFAULTS ← policyDefaults ← tutors[name].policy */
export function resolvePolicy(config: CotutorConfig, tutor: string): Policy {
  const layers = [config.policyDefaults, config.tutors[tutor]?.policy ?? {}];
  const out: Policy = { ...POLICY_DEFAULTS, contextPack: { ...POLICY_DEFAULTS.contextPack }, scenes: { ...POLICY_DEFAULTS.scenes }, post: { ...POLICY_DEFAULTS.post } };
  for (const p of layers) {
    if (p.replyMaxChars !== undefined) out.replyMaxChars = p.replyMaxChars;
    if (p.dailyMessages !== undefined) out.dailyMessages = p.dailyMessages;
    if (p.dailyRegen !== undefined) out.dailyRegen = p.dailyRegen;
    if (p.reviewGate !== undefined) out.reviewGate = p.reviewGate;
    if (p.forms !== undefined) out.forms = [...p.forms];
    if (p.contextPack?.recent !== undefined) out.contextPack.recent = p.contextPack.recent;
    if (p.contextPack?.planLines !== undefined) out.contextPack.planLines = p.contextPack.planLines;
    if (p.contextPack?.entryChars !== undefined) out.contextPack.entryChars = p.contextPack.entryChars;
    if (p.board !== undefined) out.board = p.board;
    if (p.scenes?.dailyMax !== undefined) out.scenes.dailyMax = p.scenes.dailyMax;
    if (p.post?.mode !== undefined) out.post.mode = p.post.mode;
    if (p.post?.runtime !== undefined) out.post.runtime = p.post.runtime;
    if (p.post?.timeoutMs !== undefined) out.post.timeoutMs = p.post.timeoutMs;
  }
  return out;
}

export interface TutorView {
  name: string;
  display: string;
  subject?: string;
  avatar?: string;
  voice?: string;
  enabled: boolean;
  hidden: boolean;
  policy: Policy;
}

/** 老师列表(带有效政策);kidOnly = 只要孩子端能看到的(enabled 且不 hidden) */
export function listTutors(config: CotutorConfig, opts: { kidOnly?: boolean } = {}): TutorView[] {
  return Object.entries(config.tutors)
    .filter(([, t]) => !opts.kidOnly || (t.enabled && !t.hidden))
    .map(([name, t]) => ({
      name,
      display: t.display,
      subject: t.subject,
      avatar: t.avatar,
      voice: t.voice,
      enabled: t.enabled,
      hidden: t.hidden,
      policy: resolvePolicy(config, name),
    }));
}

/** 运行时模板填占位符;{agentBody} 只在给了正文时替换,否则原样留着(doctor 会报) */
export function fillRuntime(
  argv: readonly string[],
  vars: { agent: string; prompt: string; session?: string; agentBody?: string },
): string[] {
  return argv.map((a) =>
    a
      .replaceAll('{agent}', vars.agent)
      .replaceAll('{prompt}', vars.prompt)
      .replaceAll('{session}', vars.session ?? '')
      .replaceAll('{agentBody}', vars.agentBody ?? '{agentBody}'),
  );
}

export function fillTts(argv: readonly string[], vars: { text: string; voice: string; out: string }): string[] {
  return argv.map((a) => a.replaceAll('{text}', vars.text).replaceAll('{voice}', vars.voice).replaceAll('{out}', vars.out));
}
