# cotutor

本文件给开发本仓库的 agent;在家长的电脑上安装 cotutor 看 `INSTALL.md`。

家里的 AI 老师团,和家长一起教。画面引擎(原来的旁仓 drawtell)在 `src/chalk/`(命令 `cotutor chalk`),配音(原来的 voxtell)在 `src/media/tts.ts`。

本文件写仓库结构、开发方式与当前约束,每个会话都整篇读,所以只放哪一块都用得上的;一块自己的细节在 `docs/dev/`,动手前读对应那篇(下面「动哪一块先读哪篇」)。历史讨论看 git log。Codex 直接读本文件,Claude Code 经 `CLAUDE.md` 的 `@AGENTS.md` 引入;改规矩只改这里和 `docs/dev/`,一条规矩只写一处。

- 使用、配置与开发启动见 `README.md`;iPad 真机见 `docs/iPad与iPhone.md`。
- `docs/` 根下七篇给家长和写提示词的人:设备使用、日常使用、老师与配置、vault、提示词、年级教学包和词表(README 只走家长装起来的主线,细节在这几篇);`docs/dev/` 给开发 agent,一块一篇,写现在是什么样、不写怎么变成这样的。根目录的 `INSTALL.md` 给替家长安装的 agent 看,随 npm 包发,`cotutor guide`(`src/app/cli/guide.ts`)原样打印,README 给家长的那句就是叫助手跑 `npx cotutor@latest guide`(不用输网址、走 npm 能换国内镜像、和装上的版本对得上);`tests/install-doc.test.ts` 盯着里面的命令、旗标和字段。契约以 `src/schema/` 为准,具体行为以实现和测试为准。
- 改 `grades/`、`skills/`、`cards/` 下的 md 先看 `docs/写提示词.md`;自造的词查 `docs/词表.md`。年级教学包的来源、旧版迁移和贡献要求见 `docs/年级教学包.md`。
- 草稿与随手记放 `docs/wip/`(gitignore)。已有的 `docs/archive/` 是本机材料;清理正式文档时不删除这些未入库文件。过时的正式文档直接删除,历史由 Git 保存。

## 目录

- `grades/grade-<n>/agents/<老师>/activities/<名>.md` 出厂 activity(孩子从首页一个按钮进去的一种做法):一节一个读者,「老师怎么带」就是这个话题老师的整份系统提示(人设、`第一句:`、`收:` 都在里面);一科通用的做法是其中「### <科>这一科」那一节,这位老师的每个 activity 里一字不差(`tests/activity.test.ts` 盯着)。init 拷进 workspace 的 `agents/<老师>/activities/`(老师的家),hash 记 `.cotutor/shipped.json`;形状在 `src/schema/activity.ts`,解析与检查在 `src/runtime/activity.ts`;文件写法在 `docs/写提示词.md`。老师文件(`agents/<老师>.md`)不出厂、不读;旧 workspace 里的不删,refresh 与 doctor 的 `tutor.files` 提一句(`src/app/cli/tutors.ts` 的 `retiredTutorFiles`)
- `skills/<name>/` 出厂技能:cotutor-tutor(老师们共同的守则,应用注入上下文包)、cotutor-analyze、cotutor-tune、cotutor-home(家长在 workspace 里排首页,references 里有 `cards/*/card.md`);init 拷进 workspace 的 `.agents/skills/`(Codex、Qwen Code 认这里),`.claude/skills` 是链到它的(Claude Code 只认那里);不再出厂的机器件列在 `src/app/cli/skills.ts` 的 `RETIRED_SKILLS`,refresh 时删
- `cards/<kind>/` 首页两种牌(老师牌 `tutor`、听写牌 `dictation`)的协议:`card.md` 八栏(例子即测试)+ `card.css`;`cards/动作怎么写.md` 是给老师的讲稿与动作写法(进系统提示)
- `themes/default/` 出厂主题:`theme.json` 槽表、`kid.css`
- `avatars/` 出厂头像,跟着包走、不拷进 workspace
- `src/` 按模块分,谁能引谁见 `tests/layers.test.ts` 的 `ALLOW`:底层 `schema/`(契约,zod,类型即文档;落盘的形状与文件布局也在这)与 `shared/`(没有业务归属的小函数);再上一层是画面引擎 `chalk/`(课包的骨架、时钟、擦掉与换画板、圈住了什么、烤好的画面怎么逐笔画、字母笔顺 `glyphs/`;只能在浏览器里跑的在 `ui/stage/chalk/`,做课包的命令 `cotutor chalk` 在 `app/cli/chalk/`),板书、运行层、页面、命令都能引它;中间 `brain/` 脑、`realtime/` 嘴、`board/` 讲稿、一节课与首页的牌、`memory/` vault、`media/` 配音认图(每种一家),彼此不引;`scenes/` 场景的规则与存取(只引 board);`runtime/` 教学运行层,只有它把这些串起来(runner、上下文包 `context/`、交付 `delivery/`、运行记录 `journal/`、实时通话 `live/`、首页 `home/`);`ui/` 页面(孩子 `kid/`、家长 `parent/`、工作台 `dev/`、舞台 `stage/`、场景页 `dictation/`、几页共用 `shared/`);`app/` 入口(命令 `cli/`、HTTP `http/`、WS `ws/`、`mock/`、机器级配置 `machine/`、场景的路由 `dictation/`、技能里机器生成的那几篇 `skills/`)。`src/lib/index.ts` 只给 npm 的 `./lib` 出口转发几样纯函数
- `src/board/` 讲稿与一节课:正文解析 `parse.ts`(讲稿与动作;第一个 H2 起的尾巴 `sections.ts`;首页文件的牌 `parseHomeBody`),首页牌的注册表 `cards/`(一种一个文件;协议文档在包根 `cards/<kind>/`),孩子端板上的节 `presentation.ts`(只剩骨架与输入条,内联进页面)
- `tests/` 一文件一子进程,零依赖 `check()`;假老师 `_fake-teacher.ts`(API 运行时 + 假百炼,按关键词回)、假配音 `_fake-tts.ts` 让全流程不花钱;`fixtures/board/` 真跑样本

