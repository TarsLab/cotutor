/**
 * cotutor.json:每个 workspace 一份,一孩一 workspace。承接 drawtell.json 的做法——
 * `paths` 角色映射 + `runtimes` 的 {run, resume} 命令模板——再加老师表与政策。
 * 字段归属铁律:老师的 .md 文件里只有 name / description / maxTurns / permissionMode + 正文;
 * 人设(display / avatar / voice)、政策、开关全在这里。
 */
import { z } from 'zod';
import { DEFAULT_PORT } from '../shared/default-port.ts';

export { DEFAULT_PORT };

export const PolicySchema = z.object({
  /** 老师说给孩子听的每一句的字数上限;超出在句末截断(板书后按句算) */
  replyMaxChars: z.number().int().positive().describe('老师说给孩子听的每一句的字数上限(板书讲稿一行一句,按句截);超出在句末截断'),
  /** 上下文包的三个数:最近观察条数(从日记的「- 观察:」行抽,最近 14 天)、计划行数、档案 / 入口文件 / 记忆原文各带多少字 */
  contextPack: z.object({
    recent: z.number().int().nonnegative().describe('上下文包带最近几条观察(最近 14 天日记里本学科的「- 观察:」行,取最新的)'),
    planLines: z.number().int().nonnegative().describe('上下文包带本周计划里这位老师的前几行'),
    entryChars: z.number().int().positive().describe('档案与这位老师的入口文件(vault 里 cotutor: subject 那篇)原文各最多带多少字;超出截断并在上下文包里注明'),
  }),
  /**
   * 老师动笔前想多久(2026-09-20):由 Qwen 适配器转成思考量配置。孩子在等第一个字:9 月 18–19 日真跑,输出 token 的 60–95% 是思考,
   * 用工具的轮次首拍就绪 38–50 秒;low 把思考从 1000–1900 token 压到几十、来回从 5–6 个变 2 个,首拍 11–16 秒。
   * 不用 MAX_THINKING_TOKENS=0:同日真跑,思考归零后老师把盘算写进了讲稿(会念给孩子听)、字源开始编
   */
  effort: z.enum(['low', 'medium', 'high']).describe('老师动笔前想多久:low = 想得少、开口快(缺省,孩子等 10–15 秒);medium = 多想一会儿(算题的老师);high = 最慢最细。填进运行时模板的 {effort};模板里没有 {effort} 的运行时不受影响'),
  /**
   * 孩子的话,老师带不带工具(2026-10-04):填进运行时模板的 {tools}。ray 9 月的真实对话,用了工具的轮首拍就绪中位数 31.7 秒(24 轮),没用的 6.8 秒(37 轮);
   * 孩子最喜欢的是回得快的那位老师。off 时要用的东西由应用放进上下文包
   */
  tools: z.enum(['off', 'on']).describe('孩子说的话,老师带不带工具:off = 不带,只凭上下文包答,开口快(缺省);on = 带只读工具(查教材、读 vault,慢)。带照片的那条、记账,总是带只读工具(read_file / glob / grep_search)'),
  /** 板书开关:auto = 老师判断要不要出卡(缺省);off = 只说话不出卡 */
  board: z.enum(['auto', 'off']).describe('板书:auto = 讲题讲概念时老师出卡(缺省);off = 只说话不出卡'),
  /**
   * 断流看门狗(2026-09-21):老师进程多久一个字节都不吐(工具在跑时不算)就当 API 流断了,杀掉、resume 同一个会话接着写。
   * CLI 自己的断流重试可能要等很久,9 月 21 日真跑连断两次,「讲个故事」一轮等了 6 分钟,模型真干活不到 10 秒
   */
  stall: z.object({
    ms: z.number().int().nonnegative().describe('老师进程多少毫秒没有任何输出就当断流(缺省 30000;工具在跑时不算;0 = 不看,交给 CLI 自己约 180 秒的重试)'),
    retries: z.number().int().nonnegative().describe('一轮里断流后最多接着跑几次(缺省 2);用完还断,这轮按出错收尾'),
  }),
});
export type Policy = z.infer<typeof PolicySchema>;

