# cotutor

家里的 AI 老师团,和家长一起教(应用仓,全新项目,2026-09-08 起)。设计文档在 `docs/`:《产品规划.md》(定位、两个端、回复形式阶梯、里程碑 R0–R8、拍板记录)、《agent层设计.md》(目录、三种记忆、子代理、规划老师)、《契约草案.md》(各文件形状,已逐条拍板;契约的真相是 `src/schema/`,它只剩「为什么」)。拍板都在那里;本文件只写这个仓怎么长的。草稿与随手记放 `docs/wip/`(gitignore,不入库)。底层工具 drawtell / voxtell 按 npm 版本依赖,不在本仓。

## 结构(单包,subpath export,同 drawtell)

- `agents/*.md` — **老师文件**(frontmatter 取两 CLI 公共子集:name / description / maxTurns / permissionMode / memory,正文即系统提示)。是出厂件:init **拷贝**进 workspace 的 `.claude/agents/`(2026-09-09 拍板,原为链),出厂 hash 记 `.cotutor/shipped.json`,`cotutor upgrade` 据此换新或报 diff(`src/cli/tutors.ts`);人设、政策、开关不在这里,在 workspace 的 cotutor.json
- `src/schema/` — **契约**(zod,类型即文档;`explainIssues` 把 issue 变修复指南):config(cotutor.json,含 runtimes / tts与 server.https,字段带 `.describe()`)、context-pack、conversation、ledger、sections(待裁量 / 转交)、plan、timetable、json-schema(`cotutorJsonSchema()` 从 zod 现生成,init / upgrade 写到 workspace 的 `.cotutor/cotutor.schema.json`,cotutor.json 首行 `$schema` 指过去)
- `src/lib/` — **纯函数**(全部离屏可测):agent-file、sections、transcript(stream-json → 家长条目 + 最终文本,子代理事件标 sub)、kid-view(孩子视图:只看最终文本、剥段、截断;`kidConversation` 把索引过滤成孩子端条目)、kid-board(板书的 JSON 契约 `BoardSection` + 孩子端全部交互逻辑:标注锚点、播放状态机、字幕行、输入条;**不能有运行时 import**,kid-page 把它剥掉类型内联进页面,两处一份源码)、context-pack、plan、ledger、conversation、timetable(抄 growth-apps,孩子列可选)
- `src/lib/run-plan.ts` — 一次运行的命令规划:同运行时有会话 → resume,否则新开;`{agentBody}` 只给模板里用到它的运行时
- `src/cli/` — workspace(解析链 + 校验)、skeleton(骨架清单 + 模板,init 与 doctor 共用)、tutors(老师文件拷贝 / 状态 / upgrade / add 模板 / 页面读写删)、init、doctor(`--live` 真起一次老师与配音,`explainLlmFailure` 把 API 层错误变修复指南;`env.nested` 认 CLAUDECODE)、upgrade、add、serve(机器级 `~/.config/cotutor/certs/` 有证书就 HTTPS,`server.https` 是单 workspace 例外)、cert(mkcert 签到 `~/.config/cotutor/certs/`,不需要 workspace)、send(终端发一条,与页面同一条路)、main
- `src/server/` — app(路由 `route()`,配置按 mtime 热重载;`/api/kid/*` 是服务端过滤后的孩子视图)、runner(发消息:拼上下文包 → spawn / resume → 日志落盘 → 配音 → 索引物化;一老师同时一条,忙则 409)、tts(按 `tts.say` 预设合成 kidText 到 `<日期>.<job>.mp3`,失败不响)、store(索引 / 转录 / cotutor.json 补丁的文件层)、parent-page(家长端 `/parent`:对话 / 老师团(人设、政策、老师文件正文、新老师、删自家老师)/ 设置(paths、端口、证书、配音命令))、kid-page(孩子端 `/`:首页 + 老师页 = 板书页,照豆包爱学:一轮一节、卡先铺、讲稿逐句播、笔跟声标注、末句问句停下出「继续」;输入条「相机 | 发消息或按住说话 | 加号」;平板横屏板书两列、没有左栏;`?tutor=x&step=节.句` 调试停在某句)、mock(`cotutor mock`:不经真实老师与配音的模拟接口,固定板书 JSON 脚本 + 浏览器合成声,场景 normal / limit / offline,测前端交互与渲染,不需要 workspace)——两页都是内联脚本,只走 `/api/*`
- `tests/*.test.ts` — 每文件一子进程(`scripts/test.ts`),零依赖 `check()`;HOME 注入后动态 import 的手法同 drawtell。`tests/_fake-cli.ts` 是假 CLI(模仿 stream-json、认 `--resume`),`_fake-tts.ts` 是假配音命令,runner 全流程测试靠它们,不花钱

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 前端单测不花钱:`node bin/cotutor.js mock`(或 `--scenario limit|offline`)起模拟接口,浏览器开 `/?tutor=chinese-tutor&step=0.3`;无头 Chrome 截图手机尺寸要 `--force-device-scale-factor=2 --window-size=780,1688`(窗口最小宽约 500,直接 390 会被裁),平板 `--window-size=1180,820`
- 冒烟:`node bin/cotutor.js init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live`(真起一次老师)→ `serve --workspace <tmp>` → `curl /api/tutors?kid=1`;真跑老师:`cotutor send math-tutor "<消息>" --workspace <tmp>`(或页面 `/parent`)。手册两份:docs/家长手册.md(只用)、docs/开发者手册.md(改代码)
- 在 Claude Code 会话里起 claude 子进程要 `env -u CLAUDECODE ...`(嵌套会拒);本机 claude 2.1.220 不认全局 settings 里的模型,运行时模板加 `--model sonnet` 才能跑(模型旋钮本来就在模板里)
- voxtell 没发 npm:从 TarsLab/voxtell 检出后 `pnpm add -g .` 进 PATH(pnpm ≥ 10 没有 `link --global`;首次先 `pnpm setup` 把 `~/Library/pnpm/bin` 加进 PATH 并重开终端),`tts.say` 出厂值就能用;不链就把 `tts.say[0..1]` 改成 `node <voxtell 检出目录>/bin/voxtell.js`;iPad 真机要 `cotutor cert`(mkcert)+ 把根证书装到 iPad

