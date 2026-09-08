# cotutor

家里的 AI 助教团队(应用仓,全新项目,2026-09-08 起)。设计文档在 `docs/`:《产品规划.md》(定位、两个端、回复形式阶梯、里程碑 R0–R8、拍板记录)、《agent层设计.md》(目录、三种记忆、子代理、规划老师)、《契约草案.md》(各文件形状,已逐条拍板;契约的真相是 `src/schema/`,它只剩「为什么」)。拍板都在那里;本文件只写这个仓怎么长的。草稿与随手记放 `docs/wip/`(gitignore,不入库)。底层工具 drawtell / voxtell 按 npm 版本依赖,不在本仓。

## 结构(单包,subpath export,同 drawtell)

- `agents/*.md` — **老师定义**(frontmatter 取两 CLI 公共子集:name / description / maxTurns / permissionMode / memory,正文即系统提示)。init 把它们链进 workspace;人设、政策、开关不在这里,在 workspace 的 cotutor.json
- `src/schema/` — **契约**(zod,类型即文档;`explainIssues` 把 issue 变修复指南):config(cotutor.json)、context-pack、conversation、ledger、sections(待裁量 / 转交)、plan
- `src/lib/` — **纯函数**(全部离屏可测):agent-file、sections、transcript(stream-json → 家长条目 + 最终文本,子代理事件标 sub)、kid-view(精简视图:只看最终文本、剥段、截断)、context-pack、plan、ledger、conversation
- `src/cli/` — workspace(解析链 + 校验)、skeleton(骨架清单 + 模板,init 与 doctor 共用)、init、doctor、serve、main
- `src/server/app.ts` — 路由层纯函数 `route()`;R1 只有查询接口,发消息 / 页面在 R2
- `tests/*.test.ts` — 每文件一子进程(`scripts/test.ts`),零依赖 `check()`;HOME 注入后动态 import 的手法同 drawtell

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 冒烟:`node bin/cotutor.js init <slug> --dir <tmp>` → `doctor --workspace <tmp>` → `serve --workspace <tmp>` → `curl /api/teachers?kid=1`

## 约定

- **workspace 解析链**:`--workspace` > `COTUTOR_WORKSPACE` > cwd 或祖先有 cotutor.json > `~/.config/cotutor/config.json` > `~/cotutor/` 下唯一的孩子目录 > 报错附修复指南。没有 cwd 兜底,cotutor.json 是必需的政策文件;在但坏了响亮报错
- **init 幂等补缺**,已有文件一律不动;政策文件(cotutor.json)与家规(CLAUDE.md / QWEN.md)只在缺失时写模板
- **老师文件与 cotutor.json 的字段归属**:文件里只有运行字段 + 正文;display / avatar / voice / enabled / hidden / policy 全在 cotutor.json
- **精简视图是机械规则**:孩子只看 `result.result` 剥掉「## 待裁量」「## 转交」段之后的**最后一段**(空行分段;家规让老师把给孩子的话放最后一段),按 replyMaxChars 截断;这两种固定段只吃字段行,遇空行后不是字段行就结束(老师把给孩子的话放最后一段不会被吞)
- **账本追加式**,同 id 后者为准,retracted 用追加行;坏行 doctor 点行号,不删账本
- 两 CLI(2026-09-08 实测):claude 用 `--agent` 让老师文件当主会话(链上的定义能被找到,`memory: project` 落在老师目录);qwen 0.21.13 **没有** `--agent`(Unknown argument),但 `--append-system-prompt` 有且生效、`--approval-mode yolo` / `--yolo` / `--max-wall-time` / `--resume` 都在,stream-json 事件带 `parent_tool_use_id`——老师正文由应用读文件填进预设占位 `{agentBody}`