/** 政策补丁:老师条目与 policyDefaults 都是补丁,逐层盖在 POLICY_DEFAULTS 上 */
export const PolicyPatchSchema = z.object({
  replyMaxChars: PolicySchema.shape.replyMaxChars.optional(),
  contextPack: z.object({ recent: z.number().int().nonnegative().optional(), planLines: z.number().int().nonnegative().optional(), entryChars: z.number().int().positive().optional() }).optional(),
  effort: PolicySchema.shape.effort.optional(),
  tools: PolicySchema.shape.tools.optional(),
  board: PolicySchema.shape.board.optional(),
  stall: z.object({ ms: z.number().int().nonnegative().optional(), retries: z.number().int().nonnegative().optional() }).optional(),
});
export type PolicyPatch = z.infer<typeof PolicyPatchSchema>;

/** 缺省:60 字、上下文包观察与计划各 10、原文各 4000 字、30 秒没动静算断流 */
export const POLICY_DEFAULTS: Policy = {
  replyMaxChars: 60,
  contextPack: { recent: 10, planLines: 10, entryChars: 4000 },
  effort: 'low',
  tools: 'off',
  board: 'auto',
  stall: { ms: 30000, retries: 2 },
};

/** 板书能用的卡(注册表顺序;tests/cards.test.ts 断言与 src/board/cards 的 kindsFor('board') 一致,这里不 import 卡,免得契约拖进卡的依赖) */
export const BOARD_CARD_KINDS = ['text', 'read', 'choice', 'image', 'tianzige', 'word', 'lecture', 'canvas', 'paint', 'photo', 'code'] as const;
export type BoardCardKind = (typeof BOARD_CARD_KINDS)[number];

/** agent 名:与 agents/<name>.md 的 frontmatter name 一致,小写字母数字连字符 */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 老师卡上的常驻入口:不经首页发布、一直在那位老师的卡上 */
export const TUTOR_EXTRAS = ['dictation', 'talk'] as const;
export type TutorExtra = (typeof TUTOR_EXTRAS)[number];

/**
 * 老师卡上常驻的三块方砖(设计稿 https://claude.ai/artifact/NpPFoyvuF17dbRSEUuRJfW):先后就是牌上的先后。
 * id 记在消息的 via.button;activity 是老师家里同名的文件(agents/<老师>/activities/<名>.md),孩子看到的字也是它。
 * 家里有那个文件才出那一块(三门主科出厂都有);cotutor.json 的 tiles 只记关掉的,升级来的老 workspace 自动就有
 */
export const HOME_TILES = [
  { id: 'preview', activity: '预习' },
  { id: 'check', activity: '检查作业' },
  { id: 'review', activity: '复习' },
] as const;
export type HomeTileId = (typeof HOME_TILES)[number]['id'];
export const HOME_TILE_IDS = HOME_TILES.map((t) => t.id) as [HomeTileId, ...HomeTileId[]];