## 约定

- **证书是机器级的**(2026-09-09 拍板):签的是本机名与局域网 IP,与孩子无关,所以放 `~/.config/cotutor/certs/`(`USER_CERT_DIR`,与 `config.json` 同目录),不在 workspace 里;多孩子共用一张,IP 变了只重签一次
- **workspace 解析链**:`--workspace` > `COTUTOR_WORKSPACE` > cwd 或祖先有 cotutor.json > `~/.config/cotutor/config.json` > `~/cotutor/` 下唯一的孩子目录 > 报错附修复指南。没有 cwd 兜底,cotutor.json 是必需的政策文件;在但坏了响亮报错
- **init 幂等补缺**,已有文件一律不动;政策文件(cotutor.json)与家规(CLAUDE.md / QWEN.md)只在缺失时写模板。唯一例外:`.claude/agents/` 里指向包的旧链会被换成拷贝(链不是用户数据)
- **老师按 cotutor.json 里有谁走,没有注册表**:init / doctor 对表里每一位补目录与 `.qwen` 链、查文件;出厂五位多一层 hash 与 upgrade,自家加的(`cotutor add <name> --display …`:出模板文件、`patchConfig` 进表、建目录)永远是 untracked,upgrade 不碰,doctor 的 origin 行写「自家加的老师」
- **老师文件与 cotutor.json 的字段归属**:文件里只有运行字段 + 正文;display / avatar / voice / enabled / hidden / policy 全在 cotutor.json
- **孩子视图是机械规则**:孩子只看 `result.result` 剥掉「## 待裁量」「## 转交」段之后的**最后一段**(空行分段;家规让老师把给孩子的话放最后一段),按 replyMaxChars 截断;这两种固定段只吃字段行,遇空行后不是字段行就结束(老师把给孩子的话放最后一段不会被吞)
- **账本追加式**,同 id 后者为准,retracted 用追加行;坏行 doctor 点行号,不删账本
- **对话索引物化**:`conversations/<老师>/<日期>.json` 每条消息带 kidText / holdup / handoff / agent(运行时名)/ error,页面不解析日志;家长视图的转录行从 `.log` 现读(`foldRuns`,`sub` 行折成「子代理」)。换运行时(agent 不同)→ 新开会话且索引里的 session 换成新的;跨天 → 新文件自然不 resume
- **孩子端永远没有错误与评判**:`/api/kid/*` 只给问句 / 回复 / 配音 / pending(出错的运行不出现,家长的问句不露),每日上限 `dailyMessages` 只数孩子发的,到了 429 且首页头像灰;页面上任何失败都只是「什么都不出现」或头像灰(后端不通 → `offline`),没有报错文案。识别在浏览器(webkitSpeechRecognition,没有就藏话筒),配音在服务端(没有退回 speechSynthesis)
- **cotutor.json 在页面上能改**:title / policyDefaults / tutors / runtimes.default / paths / server / tts,补丁深合并到原始 JSON(保留 `$schema` `_note`),整份过契约才落盘,null 删键;kid / version / 运行时模板走编辑器。老师文件正文走 `/api/tutors/<name>/file`(frontmatter name 必须不变),新老师 `POST /api/tutors` 与 `cotutor add` 同一条路,`DELETE` 只删自家的(文件改名保留)。服务每个请求看 mtime 热重载,改坏了留旧配置、`/api/health` 报 configError
- 两 CLI(2026-09-08 实测):claude 用 `--agent` 让老师文件当主会话(链上的定义能被找到,`memory: project` 落在老师目录);qwen 0.21.13 **没有** `--agent`(Unknown argument),但 `--append-system-prompt` 有且生效、`--approval-mode yolo` / `--yolo` / `--max-wall-time` / `--resume` 都在,stream-json 事件带 `parent_tool_use_id`——老师正文由应用读文件填进预设占位 `{agentBody}`
