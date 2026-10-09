# cotutor agent 层设计

> 范围:agent 层的概念,即目录、上下文、记忆、子代理、跨 agent 的知识流动;**不涉及 drawtell**。前提来自《产品规划.md》:老师 = 可直接对话的老师文件 + 自己的对话;两个 CLI 并行支持(claude / qwen)。本文先把「记忆」这个词拆干净,因为它对应几个不同的东西,混用会把设计做歪。
> **不设记忆的写入纪律**:孩子的这些数据都是学习数据、都是本地文件,不做隐私与评判方面的约束;本文只讲东西放哪、怎么流,不讲不许写什么。
> **一个 workspace 一个孩子**:`~/cotutor/<slug>/` 一孩一 workspace 一 vault 一服务进程;老师的记忆、账本、计划天然按孩子分,不再有孩子维度;跨孩子共享靠拷贝技能。

## 1. 三种「记忆」,三个归属(核心)

| 名 | 装什么 | 谁写 | 谁读 | 真相在哪 |
|---|---|---|---|---|
| **长期记忆(vault)** | 关于孩子与这个家的**事实**:档案、入口文件、日记(孩子问的话、打分够的摘要、观察)、教材与口径、计划 | 家长手写;机器只按封闭清单写(日记追加;记忆增改删),且老师不直接写——回「## 记账」「## 记忆」段,应用落盘(《obsidian仓库设计.md》§6) | 所有老师(话题第一条带档案、入口文件原文;每轮带 plan / recent;讲解前 Read 教材那一节、Grep 日记)、家长 | 文件形状由 lib/diary.ts 保证 |
| **产物账本(ledger)** | 课包等产物的索引与费用 | 应用(追加式;老 workspace 里有 scene-maker 记的行) | 应用、家长端 | artifacts.jsonl 契约 |
| **老师记忆** | 老师自己记下的:讲法偏好、孩子的习惯、上次做到哪 | 老师回「## 记忆」段(增 / 改 / 删),应用落盘;记账后每位老师再整理一轮 | 写它的那位老师(话题第一条带原文)、家长 | vault `记忆/<显示名>.md`(`cotutor: memory` + `agent:`),家长可改可删;**不用** CLI 自带记忆(《obsidian仓库设计.md》§8) |
| **会话记忆** | 当天这一段对话 | CLI | 该话题 `--resume` | 转录 NDJSON 落 `conversations/`;按天切,跨天不 resume |

三条约定(讲归属,不讲禁令):

1. **要给别的老师看的,进日记(记账段的 observations)。** 日记是所有 agent 都读的地方(上下文包的 recent 从它抽);记忆文件里的东西只有写它的那位老师下次会带上。
2. **记忆也是 vault 里的一篇。** 家长在 Obsidian 里改、删、分小节,下个话题生效。
3. **谁写谁是真相**(《obsidian仓库设计.md》):vault 是长期记忆,workspace 是运行记录(对话、课包、照片、产物账本);机器写 vault 只新建或追加、永不改家长的字;唯一的例外是记忆文件,整篇都可以由机器增改删(家长在 Obsidian 里兜底)。

## 2. 目录

```
~/cotutor/<slug>/                        一个孩子一个 workspace;git 仓(私有);slug 是短名不是真名
  cotutor.json                           老师人设与政策、运行时({run, resume} 模板)、paths 角色映射(vault 侧目录)
  CLAUDE.md   QWEN.md                    可选:家长自建的共同规矩(不出厂)
  .claude/agents/<name>.md               老师与帮手的定义(**拷贝**自 cotutor 包的出厂件,是家长的)
  .cotutor/shipped.json                  出厂 hash(机器文件),cotutor upgrade 据此分辨没改过 / 改过
  .claude/skills/                        技能(拷贝;`machine: true` 的每次覆盖)
  .qwen/agents/  .qwen/skills/           指向 .claude/ 下同名文件的相对链(一份真相两处可见)
  agents/<name>/                         老师的家 = 会话 cwd
  ledger/artifacts.jsonl                 产物索引:谁、何时、出了什么、状态、费用
  captures/                              应用拍的作业照片(vault 里只存老师认出的文字)
  conversations/<name>/<日期>.*          对话索引(session id、话题、打星 ratings、记过 booked、费用)+ 转录 NDJSON

vault(家长面,**一个孩子一个 vault**,如 ray-vault,自己是 git 仓;文件按 frontmatter `cotutor:` 找,《obsidian仓库设计.md》§2):profile.md 档案、课程/<学期>/<学科>.md 入口文件、教材/、记忆/<显示名>.md、日记/<日期>.md、计划/<周>.md、参考/
```