export const TutorSchema = z.object({
  /** 显示名(孩子端头像下的字、计划文件的 H2 标题) */
  display: z.string().min(1).describe('显示名:孩子端头像下的字,计划文件的 H2 标题'),
  subject: z.string().optional().describe('学科:与课程表的学科列、观察的 subject、vault 入口文件的 subject 属性对齐即归到这位老师'),
  /** 头像:一个 emoji 或图片相对路径 */
  avatar: z.string().optional().describe('头像:一个 emoji,或 workspace 根以内的图片相对路径(如 avatars/math-tutor.png;figshot pick --workspace 会写这个);不写 = 语文、数学、英语用出厂头像,其余显示学科首字'),
  /** 学科色:头像的环、牌的边、新话题气泡(白字压在上面)、听写页的按钮;不写 = 自动(src/ui/shared/tutor-color.ts) */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '要 #rrggbb').optional().describe('学科色 #rrggbb:头像的环、牌的边、新话题气泡(白字压在上面,要够深,doctor 会查)、听写页的按钮;不写 = 语文粉、数学蓝、英语绿,其余按先后自动分、不撞色'),
  /** 卡的配音音色 id(src/media/tts-voices.ts);没有 = 卡不配音 */
  voice: z.string().optional().describe('卡的配音用的音色 id(百炼 Qwen-Audio-TTS,如 qwen-audio-3.0-tts-plus-longcanzhuyue;工作台音色页「卡的配音」听着挑;点读、单词卡、听写念词的声音);不配这些卡就没有声音。老师开口的嘴在 live.voices'),
  enabled: z.boolean().default(true).describe('开关:false 时两端都不见'),
  /** 孩子端不露(只和系统、家长打交道的工具人) */
  hidden: z.boolean().default(false).describe('孩子端不露(只和系统、家长打交道的工具人)'),
  /** 这位老师的板书写法里有哪几种卡(《卡片协议.md》「谁拿到哪些卡」);不写 = 全部。text 总是带着(写坏的卡退成它) */
  cards: z.array(z.enum(BOARD_CARD_KINDS)).optional().describe(`这位老师的板书写法里讲哪几种卡(${BOARD_CARD_KINDS.join(' / ')});不写 = 全部,text 总是带着。只裁递给老师的写法,写了清单外的卡照常显示`),
  policy: PolicyPatchSchema.optional().describe('覆盖 policyDefaults 的字段,没写的继承'),
  /** 这位老师用哪个运行时(runtimes 里的键);不配用 runtimes.default。要更大预算与时限的老师配一个自己的 */
  runtime: z.string().optional().describe('这位老师用的运行时(runtimes 里的键;不配用 default)——预算、时限不同的老师配自己的'),
  extras: z.array(z.enum(TUTOR_EXTRAS)).optional().describe('老师卡上的常驻入口:dictation 听写(含拍照听写)、talk 口语课(要 talk.enabled);不写按学科给缺省:语文有听写,其余没有;[] = 都不要'),
  /** 三块方砖(HOME_TILES)哪块关掉:只记 false;没写 = 开着(家里有那个 activity 文件才出) */
  tiles: z.object(Object.fromEntries(HOME_TILE_IDS.map((id) => [id, z.boolean().optional()])) as Record<HomeTileId, z.ZodOptional<z.ZodBoolean>>).strict().optional().describe('老师卡上常驻的方砖:preview 预习、check 检查作业、review 复习;写 false 关掉,没写 = 开着(老师家里有那个 activity 文件才出)'),
});
export type Tutor = z.infer<typeof TutorSchema>;

/** 三门主科的别名:学科写「英文」「English」也认作英语,颜色、听写用英文、语文缺省带听写都照它 */
const SUBJECT_ALIASES: Readonly<Record<string, string>> = {
  语文: '语文', 中文: '语文', 国语: '语文', chinese: '语文',
  数学: '数学', math: '数学', maths: '数学', mathematics: '数学',
  英语: '英语', 英文: '英语', english: '英语',
};
/** 学科的标准名:三门主科的别名归一(语文 / 数学 / 英语),别的原样(去两头空白);没写 null */
export function canonicalSubject(subject: string | null | undefined): string | null {
  const s = subject?.trim();
  if (!s) return null;
  return SUBJECT_ALIASES[s.toLowerCase()] ?? s;
}
/** 这位老师的听写写哪种:学科是英语(含别名)= en(四线三格写英文单词),别的 zh */
export function subjectLang(subject: string | null | undefined): 'zh' | 'en' {
  return canonicalSubject(subject) === '英语' ? 'en' : 'zh';
}

/**
 * 这位老师卡上的常驻入口:配了照配的;没配按学科——语文 = 听写;英语 = 口语课,要口语课开着(talkOn = talk.enabled)
 */
export function tutorExtras(t: Pick<Tutor, 'extras' | 'subject'>, talkOn = false): TutorExtra[] {
  if (t.extras) return [...new Set(t.extras)];
  const s = canonicalSubject(t.subject);
  return s === '语文' ? ['dictation'] : s === '英语' && talkOn ? ['talk'] : [];
}