## 动哪一块先读哪篇

每篇里有这一块的结构、规矩、坑和「改之前先过」哪些测试、走哪个探针。

| 动什么 | 代码主要在 | 先读 |
| --- | --- | --- |
| 讲稿里的动作 `[[ ]]`、一节课的状态、白纸条与上面的图形、收笔、上下文包的 `board:` | `src/board/`、`src/schema/lesson.ts`、`src/runtime/context/`、`src/runtime/live/pen.ts`、kid-page 的 `LS` | `docs/dev/一节课.md`(讲稿怎么解析也在这篇) |
| 课本(PDF 的文字层、索引、课本页的舞台、窗图) | `src/memory/textbook-*.ts`、`src/chalk/kit/book.ts`、`src/ui/stage/book.tsx` | `docs/dev/课本.md` |
| 照片页、照片上认字词 | `src/chalk/kit/photo.ts`、`src/scenes/photo-words/`、kid-page 的 `BP` | `docs/dev/照片页.md` |
| 小课堂、课包、画面引擎 | `src/chalk/`、`src/app/cli/chalk/`、`src/ui/stage/chalk/`、`src/ui/stage/lecture.tsx` | `docs/dev/小课堂与课包.md` |
| 嘴、通话、交付与播放、请他说、嘴先答、一直听 | `src/realtime/`、`src/runtime/live/`、`src/runtime/delivery/`、`src/app/ws/`、`src/board/echo.ts` | `docs/dev/实时通话.md`(核心约束在本文件末尾) |
| 脑 | `src/brain/` | `docs/dev/脑.md` |
| 首页「今天」、方砖、首页的牌、头像与声音、听写 | `src/runtime/home/`、`src/runtime/kid-view.ts`、`cards/`、`src/scenes/dictation/` | `docs/dev/首页与听写.md`;加一种牌看 `docs/dev/首页的牌.md` |
| 页面地址与家长端的锁、工作台、孩子端流水、离线页、录像、CDP 探针 | `src/app/http/`、`src/ui/` | `docs/dev/页面.md` |
| 后台服务、托盘图标、端口与证书、doctor 与安装、升级与发版、百炼故障、备份、诊断信息、Windows 与 JXA 的坑 | `src/app/cli/`、`src/app/machine/` | `docs/dev/安装与机器.md` |

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- `pnpm test` 几个文件一起跑(缺省 4 个,`COTUTOR_TEST_JOBS=<n>` 改,1 = 串行);`pnpm test <名字里的一段>...` 只跑那几个。占固定端口、断言选中哪个端口、掐真时间的测试要进 `scripts/test.ts` 的 `ALONE`(排在最后单独跑),别的测试里端口一律 `listen(0)`
- 跨目录的 import 由 `tests/layers.test.ts` 盯着:模块之间谁能引谁在它的 `ALLOW`;`LEGACY`(「模块 → 被引的文件」的旧账)已经清空,不再加;内联进页面的文件运行时只能从别的内联文件拿值
- 命令行照命令表走(`src/app/cli/commands.ts`:每条命令的一句话、用法、旗标与只给哪个子命令、参数个数、会花钱或写孩子数据的、例子)。顶层帮助、`cotutor <命令> --help`、技能里的命令参考、参数检查都从它来:不认的旗标、用错子命令的旗标、多余的参数一律 exit 2,一句话加「看 cotutor <命令> --help」,不倒整篇帮助。加命令或旗标先进表(不然被当成打错的拦掉),再跑 `pnpm run gen:skills`,先过 `tests/main.test.ts`(代码读的旗标都在表里、例子照表能过)与 `tests/install-doc.test.ts`
- 改了 `cards/` 下的 md、`src/app/skills/*-doc.ts` 跑 `pnpm run gen:skills`(不跑 skills.test 会红);改了 `src/ui/stage/` 跑 `pnpm run build:stage`(dist 不在 git,没打包时舞台开不了)
- 改解析器或首页的牌先过 `tests/board.test.ts` 与 `tests/cards.test.ts`;改页面模板后 mock.test 兜「内联脚本能解析」、page-names.test 兜「没有找不到的名字」
- 改 activity 文件或 `src/runtime/activity.ts` 先过 `tests/activity.test.ts`,workspace 里的跑 `cotutor activity check`
- 冒烟:`init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live` → `serve`;真跑老师 `cotutor send`;不花钱看前端 `cotutor mock`(老师都走实时老师页,假嘴念静音的声音;`--scenario nokey` 看没配百炼)
- 页面里的 JS 有两个 CDP 探针进了 `pnpm test`(`tests/probe.test.ts`,走 mock;要本机 Chrome,没有就跳过;`COTUTOR_SKIP_PROBES=1` 跳过),改 `kid-page.ts` 先看它们红不红;其余手动验收走 `scripts/probe-*.mjs`,怎么起 Chrome、截图、不出声见 `docs/dev/页面.md`

