# cotutor

本文件给开发本仓库的 agent;在家长的电脑上安装 cotutor 看 `INSTALL.md`。

家里的 AI 老师团,和家长一起教。应用仓,2026-09-08 起。2026-10-31 起原来的两个旁仓都并进来了:画面引擎 drawtell 成了 `src/chalk/`(命令 `cotutor chalk`),配音 voxtell 成了 `src/media/tts.ts`。

本文件写仓库结构、开发方式与当前约束。历史讨论看 git log。Codex 直接读本文件,Claude Code 经 `CLAUDE.md` 的 `@AGENTS.md` 引入;改规矩只改这里。

- 使用、配置与开发启动见 `README.md`;iPad 真机见 `docs/iPad与iPhone.md`。
- `docs/` 只维护六篇:设备使用、vault、提示词、卡片协议、年级教学包和词表;根目录的 `INSTALL.md` 给替家长安装的 agent 看,`tests/install-doc.test.ts` 盯着里面的命令、旗标和字段。契约以 `src/schema/` 为准,具体行为以实现和测试为准。
- 改 `grades/`、`skills/`、`cards/` 下的 md 先看 `docs/写提示词.md`;自造的词查 `docs/词表.md`。
- 草稿与随手记放 `docs/wip/`(gitignore)。已有的 `docs/archive/` 是本机材料;清理正式文档时不删除这些未入库文件。过时的正式文档直接删除,历史由 Git 保存。

年级教学包的来源、旧版迁移和贡献要求见 `docs/年级教学包.md`。

## 目录

