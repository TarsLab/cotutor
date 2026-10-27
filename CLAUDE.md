# cotutor

家里的 AI 老师团,和家长一起教。应用仓,2026-09-08 起。drawtell 是本仓旁边的检出(`link:../drawtell`,要先 build),voxtell 是 PATH 上的命令,都不在本仓。

本文件只写怎么在这个仓干活,不记历史、不记拍板:

- 设计在 `docs/`:《产品规划.md》定位、两个端;《agent层设计.md》目录、记忆、子代理;《契约草案.md》各文件形状的「为什么」(真相在 `src/schema/`);《工作流程.md》一拍一就绪、事件;《obsidian仓库设计.md》vault;《卡片协议.md》加一种卡;《首页设计.md》孩子端首页与 cotutor-home;《作业照片设计.md》孩子端拍照、编辑与发;《家长板书页设计.md》家长端 `/parent`;《工作台设计.md》工作台 `/dev` 的样子(纸面控制台)、概览的数、activity 页;《家长录像设计.md》家长端看录像:录数据不录屏幕;《小课堂设计.md》做好的课(课包或视频)孩子看完再聊:播放器、画(一处一张截图)、画的卡、老师放课里一段;《看图说话设计.md》语文老师一问一答带看图说话;《实时老师设计.md》嘴(realtime)开口、脑(老师 CLI)写板书,有脸的老师都这样;《实时老师页设计.md》实时老师页的样子与按钮;《一直听设计.md》不用按住说话的那种说法;《口语课设计.md》英语老师的口语课:孩子拍一页,热身 + 打电话在英语老师的实时页(《口语课实时设计.md》);《activity设计.md》首页按钮进去的一种做法;《听写设计.md》听写与拍照听写;《你说我画设计.md》画图卡;《画板设计.md》画板卡与左栏的纸铺满、边画边聊、给老师看;《孩子端流水设计.md》孩子端记什么(设备、页面脚本出错)、工作台怎么显示;《接一个 CLI.md》再接一家 agent CLI(写给开发者)
- 各设计文档末尾有「拍板记录」,带日期。**带日期的决定都是可推翻的**;一条约定要在两轮以上迭代里活下来才进本文件末尾的「约定」
- 改 `grades/`、`skills/`、`cards/` 下的 md 的字先看《写提示词.md》;自造的词查《词表.md》
- 《开发者手册.md》怎么跑;给用的人看的是《家长手册.md》《iPad与iPhone.md》。模块的来龙去脉与真跑数据不另存,看 git log 与各设计文档
- 草稿与随手记放 `docs/wip/`(gitignore);过时的文档与截图移到 `docs/archive/`(gitignore,只留本机),原处留一句「原文在 git 历史 <提交>」

年级教学包的来源、旧版迁移和贡献要求见 `docs/年级教学包.md`。

## 目录