## 坑(不可推导的)

- 页面模板是模板字符串:反斜杠写 `\\n`,正则里 `\/` 写 `\\/`,吃掉一层那行就成了注释而脚本照样能解析
- serve 只热重载 cotutor.json;改 `src/` 要重起。装成后台服务的(`cotutor service`)用 `cotutor service restart`:它跑的是 install 那一刻写死的 node 与 bin,换了 Node 版本要再 install
- 提交按文件名 stage,仓里常有并行的未提交改动
- 舞台包(`dist/stage/`)打包时把 excalidraw 编进去、字体拷进 `dist/stage/fonts/`;excalidraw、react、react-dom 在 devDependencies,运行时不要(smoke 盯着)。新加只在打包时用的依赖也放 devDependencies
- 探针模拟手指用 CDP `Input.dispatchMouseEvent`,别用 `dispatchEvent`(不走命中判定);别的页面与探针的坑见 `docs/dev/页面.md`,Windows、端口、JXA 的见 `docs/dev/安装与机器.md`,百炼 realtime 的见 `docs/dev/实时通话.md`

## 约定

- 一孩一 workspace 一 vault 一服务进程;`agents/<name>/` 是老师的家(activity 在里面,老师怎么教只写在 activity 里)
- vault 和 workspace 分开放:init 缺省建在旁边的 `<目录名>-vault/`,`--vault` 指家长已有的库,写进 `paths.vault`(家目录下写 `~/…`);谁也不能在谁里面、不能和别的孩子共用,init 拦着(`checkVaultPlace`)。旧版没写 `paths.vault` 的 vault 就是根,照旧读、不迁移,doctor 的 `vault.separate` 提一句;sandbox 的 vault 拷在它里面的 `vault/`,不查
- 出厂件(activity、主题、技能)拷贝不链;workspace 里唯一的链是 `.claude/skills → ../.agents/skills`;hash 记 shipped.json,refresh 只换没改过的、改过的报 diff;`machine: true` 的技能每次覆盖
- 老师按 cotutor.json 里有谁走,没有注册表;里面的都是老师(没有工具人,名字结尾没有含义),孩子端露不露看 `enabled` 与 `hidden`
- display / description / avatar / voice / enabled / hidden / policy / runtime 在 cotutor.json;怎么教在 activity 里
- 话题都从一个 activity 开始(孩子端的按钮、方砖、小课堂;`cotutor send --activity`;工作台选 activity)。不带 activity 的只有系统任务(记账、整理),系统提示一句人设。一位老师的记忆:新记的进那个 activity 那篇,这位老师自己那篇(以前普通话题记的)每个 activity 都带、只读
- 老师的回复就是讲稿:普通行 = 讲稿一句,`[[ ]]` = 对页做的动作,围栏不上页,第一个 H2 起是给家长的尾巴;解析器永不抛
- 每个代码文件开头一段注释,只写现在的样子:这个文件是什么、谁用、推不出来的原因和实测(实测带日期)。不记改动(「从哪拆出来」「哪天起」),删掉的功能不留说明,旧数据还在读的写一句「读进来就丢」;只引仓库里有的文档;协议表、路由表留在头注释里,`docs/dev/` 指过去、不抄
- 老师不派子代理、不互相交活(自己派会烧光自己的预算)
- 孩子端永远没有错误与评判;页上不画对错;不下发的(听写的字、按钮的讲法)下发前剥掉
- 一节课的状态是孩子的,存服务端;vault 是家长的,老师(LLM)不直接写,回结构化段由应用落盘
- 历史不迁移:话题只能在开它的那种运行时下接着聊、记账;换过运行时就当那个话题已经结束——接着说开新话题、不记账(家长端说为什么),记录照样能看,不导入、不转换(`sameRuntime`)。以后换脑、换 SDK 编码同此
- workspace 解析链 `--workspace` > `COTUTOR_WORKSPACE` > cwd 祖先 > `~/.config/cotutor/config.json` > `~/cotutor/` 唯一目录;init 幂等补缺,已有文件不动
- 手动试功能用 sandbox(`--sandbox`,`src/app/cli/sandbox.ts`):从真 workspace 分到旁边的 `.sandbox/<目录名>/`,设置照拷、状态不带(`SANDBOX_SKIP`)、外面的 vault 拷一份,标题带「试用」、端口 +1;写数据的代码不认 sandbox,它就是另一个 workspace。新加孩子的状态目录要进 `SANDBOX_SKIP`,不然会被拷进 sandbox
- 证书、端口是机器级的事,选一次不再变(平板的主屏幕图标和本地设置都绑在「协议 + 主机 + 端口」上),细节见 `docs/dev/安装与机器.md`
- 千问 key 是机器级的,只认 `~/.config/cotutor/bailian.json`(百炼按量 + 业务空间 id,家长端写)与 `token-plan.json`(开发机才有);环境变量、qwen、voxtell 的配置都不读(`src/shared/qianwen.ts`)。测试要 key 往临时 HOME 写假文件(`tests/_keys.ts`),要真效果就用真的家