/** 这位老师开着的方砖(牌上的先后);家里有没有那个 activity 文件不在这里管 */
export function tutorTiles(t: Pick<Tutor, 'tiles'>): HomeTileId[] {
  return HOME_TILE_IDS.filter((id) => t.tiles?.[id] !== false);
}

/**
 * 旧的命令行运行时:一组 {run, resume} 命令模板(起 Qwen Code;更早是 Claude CLI)。2026-11-02 起不再支持,
 * 留着这个形状只为旧 cotutor.json 读得进来:doctor 报出来,用到它的老师发不出去(src/brain/runtime.ts)。
 */
export const CliRuntimeSchema = z.object({
  cli: z.string().min(1).optional(),
  run: z.array(z.string()).min(1),
  resume: z.array(z.string()).min(1),
  stdin: z.literal('stream-json').optional(),
}).describe('旧的命令行运行时(Qwen Code 等),2026-11-02 起不再支持:改成 {api, model}');
export type CliRuntime = z.infer<typeof CliRuntimeSchema>;

/**
 * API 运行时(2026-10-29;2026-11-02 起只有它):应用自己直连模型(src/brain/api.ts)。
 * 现在只有百炼(OpenAI 兼容的 Chat Completions);凭证是机器级的 ~/.config/cotutor/(家长端「首页」填的按量 key 与业务空间 id,开发机还有 Token Plan)。
 * 系统提示 = 老师正文 + 板书写法;同一话题的模型历史由应用存;effort 映射成思考开关与思考量;工具只有只读的三样。
 */
export const ApiRuntimeSchema = z.object({
  api: z.literal('bailian').describe('哪家的接口:现在只有百炼'),
  model: z.string().min(1).describe('模型名,如 qwen3.6-plus'),
  maxSteps: z.number().int().min(1).max(20).optional().describe('一轮里模型最多来回几次(每用一次工具多一次);缺省 6'),
});
export type ApiRuntime = z.infer<typeof ApiRuntimeSchema>;

export const RuntimeSchema = z.union([CliRuntimeSchema, ApiRuntimeSchema]);
export type Runtime = z.infer<typeof RuntimeSchema>;
export const isApiRuntime = (r: Runtime): r is ApiRuntime => 'api' in r;

export const RuntimesSchema = z.object({ default: z.string().min(1) }).catchall(RuntimeSchema);

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
  autoBookkeep: z.boolean().default(false).describe('自动记账(2026-10-30):serve 开着时,今天的话题空闲 2 小时就记进日记,昨天没记的第二天补上并整理一次记忆;每个话题多一次老师调用(ray 上实测一次 1.6 万–5.5 万输入 token)。缺省关,家长照旧能点「记账」'),
});
export type VaultPolicy = z.infer<typeof VaultPolicySchema>;

/**
 * 口语课:孩子在口语课页拍一张今天学的那页,改好口语单,交给英语老师的实时页上课
 * (activity「口语课」:先热身、再打电话)。口语课页自己不再打电话。出厂关着;要百炼 key。
 */
export const TALK_DEFAULT = { enabled: false, listModel: 'qwen3.8-omni-flash', minutes: 5 };
export const TalkSchema = z.object({
  enabled: z.boolean().default(false).describe('开不开口语课(/talk);关着页面只说怎么开'),
  listModel: z.string().min(1).default(TALK_DEFAULT.listModel).describe('照片读成口语单用的模型(兼容接口,不想)'),
  minutes: z.number().int().min(1).max(20).default(TALK_DEFAULT.minutes).describe('打电话那段聊几分钟(activity「口语课」的参数);到了老师收尾'),
  note: z.string().max(600).optional().describe('家长给口语课老师的话(这周学什么、想多聊什么);activity「口语课」的参数,孩子看不到'),
});
export type TalkConfig = z.infer<typeof TalkSchema>;