**cwd 取老师目录,不取根**。理由:agents / skills 向上都找得到;会话按老师归档;老师产的文件落自己目录不串门。

**多孩子 = 多套 workspace**:每套一个服务进程、一个端口;孩子设备各指各的,家长设备切实例;老师文件从出厂件各拷一次,不共享记忆与账本;跨孩子共享做成一个拷贝技能,拷贝不链接。

**老师与工具人同住 `.claude/agents/`,按 `cotutor.json` 里有谁走**:键以 `-tutor` 结尾的是有脸的老师,其余是工具人(出厂没有了,画图老师 2026-10-07 删了,拍板 13)。

## 3. 上下文:一条消息进来时老师看到什么

| 层 | 内容 | 谁给 | 每条消息付费? |
|---|---|---|---|
| 常驻 | agent 正文(系统提示)+ 预载 skill + 当天会话历史 | CLI | 是 |
| 注入 | **上下文包**:时段、学期、正开着的卡、本周计划中与本老师相关的行、最近 N 条本学科观察;话题第一条另带老师守则(`<cotutor-rules>`,有脸的老师才有)与档案、入口文件、记忆的原文(`<vault-note>`) | 应用拼成固定格式(YAML 块)放在消息前 | 是,但可控 |
| 按需 | 账本全量、vault 日记、教材、`refs:` 里的链接 | 老师自己 Read | 用到才付 |

**老师文件只写人设与这一科的做法,公共守则在机器技能 cotutor-tutor**:老师文件拷进 workspace 就归家长,改过一个字 upgrade 就不再换,公共规矩写在那里修不到每一家;守则放机器技能每次 upgrade 覆盖,由应用在话题第一条原文注入(不靠老师自己 Read,也不依赖哪个 CLI 支持预载 skill)。老师文件里学科一节的做法优先于守则,只有守则末尾「不变的规矩」改不了。

原则:**常驻小、注入准、按需大**。对话按天切是给「会话历史」一个上界;`--resume` 每次重放整段(缓存命中便宜但仍计),所以上下文包只放这条消息用得着的。N 与计划行数是政策旋钮(`contextPack`)。

## 4. 子代理

**老师不派子代理、不互相交活**(自己派会烧光自己的预算;claude 会把 `.claude/agents/` 里的老师文件当可派的子代理,普通老师的运行时模板用工具白名单 `--tools {tools}`(填 `Bash,Read,Grep,Glob`,名单里没有 Agent;孩子说的话填空,一个工具都不带,《工作流程.md》拍板 12),见拍板 12)。老师要一堂画出来的课,在给家长的尾巴里写 `## 想要小课堂`,家长在 workspace 里做(拍板 13)。

## 5. 记忆的维护

**不设写入纪律**但有**写入前三问**(《obsidian仓库设计.md》§0):一年后家长还想翻到它吗、老师下次讲同类东西需要吗、能不能机械取出来——过不了的留在 workspace,不进 vault。

- **记账段格式**:老师回「## 记账」(thread / name / textbook / summary / steps / observations),应用渲染成日记的一段:H2 = 学科 · 话题名,孩子问的话是 callout,`- 观察:` 一行一条。形状由代码保证,老师写错了应用报 warning、不落。
- **记忆段格式**:老师在任何一轮末尾写「## 记忆」(一行一条:`- …` 新增、`- 改:原话 → 新的`、`- 删:原话`),孩子看不到;应用按原话找行改删、新增加日期去重追加,讲课的轮每轮最多 2 条;落进 `记忆/<显示名>.md`,按 `entryChars` 截末尾带回。
- **记忆整理**:记账跑完,有记忆的老师各起一轮整理(新会话,带记忆原文与今天的日记路径),回一串增改删,不限条数、整理完不超过 30 条,直接落盘不问家长。
- **时间与纠错**:日记按天,观察行在哪天的哪个话题下就是日期与学科;错了家长在 Obsidian 里改一句、删一行,下一轮上下文包就变。
- **触发**:记账在**学习结束后由家长触发**,不自动跑。家长先给话题打星,再点「记账」(或 `cotutor bookkeep`):这天每个还没记过、有孩子的话或打了分的话题,各 resume 那位老师一轮,消息是「给刚才这个话题记账」;老师只回「## 记账」段。打分 ≥ `vault.keepScore` 的话题才沉淀摘要与讲解骨架,孩子问的话与观察总是记。
- **周汇总**:不另设周记;周计划家长自己写。
- **家长入口**:日记、档案、记忆文件都在 Obsidian 里直接改。