## 删掉的功能与旧数据

删掉的功能整条线删干净,不留休眠的代码;它留下的旧数据读进来就丢或不显示,不报错、不迁移,别为它把代码加回来。现在还认着的旧东西只有这些(细节在对应的 `docs/dev/` 那篇):

- 老师文件 `agents/<老师>.md`:不读,refresh 与 doctor 提一句;不再出厂的技能列在 `RETIRED_SKILLS`,refresh 时删
- activity 头上的 `board: page`、`cards:`、话题第一条的 `board: 'page'`:读进来就丢
- 课里的卡(围栏、教具卡、课本卡、小课堂卡):不上页,以前记录里的不再显示
- 讲稿里的 `[[play]]` `[[echo]]` `[[say]]`:不认,丢掉记一行
- activity 旧名「批改」:经 `ACTIVITY_RENAMES` 照样认
- 旧运行时 `{run, resume}`(Qwen Code):读得进来、用不了;那时的 `.log` 是 stream-json,`log.ts` 两种行都读
- 口语课场景:`talk/` 下以前的口语单照片不再读
- 没写 `paths.vault` 的 workspace、没写端口的旧配置:照旧读

## 实时对话的核心约束

- realtime 模型负责听说,脑(应用直连百炼)生成讲稿和动作。嘴按句照念脑的讲稿。谁先答照 activity 头上的 `reply:` 走,代码不照学科分:脑先答的(缺省)嘴不另编教学内容,只接住、照念;嘴先答的(`reply: mouth`)只在脑给的范围里回应——脑一轮最后那句问话和 `[[请 说 …]]` 要他说的那一句,说中了接一句、没说中提示一下(`cues.ts` 的 `replyCue`),答不了的(说了别的、连着两次没说中、说中了这一步就完了)交给脑,嘴说过的下一轮带给脑(`live.mouth`)。
- 孩子开口或发出新一轮时,中断旧播放并使旧轮的延迟结果失效,不能把上一轮语音接到下一轮。队列与取消逻辑在 `src/runtime/live/call.ts`、`src/runtime/delivery/queue.ts`。
- 嘴、小课堂那一段和重放的声音互斥;暂停、恢复和打断统一经 `liveDispatch` / `liveStep`,页面不私自改播放状态。板上的节由 `board/presentation.ts` 的 `step` 管。
- 按句交付讲稿,每句的动作念完才落到页上;问答、请他说([[请 说 …]])和「给老师看」的等待时机以 `tests/live-player.test.ts`、`tests/live-flow.test.ts` 与 `tests/player.test.ts` 为准。
