# cotutor

家里的 AI 助教团队(应用仓,全新项目,2026-09-08 起)。设计文档在 `docs/`:《产品规划.md》(定位、两个端、回复形式阶梯、里程碑 R0–R8、拍板记录)、《agent层设计.md》(目录、三种记忆、子代理、规划老师)、《契约草案.md》(各文件形状,已逐条拍板;契约的真相是 `src/schema/`,它只剩「为什么」)。拍板都在那里;本文件只写这个仓怎么长的。草稿与随手记放 `docs/wip/`(gitignore,不入库)。底层工具 drawtell / voxtell 按 npm 版本依赖,不在本仓。

## 结构(单包,subpath export,同 drawtell)

- `agents/*.md` — **老师定义**(frontmatter 取两 CLI 公共子集:name / description / maxTurns / permissionMode / memory,正文即系统提示)。init 把它们链进 workspace;人设、政策、开关不在这里,在 workspace 的 cotutor.json
- `src/schema/` — **契约**(zod,类型即文档;`explainIssues` 把 issue 变修复指南):config(cotutor.json,含 agents / tts 预设与 server.https)、context-pack、conversation、ledger、sections(待裁量 / 转交)、plan、timetable
- `src/lib/` — **纯函数**(全部离屏可测):agent-file、sections、transcript(stream-json → 家长条目 + 最终文本,子代理事件标 sub)、kid-view(精简视图:只看最终文本、剥段、截断;`kidConversation` 把索引过滤成孩子端条目)、context-pack、plan、ledger、conversation、timetable(抄 growth-apps,孩子列可选)
- `src/lib/run-plan.ts` — 一次运行的命令规划:同预设有会话 → resume,否则新开;`{agentBody}` 只给模板里用到它的预设
- `src/cli/` — workspace(解析链 + 校验)、skeleton(骨架清单 + 模板,init 与 doctor 共用)、init、doctor、serve(certs/ 有证书就 HTTPS)、cert(mkcert 签到 certs/)、send(终端发一条,与页面同一条路)、main
- `src/server/` — app(路由 `route()`,配置按 mtime 热重载;`/api/kid/*` 是服务端过滤后的孩子视图)、runner(发消息:拼上下文包 → spawn / resume → 日志落盘 → 配音 → 索引物化;一老师同时一条,忙则 409)、tts(按 `tts.say` 预设合成 kidText 到 `<日期>.<job>.mp3`,失败不响)、store(索引 / 转录 / cotutor.json 补丁的文件层)、parent-page(家长端 `/parent`)、kid-page(孩子端 `/`:一周小路、老师头像、聊天窗、按住说话走浏览器识别)——两页都是内联脚本,只走 `/api/*`
- `tests/*.test.ts` — 每文件一子进程(`scripts/test.ts`),零依赖 `check()`;HOME 注入后动态 import 的手法同 drawtell。`tests/_fake-cli.ts` 是假 CLI(模仿 stream-json、认 `--resume`),`_fake-tts.ts` 是假配音命令,runner 全流程测试靠它们,不花钱

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 冒烟:`node bin/cotutor.js init <slug> --dir <tmp>` → `doctor --workspace <tmp>` → `serve --workspace <tmp>` → `curl /api/teachers?kid=1`;真跑老师:`cotutor send math-teacher "<消息>" --workspace <tmp>`(或页面 `/parent`)
- 在 Claude Code 会话里起 claude 子进程要 `env -u CLAUDECODE ...`(嵌套会拒);本机 claude 2.1.220 不认全局 settings 里的模型,预设模板加 `--model sonnet` 才能跑(模型旋钮本来就在模板里)
- voxtell 没发 npm、不在 PATH:冒烟时把 `tts.say[0..1]` 改成 `node ~/Projects/github-tarslab/voxtell/bin/voxtell.js`;iPad 真机要 `cotutor cert`(mkcert)+ 把根证书装到 iPad

## 约定

- **workspace 解析链**:`--workspace` > `COTUTOR_WORKSPACE` > cwd 或祖先有 cotutor.json > `~/.config/cotutor/config.json` > `~/cotutor/` 下唯一的孩子目录 > 报错附修复指南。没有 cwd 兜底,cotutor.json 是必需的政策文件;在但坏了响亮报错
- **init 幂等补缺**,已有文件一律不动;政策文件(cotutor.json)与家规(CLAUDE.md / QWEN.md)只在缺失时写模板
- **老师文件与 cotutor.json 的字段归属**:文件里只有运行字段 + 正文;display / avatar / voice / enabled / hidden / policy 全在 cotutor.json
- **精简视图是机械规则**:孩子只看 `result.result` 剥掉「## 待裁量」「## 转交」段之后的**最后一段**(空行分段;家规让老师把给孩子的话放最后一段),按 replyMaxChars 截断;这两种固定段只吃字段行,遇空行后不是字段行就结束(老师把给孩子的话放最后一段不会被吞)
- **账本追加式**,同 id 后者为准,retracted 用追加行;坏行 doctor 点行号,不删账本
- **会话索引物化**:`conversations/<老师>/<日期>.json` 每条消息带 kidText / holdup / handoff / agent(预设名)/ error,页面不解析日志;家长视图的转录行从 `.log` 现读(`foldRuns`,`sub` 行折成「子代理」)。换预设(agent 不同)→ 新开会话且索引里的 session 换成新的;跨天 → 新文件自然不 resume
- **孩子端永远没有错误与评判**:`/api/kid/*` 只给问句 / 回复 / 配音 / pending(出错的运行不出现,家长的问句不露),每日上限 `dailyMessages` 只数孩子发的,到了 429 且首页头像灰;页面上任何失败都只是「什么都不出现」或头像灰(后端不通 → `offline`),没有报错文案。识别在浏览器(webkitSpeechRecognition,没有就藏话筒),配音在服务端(没有退回 speechSynthesis)
- **cotutor.json 只在页面上改四个键**(title / policyDefaults / teachers / agents.default),补丁深合并到原始 JSON(保留 `_note`),整份过契约才落盘,null 删键;paths / 预设模板走编辑器。服务每个请求看 mtime 热重载,改坏了留旧配置、`/api/health` 报 configError
- 两 CLI(2026-09-08 实测):claude 用 `--agent` 让老师文件当主会话(链上的定义能被找到,`memory: project` 落在老师目录);qwen 0.21.13 **没有** `--agent`(Unknown argument),但 `--append-system-prompt` 有且生效、`--approval-mode yolo` / `--yolo` / `--max-wall-time` / `--resume` 都在,stream-json 事件带 `parent_tool_use_id`——老师正文由应用读文件填进预设占位 `{agentBody}`
