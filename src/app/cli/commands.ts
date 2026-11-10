/**
 * 命令表:cotutor 每条命令的说明、参数和例子,只在这里写一次。
 * 由它生成:顶层帮助与 cotutor <命令> --help(usage.ts)、技能里的命令参考(app/skills/*-doc.ts);
 * main.ts 照它拦不认识的旗标、用错子命令的旗标和多余的参数(agent 打错一个字,不能悄悄当没看见)。
 * 纯数据,不引别的模块:技能生成和测试都要读它。
 */

export type Group = 'setup' | 'daily' | 'custom' | 'debug';

export const GROUP_TITLE: Record<Group, string> = {
  setup: '安装与设置',
  daily: '日常使用',
  custom: '定制教学',
  debug: '开发与调试',
};

export interface FlagSpec {
  name: string;
  /** 带值的旗标写值的占位,如 '<n>';不写就是开关 */
  value?: string;
  desc: string;
  /** 只给这几个子命令用;空串是不带子命令的那种(如 cotutor backup) */
  subs?: readonly string[];
  /** 认,但不写进帮助(旧名、内部用的) */
  hidden?: boolean;
}

export interface CommandSpec {
  name: string;
  group: Group;
  /** 顶层帮助里的一句 */
  summary: string;
  /** 用法,一种写法一行 */
  usage: readonly string[];
  /** 认、但不进帮助(旧名) */
  hidden?: boolean;
  /** 第一个参数是子命令时列出来;subRequired 时必须给 */
  subs?: readonly string[];
  subRequired?: boolean;
  /** 认、但不写进帮助的子命令(后台服务的看护进程用) */
  hiddenSubs?: readonly string[];
  /** 参数(含子命令)最多几个;Infinity 是不限 */
  maxArgs: number;
  flags?: readonly FlagSpec[];
  /** 认 --workspace */
  workspace?: boolean;
  /** 认 --sandbox(在试用副本里跑) */
  sandbox?: boolean;
  /** 认 --json;给数组就是只有这几个子命令认 */
  json?: boolean | readonly string[];
  notes?: readonly string[];
  /** 会花钱、会写孩子的数据、要人来:agent 跑之前要知道 */
  effects?: readonly string[];
  examples: readonly string[];
}

const DATE: FlagSpec = { name: 'date', value: '<日期>', desc: '哪天(YYYY-MM-DD,缺省今天)' };
const LANE: FlagSpec = { name: 'lane', value: '<道>', desc: '只看这几道的事件,逗号分开,如 main,tts' };
const ACTIVITY: FlagSpec = { name: 'activity', value: '<名>', desc: '像孩子点了首页的 activity 按钮,新开话题' };
const PARAM: FlagSpec = { name: 'param', value: "'名=值;名=值'", desc: 'activity 的参数(按钮下面那几行)' };
const FROM: FlagSpec = { name: 'from', value: 'kid|system', desc: '谁说的(缺省 kid;system 不算孩子说的)' };
const OPEN_QR: FlagSpec = { name: 'open-qr', desc: '--open 的旧名', hidden: true };