- `grades/grade-<n>/agents/*.md` 出厂老师文件:frontmatter 取两 CLI 公共子集,正文即系统提示;init 拷进 workspace,hash 记 `.cotutor/shipped.json`
- `grades/grade-<n>/agents/<老师>/activities/<名>.md` 出厂 activity(孩子从首页一个按钮进去的一种做法):一节一个读者,init 拷进 workspace 的 `agents/<老师>/activities/`(老师的家),hash 同上;形状在 `src/schema/activity.ts`,解析与检查在 `src/lib/activity.ts`;设计在 `docs/activity设计.md`
- `skills/<name>/` 出厂技能:cotutor-tutor(有脸的老师共同的守则,应用注入上下文包)、cotutor-board(由 `cards/板书怎么写.md` 与 `cards/*/card.md` 生成)、cotutor-vault、cotutor-analyze、cotutor-tune、cotutor-home(家长在 workspace 里排首页);不再出厂的机器件列在 `src/cli/skills.ts` 的 `RETIRED_SKILLS`,upgrade 时删
- `cards/<kind>/` 卡的协议:`card.md` 八栏(例子即测试)+ `card.css`
- `themes/default/` 出厂主题:`theme.json` 槽表、`kid.css`
- `src/schema/` 契约(zod,类型即文档);`src/lib/` 纯函数,离屏可测;`src/cards/` 卡的注册表;`src/clis/` 各 agent CLI 的适配器(一家一个文件,读输出、关工具、环境、出厂模板都在里面,别处只认统一事件)
- `src/paint/` 你说我画的画图卡在后台画(百炼文生图,同步接口):拼提示词、画、落盘到卡的资产目录、下发时补画好没有;runner 一轮跑完起它,app 的孩子 / 家长那天接一行;设计在 `docs/你说我画设计.md`
- `src/stage/` 舞台包(React,esbuild 打到 `dist/stage/`);`src/cli/` 命令;`src/server/` 服务、runner、页面,地址按端分:孩子端 `/`、`/dictation`、`/talk`(孩子拍口语单,交给英语老师的实时页);家长端都在 `/parent` 下(记录 `/parent`、设首页 `/parent/home`、听写 `/parent/dictation`);工作台都在 `/dev` 下(扫码 `/dev/qr`)。录像里孩子的屏幕(`/reel`、`/dictation?reel=`)与家长「首页」里的预览(`/preview`)是孩子端页面本身,只开在家长端的 iframe 里;孩子端页面的源码里不出现 `/parent`,家长清单上的跳转由服务端只在家长模式塞进 `MODE.links`、mock;家长端与工作台的锁在 `src/server/access.ts`(机器级 PIN,`cotutor pin`;没设就全开;孩子端新加的路径要在那里的白名单登记,`tests/access.test.ts` 盯着)
- `src/live/` realtime 那条线:有脸的老师都走它(百炼 realtime 客户端、零依赖 WebSocket 服务端、录像记录 `CallRecorder`、孩子端采音放音的内联源);实时老师(`docs/实时老师设计.md`)的一次通话在 `call.ts`(嘴接住、脑写板书、照念排队 `lib/queue.ts`、开口指令 `lib/cue.ts`),WS `/api/live/<老师>/ws`,serve.ts 的 upgrade 接一行;孩子端发一条的验与拼和 HTTP 共用 app.ts 的 `kidSendInput`。百炼(按量 key + 业务空间 id)是机器级的 `~/.config/cotutor/bailian.json`,家长端「首页」里填(`src/server/bailian.ts`);没配孩子端只出「老师们还没到」
- 一个场景一个目录、cotutor 只在 app.ts 接一行的模块:`src/talk/`(口语课,孩子 `/talk`:拍一页、老师读出口语单、孩子改,交给英语老师的实时页跑 activity「口语课」;`src/server/talk-run.ts` 只读 `talk/<id>/talk.json`)、`src/dictation/`(听写,`/dictation`:从首页的 `dictation` 卡点进来,所以多了卡的注册、kid-page 画卡、mock 接一行;老师卡上常驻「拍照听写」,照片交百炼视觉模型流式认词;英文单词听写是另一页 `/dictation?lang=en`(四线三格,不逐字母比);比对照搬 hanzi-writer 的一笔像不像,改它先过 `tests/dictation.test.ts`,页面走 `scripts/probe-dictation.mjs` 与 `probe-dictation-en.mjs`);设计在 `docs/口语课设计.md`、`docs/听写设计.md`
- `tests/` 一文件一子进程,零依赖 `check()`;`_fake-cli.ts` / `_fake-tts.ts` 让全流程不花钱;`fixtures/board/` 真跑样本

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 改了 `cards/` 下的 md、`src/lib/*-doc.ts` 跑 `pnpm run gen:skills`(不跑 skills.test 会红);改了 `src/stage/` 跑 `pnpm run build:stage`(dist 不在 git,没打包时舞台开不了)
- 改解析器或卡先过 `tests/board.test.ts`;改页面模板后 mock.test 兜「内联脚本能解析」、page-names.test 兜「没有找不到的名字」;改 `src/clis/` 先过 `tests/clis.test.ts` 与 `tests/qwen.test.ts`(假 CLI 有 qwen 方言);改 `src/talk/` 或 `src/live/` 先过 `tests/talk*.test.ts` 与 `tests/live*.test.ts`(假百炼 `tests/_fake-realtime.ts`),口语课页走 `scripts/probe-talk-page.mjs`;实时老师页走 `scripts/probe-live-page.mjs`(假百炼 + 假老师 + 无头 Chrome 假麦克风),Safari 走 `probe-live-webkit.mjs`,整条线真跑走 `probe-live-call.mjs`
- 改 activity 文件或 `src/lib/activity.ts` 先过 `tests/activity.test.ts`(出厂那份画家的画风要和 `PAINT_PROMPT_DEFAULT` 一字不差),workspace 里的跑 `cotutor activity check`
- 改工作台(`src/server/dev-*.ts`、`qr-page.ts`)先过 `tests/dev-overview.test.ts`、`tests/dev-activities.test.ts` 与 `tests/dev-tutor-files.test.ts`,颜色只用 `dev-theme.ts` 的变量;页面走 `scripts/probe-dev.mjs`(只看不改)
- 改孩子端流水(`src/server/kid-log.ts`、`src/lib/kid-device.ts`)先过 `tests/kid-log.test.ts` 与 `tests/dev-overview.test.ts`;新加孩子端页面要带 `KID_LOG_JS`(kid-log.test 的 PAGES 里登记);页面走 `scripts/probe-kid-log.mjs`(会写流水与设备表,拿试用 workspace)
- 改画板(`src/lib/canvas-chat.ts`、`src/stage/canvas.tsx`、`src/server/paper.ts`、`call.ts` 的边画边聊、kid-page 的「画板」)先过 `tests/canvas-chat.test.ts` 与 `tests/live-canvas.test.ts`;页面走 `scripts/probe-paper.mjs`(先起 `cotutor mock --http`,探针交掉 mock 里那张画板卡,再跑要重起 mock)
- 改 `src/paint/` 或画图卡先过 `tests/paint.test.ts`(假百炼、假老师全流程),页面走 `scripts/probe-paint.mjs`;真画按张计费
- 改孩子端播放(嘴、卡的声音、孩子谁打断谁)先改《工作流程.md》的仲裁表,再改 `tests/live-player.test.ts`,最后改 `live-board.ts` 的 `liveStep`;页面只 `liveDispatch`。板上的节(铺、写完、撤掉)是 `kid-board.ts` 的 `step`,对 `tests/player.test.ts`,页面只 `dispatch`
- 冒烟:`init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live` → `serve`;真跑老师 `cotutor send`;不花钱看前端 `cotutor mock`(老师都走实时老师页,假嘴念静音的声音;`--scenario nokey` 看没配百炼)
- 页面里的 JS 有两个 CDP 探针进了 `pnpm test`(`tests/probe.test.ts` 起 `probe-layout`、`probe-play`,走 mock;要本机 Chrome,没有就跳过;`COTUTOR_SKIP_PROBES=1` 跳过),改 `kid-page.ts` 先看它们红不红;其余手动验收走 `scripts/probe-*.mjs`(CDP);舞台里的东西用 CDP 驱动;截图也走 CDP(`Page.captureScreenshot`),孩子端、工作台在轮询,无头 Chrome 的 `--screenshot` 会挂;手机尺寸要 `--force-device-scale-factor=2 --window-size=780,1688`;探针不出声:起 Chrome 加 `QUIET_ARGS`、连上先 `quiet(send)`(`scripts/_quiet.mjs`,mock 的合成声走系统语音服务,`--mute-audio` 静不了它),要听加 `COTUTOR_PROBE_SOUND=1`