## 6. 运行时与适配器

老师进程是一个本地的 agent CLI(claude、qwen……):能读写本地文件、能接着一个会话往下说、能把回复一个字一个字吐出来。cotutor 不直接调模型 API,换 CLI 就是换运行时。

两层分开:

| | 装什么 | 在哪 | 谁改 |
|---|---|---|---|
| **运行时模板** | 选哪个 CLI、哪个模型、预算与时限、递板书写法的旗标 | `cotutor.json` 的 `runtimes`(`{run, resume}` 两条命令,占位符见 `src/schema/config.ts`) | 家长、开发者,改数据不改代码 |
| **CLI 适配器** | 这个 CLI 怎么说话:输出流怎么读、消息怎么写进 stdin、工具叫什么、工具怎么关、思考量怎么调、环境变量要什么、出厂模板长什么样 | `src/clis/<cli>.ts`,一个 CLI 一个文件 | 开发者,接一个新 CLI 写一个文件 |

- **找适配器**:运行时写了 `cli` 就按它,没写就按 `run[0]` 的文件名(`claude`、`qwen`)。套了一层壳脚本的运行时要写 `cli`。
- **统一事件**:适配器把 CLI 的输出行读成同一套事件——一个字(增量)、一段整的正文、开始新的一条、工具调用、工具结果、会话 id、收尾(成没成、费用或 token)。孩子端的流式出卡、断流看门狗、家长端的「读了什么」、费用都只认这套事件,不认哪家的 JSON。
- **工具按类别认**:应用要知道「读了哪个文件」「用没用 Skill 回读板书写法」时问适配器这是哪一类(读文件 / shell / 搜索 / 技能 / 别的),不比工具名。
- **`{tools}` 由适配器展开**:政策 `tools` 只说带不带(孩子的话缺省不带;带照片的、记账的带只读的几样),展开成什么旗标、几个参数,是适配器的事。
- **`{effort}` 由适配器落地**:claude 是 `--effort`;qwen 没有这个旗标,适配器按 effort 给进程选一份配置文件(环境变量),见拍板 15。
- **费用可以没有**:有的 CLI 只报 token 不报钱。没有钱数的轮次记 token,家长端显示 token。

claude 与 qwen 的输出同族(Claude Code 的 stream-json),共用一个读法,各自的差别写在各自的文件里。接一个新 CLI 要满足的条件、怎么写适配器,见《接一个 CLI.md》。

## 7. 拍板记录

