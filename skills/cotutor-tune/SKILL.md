---
name: cotutor-tune
description: 调 cotutor 的老师团:改某位老师的提示词(口气、规矩、学科做法)、改 vault 里给老师看的档案 / 日记 / 计划、加一位新老师、改政策与开关。家长或开发者在 workspace 根开 Claude Code 说「我想让数学老师…」「把孩子怕竖式记下来」「加一个英语老师」「老师话太多」时用。每一处改动先给 diff、点头才写,写完带着验效果。
---

# 调老师团

你在一个 cotutor workspace 的根目录(有 cotutor.json)。这里的活是**改**:老师文件、cotutor.json、vault 里给老师看的那几个文件。改之前要知道改哪、改完要验,能改的字段与缺省在 references/字段.md。看现状、查原因是另一个技能 cotutor-analyze 的活,需要就先用它。

## 铁律

- **每一处改动先给 diff,家长点头才写**;vault 是家长的长期记忆,一处一处确认,不批量。老师文件与 cotutor.json 一次可以改几处,但一样先给 diff。
- **改完必验**:改老师文件就 replay 一轮(花钱,先问);改 vault 就 pack 干跑(不花钱);加老师就 doctor 再 pack。没验的改动不算完。
- 不改 conversations/、evals/、ledger/;不碰 .cotutor/、.claude/skills/(机器件,upgrade 会覆盖)。
- 出厂老师的文件改过之后,cotutor upgrade 不再覆盖它、只报 diff——告诉家长这个代价;想回出厂的用 cotutor upgrade --force <老师>。
- .claude/agents/ 里的老师是给 cotutor 起 claude -p 用的,**不要把它们当子代理派**。

## 一、改某位老师的提示词

家长的话多半是「话太多」「别用竖式」「先问孩子怎么想」「口气凶」。路子:

1. 先看现状:cotutor show 家长提到的那轮(没提就看今天最近一轮),读老师文件 .claude/agents/<name>.md 找到管这件事的那一段。
2. 分清归属再动手:**口气、规矩、学科做法**在老师文件正文;**显示名、头像、音色、开关、每句字数、每日上限、板书开关、后期开关、运行时**在 cotutor.json 的 tutors.<name>(字段表见 references/字段.md);**关于孩子的事**不进老师文件,进 vault(第二节):所有老师都该知道的进档案,只关这一科这学期的(学到哪、还没学别用什么、家长的讲法偏好)进这位老师的入口文件。老师文件要通用,换个孩子、换个学期也能用。
3. 改法要小:改一句、加一条,不重写整段;frontmatter 五个键之外不加,name 不动;正文里已有的段落标题(看图 / 板书怎么写)别删,老师靠它们干活。
4. 给 diff,点头写入。
5. 验:cotutor replay <老师> <job> <日期>(先说明要花一轮老师的钱),看讲稿与卡的 diff 是不是想要的方向;模型本身有抖动,一次差异别下结论,拿不准再回放一次。改的是 cotutor.json 的字段就不用 replay,cotutor doctor 过、cotutor pack 看一眼就行。

## 二、改 vault 里给老师看的

老师不用工具就能看到的只有这几处,别的它看不见(形状在 cotutor-vault 技能的 SKILL.md,别重写)。vault 里的文件**按属性找,不认文件名与目录**:

- **档案**(frontmatter `cotutor: profile`,一个 vault 一篇):`school_start: YYYY-MM` 算当前学期(特殊情况写 `semester: 二年级上` 覆盖);整篇原文每个话题开头给每位老师。孩子是谁、怎么样、要避开什么,写这里。
- **入口文件**(`cotutor: subject`、`subject: <学科>`、`semester: <学期>`,一科一学期一篇,家长习惯放 `课程/<学期>/<学科>.md`):整篇原文每个话题开头给那一科的老师。这学期学到哪、常问什么、怎么讲他听得懂,写这里;长的资料另建笔记,在这里 `[[链过去]]`,老师只拿到路径。
- **记忆**(`cotutor: memory`、`agent: <老师名>`,缺省 `记忆/<显示名>.md`):老师自己写「## 记忆」段、应用追加的;原文每个话题开头给它自己。家长觉得哪条不对、过时,直接删改;要它以后照某个做法来,也可以手加一行。太长了(doctor 的 vault.memory 报)就帮家长合并、删旧的。
- **教材**(`cotutor: textbook` + 同样的 subject / semester):只给路径,老师要用时自己读。
- **日记的「- 观察:」行**(paths.diary,缺省 日记/<日期>.md):要在「## 学科 · 话题」那种 H2 下面,老师按学科认;最近 14 天、按 recent(缺省 10)取最新的。
- **本周计划**(paths.plans/<ISO 周>.md,如 2026-W38.md):H2 是老师的**显示名**,下面的行按 planLines(缺省 10)给那位老师。

程序读的属性键用英文,只给人看的用中文;学期写「二年级上 / 二年级寒假 / 二年级下 / 二年级暑假」。

路子:家长说的事归到上面哪一处 → 给出要加 / 改的那一行(照 cotutor-vault 里的形状)→ 点头写入 → cotutor pack <老师> "随便一句" 看那一行进没进上下文包,来源里有没有「截掉」;被截就商量是把长的挪出去链过去,还是调 contextPack 的上限(cotutor.json policyDefaults.contextPack.entryChars)。

vault 是 Obsidian 仓库,可能在 iCloud 里:只改文本,不加标签,不放图片;新学期的入口文件要新建(不改上学期的),属性写全。

## 三、加一位老师

1. 用 cotutor add <name> --display <显示名> --subject <学科> [--avatar emoji] [--hidden],不手建文件:它出模板、进 cotutor.json、建目录。name 小写英文加连字符,一旦定了不改。
2. subject 要和课程表的学科列、日记 H2 的学科、入口文件的 subject 属性**一个字不差**,不然观察归不到它、课程表命不中、入口文件找不到。建这一科这学期的入口文件(doctor 会说该叫什么、写什么属性)。
3. 模板正文照出厂老师改人设与学科做法(路子同第一节);hidden 是只和家长打交道的(规划老师那种),enabled: false 是先建好不上线;费用或时限要不一样的配自己的 runtime。
4. 验:cotutor doctor(它会查文件、目录、链),再 cotutor pack <name> "你好" 看它拿到的上下文包(学期、档案、入口文件、这学科的观察、计划里它那段)对不对;要试真回答就 cotutor send <name> "<一句>"(花钱,先问)。
5. 自家加的老师 upgrade 永远不碰;要删就在 cotutor.json 里删条目,文件改名留着。

## 报告怎么写

先说改了哪个文件的哪一处、为什么放那里(归属),再贴验证结果(pack 的来源行 / replay 的 diff / doctor 的那几项),最后说副作用:改了出厂老师 upgrade 只报 diff、改了档案所有老师都会看到、花了多少钱。