## 坑(不可推导的)

- 页面模板是模板字符串:反斜杠写 `\\n`,正则里 `\/` 写 `\\/`,吃掉一层那行就成了注释而脚本照样能解析
- Claude Code 会话里起 claude 子进程要 `env -u CLAUDECODE`
- claude 运行时模板带 `--setting-sources project` 隔离本机配置,代价是 `~/.claude/settings.json` 的代理 env 也不进:cotutor.json 的 `proxy`(init 会问,`cotutor proxy on`)起 claude 时注进去;没设就得从 export 了代理的 shell 起 serve
- serve 只热重载 cotutor.json;改 `src/` 要重起
- 提交按文件名 stage,仓里常有并行的未提交改动
- 舞台页(`/stage/`)也装孩子端的 `theme.css`:舞台里自己的类名要带前缀(`lc-` 这种),撞上 `.pen` `.c` 之类会被那边的样式改掉(`.pen` 关着 pointer-events,圈不上)
- 探针模拟手指用 CDP `Input.dispatchMouseEvent`,别用 `dispatchEvent`:后者直接派到元素上,不走命中判定,盖住了、pointer-events 关了都照样过
- 课包的画面是 build 后烤好的(`bake.json`),孩子端不跑 excalidraw 也没有 SMIL;改了画面要重烤(`drawtell bake`,snap 顺手烤),不然孩子端在浏览器里现烤、服务端后台补烤
- qwen 老师的家是 workspace 的 `.cotutor/qwen/home/`(`QWEN_HOME`,适配器生成),手跑 qwen 复现要带上 `QWEN_HOME`、`QWEN_RUNTIME_DIR`、`QWEN_CODE_SYSTEM_SETTINGS_PATH`,还有 `COTUTOR_QWEN_BASE_URL` 与 `COTUTOR_QWEN_API_KEY`(家里的 settings.json 只写这两个占位,适配器按 Token Plan / 按量填);别改 `HOME`。`--bare` 不认 `--core-tools`,别用
- qwen 读会话 cwd(老师目录)外的文件要征得同意,消息走 stdin 时没人回答,进程就挂到 `--max-wall-time`;只读那轮的 `--include-directories` 由适配器展开
- Safari 才有的毛病拿 Playwright 的 WebKit 复现(`scripts/probe-lecture-webkit.mjs`,本仓不装 playwright,借一份)
- 百炼 realtime:`turn_detection.silence_duration_ms` 喂过音频就改不了(切 null 再切回也回缺省 800),要不同的 silence 就另开会话;端点用业务空间 id 的域名,公网域名连上 1 秒就断;300 秒没输入就关,只 append 不 clear 会报 `response_idle_timeout` 而连接不断(死会话),心跳要 append 完马上 clear(`scripts/probe-live-idle.mjs`);`semantic_vad` 听不见一两个词的回答(好的、Yes,问过也一样),`server_vad` 听得见但「嗯」、笑声也算开口(`scripts/probe-live-vad.mjs context / noise`);Node 的 WebSocket 客户端握手被拒只发 error 不发 close,`close()` 后服务端那头要 5–10 秒才回;CDP 的鼠标事件派不到视口外的元素,先 `scrollIntoView`