1. cwd 取老师目录,不取根(2026-09-08,约定)。
3. 记账在学习结束后由家长触发,不自动跑(2026-09-08;这条链在 ray 上还没真跑过一次)。
4. 不设记忆的写入纪律(2026-09-08)。
5. 一个 workspace 一个孩子(2026-09-08,约定)。
6. 老师文件拷贝不链(2026-09-09,约定):共享的是出厂件,拷进来就是这家的;升级靠 hash 分辨。
7. 删掉规划老师,周计划由家长写;跨老师只能走 vault 文件(2026-09-17)。
8. 有脸的老师共同的段落挪进机器技能 cotutor-tutor,应用在话题第一条注入上下文包;老师文件只留人设与学科(2026-09-18)。代价:改过老师文件的老 workspace 会同时有旧正文和守则,内容重复但不冲突,家长想清爽就 `cotutor upgrade --force <老师>`。
9. 朗读老师改成英语老师,键 `reading-tutor` → `english-tutor`(2026-09-18)。键是数据的钥匙(会话 cwd、对话目录、记忆笔记的 `agent:`、首页的 tutor 卡),老 workspace 由 `cotutor upgrade --config` 连设置带文件一起挪(`src/cli/rename.ts` 的改名表);要停服务,当天没聊完的旧话题续不上。
10. 板书技能预载进系统提示(2026-09-19;递法当天由第 11 条改写):普通老师的 claude 模板加 `--append-system-prompt-file`(run / resume 都带)。原来每个要讲解的话题老师都用 Skill 工具读一遍 cotutor-board,多一个模型来回,正文落在消息里、每个话题各写一遍缓存;追加进系统提示后它在「工具 → 系统」这段前缀里,同一位老师的各话题共享缓存。实测(claude 2.1.275,旗标相同的两组新会话):不追加时第二个新会话缓存读 23,120,追加后 26,886,多出的 3,766 就是整篇技能;frontmatter 的 `skills:` 对 `--agent` 主线程不生效。代价:随口问答的话题也带着这 3.8K(热的时候按缓存读计,约 0.1 倍价);qwen 没有对应旗标,守则里留了「不在才读」的退路;claude-scene 不带。老 workspace 由 `cotutor upgrade --config` 补旗标。
11. 板书写法由应用递给老师,递法按运行时分,老师不自查(2026-09-19)。起因:第 10 条上线当天实测,默认 effort 那次老师没再调 Skill,low / medium 两次照调——技能索引里 cotutor-board 的描述还写着「要出卡之前读一遍」,守则写的是「在系统提示里就照着写、不在才读」的条件句,三处文字打架,而且整套机制(Skill 工具、技能索引、追加系统提示的旗标)只有 claude 有。改成五条:
    - **内容一份**:板书写法仍由 `src/cards/docs.ts` 生成;各种卡的 references 照旧按需读(读文件哪个 CLI 都会)。
    - **递法看模板**:`{boardFile}`(SKILL.md 的绝对路径,claude 用 `--append-system-prompt-file`)或 `{systemBody}`(老师正文 + 板书写法,给只收一段系统提示文字的 CLI,出厂 qwen 模板用它)算预载;两个都没用的运行时(以后的 codex 之类),应用在话题第一条注入 `<cotutor-board>`,与守则同一套「未变」去重。头一版写死路径的模板也认作预载。
    - **应用说事实**:上下文包多一行 `boardGuide:`——「已在你的系统提示里」,或路径(原文就在下面);守则改成无条件的「应用已经递给你了,不要再去读」。
    - **拔掉竞争的触发点**:技能描述去掉「要出卡之前读一遍」;frontmatter 加 `disable-model-invocation: true`(只有 claude 认,别的 CLI 忽略;家长仍可手动调)。
    - **回归检查**:每轮跑完查工具调用,板书写法递到了手里还用 Skill / Read / cat 去读 SKILL.md 的,这轮挂一条提醒;`cotutor doctor` 的 `runtime.<名>.board` 说清每个运行时走哪条递法、run 与 resume 是否一致。
    顺带更正第 10 条里的一个理由:resume 的会话沿用它开始时记录的系统提示(官方文档 + 实测:resume 不带旗标,热缓存照样整段读中),run / resume 都带旗标不是为了「前缀对得上」,而是压缩之后系统提示按当时的旗标重建。所以改老师文件、改模板不会让当天旧话题的缓存失效,只是旧话题要到压缩或新话题才看到改动。
    没验证的:本机 qwen 0.21.13 的帮助里已经看不到 `--append-system-prompt` / `--yolo` / `--max-wall-time`,模板可能过时,要 `doctor --live` 在 qwen 上真跑一次才知道;codex 本机没装,「走话题第一条」是按它没有系统提示旗标推的。