/**
 * 实时老师:老师用 realtime 模型开口(嘴),老师 CLI 在后面写板书(脑);讲稿不配音,交给嘴照念。
 * 有脸的老师都走实时,没有开关;要百炼按量 key 与业务空间 id,没配孩子端打不开。
 */
/** 嘴的缺省音色:出厂三位各一个(10-19 起 Ray 那里用着的),别的老师用 MOUTH_VOICE。不进 voices 的缺省值:voices 的键要是在的老师 */
export const MOUTH_VOICE = 'Serena';
export const SHIPPED_MOUTHS: Readonly<Record<string, string>> = { 'chinese-tutor': 'Serena', 'math-tutor': 'Andre', 'english-tutor': 'Theo Calm' };
export const LIVE_DEFAULT = { model: 'qwen3.8-omni-flash-realtime', voices: {} as Record<string, string>, listen: 'hold' as const, vad: 'server_vad' as const, silenceMs: 1600 };
export const LiveSchema = z.object({
  model: z.string().min(1).default(LIVE_DEFAULT.model).describe('嘴用的 realtime 模型'),
  voices: z
    .record(z.string().regex(AGENT_NAME_RE), z.string().min(1))
    .default({})
    .describe(`老师的嘴用哪个 realtime 音色(这个模型认的 56 个在 src/realtime/voices.ts,工作台音色页「实时的嘴」听着挑;写错了第一次开口才报错,doctor 的 live.voices 会提示);没写的出厂老师用出厂的(语文 Serena、数学 Andre、英语 Theo Calm),别的用 ${MOUTH_VOICE}`),
  // 一直听:孩子不用按,百炼的 VAD 判开口 / 说完,应用判收下 / 放过;老师说话时也在听(全双工)。
  // 孩子端没有开关:10-20 真跑,一问一答以外孩子的停顿、语气词、旁边的话都被当成一句;口语课自己开,不看这里
  listen: z.enum(['hold', 'open']).default(LIVE_DEFAULT.listen).describe('实时老师页怎么说话:hold 按住说(缺省)、open 一直听(试验;孩子停一下就算说完、旁边的话也会当成一句)。孩子端没有开关;口语课总是一直听,不看这里'),
  // 缺省 server_vad:semantic_vad 听不见一两个字的回答(好的、Yes,问过也一样,probe-live-vad context)
  vad: z.enum(['semantic_vad', 'server_vad']).default(LIVE_DEFAULT.vad).describe('一直听时谁判说完:server_vad 按静音(缺省;一两个字的回答也认,「嗯」、笑声也会让老师小声一下);semantic_vad 按语义(切得少、不理「嗯」和笑声,但「好的」「Yes」这类短回答听不见)'),
  silenceMs: z.number().int().min(500).max(4000).default(LIVE_DEFAULT.silenceMs).describe('一直听时停多久算说完(毫秒;孩子一句话中间停一下接着说,太短会切碎)'),
});
export type LiveConfig = z.infer<typeof LiveSchema>;
/** 这位老师的嘴用哪个音色 */
export const mouthVoice = (live: Pick<LiveConfig, 'voices'>, tutor: string): string => live.voices[tutor] ?? SHIPPED_MOUTHS[tutor] ?? MOUTH_VOICE;

/** 卡的配音(点读、单词卡、听写念词)的缺省:出厂三位各一个(2026-11-03 照 Ray 那里用着的),不写进 cotutor.json;别的老师没配就不配音 */
export const SHIPPED_CARD_VOICES: Readonly<Record<string, string>> = {
  'chinese-tutor': 'qwen-audio-3.0-tts-plus-longfengyutong',
  'math-tutor': 'qwen-audio-3.0-tts-plus-longyingsongliu',
  'english-tutor': 'qwen-audio-3.0-tts-plus-loongnorahu',
};
/** 这位老师卡的配音用哪个音色:家长挑的,没挑用出厂的;都没有 undefined(不配音) */
export const cardVoice = (tutors: Readonly<Record<string, { voice?: string }>>, tutor: string): string | undefined => tutors[tutor]?.voice ?? SHIPPED_CARD_VOICES[tutor];