export const COMMANDS: readonly CommandSpec[] = [
  // ---- 安装与设置 ----
  {
    name: 'guide', group: 'setup', summary: '给 AI 助手的安装说明(新电脑先跑这条)',
    usage: ['cotutor guide'], maxArgs: 0,
    notes: ['打印随包发的 INSTALL.md,和这个版本对得上', '还没装 cotutor 时:npx cotutor@latest guide', '第一行只用 ASCII:中文成了乱码,照它说的直接按 UTF-8 读文件'],
    examples: ['npx cotutor@latest guide'],
  },
  {
    name: 'init', group: 'setup', summary: '建孩子的 cotutor 文件夹和笔记文件夹',
    usage: ['cotutor init <slug> [--name <称呼>] [--grade <1-6>] [--vault <目录>] [--dir <目录>] [--port <n>] [--json]'],
    maxArgs: 1, json: true,
    flags: [
      { name: 'name', value: '<称呼>', desc: '老师怎么叫孩子,小名就行' },
      { name: 'grade', value: '<1-6>', desc: '年级,决定装哪个教学包(cotutor grades 看有哪些)' },
      { name: 'vault', value: '<目录>', desc: '用家长已有的笔记库(缺省在旁边建 <slug>-vault/);不能放在 cotutor 文件夹里' },
      { name: 'dir', value: '<目录>', desc: 'cotutor 文件夹放哪(缺省 ~/cotutor/<slug>/)' },
      { name: 'port', value: '<n>', desc: '端口(缺省 443,不行就 8443、8445…);选一次写进 cotutor.json,以后不变' },
    ],
    notes: ['<slug> 是孩子的短名:小写字母、数字、连字符,不用真名', '重复跑只补缺,已有的文件不动'],
    examples: ['cotutor init ming --name 小明 --grade 2'],
  },
  {
    name: 'grades', group: 'setup', summary: '列出能装的年级教学包',
    usage: ['cotutor grades [--json]'], maxArgs: 0, json: true,
    examples: ['cotutor grades --json'],
  },
  {
    name: 'service', group: 'setup', summary: '后台服务:装、起停、状态、日志',
    usage: [
      'cotutor service install [--no-open] [--no-tray] [--json]',
      'cotutor service uninstall | start | stop | restart',
      'cotutor service status [--json]',
      'cotutor service logs [--lines <n>] [--follow]',
    ],
    subs: ['install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs'], subRequired: true, hiddenSubs: ['run'],
    maxArgs: 1, workspace: true, json: ['install', 'uninstall', 'status'],
    flags: [
      { name: 'no-open', desc: '装完不打开家长端(第一次装缺省会打开)', subs: ['install'] },
      { name: 'open', desc: '装完打开家长端(重装缺省不开)', subs: ['install'] },
      OPEN_QR,
      { name: 'no-tray', desc: '不带菜单栏 / 任务栏图标', subs: ['install'] },
      { name: 'lines', value: '<n>', desc: '看最后几行(缺省 50)', subs: ['logs'] },
      { name: 'follow', desc: '一直跟着看新写的', subs: ['logs'] },
      { name: 'log-dir', value: '<目录>', desc: '看护进程用', subs: ['run'], hidden: true },
    ],
    notes: [
      '一个孩子一个服务,不要管理员:macOS launchd、Linux systemd 用户服务、Windows 登录项',
      '登录后自己起来,崩了 10 秒后再起;日志按天留 14 天',
      '换了 Node 版本或包挪了地方,再 install 一次',
    ],
    effects: ['install / uninstall 改这台电脑的登录项'],
    examples: ['cotutor service install --no-open', 'cotutor service status --json', 'cotutor service logs --lines 100'],
  },
  {
    name: 'cert', group: 'setup', summary: '签 HTTPS 证书(平板上说话要 HTTPS)',
    usage: ['cotutor cert [<名或IP>]... [--json]'], maxArgs: Infinity, json: true,
    flags: [{ name: 'host', value: '<名或IP>', desc: '多认一个名字或 IP(也可以直接写在后面)' }],
    notes: ['要先装 mkcert;缺省认电脑名,换 Wi-Fi、IP 变了都不用重签', '所有孩子共用一张,在 ~/.config/cotutor/certs/', '签完 cotutor service restart 才走 HTTPS'],
    effects: ['这台电脑信任根证书另有一步(Mac 弹框要登录密码,Windows 弹窗点「是」,Linux 要 sudo),没做只是这台电脑的浏览器报警告;要做的那条命令 cotutor cert 会打印'],
    examples: ['cotutor cert', 'cotutor cert 192.168.1.20'],
  },
  {
    name: 'pin', group: 'setup', summary: '家长端密码(PIN)',
    usage: ['cotutor pin [--pin <4-8 位数字>]', 'cotutor pin off | status [--json]'],
    subs: ['off', 'status'], maxArgs: 1, json: true,
    flags: [{ name: 'pin', value: '<数字>', desc: '设成这个 PIN(不带它在终端里会问)', subs: [''] }],
    notes: ['锁家长端 /parent 和工作台 /dev;没设就对局域网全开', '这台电脑上免密;所有孩子共用'],
    effects: ['要人来:PIN 由家长自己设,不要说给 AI 助手'],
    examples: ['cotutor pin status --json', 'cotutor pin off'],
  },

  // ---- 日常使用 ----
  {
    name: 'open', group: 'daily', summary: '打开家长端',
    usage: ['cotutor open [--print] [--json]'], maxArgs: 0, workspace: true, sandbox: true, json: true,
    flags: [{ name: 'print', desc: '只打印地址,不开浏览器' }],
    notes: ['读 cotutor.json,不用记端口;没在跑就说怎么起,退出码 1'],
    examples: ['cotutor open', 'cotutor open --print'],
  },
  {
    name: 'doctor', group: 'daily', summary: '体检;--fix 修掉能自动修的',
    usage: ['cotutor doctor [--json]', 'cotutor doctor --fix', 'cotutor doctor --live'],
    maxArgs: 0, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'fix', desc: '修掉能自动修的(幂等,不碰孩子的数据,不用人输东西),要人来的留着' },
      { name: 'live', desc: '真连一次百炼的嘴、真配一句音' },
    ],
    notes: ['--json 里没过的项带 cmd(能直接跑)或 human(要人来)', '有必需项没过,退出码 1'],
    effects: ['--live 花一分钱'],
    examples: ['cotutor doctor --fix', 'cotutor doctor --json'],
  },
  {
    name: 'update', group: 'daily', summary: '升级程序,再更新每个孩子的出厂文件',
    usage: ['cotutor update [--anyway]'], maxArgs: 0, workspace: true,
    flags: [{ name: 'anyway', desc: '孩子在通话时也动(缺省等下课)' }],
    notes: ['问 npm 有没有新版本 → 换程序 → 每个孩子换新出厂文件(cotutor refresh)、重起服务和图标', 'npm 没装成,服务不动', '「升级 cotutor」就是这条'],
    examples: ['cotutor update'],
  },
  {
    name: 'backup', group: 'daily', summary: '备份、看有哪些、恢复',
    usage: ['cotutor backup', 'cotutor backup list [--json]', 'cotutor backup restore <名字> [--yes]'],
    subs: ['list', 'restore'], maxArgs: 2, workspace: true, sandbox: true, json: true,
    flags: [{ name: 'yes', desc: '真的恢复(不加只说会做什么)', subs: ['restore'] }],
    notes: ['在孩子的 cotutor 文件夹旁边的 .backups/,不含录音', '服务开着时每天一份,升级前一份;恢复前先把现在的也备一份', 'restore 不加 --yes:只说会做什么,以 1 退(--json 时 needsYes: true)'],
    effects: ['restore 覆盖孩子的文件:家长明确说要恢复才跑'],
    examples: ['cotutor backup list', 'cotutor backup restore <名字> --yes'],
  },
  {
    name: 'report', group: 'daily', summary: '诊断信息(不含孩子的对话和 key)',
    usage: ['cotutor report'], maxArgs: 0, workspace: true, sandbox: true,
    notes: ['版本、系统、服务、没过的体检、最近报错的原因;名字和 IP 已抹掉,先看再发', '给人看、贴进 issue 的,只出文字;要机器可读的用 cotutor doctor --json 和 cotutor service status --json'],
    examples: ['cotutor report'],
  },
  {
    name: 'tray', group: 'daily', summary: '菜单栏 / 任务栏图标',
    usage: ['cotutor tray on | off | status [--json]'],
    subs: ['on', 'off', 'status'], subRequired: true, maxArgs: 1, json: true,
    notes: ['macOS、Windows;service install 时一起装', 'off 关掉并记住,以后装服务也不带'],
    examples: ['cotutor tray status --json'],
  },

  // ---- 定制教学 ----
  {
    name: 'refresh', group: 'custom', summary: '换新这个孩子的出厂文件(不升级程序)',
    usage: ['cotutor refresh [--json]', 'cotutor refresh --config [--dry-run] [--json]'],
    maxArgs: 0, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'config', desc: '改的是 cotutor.json:只补缺的、删不再用的出厂段,改过的值不动' },
      { name: 'dry-run', desc: '和 --config 一起:只看要改什么' },
      { name: 'grade', value: '<1-6>', desc: '', hidden: true },
    ],
    notes: [
      '出厂的老师、activity、技能、主题:没改过的换新,改过的保留并报 diff;换之前自动备份一份',
      '升级程序用 cotutor update,它会对每个孩子跑这条;这条只在程序已经换过(手动 npm i -g、从仓库跑)时单独用',
      '改过的想回出厂的:cotutor reset',
    ],
    examples: ['cotutor refresh', 'cotutor refresh --config --dry-run'],
  },
  {
    name: 'reset', group: 'custom', summary: '把改过的出厂老师或 activity 换回出厂的',
    usage: ['cotutor reset <老师>|<老师>/<activity>... [--json]'],
    maxArgs: Infinity, workspace: true, sandbox: true, json: true,
    notes: ['只动点名的这几份;你那份存成旁边的 .bak,换之前还自动备份一份', '自家加的老师、activity 没有出厂那份,换不了'],
    effects: ['盖掉家长改过的老师文件:家长明确说要回出厂的才跑'],
    examples: ['cotutor reset math-tutor', 'cotutor reset chinese-tutor/你说我画'],
  },
  {
    // refresh 的旧名:0.4.x 的 cotutor update 换完程序,会用新程序跑 upgrade --workspace <孩子>,所以一直要认;不进帮助
    name: 'upgrade', group: 'custom', hidden: true, summary: '旧名:升级程序用 cotutor update,换新出厂文件用 cotutor refresh,回出厂用 cotutor reset',
    usage: ['cotutor upgrade [--force <老师>]... [--config [--dry-run]] [--json]'],
    maxArgs: Infinity, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'force', value: '<老师>', desc: '同 cotutor reset' },
      { name: 'config', desc: '同 cotutor refresh --config' },
      { name: 'dry-run', desc: '和 --config 一起:只看要改什么' },
      { name: 'grade', value: '<1-6>', desc: '', hidden: true },
    ],
    notes: ['还认,是为了旧版本的 cotutor update 和旧文档;新写的一律用 update / refresh / reset'],
    examples: ['cotutor refresh'],
  },
  {
    name: 'add', group: 'custom', summary: '加一位自家的老师',
    usage: ['cotutor add <老师名> --display <显示名> [--subject <学科>] [--avatar <emoji|图片>] [--description <一句话>] [--hidden] [--json]'],
    maxArgs: 1, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'display', value: '<显示名>', desc: '孩子看到的名字(必填)' },
      { name: 'subject', value: '<学科>', desc: '学科' },
      { name: 'avatar', value: '<emoji|图片>', desc: 'emoji,或 workspace 里图片的相对路径' },
      { name: 'description', value: '<一句话>', desc: '写进老师文件的一句介绍' },
      { name: 'hidden', desc: '孩子端不露(只和系统、家长打交道的工具人)' },
    ],
    notes: ['名字以 -tutor 结尾的是有脸的老师,其余是工具人', '出老师文件、写进 cotutor.json、建它的家;服务不用重启'],
    examples: ['cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬'],
  },
  {
    name: 'add-theme', group: 'custom', summary: '加一个自家的主题',
    usage: ['cotutor add-theme <主题名> [--from <主题>] [--json]'], maxArgs: 1, workspace: true, sandbox: true, json: true,
    flags: [{ name: 'from', value: '<主题>', desc: '从哪个主题拷(缺省 default)' }],
    notes: ['拷到 themes/<主题名>/;cotutor.json 的 kid.theme 改成它就换过去'],
    examples: ['cotutor add-theme dark'],
  },
  {
    name: 'home', group: 'custom', summary: '检查和发布孩子端首页',
    usage: ['cotutor home check [--published] [--json]', 'cotutor home publish [--force] [--from <文件>] [--json]', 'cotutor home show [--json]'],
    subs: ['check', 'publish', 'show'], subRequired: true, maxArgs: 1, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'published', desc: '查已发布的那份(缺省查草稿 home/draft.md)', subs: ['check'] },
      { name: 'force', desc: '有要改的卡,丢掉它们照发', subs: ['publish'] },
      { name: 'from', value: '<文件>', desc: '发另一份(比如历史里的)', subs: ['publish'] },
    ],
    notes: ['check 不花钱:孩子会看到哪几张卡、每位老师的按钮、要改的(带行号)', 'publish 先检查,留历史 home/history/,写 home/published.json;孩子端刷新就是新的', 'show:现在发布的是哪份、每个按钮被点了几次'],
    examples: ['cotutor home check', 'cotutor home publish'],
  },
  {
    name: 'activity', group: 'custom', summary: '检查和评测 activity',
    usage: ['cotutor activity check [<老师> [<名>]] [--json]', 'cotutor activity eval <老师> <名> [--runs <n>] [--only <例子>] [--kid-model <模型>] [--json]'],
    subs: ['check', 'eval'], subRequired: true, maxArgs: 3, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'runs', value: '<n>', desc: '每个例子跑几次(1–10,缺省 3),次次都过才算过', subs: ['eval'] },
      { name: 'only', value: '<例子>', desc: '只跑这个例子', subs: ['eval'] },
      { name: 'kid-model', value: '<模型>', desc: '模拟孩子用的千问模型(缺省 qwen3.8-flash)', subs: ['eval'] },
    ],
    notes: ['activity 文件在 agents/<老师>/activities/<名>.md', 'check 不花钱;eval 照 <名>.例子.md 跑真老师 + 模拟孩子,落 evals/'],
    effects: ['eval 花钱'],
    examples: ['cotutor activity check', 'cotutor activity eval chinese-tutor 你说我画 --runs 1'],
  },
  {
    name: 'chalk', group: 'custom', summary: '做小课堂的课包',
    usage: [
      'cotutor chalk check <scene.ts|目录> [--no-types] [--json]',
      'cotutor chalk build <scene.ts|目录> [--out <目录>] [--json]',
      'cotutor chalk bake <scene.ts|课包 id> [--bundles <目录>] [--json]',
      'cotutor chalk snap <scene.ts|课包 id> [--step <n>] [--no-cursor] [--out <目录>] [--bundles <目录>] [--json]',
      'cotutor chalk dub <scene.ts|课包 id> [--voice <音色>] [--tutor <老师>] [--instruction <语气>] [--dry-run] [--bundles <目录>] [--json]',
    ],
    subs: ['check', 'build', 'bake', 'snap', 'dub'], maxArgs: 2, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'no-types', desc: '不跑类型检查', subs: ['check'] },
      { name: 'out', value: '<目录>', desc: 'build:课包放哪(缺省 bundles/<id>/);snap:截图放哪', subs: ['build', 'snap'] },
      { name: 'bundles', value: '<目录>', desc: '课包目录(缺省 workspace 的 bundles/)', subs: ['bake', 'snap', 'dub'] },
      { name: 'step', value: '<n>', desc: '只截这一步(0 = 空板)', subs: ['snap'] },
      { name: 'no-cursor', desc: '截图里不画笔尖', subs: ['snap'] },
      { name: 'voice', value: '<音色>', desc: '配音的音色(缺省用 --tutor 那位老师卡的音色)', subs: ['dub'] },
      { name: 'tutor', value: '<老师>', desc: '用这位老师卡的音色(缺省 math-tutor)', subs: ['dub'] },
      { name: 'instruction', value: '<语气>', desc: '配音的语气', subs: ['dub'] },
      { name: 'dry-run', desc: '只算账(几步、多少计费字符),不合成', subs: ['dub'] },
    ],
    notes: ['check 校验场景;build 出课包;bake 烤画面;snap 每步截图;dub 配音', '给 .ts 的 bake / snap / dub 先 check + build;给课包 id 的直接用 bundles 里那份', '相对路径按当前目录'],
    effects: ['bake / snap 要本机的 Chrome', 'dub 花钱'],
    examples: ['cotutor chalk check scene.ts', 'cotutor chalk snap scene.ts'],
  },

  // ---- 开发与调试(顶层帮助缺省不列,cotutor --help --all 看) ----
  {
    name: 'serve', group: 'debug', summary: '在终端里起服务(关了终端就停)',
    usage: ['cotutor serve [--port <n>] [--http] [--open] [--trace [--lane <道>]] [--log-dir <目录>]'],
    maxArgs: 0, workspace: true, sandbox: true,
    flags: [
      { name: 'port', value: '<n>', desc: '这次换个端口' },
      { name: 'http', desc: '不走 HTTPS' },
      { name: 'open', desc: '顺手打开家长端' },
      OPEN_QR,
      { name: 'trace', desc: '每一轮的事件按道打印' },
      LANE,
      { name: 'log-dir', value: '<目录>', desc: '输出按天落文件(后台服务用)' },
    ],
    notes: ['一直开着用 cotutor service'],
    examples: ['cotutor serve --sandbox'],
  },
  {
    name: 'mock', group: 'debug', summary: '不花钱看前端:假老师、假嘴',
    usage: ['cotutor mock [--port <n>] [--scenario normal|nokey] [--delay <ms>] [--http] [--open]'], maxArgs: 0,
    flags: [
      { name: 'port', value: '<n>', desc: '端口' },
      { name: 'scenario', value: 'normal|nokey', desc: 'nokey = 没配百炼,孩子端只出「老师们还没到」' },
      { name: 'delay', value: '<ms>', desc: '假老师的延迟(毫秒)' },
      { name: 'http', desc: '不走 HTTPS' },
      { name: 'open', desc: '顺手打开扫码页' },
      OPEN_QR,
    ],
    notes: ['不需要 workspace'],
    examples: ['cotutor mock --scenario nokey'],
  },
  {
    name: 'send', group: 'debug', summary: '终端里给老师发一条',
    usage: [
      'cotutor send <老师> [<消息>] [--new] [--photo <图,图>] [--quiet] [--json]',
      "cotutor send <老师> --activity <名> [--param '名=值;名=值']",
    ],
    maxArgs: Infinity, workspace: true, sandbox: true, json: true,
    flags: [
      { name: 'new', desc: '开新话题' },
      { name: 'photo', value: '<图,图>', desc: '带作业照片(jpg / png,最多 9 张);有照片时消息可以空' },
      ACTIVITY, PARAM, FROM,
      { name: 'runtime', value: '<名>', desc: '换个运行时' },
      LANE,
      { name: 'quiet', desc: '只要结果,不打印过程' },
    ],
    notes: ['孩子的话照实时写(同孩子端),只是没有嘴;事件落 events.jsonl,事后 cotutor trace 看'],
    effects: ['花钱', '写进孩子的对话记录(试一下用 --sandbox)'],
    examples: ['cotutor send math-tutor "这一步为什么要借位"'],
  },
  {
    name: 'pack', group: 'debug', summary: '干跑上下文包:不起模型,看老师会拿到什么',
    usage: ["cotutor pack <老师> [<消息>] [--activity <名> [--param '名=值;名=值']] [--from kid|system] [--at <ISO时间>] [--json]"],
    maxArgs: Infinity, workspace: true, sandbox: true, json: true,
    flags: [ACTIVITY, PARAM, FROM, { name: 'at', value: '<ISO时间>', desc: '当作这个时间' }],
    notes: ['每段来自哪个文件、一共几条、按政策带了几条;改了档案、日记、计划立刻看效果'],
    examples: ['cotutor pack math-tutor "讲讲退位"'],
  },
  {
    name: 'show', group: 'debug', summary: '看一轮:问了什么、上下文包、讲稿与卡、读了什么',
    usage: ['cotutor show <老师> <job> [<日期>] [--evals] [--json]'], maxArgs: 3, workspace: true, sandbox: true, json: true,
    flags: [{ name: 'evals', desc: '看回放的那轮(evals/ 里的)' }],
    notes: ['日期缺省今天;--json 和家长端「看原文」是同一份'],
    examples: ['cotutor show math-tutor 1620-1 2026-09-12 --json'],
  },
  {
    name: 'trace', group: 'debug', summary: '回放一轮的事件',
    usage: ['cotutor trace <老师> <job> [<日期>] [--lane <道>] [--json]'], maxArgs: 3, workspace: true, sandbox: true, json: true,
    flags: [LANE],
    notes: ['读 <日期>.<job>.events.jsonl;日期缺省今天'],
    examples: ['cotutor trace math-tutor 1620-1 --lane main'],
  },
  {
    name: 'replay', group: 'debug', summary: '同一问按现在的提示词再跑一遍,并排对照',
    usage: ['cotutor replay <老师> <job> [<日期>] [--runtime <名>] [--json]'], maxArgs: 3, workspace: true, sandbox: true, json: true,
    flags: [{ name: 'runtime', value: '<名>', desc: '换个运行时' }],
    notes: ['落 evals/,不进孩子的对话、不配音'],
    effects: ['花钱'],
    examples: ['cotutor replay math-tutor 1620-1 2026-09-12'],
  },
  {
    name: 'compare', group: 'debug', summary: '再看一次回放的对照',
    usage: ['cotutor compare <老师> [<evalJob>] [<日期>] [--json]'], maxArgs: 3, workspace: true, sandbox: true, json: true,
    notes: ['不给 evalJob 就列这天回放过哪些'],
    examples: ['cotutor compare math-tutor'],
  },
  {
    name: 'rate', group: 'debug', summary: '给一个话题打星(1–5)',
    usage: ['cotutor rate <老师> <话题> <1-5> [--date <日期>] [--json]'], maxArgs: 3, workspace: true, sandbox: true, json: true,
    flags: [DATE],
    notes: ['和家长端同一条路;到 vault.keepScore 星的话题,记账时摘要才进日记'],
    examples: ['cotutor rate math-tutor 1620-1 4'],
  },
  {
    name: 'bookkeep', group: 'debug', summary: '记账:把这天的话题写进日记',
    usage: ['cotutor bookkeep <老师> [--date <日期>] [--thread <话题>] [--quiet] [--json]'], maxArgs: 1, workspace: true, sandbox: true, json: true,
    flags: [DATE, { name: 'thread', value: '<话题>', desc: '只记这个话题' }, { name: 'quiet', desc: '不打印过程' }],
    notes: ['每个还没记过的话题起一轮记账,应用写进笔记文件夹的日记'],
    effects: ['花钱', '写孩子的笔记文件夹'],
    examples: ['cotutor bookkeep math-tutor'],
  },
];

export const commandSpec = (name: string | undefined): CommandSpec | undefined => COMMANDS.find((c) => c.name === name);

/** 所有命令里带值的旗标(parseArgs 要先知道哪些吃下一个词) */
export const VALUED_FLAGS: readonly string[] = [...new Set(['workspace', ...COMMANDS.flatMap((c) => (c.flags ?? []).filter((f) => f.value).map((f) => f.name))])];