12. 老师动笔前想多久做成政策 `effort`,普通老师的工具改白名单(2026-09-20)。起因:孩子端提问后要等 38–50 秒才有第一个字。9 月 18–19 日 23 轮真跑的事件与原始日志:配音加后期只占 2–3 秒,时间花在老师动笔之前——输出 token 的 60–95% 是思考(一轮 1000–1900 token),用工具的轮次 5–6 个来回,老师第 47 秒才动笔、2.6 秒写完。
    - **`policy.effort`**(low / medium / high,出厂缺省 low,数学老师 medium):三层覆盖同别的政策,填进运行时模板的 `{effort}`(claude 模板 `--effort {effort}`);模板里没有这个占位的运行时(qwen、claude-scene、claude-fast)不受影响。家长端老师团那页的政策里可改。真跑(临时副本,每轮换一个记忆里没有的字):low 把思考压到 0–70 token、来回变 2–3 个,首拍就绪 11–21 秒;数学两道题 low 与 medium 的第一节都对,14–16 秒。
    - **不用 `MAX_THINKING_TOKENS=0`**:更快(首拍 10.9 秒),但同日真跑里老师把盘算写进了讲稿第一句(「『桃』出现在课文里,但没在识字表……按"还没学到"讲,只认不逼写」,会念给孩子听),字源也开始编。后期那一路是一问一答的补丁,归零没事;老师不行。
    - **工具白名单**:`--tools Bash,Read,Grep,Glob` 取代 `--disallowedTools Agent`。黑名单只禁调用、工具定义照发,CLI 升版本还会带进新工具——2.1.275 真跑里老师去调了 `Artifact`、`ToolSearch`,每次白花一个来回。真机上老师实际只用过 Bash、Read(另有两次 Skill 正是不该发生的回读板书写法);Skill 不给,板书写法与守则由应用递,别的技能按路径 Read。Bash 留着:查教材、裁作业照片要它。收的是模板里的旗标(换 CLI 换模板),不是老师文件的 `tools` 字段。老 workspace 由 `upgrade --config` 补旗标;老的 `--disallowedTools Agent` 留着无害。
    - **试过没用的**(同日,已回滚):「先写后查」——让老师先写第一张卡再去查教材,并让那一拍当场关、当场播。守则里讲道理的写法 0/2 照做,把守则与老师文件译成英文也 0/2(还多出调 `Artifact` 的副作用);只有在老师文件里硬性规定「第一条消息不许只有工具调用」照做了 1/1。而不限思考时不用工具的轮次首卡也要 19.8 秒,这条路单独走到不了 10 秒级,先不做。
    没验证的:老 workspace 迁移只补旗标,不会给已有的数学老师条目加 `policy.effort: medium`,要家长自己在老师团那页选;老师动笔前偶尔还会调一次空操作 `Bash true`(白花约 3 秒),原因没查。
13. 删掉画图老师 scene-maker 与场景卡,讲解动画只走家长在幕后做的小课堂(2026-10-07)。起因:场景卡让孩子在板书前等一个现做的课包,几分钟、约一轮问答的 30 倍费用;ray 的 workspace 里它只做过一份(`2026-09-18-po13-jian-8`,后来成了小课堂的样本),jack 那边没有。课包与小课堂共用 `bundles/` 和烤好的画面,删的只是「老师现场叫人画」这条路。
    - **老师要图**:这一节照常用卡讲完,在给家长的尾巴里写 `## 想要小课堂`(`题面:` `讲法:`,原来场景卡上那两行)。不加新的固定段:尾巴本来就在家长端「给家长」里;cotutor-home 技能在对话索引的 `parentText` 里找。
    - **删的**:`agents/scene-maker.md`、场景卡全套(`src/cards/scene.ts`、`cards/scene/`、舞台的 `SceneStage`、`scene-props.ts`)、runner 的画图作业与收尾记账、`policy.scenes.dailyMax`、消息的 `scenes`、事件的 `scene` 道、`claude-scene` / `qwen-scene` 运行时模板、骨架的 `scenes/` `snaps/`。板书卡十一种。
    - **留的**:drawtell 的四个领域技能与 `.cotutor/drawtell` 壳(家长做课包用,壳和服务端烤画面是同一版 drawtell);`loadBundle` / `loadBaked` 挪到 `src/stage/bundle.ts`。
    - **老数据**:存下的场景卡下发孩子前退成一段字(老师那句),题面、讲法、课包 id 不下发;老 workspace 里的 `tutors.scene-maker`、它的老师文件、`scenes/` 没有代码再读,家长自己删。老师照旧写 ```` ```scene ```` 当代码卡原样显示。
    没验证的:真老师会不会写 `## 想要小课堂`、写得好不好,要真跑看;按天列出这些请求、做完划掉的界面没做。
14. 按老师配卡(2026-10-07):cotutor.json 老师条目加 `cards`,板书写法与守则只讲这位老师用得上的卡。起因:每位有脸的老师拿到的板书写法都是同一份 12.5 KB(删场景卡后 11 种),口播老师也读着选择题和作业照片;以后每加一种卡,每位老师的提示都变长。
    - **配在条目顶层,不在 `policy`**:政策是一层层盖的旋钮,卡的清单是这位老师教什么,数组也不好「在缺省上加一张」。
    - **只裁写法,解析器不动**:清单外的卡照常解析、照常显示,这轮记一条提醒。按老师裁的写法从包里现拼(和解析器同一版),写到 `.cotutor/board/<老师>-<hash>.md` 给 `{boardFile}`;hash 进文件名,改了清单预热进程自然作废。没写 `cards` = 全部、递出厂的 SKILL.md,老 workspace 不改也照旧。
    - **手写段落用守卫**:`{{有 x y}}` … `{{/有}}`(`src/lib/card-guards.ts`),板书写法里「能选配 choice、能填配 fill」那句、作业照片一节、作业上用画板那段,守则里小课堂那几段。「一节长什么样」的例子照常留。
    - **出厂清单**:数学 text choice fill image lecture canvas code;语文 text read choice fill image tianzige lecture canvas;英语 text read choice fill image word lecture;口播 text read record。按老师文件与学科估的,没有真跑数据;`cotutor upgrade --config` 给老 workspace 补。
    - **没做的**:按这一轮的上下文裁(有照片才给作业照片)——写法预载在系统提示里,预热在孩子开口前就起好进程,同一话题系统提示一变缓存也作废。给 `record` 设「配了 koubo 才给」的门——koubo 的评测模板有缺省值,从配置看不出能不能用。
    没验证的:裁了以后老师出卡的样子变没变,要 ray 的真跑;清单外的卡多不多,看提醒。
