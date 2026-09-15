/** 命令用法(cotutor --help;技能 cotutor-analyze 的 references/命令与文件.md 从这里取分析用的那几行,所以放单独文件,别的模块 import 不会跑到 CLI) */
export const USAGE = `用法:
  cotutor init <slug> [--dir <path>] [--name <孩子名>] [--port <n>]   建 ~/cotutor/<slug>/ 骨架(幂等补缺)
  cotutor doctor [--workspace <dir>] [--json] [--live]                 逐项体检;--live 真起一次老师与配音(花一分钱)把 API 层的坑摆出来
  cotutor upgrade [--workspace <dir>] [--force <老师>]...                老师文件与 skill 换新版:没改过的直接换,改过的只报 diff(--force 才覆盖,原文留 .bak)
  cotutor upgrade --config [--dry-run] [--workspace <dir>]              cotutor.json 补缺:新出厂老师 / 运行时 / 命令模板旗标(只加缺的,你改过的值不动)
  cotutor add <老师名> --display <显示名> [--subject <学科>] [--avatar <emoji>] [--hidden]   加一位自家的老师:出模板文件、进 cotutor.json、建目录
  cotutor add-theme <主题名> [--from <主题>] [--workspace <dir>]       加一个自家的主题:拷一份(缺省出厂的 default)到 themes/<主题名>/,改 cotutor.json 的 kid.theme 换过去
  cotutor serve [--workspace <dir>] [--port <n>] [--http] [--trace]     起服务(一 workspace 一进程;~/.config/cotutor/certs/ 有证书就走 HTTPS;--trace 每一轮的事件按道打印)
  cotutor cert [--host <名或IP>]...                                      用 mkcert 建这台机器的自签证书到 ~/.config/cotutor/certs/(iPad / iPhone 上录音要 HTTPS;所有 workspace 共用)
  cotutor send <老师> <消息> [--from parent|kid|system] [--runtime <名>] [--new] [--lane main,tts,post] [--quiet]   终端里发一条,现场按道打印每道工序的事件,说完打印结果(与页面同一条路;--new 开新话题;--quiet 只要结果)
  cotutor pack <老师> [<消息>] [--from kid|parent|system] [--at <ISO时间>] [--json]   干跑上下文包:不起模型,打印现在会发给老师的那份 + 每段来自哪个文件、那里一共几条、按政策带了几条(改了档案 / 日记 / 计划立刻看效果)
  cotutor replay <老师> <job> [<日期>] [--runtime <名>] [--post] [--json]   回放一轮:同一问按现在的 vault 与提示词再跑一遍(落 evals/,不进孩子的对话、不配音、后期缺省关),跑完并排打印上下文包 / 讲稿 / 卡 / 读了什么的 diff
  cotutor compare <老师> [<evalJob>] [<日期>] [--json]                   再看一次回放的对照(不给 evalJob 就列这天回放过哪些)
  cotutor show <老师> <job> [<日期>] [--json] [--evals] [--workspace <dir>]   看一轮:问了什么、上下文包、当时的老师文件与技能 hash、讲稿与卡、读了什么、费用与用时、给家长的尾巴;--json 是家长端「看原文」同一份数据,给 Claude Code 分析用
  cotutor trace <老师> <job> [<日期>] [--lane …] [--workspace <dir>]     回放一轮的事件(<日期>.<job>.events.jsonl;排查昨天那轮用)
  cotutor rate <老师> <话题> <1-5> [--date <日期>]                       给一个话题打星(与家长端同一条路;≥ vault.keepScore 的话题记账时摘要才进日记)
  cotutor bookkeep <老师> [--date <日期>] [--thread <话题>]...           记账:这天每个还没记过的话题各起一轮记账任务,老师回「## 记账」,应用写进 vault 的日记(话题名、孩子问、摘要、观察)
  cotutor mock [--port <n>] [--scenario normal|limit|offline|nopost] [--delay <ms>] [--http]   不经真实老师与配音,用固定的板书 JSON 起孩子端,测前端交互与渲染(不需要 workspace;nopost = 没有后期的素版)
  cotutor repost <老师> [<日期>] [--job <job>] [--workspace <dir>]      板书后期再做一次:老师原文重解 → 快模型重新划重点 / 排版 / 定样子 → 改写索引(老师原文与配音不动;调提示词时旧板书全部能重来)
  cotutor --version | --help
workspace解析:--workspace > COTUTOR_WORKSPACE > cwd 或祖先有 cotutor.json > ~/.config/cotutor/config.json > ~/cotutor/ 下唯一的孩子目录
`;
