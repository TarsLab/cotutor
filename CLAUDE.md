# cotutor

家里的 AI 老师团,和家长一起教。应用仓,2026-09-08 起。底层 drawtell / voxtell 按 npm 版本依赖,不在本仓。

本文件只写怎么在这个仓干活,不记历史、不记拍板:

- 设计在 `docs/`:《产品规划.md》定位、两个端、里程碑;《agent层设计.md》目录、记忆、子代理;《契约草案.md》各文件形状的「为什么」(真相在 `src/schema/`);《工作流程.md》一拍一就绪、事件;《快模型方案.md》板书后期;《obsidian仓库设计.md》vault;《卡片协议.md》加一种卡;《首页设计.md》孩子端首页与 cotutor-home;《作业照片设计.md》孩子端拍照、编辑与发
- 各设计文档末尾有「拍板记录」,带日期。**带日期的决定都是可推翻的**;一条约定要在两轮以上迭代里活下来才进本文件末尾的「约定」
- 《开发者手册.md》怎么跑。模块的来龙去脉与真跑数据不另存,看 git log 与各设计文档
- 草稿与随手记放 `docs/wip/`(gitignore)

## 目录

- `agents/*.md` 出厂老师文件:frontmatter 取两 CLI 公共子集,正文即系统提示;init 拷进 workspace,hash 记 `.cotutor/shipped.json`
- `skills/<name>/` 出厂技能:cotutor-tutor(有脸的老师共同的守则,应用注入上下文包)、cotutor-board(由 `cards/*/card.md` 生成)、cotutor-vault、cotutor-analyze、cotutor-tune、cotutor-home(家长在 workspace 里排首页)
- `cards/<kind>/` 卡的协议:`card.md` 八栏(例子即测试)+ `card.css`
- `themes/default/` 出厂主题:`theme.json` 槽表、`kid.css`、`post.md` 后期骨架
- `src/schema/` 契约(zod,类型即文档);`src/lib/` 纯函数,离屏可测;`src/cards/` 卡的注册表
- `src/stage/` 舞台包(React,esbuild 打到 `dist/stage/`);`src/cli/` 命令;`src/server/` 服务、runner、三个页面(孩子端 `/`、家长端 `/parent`、工作台 `/dev`)、mock
- `tests/` 一文件一子进程,零依赖 `check()`;`_fake-cli.ts` / `_fake-tts.ts` 让全流程不花钱;`fixtures/board/` 真跑样本

## 运行与验证

- `pnpm typecheck`;`pnpm test`;`node bin/cotutor.js --help`(bin 直跑 src,Node ≥ 22.18)
- 改了 `cards/*/card.md` 跑 `pnpm run gen:skills`(不跑 skills.test 会红);改了 `src/stage/` 跑 `pnpm run build:stage`(dist 不在 git,没打包时舞台开不了)
- 改解析器或卡先过 `tests/board.test.ts`;改页面模板后 mock.test 兜「内联脚本能解析」
- 改孩子端播放(谁念、谁停、谁打断谁)先改《工作流程.md》的仲裁表,再改 `tests/player.test.ts`,最后改 `kid-board.ts` 的 `step`;页面只 `dispatch`
- 冒烟:`init <slug> --dir <tmp>` → `doctor --workspace <tmp> --live` → `serve`;真跑老师 `cotutor send`;不花钱看前端 `cotutor mock`
- 手动验收走 `scripts/probe-*.mjs`(CDP);舞台里的东西用 CDP 驱动,截图用 CLI `--screenshot`,手机尺寸要 `--force-device-scale-factor=2 --window-size=780,1688`
- 手册:《家长手册.md》《开发者手册.md》《iPad与iPhone.md》

## 坑(不可推导的)

- 页面模板是模板字符串:反斜杠写 `\\n`,正则里 `\/` 写 `\\/`,吃掉一层那行就成了注释而脚本照样能解析
- 后期子进程带 `MAX_THINKING_TOKENS=0`,否则 haiku 一拍 35–69 秒
- Claude Code 会话里起 claude 子进程要 `env -u CLAUDECODE`;本机 claude 要 `--model sonnet`
- claude 运行时模板带 `--setting-sources project` 隔离本机配置,代价是 `~/.claude/settings.json` 的代理 env 也不进:serve 要从 export 了代理的 shell 起
- serve 只热重载 cotutor.json;改 `src/` 要重起
- voxtell 没发 npm,检出后 `pnpm add -g .` 进 PATH;iPad 真机要 `cotutor cert`
- 提交按文件名 stage,仓里常有并行的未提交改动

## 约定(活过多轮的)

- 一孩一 workspace 一 vault 一服务进程;老师会话的 cwd 是 `agents/<name>/`
- 出厂件(老师文件、主题、技能)拷贝不链;hash 记 shipped.json,upgrade 只换没改过的、改过的报 diff;`machine: true` 的技能每次覆盖
- 老师按 cotutor.json 里有谁走,没有注册表;键以 `-tutor` 结尾的是有脸的老师,其余是工具人
- 老师文件里只有运行字段与正文;display / avatar / voice / enabled / policy / runtime 在 cotutor.json
- 老师的正文就是板书:普通行 = 讲稿一句,围栏 = 卡,第一个 H2 起是给家长的尾巴;解析器永不抛
- 老师不派子代理、不互相交活(自己派会烧光自己的预算);画图作业由场景卡起
- 孩子端永远没有错误与评判;卡上不画对错;答案下发前剥掉
- 卡的状态是孩子的,存服务端;vault 是家长的,老师(LLM)不直接写,回结构化段由应用落盘
- workspace 解析链 `--workspace` > `COTUTOR_WORKSPACE` > cwd 祖先 > `~/.config/cotutor/config.json` > `~/cotutor/` 唯一目录;init 幂等补缺,已有文件不动
- 证书是机器级的,`~/.config/cotutor/certs/`