15. CLI 的差别收进适配器,接上 qwen code(2026-10-09)。起因:cotutor 要开源,开发者要能接各家 agent CLI;原来「认得某个 CLI」的知识散在十几个文件里(读输出流、写 stdin、工具名 `Read` / `Skill`、`--tools` 白名单、代理、嵌套变量、费用),而且都默认 claude 的 stream-json,qwen 碰巧同族才跑得通。改成一个 CLI 一个适配器(§6),先抽 claude、行为不变,再写 qwen。qwen code 0.25 的定法(同日真跑与读它的打包代码):
    - **不用 `--bare`,给 qwen 一个隔离的家**:`QWEN_HOME` 指 workspace 的 `.cotutor/qwen/home/`(不改 `HOME`),里面的 `settings.json` 由 cotutor 生成。`--bare` 虽快,但它不读任何配置(思考关不掉)、不认 `--core-tools`、自带 `read_file` `edit` `run_shell_command` 一套——9 日 A/B 真跑里 qwen 在「不带工具」的轮次照样跑 shell,整理记忆那轮用 `edit` 直接改了日记。隔离的家实测每轮 2.4–3.1 秒、约 2K 输入 token,与 `--bare` 一样快;原来测到的 7 秒、26K token 来自 `~/.qwen` 里装的东西。家里要关掉它自己的记忆整理(`memory.enableManagedAutoMemory: false`),不然一轮跑完它在后台用 `write_file` 写文件。
    - **工具**:不带 = `--core-tools read_file --exclude-tools read_file,<非核心工具>`(`system/init` 的工具表为空);只读 = `--core-tools read_file,glob,grep_search` 加 `--approval-mode default`(读 workspace 外、shell、写都被拒;`--yolo` 会放行 workspace 外的读,不用)。qwen 只读时没有 shell,要跑命令的老师(口播老师跑 koubo)在 qwen 上干不了活。每轮核对 `system/init` 的工具表,多出没想到的工具记提醒(CLI 升版本会带进新工具)。
    - **思考量**:`QWEN_CODE_SYSTEM_SETTINGS_PATH` 每次起进程时按 effort 指一份配置(`model.reasoningEffort`):low → none(不想)、medium → low、high → high。qwen3.7-plus 只有开关,low / medium 都是关;qwen3.8 系列分档。
    - **key 不落盘**:起 qwen 时 `DASHSCOPE_API_KEY` 先看环境变量,没有就从本机 `~/.qwen/settings.json` 的 `env` 现读,只放进子进程的环境;workspace 是 git 仓,key 永不写进去。
    - **消息走 stdin**(`--input-format stream-json`),新话题 `--session-id` 先给定 id,续话题 `--resume`。数组旗标(`--core-tools` 之类)会把跟在后面的消息吞掉,消息不进 argv 正好避开。
    - **收尾**:超时(退出码 55)不吐 `result`,当出错;每轮一条 `goal_state` 事件不管;使用统计默认发往阿里云,家里关掉。
    - **出厂缺省仍是 claude**,qwen 由家长在 `cotutor.json` 里给某位老师配。`.qwen/agents/`、`.qwen/skills/` 两套链退役:老师正文与板书写法由 `{systemBody}` 递,qwen 的 skill 工具不给。
    没验证的:qwen 的讲课质量(9 日 7 题回放里 qwen3.7-plus 把「明」讲成「名」,claude 没错);effort none 会不会像 claude 归零那样把盘算写进讲稿;关了工具后 qwen 偶尔在正文里写假的 `<tool_use>`,孩子端会不会念出来。