- `grades/grade-<n>/agents/*.md` 出厂老师文件:frontmatter 取应用支持的字段,正文即系统提示;init 拷进 workspace 的 `agents/<老师>.md`(和老师的家 `agents/<老师>/` 并排),hash 记 `.cotutor/shipped.json`
- `grades/grade-<n>/agents/<老师>/activities/<名>.md` 出厂 activity(孩子从首页一个按钮进去的一种做法):一节一个读者,init 拷进 workspace 的 `agents/<老师>/activities/`(老师的家),hash 同上;形状在 `src/schema/activity.ts`,解析与检查在 `src/runtime/activity.ts`;文件写法在 `docs/写提示词.md`
- `skills/<name>/` 出厂技能:cotutor-tutor(有脸的老师共同的守则,应用注入上下文包)、cotutor-board(由 `cards/板书怎么写.md` 与 `cards/*/card.md` 生成)、cotutor-analyze、cotutor-tune、cotutor-home(家长在 workspace 里排首页);init 拷进 workspace 的 `.agents/skills/`(Codex、Qwen Code 认这里),`.claude/skills` 是链到它的(Claude Code 只认那里);不再出厂的机器件列在 `src/app/cli/skills.ts` 的 `RETIRED_SKILLS`,upgrade 时删
- `cards/<kind>/` 卡的协议:`card.md` 八栏(例子即测试)+ `card.css`
- `themes/default/` 出厂主题:`theme.json` 槽表、`kid.css`
- `avatars/` 出厂头像:三门主科各一张木钉娃娃(webp),跟着包走、不拷进 workspace;老师没写 avatar(或还是旧版 init 写的 🧮 📚 🔤)时由 `src/app/http/avatars.ts` 给出;重渲见 `scripts/avatars/peg.py`(借 figshot 的影棚);卡的配音(点读声音)同样有出厂缺省,`SHIPPED_CARD_VOICES`(`src/schema/config.ts`,不写进 cotutor.json),读一律经 `cardVoice()`。家长端首页「样子与声音」(头像点了就存;说话与点读的声音各一行,「换一个」开弹窗:全部声音,按男女、口音 / 中英、年纪、场景筛,按「用」才存)在 `src/app/http/parent-look.ts`;嘴的男女标在 `src/realtime/voices.ts`(官方表没有这一栏)
- `src/` 按模块分,谁能引谁见 `tests/layers.test.ts` 的 `ALLOW`:底层 `schema/`(契约,zod,类型即文档;落盘的形状与文件布局也在这)与 `shared/`(没有业务归属的小函数);再上一层是画面引擎 `chalk/`(课包的骨架、时钟、擦掉与换画板、圈住了什么、烤好的画面怎么逐笔画、字母笔顺 `glyphs/`;只能在浏览器里跑的在 `ui/stage/chalk/`,做课包的命令 `cotutor chalk` 在 `app/cli/chalk/`),板书、运行层、页面、命令都能引它;中间 `brain/` 脑、`realtime/` 嘴、`board/` 板书与卡、`memory/` vault、`media/` 配音画图认图(每种一家),彼此不引;`scenes/` 场景的规则与存取(只引 board);`runtime/` 教学运行层,只有它把这些串起来(runner、上下文包 `context/`、交付 `delivery/`、运行记录 `journal/`、实时通话 `live/`、首页 `home/`);`ui/` 页面(孩子 `kid/`、家长 `parent/`、工作台 `dev/`、舞台 `stage/`、场景页 `talk/` `dictation/`、几页共用 `shared/`);`app/` 入口(命令 `cli/`、HTTP `http/`、WS `ws/`、`mock/`、机器级配置 `machine/`、场景的路由 `talk/` `dictation/`、技能里机器生成的那几篇 `skills/`)。`src/lib/index.ts` 只给 npm 的 `./lib` 出口转发几样纯函数
- `src/brain/` 脑执行(`BrainExecutor`:定这一轮怎么跑、请老师、读输出,收尾给整轮转录),runner 只经它请老师;运行时只有 `{api: "bailian", model}` 一种,应用直连百炼(`api.ts`,AI SDK;只读工具在 `api-tools.ts`,话题的模型历史在 `<日期>.<话题>.brain.jsonl`,拼回去时结束的轮瘦身(不带思考、工具往返成一句、照片只附最近那组),上一轮上下文过 32k 就整段压缩(前情 `src/runtime/context/thread-digest.ts` 照索引拼,不调模型);`.log` 落一行一条统一事件(`types.ts`)。2026-11-02 起不再起 Qwen Code:旧 cotutor.json 里的 `{run, resume}` 读得进来、用不了(`runtime.ts`),那时的 `.log` 是 stream-json,`log.ts` 两种行都读)
- 老师牌上常驻的三块方砖(预习、检查作业、复习):表在 `src/schema/config.ts` 的 `HOME_TILES`(id 记在 `via.button`),cotutor.json 的 `tiles` 只记关掉的;服务端照老师家里有没有那个 activity 文件给(`src/runtime/home/`),图在 `src/ui/kid/home-tiles.ts`,样式在 `cards/tutor/card.css`。「检查作业」2026-11-03 以前叫「批改」:旧名经 `src/runtime/activities.ts` 的 `ACTIVITY_RENAMES` 照样认,upgrade 挪文件
- `src/board/` 板书:正文解析 `parse.ts`(第一个 H2 起的尾巴 `sections.ts`),卡的注册表 `cards/`(一种卡一个文件;协议文档在包根 `cards/<kind>/`),孩子端板上的节 `presentation.ts`(内联进页面)
- 你说我画的画图卡在后台画:场景的规则在 `src/scenes/paint/`(拼提示词、哪几幅、落盘到卡的资产目录、下发时补画好没有),百炼文生图的请求在 `src/media/draw.ts`(同步接口);runner 一轮跑完起它、把画一张的函数交进去(场景不引 media),app 的孩子 / 家长那天接一行
- `src/ui/stage/` 舞台包(React,esbuild 打到 `dist/stage/`);路由在 `src/app/http/app.ts`,页面在 `src/ui/<端>/`,地址按端分:孩子端 `/`、`/dictation`、`/talk`(孩子拍口语单,交给英语老师的实时页);家长端都在 `/parent` 下(记录 `/parent`、设首页 `/parent/home`、设置 `/parent/settings`、打印二维码 `/parent/qr`、听写 `/parent/dictation`;扫码打开、头像与声音在家长端首页,工作台不重复;`cotutor serve` 只打印家长端首页的地址);工作台都在 `/dev` 下。录像里孩子的屏幕(`/reel`、`/dictation?reel=`)与家长「首页」里的预览(`/preview`)是孩子端页面本身,只开在家长端的 iframe 里;孩子端页面的源码里不出现 `/parent`;家长端「记录」是自己的一页(`src/ui/parent/parent-page.ts`,录像开 `/reel` 的 iframe),几页共用的 `$` / `h` / `toast` / `api` 在 `src/ui/shared/page-dom.ts`;家长端与工作台的锁在 `src/app/http/access.ts`(机器级 PIN,`cotutor pin`;没设就全开;孩子端新加的路径要在那里的白名单登记,`tests/access.test.ts` 盯着)
- realtime 那条线:有脸的老师都走它。嘴在 `src/realtime/`(百炼 realtime 客户端 `bailian.ts`、开口指令 `cues.ts`、一直听时这句收不收 `listen.ts`);实时老师的一次通话在 `src/runtime/live/call.ts`(孩子端的协议、嘴的连接、一直听、热身、边画边聊),交给脑在 `turns.ts`;交付在 `src/runtime/delivery/`(`delivery.ts`:嘴的声音排到哪、第几句开始放、打断听到第几句;照念排队 `queue.ts`);录像记录 `CallRecorder`、嘴这一道的事件与字幕重放的声音在 `src/runtime/journal/`(`recorder.ts`、`mouth.ts`);孩子端采音放音的内联源 `src/ui/kid/audio-client.ts`;WS `/api/live/<老师>/ws` 在 `src/app/ws/`(零依赖 WebSocket 服务端 `ws.ts`),serve.ts 的 upgrade 接一行;孩子端发一条只走这条连接(HTTP 的发 2026-11-04 删了),验与拼在 `runner.accept`(`src/runtime/kid-input.ts`);测试照这条路发用 `tests/_kid-send.ts`(经 `Turns`,少的只有嘴),探针用 `scripts/_live-send.mjs`;`cotutor send`、工作台、`replay`、`activity eval` 发的孩子的话也照实时写(`live: {}`,没有嘴),只有系统发的(`--from system`、记账)不是;板上只有实时一种画法(以前的话题也这样画)。百炼(按量 key + 业务空间 id)是机器级的 `~/.config/cotutor/bailian.json`,家长端「首页」里填(`src/app/machine/bailian.ts`);没配孩子端只出「老师们还没到」
- 场景(口语课、听写)分三处,cotutor 只在 app.ts 接一行:路由在 `src/app/<场景>/`,页面在 `src/ui/<场景>/`,规则与存取在 `src/scenes/<场景>/`(不引 media 与厂商实现,看图的请求 `src/media/vision.ts` 由路由那层交进去)。口语课(孩子 `/talk`:拍一页、老师读出口语单、孩子改,交给英语老师的实时页跑 activity「口语课」;`src/runtime/talk-run.ts` 只读 `talk/<id>/talk.json`);听写(`/dictation`:从首页的 `dictation` 卡点进来,所以多了卡的注册、kid-page 画卡、mock 接一行;老师卡上常驻「拍照听写」,照片交百炼视觉模型流式认词;英文单词听写是另一页 `/dictation?lang=en`(四线三格,不逐字母比);比对照搬 hanzi-writer 的一笔像不像(`src/scenes/dictation/match.ts`),改它先过 `tests/dictation.test.ts`,页面走 `scripts/probe-dictation.mjs` 与 `probe-dictation-en.mjs`)
- `tests/` 一文件一子进程,零依赖 `check()`;假老师 `_fake-teacher.ts`(API 运行时 + 假百炼,按关键词回)、假配音 `_fake-tts.ts` 让全流程不花钱;`fixtures/board/` 真跑样本

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 跨目录的 import 由 `tests/layers.test.ts` 盯着:模块之间谁能引谁在它的 `ALLOW`;`LEGACY`(「模块 → 被引的文件」的旧账)已经清空,不再加;内联进页面的文件运行时只能从别的内联文件拿值
- 改了 `cards/` 下的 md、`src/app/skills/*-doc.ts` 跑 `pnpm run gen:skills`(不跑 skills.test 会红);改了 `src/ui/stage/` 跑 `pnpm run build:stage`(dist 不在 git,没打包时舞台开不了)
- 改解析器或卡先过 `tests/board.test.ts`;改页面模板后 mock.test 兜「内联脚本能解析」、page-names.test 兜「没有找不到的名字」;改 `src/brain/` 先过 `tests/brain-api.test.ts`(假百炼 `tests/_fake-bailian-chat.ts`,`COTUTOR_BRAIN_ENDPOINT` 指过去)与 `tests/stream-json.test.ts`(读旧轮次的日志);改口语课(`src/*/talk/`)或实时那条线(`src/realtime/`、`src/runtime/live/`、`src/runtime/delivery/`、`src/app/ws/`)先过 `tests/talk*.test.ts` 与 `tests/live*.test.ts`(假百炼 `tests/_fake-realtime.ts`),口语课页走 `scripts/probe-talk-page.mjs`;实时老师页走 `scripts/probe-live-page.mjs`(假百炼 + 假老师 + 无头 Chrome 假麦克风),Safari 走 `probe-live-webkit.mjs`,整条线真跑走 `probe-live-call.mjs`
- 改 activity 文件或 `src/runtime/activity.ts` 先过 `tests/activity.test.ts`(出厂那份画家的画风要和 `PAINT_PROMPT_DEFAULT` 一字不差),workspace 里的跑 `cotutor activity check`
- 改工作台(`src/app/http/dev-*.ts`、`src/ui/dev/`)先过 `tests/dev-overview.test.ts`、`tests/dev-activities.test.ts` 与 `tests/dev-tutor-files.test.ts`,颜色只用 `dev-theme.ts` 的变量;页面走 `scripts/probe-dev.mjs`(只看不改)
- 改孩子端流水(页面脚本 `src/ui/kid/kid-log.ts`、收与存 `src/runtime/journal/kid-log.ts`、`src/schema/kid-device.ts`)先过 `tests/kid-log.test.ts` 与 `tests/dev-overview.test.ts`;新加孩子端页面要带 `KID_LOG_JS`(kid-log.test 的 PAGES 里登记);页面走 `scripts/probe-kid-log.mjs`(会写流水与设备表,拿试用 workspace)
- 改画板(`src/board/canvas-chat.ts`、`src/ui/stage/canvas.tsx`、`src/board/paper.ts`、`call.ts` 的边画边聊、kid-page 的「画板」)先过 `tests/canvas-chat.test.ts` 与 `tests/live-canvas.test.ts`;页面走 `scripts/probe-paper.mjs`(先起 `cotutor mock --http`,探针交掉 mock 里那张画板卡,再跑要重起 mock)
- 改画面引擎 `src/chalk/` 先过 `tests/chalk-*.test.ts`(烤好的画面、圈住了什么、擦掉与换画板、字母笔顺),改做课包的命令 `src/app/cli/chalk/` 或舞台的 `src/ui/stage/chalk/` 再拿年级包的例子真跑一遍 `cotutor chalk build / bake / snap`(要本机的 Chrome;烤出的 bake.json 和入库的那份该一字不差)
- 改 `src/scenes/paint/`、`src/media/draw.ts` 或画图卡先过 `tests/paint.test.ts`(假百炼、假老师全流程),页面走 `scripts/probe-paint.mjs`;真画按张计费
- 改孩子端播放(嘴、卡的声音、孩子谁打断谁)先在 `tests/live-player.test.ts` 明确预期,再改 `runtime/delivery/player.ts` 的 `liveStep`;页面只 `liveDispatch`。板上的节(铺、写完、撤掉)是 `board/presentation.ts` 的 `step`,对 `tests/player.test.ts`,页面只 `dispatch`
- 后台服务 `cotutor service`(`src/app/cli/service.ts`):macOS launchd、Linux systemd 用户服务,Windows 是 Run 注册表项 + wscript 跑的隐藏启动器 + 看护进程(`service-windows.ts`,为什么不用计划任务、`conhost --headless` 写在它开头);服务里的 serve 带 `--log-dir`,输出按天落文件(`serve-log.ts`);有通话或老师在写时拦闲置睡眠(`serve.ts` 的 `holdAwake`)。改了先过 `tests/service.test.ts`(假 launchctl / systemctl / reg);真装拿临时 workspace 换个端口试,试完 uninstall,别给真孩子的 workspace 装
- 写进服务文件和登录项的 node 走 `stableNode`:Homebrew 的 `process.execPath` 带版本号,`brew upgrade` 后服务和图标都起不来,没人报警
- 第一次 `service install` 打开一次家长端(`opensAfterInstall`,`--no-open` 不开),别的启动都不开:登录、崩溃重起、升级都不是人要看页面。agent 走 `--no-open`,装完再 `cotutor open`
- 托盘图标 `cotutor tray`(`src/app/cli/tray.ts`):node 进程(`cotutor tray run`,bin 直接走轻入口 `tray-run.ts`,不带 zod,`tests/tray.test.ts` 盯着)判断状态、发通知;显示脚本(`tray-mac.ts` 的 JXA、`tray-windows.ts` 的 PowerShell)只管画和回报点击,协议一行一条 JSON。改了先过 `tests/tray.test.ts`,显示脚本要在真系统里看;真装服务时不想带图标加 `--no-tray`
- 端口(`src/app/cli/port.ts`)与地址(`serve.ts` 的 `computerName`、`siteUrl`):改了先过 `tests/port.test.ts`
- 新版本提醒(`src/app/machine/update.ts`、比较与升级步骤 `src/shared/upgrade.ts`):服务每天问一次 npm 的 `latest`,存 `~/.config/cotutor/update.json`,经 `/api/health` 的 `latest`、`latestNotes` 给托盘菜单、家长端首页、`service status`;从仓库跑的不问;不自动升级。升级是 `cotutor update`(`src/app/cli/update-cmd.ts`):换完程序只用子进程跑新的 bin,这个文件别改成动态 import。改了先过 `tests/update.test.ts`、`tests/update-cmd.test.ts` 与 `tests/tray.test.ts`
- 百炼跑起来以后的故障(`src/app/machine/bailian.ts` 的 `note` / `trouble` / `blocked` / `recheck`):嘴连不上(`mouthHealth`)、脑的请求失败记下,经 `/api/health` 的 `bailianTrouble` 给图标、家长端、`service status`、`doctor`;要家长动手的类别让孩子端首页 `ready` 变 false。WebSocket 看不到握手被拒的状态码,`askRealtime` 用普通 HTTPS 问错误码。欠费没法真测,照官方错误码表写。改了先过 `tests/bailian-trouble.test.ts`
- 改 `cotutor doctor`、`service status --json` 或安装流程先过 `tests/init-doctor.test.ts`、`tests/service.test.ts` 与 `tests/install-doc.test.ts`,照着改 `INSTALL.md`。doctor 不过的项要么有 `cmd`(agent 直接跑:幂等、不碰孩子的数据、不用人输东西),要么由 `finish` 标 `human`
- 发版:先写 `CHANGELOG.md` 和 `package.json` 的 `releaseNotes`(家长在提示条上看到的就是它,随 npm 下发;`tests/update.test.ts` 盯着两边一致)。账号开了发布 2FA,验证码 30 秒失效,所以先跑完 `prepublishOnly` 里的检查,再由人在自己的终端跑 `npm publish --ignore-scripts`。npm 回 `202` 后要扫描,公开前 `npm view` 查不到这个版本(0.4.0 等了约 26 分钟),要轮询;`INSTALL.md` 里新的命令和字段等 npm 公开后再推 main,因为推上去就生效
- 冒烟:`init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live` → `serve`;真跑老师 `cotutor send`;不花钱看前端 `cotutor mock`(老师都走实时老师页,假嘴念静音的声音;`--scenario nokey` 看没配百炼)
- 页面里的 JS 有两个 CDP 探针进了 `pnpm test`(`tests/probe.test.ts` 起 `probe-layout`、`probe-play`,走 mock;要本机 Chrome,没有就跳过;`COTUTOR_SKIP_PROBES=1` 跳过),改 `kid-page.ts` 先看它们红不红;其余手动验收走 `scripts/probe-*.mjs`(CDP);舞台里的东西用 CDP 驱动;截图也走 CDP(`Page.captureScreenshot`),孩子端、工作台在轮询,无头 Chrome 的 `--screenshot` 会挂;手机尺寸要 `--force-device-scale-factor=2 --window-size=780,1688`;探针不出声:起 Chrome 加 `QUIET_ARGS`(`scripts/_quiet.mjs`,`--mute-audio`;页面不用浏览器合成声,mock 里卡的配音也是静音),要听加 `COTUTOR_PROBE_SOUND=1`