/**
 * 听写:拍照认词表用哪个模型。挑词的要求在听写 activity 文件「认字收到什么」;
 * 下面两份是出厂那节的原文,workspace 里没有听写 activity 文件时照它。回什么格式(一行一段 JSON)由应用填(src/scenes/dictation/recognize.ts 的 FORMAT)。
 */
export const DICTATION_PROMPT_DEFAULT = [
  '这是一张照片:小学语文课本的一页(课文、写字、词语表、读读写写、识字),或者老师发的听写单。按照片中的内容和难度识别,不推断孩子年级。',
  '先把照片上的正文一行一行全认出来;再挑出这页要孩子会写的字词,当听写的词。',
  '怎么挑、默认选不选:',
  '- 「写字」那栏(田字格里的字):挑,默认选上。',
  '- 「词语表」「读读写写」里的词:挑,默认选上。',
  '- 课文里课本用彩色框、圈、下划线标出来的字词:挑,默认选上。',
  '- 老师的听写单上的:都挑,默认选上。',
  '- 「识字」那栏(只要会认、通常带拼音或在圈里):挑出来,但默认不选。',
  '- 课文正文里别的词:不挑,全文里有就够了。',
  '念法:听写时老师怎么念给孩子听。先念这一项,再说一个孩子熟悉的短语或短句把它用进去,让同音字分得开;短语里要有别的字,不能只是把它重复一遍。例如「鼓励,老师鼓励我」「灰色,灰色的小蝌蚪」「叶,树叶的叶」。30 字以内。',
];
/** 英文单词的拍照认词(英语老师卡上的拍照听写) */
export const DICTATION_PROMPT_EN_DEFAULT = [
  '这是一张照片:小学英语课本的一页(单词表、对话、课文),或者老师发的单词听写单。按照片中的内容和难度识别,不推断孩子年级。',
  '先把照片上的正文一行一行全认出来;再挑出这页要孩子会写的英文单词,当听写的词。',
  '怎么挑、默认选不选:',
  '- 单词表、「Words」「Let\'s learn」里的单词:挑,默认选上。',
  '- 课文、对话里课本用彩色、加粗、框出来的单词:挑,默认选上。',
  '- 老师的听写单上的:都挑,默认选上。',
  '- 只要会认、会读的(课本标着「认读」「Listen and say」那种):挑出来,但默认不选。',
  '- 人名、a / the 这类小词:不挑。',
  '念法:先念这个单词,再说一个孩子熟悉的短语把它用进去,例如「yellow, a yellow bus」「cat, a little cat」。英文,10 个词以内。',
];
export const DICTATION_DEFAULT = { model: 'qwen3.8-max' };
export const DictationSchema = z.object({
  model: z.string().min(1).default(DICTATION_DEFAULT.model).describe('拍照认词表用的百炼视觉模型(兼容接口,流式);挑词的要求在听写 activity 文件「认字收到什么」'),
});
export type DictationConfig = z.infer<typeof DictationSchema>;

/**
 * 你说我画:画图卡(paint)用哪个文生图模型、画多大、画成什么样(一天几张的上限 10-21 去掉了,老配置里的 daily 不认)。
 * 画风在 activity 文件「画家收到什么」那节;PAINT_PROMPT_DEFAULT 是出厂那节的画风,不在 activity 话题里画照它。版式、角色、分幅由应用接(src/scenes/paint/prompt.ts)。
 * 2026-10-11 拿「小熊和小猴种西瓜」四格试:qwen-image-2.0 4 秒、qwen-image-2.0-pro 15 秒,四格里角色都对得上;pro 的表情(低头、脸红)更到位。
 * 2026-10-13 缺省换 qwen-image-3.0-pro:千问 Token Plan 有它(一张约 50 Credits),2.0 系列没有;同一个四格 10 秒,画风照提示词,角色分到哪格有几处没对上。
 * 2026-10-21「除了圆圈数字」挪进多格的版式:写在画风里一幅的图也收到,宇宙那张散着画了 ①③Ⓐ。
 */
