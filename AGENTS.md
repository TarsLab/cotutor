# cotutor

家里的 AI 老师团,和家长一起教。应用仓,2026-09-08 起。drawtell 是本仓旁边的检出(`link:../drawtell`,要先 build),voxtell 是 PATH 上的命令,都不在本仓。

本文件写仓库结构、开发方式与当前约束。历史讨论看 git log。Codex 直接读本文件,Claude Code 经 `CLAUDE.md` 的 `@AGENTS.md` 引入;改规矩只改这里。

- 使用、配置与开发启动见 `README.md`;iPad 真机见 `docs/iPad与iPhone.md`。
- `docs/` 只维护六篇:设备使用、vault、提示词、卡片协议、年级教学包和词表。契约以 `src/schema/` 为准,具体行为以实现和测试为准。
- 改 `grades/`、`skills/`、`cards/` 下的 md 先看 `docs/写提示词.md`;自造的词查 `docs/词表.md`。
- 草稿与随手记放 `docs/wip/`(gitignore)。已有的 `docs/archive/` 是本机材料;清理正式文档时不删除这些未入库文件。过时的正式文档直接删除,历史由 Git 保存。

年级教学包的来源、旧版迁移和贡献要求见 `docs/年级教学包.md`。

## 目录

- `grades/grade-<n>/agents/*.md` 出厂老师文件:frontmatter 取应用支持的字段,正文即系统提示;init 拷进 workspace,hash 记 `.cotutor/shipped.json`
- `grades/grade-<n>/agents/<老师>/activities/<名>.md` 出厂 activity(孩子从首页一个按钮进去的一种做法):一节一个读者,init 拷进 workspace 的 `agents/<老师>/activities/`(老师的家),hash 同上;形状在 `src/schema/activity.ts`,解析与检查在 `src/lib/activity.ts`;文件写法在 `docs/写提示词.md`
- `skills/<name>/` 出厂技能:cotutor-tutor(有脸的老师共同的守则,应用注入上下文包)、cotutor-board(由 `cards/板书怎么写.md` 与 `cards/*/card.md` 生成)、cotutor-vault、cotutor-analyze、cotutor-tune、cotutor-home(家长在 workspace 里排首页);不再出厂的机器件列在 `src/cli/skills.ts` 的 `RETIRED_SKILLS`,upgrade 时删
- `cards/<kind>/` 卡的协议:`card.md` 八栏(例子即测试)+ `card.css`
- `themes/default/` 出厂主题:`theme.json` 槽表、`kid.css`
- `src/schema/` 契约(zod,类型即文档);`src/lib/` 纯函数,离屏可测;`src/cards/` 卡的注册表;`src/clis/` 各 agent CLI 的适配器(一家一个文件,读输出、关工具、环境、出厂模板都在里面,别处只认统一事件);`src/brain/` 脑执行(`BrainExecutor`:定这一轮怎么跑、起老师、读输出,收尾给整轮转录),runner 只经它起老师;按这轮的运行时分两种:`{run, resume}` 起 CLI(`cli.ts`,预热、断流接着跑都在这),`{api: "bailian", model}` 应用直连百炼(`api.ts`,AI SDK;只读工具在 `api-tools.ts`,话题的模型历史在 `<日期>.<话题>.brain.jsonl`,拼回去时结束的轮瘦身(不带思考、工具往返成一句、照片只附最近那组),上一轮上下文过 32k 就整段压缩(前情 `src/lib/thread-digest.ts` 照索引拼,不调模型);`.log` 落一行一条统一事件)
- 你说我画的画图卡在后台画:场景的规则在 `src/scenes/paint/`(拼提示词、哪几幅、落盘到卡的资产目录、下发时补画好没有),百炼文生图的请求在 `src/media/draw.ts`(同步接口);runner 一轮跑完起它、把画一张的函数交进去(场景不引 media),app 的孩子 / 家长那天接一行;`src/paint/` 是旧路径的转发
- `src/stage/` 舞台包(React,esbuild 打到 `dist/stage/`);`src/cli/` 命令;`src/server/` 服务、runner、页面,地址按端分:孩子端 `/`、`/dictation`、`/talk`(孩子拍口语单,交给英语老师的实时页);家长端都在 `/parent` 下(记录 `/parent`、设首页 `/parent/home`、听写 `/parent/dictation`);工作台都在 `/dev` 下(扫码 `/dev/qr`)。录像里孩子的屏幕(`/reel`、`/dictation?reel=`)与家长「首页」里的预览(`/preview`)是孩子端页面本身,只开在家长端的 iframe 里;孩子端页面的源码里不出现 `/parent`;家长端「记录」是自己的一页(`src/server/parent-page.ts`,录像开 `/reel` 的 iframe),几页共用的 `$` / `h` / `toast` / `api` 在 `src/server/page-dom.ts`;家长端与工作台的锁在 `src/server/access.ts`(机器级 PIN,`cotutor pin`;没设就全开;孩子端新加的路径要在那里的白名单登记,`tests/access.test.ts` 盯着)
- `src/live/` realtime 那条线:有脸的老师都走它(零依赖 WebSocket 服务端、录像记录 `CallRecorder`、孩子端采音放音的内联源;百炼 realtime 客户端在 `src/realtime/bailian.ts`);实时老师的一次通话在 `call.ts`(孩子端的协议、嘴的连接、一直听、热身、边画边聊),交付在 `delivery.ts`(照念排队 `lib/queue.ts`、嘴的声音排到哪、第几句开始放、打断听到第几句),交给脑在 `turns.ts`,嘴这一道的事件与字幕重放的声音在 `journal.ts`,开口指令 `lib/cue.ts`,WS `/api/live/<老师>/ws`,serve.ts 的 upgrade 接一行;孩子端发一条的验与拼和 HTTP 共用 `runner.accept`(`src/server/kid-input.ts`)。百炼(按量 key + 业务空间 id)是机器级的 `~/.config/cotutor/bailian.json`,家长端「首页」里填(`src/server/bailian.ts`);没配孩子端只出「老师们还没到」
- 一个场景一个目录、cotutor 只在 app.ts 接一行的模块:`src/talk/`(口语课,孩子 `/talk`:拍一页、老师读出口语单、孩子改,交给英语老师的实时页跑 activity「口语课」;`src/server/talk-run.ts` 只读 `talk/<id>/talk.json`)、`src/dictation/`(听写,`/dictation`:从首页的 `dictation` 卡点进来,所以多了卡的注册、kid-page 画卡、mock 接一行;老师卡上常驻「拍照听写」,照片交百炼视觉模型流式认词;英文单词听写是另一页 `/dictation?lang=en`(四线三格,不逐字母比);比对照搬 hanzi-writer 的一笔像不像,改它先过 `tests/dictation.test.ts`,页面走 `scripts/probe-dictation.mjs` 与 `probe-dictation-en.mjs`)
- `tests/` 一文件一子进程,零依赖 `check()`;`_fake-cli.ts` / `_fake-tts.ts` 让全流程不花钱;`fixtures/board/` 真跑样本

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 跨目录的 import 由 `tests/layers.test.ts` 盯着:目录之间谁能引谁在它的 `ALLOW`,现有的反向依赖(「模块 → 被引的文件」)列在 `LEGACY`,只许删不许加;内联进页面的文件运行时只能从别的内联文件拿值
- 改了 `cards/` 下的 md、`src/lib/*-doc.ts` 跑 `pnpm run gen:skills`(不跑 skills.test 会红);改了 `src/stage/` 跑 `pnpm run build:stage`(dist 不在 git,没打包时舞台开不了)
- 改解析器或卡先过 `tests/board.test.ts`;改页面模板后 mock.test 兜「内联脚本能解析」、page-names.test 兜「没有找不到的名字」;改 `src/brain/api*.ts` 先过 `tests/brain-api.test.ts`(假百炼 `tests/_fake-bailian-chat.ts`,`COTUTOR_BRAIN_ENDPOINT` 指过去);改 `src/clis/` 先过 `tests/clis.test.ts` 与 `tests/qwen.test.ts`(假 CLI 有 qwen 方言);改 `src/talk/` 或 `src/live/` 先过 `tests/talk*.test.ts` 与 `tests/live*.test.ts`(假百炼 `tests/_fake-realtime.ts`),口语课页走 `scripts/probe-talk-page.mjs`;实时老师页走 `scripts/probe-live-page.mjs`(假百炼 + 假老师 + 无头 Chrome 假麦克风),Safari 走 `probe-live-webkit.mjs`,整条线真跑走 `probe-live-call.mjs`
- 改 activity 文件或 `src/lib/activity.ts` 先过 `tests/activity.test.ts`(出厂那份画家的画风要和 `PAINT_PROMPT_DEFAULT` 一字不差),workspace 里的跑 `cotutor activity check`
- 改工作台(`src/server/dev-*.ts`、`qr-page.ts`)先过 `tests/dev-overview.test.ts`、`tests/dev-activities.test.ts` 与 `tests/dev-tutor-files.test.ts`,颜色只用 `dev-theme.ts` 的变量;页面走 `scripts/probe-dev.mjs`(只看不改)
- 改孩子端流水(`src/server/kid-log.ts`、`src/lib/kid-device.ts`)先过 `tests/kid-log.test.ts` 与 `tests/dev-overview.test.ts`;新加孩子端页面要带 `KID_LOG_JS`(kid-log.test 的 PAGES 里登记);页面走 `scripts/probe-kid-log.mjs`(会写流水与设备表,拿试用 workspace)
- 改画板(`src/lib/canvas-chat.ts`、`src/stage/canvas.tsx`、`src/server/paper.ts`、`call.ts` 的边画边聊、kid-page 的「画板」)先过 `tests/canvas-chat.test.ts` 与 `tests/live-canvas.test.ts`;页面走 `scripts/probe-paper.mjs`(先起 `cotutor mock --http`,探针交掉 mock 里那张画板卡,再跑要重起 mock)
- 改 `src/scenes/paint/`、`src/media/draw.ts` 或画图卡先过 `tests/paint.test.ts`(假百炼、假老师全流程),页面走 `scripts/probe-paint.mjs`;真画按张计费
- 改孩子端播放(嘴、卡的声音、孩子谁打断谁)先在 `tests/live-player.test.ts` 明确预期,再改 `live-board.ts` 的 `liveStep`;页面只 `liveDispatch`。板上的节(铺、写完、撤掉)是 `kid-board.ts` 的 `step`,对 `tests/player.test.ts`,页面只 `dispatch`
- 冒烟:`init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live` → `serve`;真跑老师 `cotutor send`;不花钱看前端 `cotutor mock`(老师都走实时老师页,假嘴念静音的声音;`--scenario nokey` 看没配百炼)
- 页面里的 JS 有两个 CDP 探针进了 `pnpm test`(`tests/probe.test.ts` 起 `probe-layout`、`probe-play`,走 mock;要本机 Chrome,没有就跳过;`COTUTOR_SKIP_PROBES=1` 跳过),改 `kid-page.ts` 先看它们红不红;其余手动验收走 `scripts/probe-*.mjs`(CDP);舞台里的东西用 CDP 驱动;截图也走 CDP(`Page.captureScreenshot`),孩子端、工作台在轮询,无头 Chrome 的 `--screenshot` 会挂;手机尺寸要 `--force-device-scale-factor=2 --window-size=780,1688`;探针不出声:起 Chrome 加 `QUIET_ARGS`(`scripts/_quiet.mjs`,`--mute-audio`;页面不用浏览器合成声,mock 里卡的配音也是静音),要听加 `COTUTOR_PROBE_SOUND=1`