## 坑(不可推导的)

- 页面模板是模板字符串:反斜杠写 `\\n`,正则里 `\/` 写 `\\/`,吃掉一层那行就成了注释而脚本照样能解析
- serve 只热重载 cotutor.json;改 `src/` 要重起。装成后台服务的(`cotutor service`)用 `cotutor service restart`:它跑的是 install 那一刻写死的 node 与 bin,换了 Node 版本要再 install
- 提交按文件名 stage,仓里常有并行的未提交改动
- 舞台页(`/stage/`)也装孩子端的 `theme.css`:舞台里自己的类名要带前缀(`lc-` 这种),撞上 `.pen` `.c` 之类会被那边的样式改掉(`.pen` 关着 pointer-events,圈不上)
- Windows 的 PowerShell 缺省策略拦 `npm`、`cotutor` 的 `.ps1`(开发机上的账户可能改过策略,看不出来),给家长看的命令要带 `.cmd`(`upgradeSteps`);cmd.exe 不展开 `doctor` 的 `cmd` 里的 `$HOME`,会建出一个字面叫 `$HOME` 的文件夹。在那边跑脚本:PowerShell 5.1 读无 BOM 的中文脚本会解析错;调原生程序时吃掉参数里的双引号,要试 Git Bash 就写成 `.sh` 文件
- Windows 上 node 的非 detached 子进程在「父进程退出就杀」的 job 里(libuv):命令行起完就退的,子进程要 `detached: true`(配 `windowsHide`,不然有窗口)。不报错,退出码也是 0;验证要看对面真收到了,常驻进程里试不出来(`openCommand`)
- Windows 上 `os.homedir()` 读 `USERPROFILE`,只设 `HOME` 隔离不住,测试会写进真的用户目录。`tests/_check.ts` 让它跟着 `HOME` 走,所有测试都要经过它;在别的机器上跑测试、脚本前先确认写到哪
- 别的程序只占着 `127.0.0.1:<端口>` 时,绑 `0.0.0.0:<端口>` 照样成功(macOS、Windows 都这样),光试绑看不出被占,要先连一下(`port.ts` 的 `answersLocally`)
- JXA(macOS 的显示脚本):`$.NSAttributedString.alloc.initWithStringAttributes` 不存在,要 `NSMutableAttributedString.alloc.init` 再填;枚举常量取不到值,写数字;返回整数的方法给的是字符串(`a.runModal` 是 `"1001"`),比较前要 `Number()`;回调里的异常被吞掉,不报错也不动作;菜单项标号别用 0(别的行缺省是 0)
- 探针模拟手指用 CDP `Input.dispatchMouseEvent`,别用 `dispatchEvent`:后者直接派到元素上,不走命中判定,盖住了、pointer-events 关了都照样过
- 课包的画面是 build 后烤好的(`bake.json`),孩子端不跑 excalidraw 也没有 SMIL;改了画面要重烤(`cotutor chalk bake`,snap 顺手烤,要本机的 Chrome),不然孩子端在浏览器里现烤、服务端后台补烤
- Safari 才有的毛病拿 Playwright 的 WebKit 复现(`scripts/probe-lecture-webkit.mjs`,本仓不装 playwright,借一份)
- 百炼 realtime:`turn_detection.silence_duration_ms` 喂过音频就改不了(切 null 再切回也回缺省 800),要不同的 silence 就另开会话;端点用业务空间 id 的域名,公网域名连上 1 秒就断;300 秒没输入就关,只 append 不 clear 会报 `response_idle_timeout` 而连接不断(死会话),心跳要 append 完马上 clear(`scripts/probe-live-idle.mjs`);`semantic_vad` 听不见一两个词的回答(好的、Yes,问过也一样),`server_vad` 听得见但「嗯」、笑声也算开口(`scripts/probe-live-vad.mjs context / noise`);Node 的 WebSocket 客户端握手被拒只发 error 不发 close,`close()` 后服务端那头要 5–10 秒才回;CDP 的鼠标事件派不到视口外的元素,先 `scrollIntoView`

