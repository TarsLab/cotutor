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
  /** 上下文包的两个数:最近观察条数、计划行数 */
  contextPack: z.object({ recent: z.number().int().nonnegative(), planLines: z.number().int().nonnegative() }),
  /** 板书开关:auto = 老师判断要不要出卡(缺省);off = 只说话不出卡 */
  board: z.enum(['auto', 'off']).describe('板书:auto = 讲题讲概念时老师出卡(缺省);off = 只说话不出卡'),
  /** 场景作业(scene-maker 做课包,$3–5 / 10–15 分钟一个):每天最多起几个;配在 scene-maker 身上或 policyDefaults */
  scenes: z.object({ dailyMax: z.number().int().nonnegative().describe('每天最多起几个场景作业(一个 ≈ 一轮问答的 30 倍费用)') }),
});
export type Policy = z.infer<typeof PolicySchema>;

/** 政策补丁:老师条目与 policyDefaults 都是补丁,逐层盖在 POLICY_DEFAULTS 上 */
export const PolicyPatchSchema = z.object({
  replyMaxChars: PolicySchema.shape.replyMaxChars.optional(),
  dailyMessages: PolicySchema.shape.dailyMessages.optional(),
  dailyRegen: PolicySchema.shape.dailyRegen.optional(),
  reviewGate: PolicySchema.shape.reviewGate.optional(),
  forms: PolicySchema.shape.forms.optional(),
  contextPack: z.object({ recent: z.number().int().nonnegative().optional(), planLines: z.number().int().nonnegative().optional() }).optional(),
  board: PolicySchema.shape.board.optional(),
  scenes: z.object({ dailyMax: z.number().int().nonnegative().optional() }).optional(),
});
export type PolicyPatch = z.infer<typeof PolicyPatchSchema>;

/** 2026-09-08 拍板的缺省:60 字、30 条/日、3 次重生、验收关、上下文包各 10 */
export const POLICY_DEFAULTS: Policy = {
  replyMaxChars: 60,
  dailyMessages: 30,
  dailyRegen: 3,
  reviewGate: false,
  forms: ['L0', 'L1', 'L3', 'L4'],
  contextPack: { recent: 10, planLines: 10 },
  board: 'auto',
  scenes: { dailyMax: 2 },
};

/** agent 名:与 .claude/agents/<name>.md 的 frontmatter name 一致,小写字母数字连字符 */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const TutorSchema = z.object({
  /** 显示名(孩子端头像下的字、计划文件的 H2 标题) */
  display: z.string().min(1).describe('显示名:孩子端头像下的字,计划文件的 H2 标题'),
  subject: z.string().optional().describe('学科:与课程表的学科列、观察的 subject 对齐即归到这位老师'),
  /** 头像:一个 emoji 或图片相对路径 */
  avatar: z.string().optional().describe('头像:一个 emoji'),
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
export const TtsSchema = z.object({ say: z.array(z.string()).min(1) });
export type Tts = z.infer<typeof TtsSchema>;
export const TTS_DEFAULT: Tts = { say: ['voxtell', 'say', '{text}', '--voice', '{voice}', '--json', '-o', '{out}'] };

/** paths 里 CLI 认识的角色;其余角色原样保留给应用层。vault 侧角色相对 vault 解析,没配 vault 就相对 workspace 根 */
export const PATH_ROLES = ['vault', 'photos', 'diary', 'plans', 'profile', 'timetable'] as const;
export type PathRole = (typeof PATH_ROLES)[number];
export const ROLE_DEFAULTS: Record<PathRole, string> = {
  vault: '.',
  photos: 'photos',
  diary: 'diary',
  plans: 'plans',
  profile: 'profile.md',
  timetable: 'timetable.md',
};

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
    }),
    server: z
      .object({
        port: z.number().int().min(1).max(65535).default(5180),
        /** 只给这个 workspace 用的证书(相对 workspace 根),是例外;不配则用机器级 ~/.config/cotutor/certs/(cotutor cert 会建,所有 workspace 共用;iPad 上录音要 HTTPS) */
        https: z.object({ cert: z.string().min(1), key: z.string().min(1) }).optional(),
      })
      .default({ port: 5180 }),
    paths: z.record(z.string(), z.string()).default({}).describe('角色 → 目录:vault 指 Obsidian vault 根;photos / diary / plans / profile / timetable 相对 vault;不配 vault 就相对 workspace 根'),
    policyDefaults: PolicyPatchSchema.default({}).describe('所有老师的政策缺省;没写的用出厂缺省(60 字 / 30 条 / 3 次 / 验收关 / L0,L1,L3,L4 / 10,10)'),
    tutors: z.record(z.string().regex(AGENT_NAME_RE), TutorSchema).default({}).describe('老师表:键 = .claude/agents/<键>.md 的 frontmatter name;人设、开关、政策都在这里,老师文件里只有正文'),
    runtimes: RuntimesSchema.describe('运行时:default 指一个键;每个运行时 {run, resume} 命令模板,占位 {agent} {agentBody} {prompt} {session};模型、预算、时限写在这里'),
    tts: TtsSchema.default(TTS_DEFAULT).describe('配音命令模板,占位 {text} {voice} {out}'),
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
  const out: Policy = { ...POLICY_DEFAULTS, contextPack: { ...POLICY_DEFAULTS.contextPack }, scenes: { ...POLICY_DEFAULTS.scenes } };
  for (const p of layers) {
    if (p.replyMaxChars !== undefined) out.replyMaxChars = p.replyMaxChars;
    if (p.dailyMessages !== undefined) out.dailyMessages = p.dailyMessages;
    if (p.dailyRegen !== undefined) out.dailyRegen = p.dailyRegen;
    if (p.reviewGate !== undefined) out.reviewGate = p.reviewGate;
    if (p.forms !== undefined) out.forms = [...p.forms];
    if (p.contextPack?.recent !== undefined) out.contextPack.recent = p.contextPack.recent;
    if (p.contextPack?.planLines !== undefined) out.contextPack.planLines = p.contextPack.planLines;
    if (p.board !== undefined) out.board = p.board;
    if (p.scenes?.dailyMax !== undefined) out.scenes.dailyMax = p.scenes.dailyMax;
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