export const PAINT_PROMPT_DEFAULT = [
  '儿童绘本插画,水彩加干净的线条,颜色明亮柔和,像小学语文练习册里的看图写话插图。',
  '人物是可爱的卡通形象,表情和动作夸张一点,一眼看得出在干什么、心情怎样。',
  '画面里不要任何文字、对话气泡、拟声词。',
];
/** 反向提示词(百炼限 500 字符):画家不要的;activity 文件「画家收到什么」没写就用它 */
export const PAINT_NEGATIVE = '文字,字母,水印,对话气泡,拟声词,写实照片,恐怖,血腥,武器,畸形的手,多余的肢体,格子数量不对';
export const PAINT_DEFAULT = { model: 'qwen-image-3.0-pro', size: '1280*1280' };
export const PaintSchema = z.object({
  model: z.string().min(1).default(PAINT_DEFAULT.model).describe('画图用的千问文生图模型(同步接口):qwen-image-3.0-pro 约 10–20 秒,Token Plan 有它;qwen-image-2.0-pro(约 15 秒)、qwen-image-2.0(约 4 秒)只有百炼按量'),
  size: z.string().regex(/^\d{3,4}\*\d{3,4}$/).default(PAINT_DEFAULT.size).describe('图多大,「宽*高」;四格是方的,缺省 1280*1280(总像素在 512*512 到 2048*2048 之间)'),
});
export type PaintConfig = z.infer<typeof PaintSchema>;

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
      /** 按住说话那一栏放哪边:left = 平板横屏实时老师页的那一栏(与画板那列工具)挪到右边,写字的在左边;缺省 right(那一栏在左边),不写进文件 */
      hand: z.enum(['right', 'left']).optional().describe('按住说话那一栏放哪边:left = 平板横屏实时老师页的那一栏挪到右边;缺省 right(在左边)。家长端设置页能切'),
    }),
    server: z
      .object({
        port: z.number().int().min(1).max(65535).default(DEFAULT_PORT).describe('端口。cotutor init 选一次写在这里(443 优先);改了平板要重新扫码、重加主屏幕图标'),
        /** 只给这个 workspace 用的证书(相对 workspace 根),是例外;不配则用机器级 ~/.config/cotutor/certs/(cotutor cert 会建,所有 workspace 共用;iPad 上录音要 HTTPS) */
        https: z.object({ cert: z.string().min(1), key: z.string().min(1) }).optional(),
      })
      .default({ port: DEFAULT_PORT }),
    paths: z.record(z.string(), z.string()).default({}).describe('角色 → 目录:vault 指 Obsidian vault 根;diary / plans / profile / timetable / textbooks / reference 相对 vault(缺省 日记 / 计划 / 孩子.md / 课程表.md / 教材 / 参考),不配 vault 就相对 workspace 根;profile 只是 init 新建档案的位置,老师按 cotutor: profile 属性找;captures(作业照片)相对 workspace 根'),
    vault: VaultPolicySchema.default({ keepScore: 4, autoBookkeep: false }).describe('vault 的写入政策:keepScore 话题打几星起才把摘要沉淀进日记(缺省 4);autoBookkeep 自动记账(缺省关)'),
    policyDefaults: PolicyPatchSchema.default({}).describe('所有老师的政策缺省;没写的用出厂缺省(60 字 / 板书 auto / 观察 10 条、计划 10 行、原文 4000 字)'),
    tutors: z.record(z.string().regex(AGENT_NAME_RE), TutorSchema).default({}).describe('老师表:键 = agents/<键>.md 的 frontmatter name;人设、开关、政策都在这里,老师文件里只有正文'),
    runtimes: RuntimesSchema.describe('运行时:default 指一个键;每个运行时是 {api, model}(应用直连百炼);老师用哪个模型写在这里'),
    figshot: z
      .object({ port: z.number().int().min(1).max(65535).default(8477) })
      .optional()
      .describe('给老师换样子(figshot pick):它在这台电脑的哪个端口(缺省 8477)。配了孩子端首页多一张「给老师们换个样子」,figshot 没开着就不出现;不配就没有这张卡'),
    dictation: DictationSchema.default(DICTATION_DEFAULT).describe('听写(/dictation):拍照认词表用的模型(改了不用重起服务);挑词的要求在听写 activity 文件「认字收到什么」'),
    paint: PaintSchema.default(PAINT_DEFAULT).describe('你说我画:画图卡(paint)用的文生图模型、尺寸(改了不用重起服务);画风在 activity 文件「画家收到什么」'),
    talk: TalkSchema.default(TALK_DEFAULT).describe('口语课(/talk):孩子拍一张今天学的,改好口语单交给英语老师的实时页(先热身、再打电话);enabled 出厂 false'),
    live: LiveSchema.default(LIVE_DEFAULT).describe('实时老师:有脸的老师都由 realtime 模型开口、脑在后面写板书(讲稿不配音、嘴照念);voices 挑嘴的音色;要百炼按量 key 与业务空间 id'),
  })
  .superRefine((c, ctx) => {
    for (const name of Object.keys(c.live.voices)) {
      if (!(name in c.tutors) || !name.endsWith('-tutor')) ctx.addIssue({ code: 'custom', path: ['live', 'voices', name], message: `"${name}" 不是有脸的老师(tutors 里键以 -tutor 结尾的);只有老师能走实时` });
    }
    if (!(c.runtimes.default in c.runtimes) || c.runtimes.default === 'default') {
      ctx.addIssue({
        code: 'custom',
        path: ['runtimes', 'default'],
        message: `运行时 "${c.runtimes.default}" 不存在;runtimes 里要有同名的 {api, model}`,
      });
    }
  });