## 约定

- 一孩一 workspace 一 vault 一服务进程;`agents/<name>/` 是老师的家(activity 在里面)
- 出厂件(老师文件、主题、技能)拷贝不链;workspace 里唯一的链是 `.claude/skills → ../.agents/skills`;hash 记 shipped.json,upgrade 只换没改过的、改过的报 diff;`machine: true` 的技能每次覆盖
- 老师按 cotutor.json 里有谁走,没有注册表;键以 `-tutor` 结尾的是有脸的老师,其余是工具人
- 老师文件里只有运行字段与正文;display / avatar / voice / enabled / policy / runtime 在 cotutor.json
- 老师的正文就是板书:普通行 = 讲稿一句,围栏 = 卡,第一个 H2 起是给家长的尾巴;解析器永不抛
- 老师不派子代理、不互相交活(自己派会烧光自己的预算)
- 孩子端永远没有错误与评判;卡上不画对错;答案下发前剥掉
- 卡的状态是孩子的,存服务端;vault 是家长的,老师(LLM)不直接写,回结构化段由应用落盘
- 历史不迁移:话题只能在开它的那种运行时下接着聊、记账;换过运行时就当那个话题已经结束——接着说开新话题、不记账(家长端说为什么),记录照样能看,不导入、不转换(`sameRuntime`)。以后换脑、换 SDK 编码同此
- workspace 解析链 `--workspace` > `COTUTOR_WORKSPACE` > cwd 祖先 > `~/.config/cotutor/config.json` > `~/cotutor/` 唯一目录;init 幂等补缺,已有文件不动
- 手动试功能用 sandbox(`--sandbox`,`src/app/cli/sandbox.ts`):从真 workspace 分到旁边的 `.sandbox/<目录名>/`,设置照拷、状态不带(`SANDBOX_SKIP`)、外面的 vault 拷一份,标题带「试用」、端口 +1;写数据的代码不认 sandbox,它就是另一个 workspace。新加孩子的状态目录要进 `SANDBOX_SKIP`,不然会被拷进 sandbox
- 证书是机器级的,`~/.config/cotutor/certs/`
- 端口只在 `cotutor init` 选一次写进 cotutor.json,以后不变:443 优先,再 8443、8445…,系统不让用或被占就看下一个,别的孩子的连同 sandbox 都让开;sandbox 恒为 +1。运行时被占只报错说是谁占着,不自动换:平板的主屏幕图标和本地设置都绑在「协议 + 主机 + 端口」上。schema 的 `DEFAULT_PORT`(5180)只给没写端口的旧配置,不跟着改。地址认电脑名(macOS 的本地主机名),IP 变了不用重签;二维码、证书、serve 都从 `computerName` 拿
- 千问 key 是机器级的,只认 `~/.config/cotutor/bailian.json`(百炼按量 + 业务空间 id,家长端写)与 `token-plan.json`(开发机才有);环境变量、qwen、voxtell 的配置都不读(`src/shared/qianwen.ts`)。测试要 key 往临时 HOME 写假文件(`tests/_keys.ts`),要真效果就用真的家

## 实时对话的核心约束

- realtime 模型负责听说,脑(应用直连百炼)生成讲稿和卡。嘴按句照念脑的讲稿,不另编教学内容;画板上的边画边聊由独立的有限上下文处理。
- 孩子开口或发出新一轮时,中断旧播放并使旧轮的延迟结果失效,不能把上一轮语音接到下一轮。队列与取消逻辑在 `src/runtime/live/call.ts`、`src/runtime/delivery/queue.ts`。
- 嘴、卡片配音和小课堂的声音互斥;暂停、恢复和打断统一经 `liveDispatch` / `liveStep`,页面不私自改播放状态。板书状态由 `board/presentation.ts` 的 `step` 管。
- 按句交付讲稿,卡片就绪后按顺序展示;问答、口语课热身和交卡的等待时机以 `tests/live-player.test.ts`、`tests/live-flow.test.ts` 与 `tests/player.test.ts` 为准。