## 约定(活过多轮的)

- 一孩一 workspace 一 vault 一服务进程;老师会话的 cwd 是 `agents/<name>/`
- 出厂件(老师文件、主题、技能)拷贝不链;hash 记 shipped.json,upgrade 只换没改过的、改过的报 diff;`machine: true` 的技能每次覆盖
- 老师按 cotutor.json 里有谁走,没有注册表;键以 `-tutor` 结尾的是有脸的老师,其余是工具人
- 老师文件里只有运行字段与正文;display / avatar / voice / enabled / policy / runtime 在 cotutor.json
- 老师的正文就是板书:普通行 = 讲稿一句,围栏 = 卡,第一个 H2 起是给家长的尾巴;解析器永不抛
- 老师不派子代理、不互相交活(自己派会烧光自己的预算)
- 孩子端永远没有错误与评判;卡上不画对错;答案下发前剥掉
- 卡的状态是孩子的,存服务端;vault 是家长的,老师(LLM)不直接写,回结构化段由应用落盘
- workspace 解析链 `--workspace` > `COTUTOR_WORKSPACE` > cwd 祖先 > `~/.config/cotutor/config.json` > `~/cotutor/` 唯一目录;init 幂等补缺,已有文件不动
- 证书是机器级的,`~/.config/cotutor/certs/`