## 坑(不可推导的)

- 页面模板是模板字符串:反斜杠写 `\\n`,正则里 `\/` 写 `\\/`,吃掉一层那行就成了注释而脚本照样能解析
- serve 只热重载 cotutor.json;改 `src/` 要重起
- 提交按文件名 stage,仓里常有并行的未提交改动
- 舞台页(`/stage/`)也装孩子端的 `theme.css`:舞台里自己的类名要带前缀(`lc-` 这种),撞上 `.pen` `.c` 之类会被那边的样式改掉(`.pen` 关着 pointer-events,圈不上)
- 探针模拟手指用 CDP `Input.dispatchMouseEvent`,别用 `dispatchEvent`:后者直接派到元素上,不走命中判定,盖住了、pointer-events 关了都照样过
- 课包的画面是 build 后烤好的(`bake.json`),孩子端不跑 excalidraw 也没有 SMIL;改了画面要重烤(`drawtell bake`,snap 顺手烤),不然孩子端在浏览器里现烤、服务端后台补烤
- qwen 老师的家是 workspace 的 `.cotutor/qwen/home/`(`QWEN_HOME`,适配器生成),手跑 qwen 复现要带上 `QWEN_HOME`、`QWEN_RUNTIME_DIR`、`QWEN_CODE_SYSTEM_SETTINGS_PATH`,还有 `COTUTOR_QWEN_BASE_URL` 与 `COTUTOR_QWEN_API_KEY`(家里的 settings.json 只写这两个占位,适配器按 Token Plan / 按量填);别改 `HOME`。`--bare` 不认 `--core-tools`,别用
- qwen 读会话 cwd(老师目录)外的文件要征得同意,消息走 stdin 时没人回答,进程就挂到 `--max-wall-time`;只读那轮的 `--include-directories` 由适配器展开
- Safari 才有的毛病拿 Playwright 的 WebKit 复现(`scripts/probe-lecture-webkit.mjs`,本仓不装 playwright,借一份)
- 百炼 realtime:`turn_detection.silence_duration_ms` 喂过音频就改不了(切 null 再切回也回缺省 800),要不同的 silence 就另开会话;端点用业务空间 id 的域名,公网域名连上 1 秒就断;300 秒没输入就关,只 append 不 clear 会报 `response_idle_timeout` 而连接不断(死会话),心跳要 append 完马上 clear(`scripts/probe-live-idle.mjs`);`semantic_vad` 听不见一两个词的回答(好的、Yes,问过也一样),`server_vad` 听得见但「嗯」、笑声也算开口(`scripts/probe-live-vad.mjs context / noise`);Node 的 WebSocket 客户端握手被拒只发 error 不发 close,`close()` 后服务端那头要 5–10 秒才回;CDP 的鼠标事件派不到视口外的元素,先 `scrollIntoView`

## 约定

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

## 实时对话的核心约束

- realtime 模型负责听说,Qwen Code 运行脑模型生成讲稿和卡。嘴按句照念脑的讲稿,不另编教学内容;画板上的边画边聊由独立的有限上下文处理。
- 孩子开口或发出新一轮时,中断旧播放并使旧轮的延迟结果失效,不能把上一轮语音接到下一轮。队列与取消逻辑在 `src/live/call.ts`、`src/live/lib/queue.ts`。
- 嘴、卡片配音和小课堂的声音互斥;暂停、恢复和打断统一经 `liveDispatch` / `liveStep`,页面不私自改播放状态。板书状态由 `kid-board.ts` 的 `step` 管。
- 按句交付讲稿,卡片就绪后按顺序展示;问答、口语课热身和交卡的等待时机以 `tests/live-player.test.ts`、`tests/live-flow.test.ts` 与 `tests/player.test.ts` 为准。