export type CotutorConfig = z.infer<typeof CotutorConfigSchema>;

/** 老师的有效政策 = POLICY_DEFAULTS ← policyDefaults ← tutors[name].policy */
export function resolvePolicy(config: CotutorConfig, tutor: string): Policy {
  const layers = [config.policyDefaults, config.tutors[tutor]?.policy ?? {}];
  const out: Policy = { ...POLICY_DEFAULTS, contextPack: { ...POLICY_DEFAULTS.contextPack }, stall: { ...POLICY_DEFAULTS.stall } };
  for (const p of layers) {
    if (p.replyMaxChars !== undefined) out.replyMaxChars = p.replyMaxChars;
    if (p.contextPack?.recent !== undefined) out.contextPack.recent = p.contextPack.recent;
    if (p.contextPack?.planLines !== undefined) out.contextPack.planLines = p.contextPack.planLines;
    if (p.contextPack?.entryChars !== undefined) out.contextPack.entryChars = p.contextPack.entryChars;
    if (p.effort !== undefined) out.effort = p.effort;
    if (p.tools !== undefined) out.tools = p.tools;
    if (p.board !== undefined) out.board = p.board;
    if (p.stall?.ms !== undefined) out.stall.ms = p.stall.ms;
    if (p.stall?.retries !== undefined) out.stall.retries = p.stall.retries;
  }
  return out;
}

export interface TutorView {
  name: string;
  display: string;
  subject?: string;
  avatar?: string;
  /** cotutor.json 里写的学科色(没写 = 自动;用的颜色看 src/ui/shared/tutor-color.ts 的 tutorColors) */
  color?: string;
  voice?: string;
  enabled: boolean;
  hidden: boolean;
  policy: Policy;
  /** 老师卡上的常驻入口(已按学科补缺省) */
  extras: TutorExtra[];
  /** 开着的方砖(没管家里有没有那个文件) */
  tiles: HomeTileId[];
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
      color: t.color,
      voice: cardVoice(config.tutors, name),
      enabled: t.enabled,
      hidden: t.hidden,
      policy: resolvePolicy(config, name),
      extras: tutorExtras(t, config.talk.enabled),
      tiles: tutorTiles(t),
    }));
}

