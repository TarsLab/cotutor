---
name: cotutor-analyze
description: 在 cotutor workspace 里分析 AI 老师的对话:某一轮传了什么上下文、读了什么文件、为什么没看见档案或日记里的某句、改了老师文件 / 技能 / vault 之后回放对照、一天的费用与延迟。家长或开发者在 workspace 根开 Claude Code 问「老师为什么…」「这轮读了什么」「我改了 X 效果如何」「今天花了多少」时用。
---

# 分析老师的对话

你在一个 cotutor workspace 的根目录(有 cotutor.json)。这里的数据是孩子和 AI 老师的对话记录,你的活是**看**和**解释**,不是改。

## 先知道的几件事

- 一轮 = 一条消息 + 老师的回答。文件都在 conversations/<老师>/,按 <日期>.<job>.* 命名(job 形如 1620-1);索引 <日期>.json 一天一份,每条消息物化了讲稿与卡、读了什么(tools)、用时(timing)、费用、后期、提醒。命名表与各文件是什么在 references/命令与文件.md。
- **老师看到的只有两样**:上下文包(run.json 的 prompt:当前学期、档案与入口文件的原文、参考路径、本周计划、最近 14 天日记的观察行、课程表时段、vault 路径、孩子上一轮在卡上做的、这条的照片)和它自己 Read 的文件(消息的 tools)。它看不到 cotutor.json、看不到别的老师、看不到今天之前的对话——只有 vault 里沉淀过的。
- 回答「老师为什么没提 X」的顺序:先 show 看那轮的上下文包里有没有 X;没有就 pack 干跑看现在会不会有、来源里那一段是「读不到」还是「截掉」;有的话看 tools 它有没有去读、读到多少字;都有就是模型没用上,去看老师文件里那条规则怎么写的。
- .claude/agents/ 里的老师文件是给 cotutor 起 claude -p 用的,**不要把它们当子代理派(Task)**,也不要替老师回答孩子。
- **不改** conversations/、evals/、ledger/ 里的任何文件;**不写 vault**(日记、档案、计划、教材)——那是家长的长期记忆,要改也是家长自己动手。改老师文件 / 技能 / cotutor.json 要先说清改什么、为什么、会影响哪些老师,得到同意再动。

## 工具箱(都在 workspace 根跑,精确用法在 references/命令与文件.md)

| 想知道 | 跑 | 花钱 |
|---|---|---|
| 某一轮的全部:问句、上下文包、当时的老师文件与技能 hash、讲稿、卡、读了什么、费用、用时、给家长的尾巴 | cotutor show <老师> <job> <日期>(--json 是全量) | 不 |
| 现在发这句话老师会看到什么、每段从哪个文件来、那里共几条、截了几条 | cotutor pack <老师> "<消息>" [--from kid] [--at 时间] | 不 |
| 一轮每道工序的时刻:首卡、每句配音、每拍后期、就绪 | cotutor trace <老师> <job> <日期> [--lane main,tts,post] | 不 |
| 改了老师文件 / 技能 / vault,**同一问答案怎么变** | cotutor replay <老师> <job> <日期>,跑完并排打印;cotutor compare <老师> [evalJob] <日期> 再看或列 | **是**,一轮老师的钱(几分到两毛美元),**跑前先问** |
| 回放那轮自己的全部 | cotutor show <老师> <evalJob> <日期> --evals | 不 |
| workspace 哪里坏了(路径、证书、技能、配置缺口) | cotutor doctor | 不(--live 花一分钱) |

一天的费用与延迟不用命令:读 conversations/<老师>/<日期>.json,每条的 costUsd 与 timing(从 startedAt 起算的毫秒:firstReadyMs 首拍就绪、doneMs 老师写完、dubbedMs 配音齐、postMs 后期完),顶层 costUsd 是这天合计。

## 常见问题怎么查

1. **「老师为什么没看见档案 / 入口文件里那句」**:show 看 prompt 末尾的 <vault-note>。那轮是续聊、YAML 里写「未变」= 原文在这个话题的第一条,去看第一条。不在就 pack 看来源——「没有 cotutor: profile 的笔记」「没有 subject / semester 的入口文件」= 属性没写或写错(学期按档案 school_start 算,subject 要和 cotutor.json 里这位老师的 subject 一字不差);「截到 N」= 被 policyDefaults.contextPack.entryChars 截了,长的挪到别的笔记、入口文件里链过去。
2. **「老师为什么不知道上周的观察」**:recent 段只抽最近 14 天日记里 H2 学科匹配的「- 观察:」行。pack 的来源会说有几天的日记、这学科几条。日记的 H2 得是「## 数学 · 话题名」这种,「- 观察:」是行首。
3. **「这轮读了什么、贵在哪」**:show 的「读了什么」,每条有字数;贵的一般是子代理、读了大文件、或轮数多。真要看它读到的原文,grep 那轮的 .log。
4. **「我改了老师文件,效果?」**:先 show 看原轮的老师文件 hash,再 replay 一次(先问),看 notes 里 hash 变没变、讲稿与卡的 diff。同一问不改任何东西回放两次也会有差异(模型抖动),别把一次的差异当结论,拿不准就再回放一次。
5. **「我改了 vault,效果?」**:pack 干跑就够,不用花钱:上下文包变了什么就是效果。要看老师会不会因此说得不一样再 replay。
6. **「板书后期为什么没标 / 排错了」**:show 的「后期」一行与 .post.json 每拍的 prompt / raw / dropped;调后期的提示词与评测在 cotutor 仓库里(themes/<主题>/post.md 与 post-eval),不在 workspace。

## 报告怎么写

先一句结论,再给证据(引 run.json 的 prompt、tools 里的那条、索引里的字段,带文件名),最后给改法并标清改哪个文件、要不要花钱、会影响哪几位老师。老师的回答是教学,好坏最终由家长判断;你给的是「它看见了什么、没看见什么、为什么」。
