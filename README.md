# cotutor

家里的 AI 助教团队。老师 = 一个可直接对话的 agent 文件 + 自己的会话;一孩一 workspace;家长看全部过程,孩子看精简后的对话与产物。

设计文档在仓库的 [docs/](https://github.com/TarsLab/cotutor/tree/main/docs):《产品规划.md》《agent层设计.md》《契约草案.md》。

> R3:孩子端。`/` 是孩子的今天(课程表的一周小路、老师头像、产物叠)与聊天窗(按住说话、打字、回复自动配音);家长端 `/parent` 看同一段对话的全部过程。iPad 上录音要 HTTPS:`cotutor cert` 用 mkcert 签证书。

## 装与用

需要 Node ≥ 22.18,以及 `claude`(Claude Code)或 `qwen`(Qwen Code)至少一个。

```sh
npm i -g cotutor          # 装全局,别用 npx:老师定义是链进 workspace 的,npx 缓存被回收链就断(doctor 会报断链)
cotutor init ming --name 小明   # 建 ~/cotutor/ming/
cotutor doctor                  # 逐项体检,不过的每条都带修复指南
cotutor cert                    # 可选:mkcert 签自签证书到 certs/(iPad Safari 的按住说话要 HTTPS)
cotutor serve                   # 一 workspace 一进程;孩子端 https://<ip>:5180/,家长端 /parent
cotutor send math-teacher "42-17 怎么讲?"   # 终端里发一条,与页面同一条路
```

孩子端要在 iPad 上听到老师的声音,再做两件事:`cotutor.json` 里给老师填 `voice`(voxtell 的音色 id,`voxtell voices` 可查),并把 `mkcert -CAROOT` 下的 rootCA.pem 装到 iPad 并信任。老师没配 voice 或 voxtell 没装时,孩子端用浏览器自带的合成声。课程表是 vault 里的 `课程表.md`(表头 星期 / 时间 / 学科,孩子列可选),没有也能用。

老师定义随包发布(数学老师、语文老师、朗读老师、作业助教、规划老师),init 把它们**链**进 workspace 的 `.claude/agents/` 与 `.qwen/agents/`——共享的是定义,不共享记忆与账本。人设、音色、开关、政策不在老师文件里,在 workspace 的 `cotutor.json`。从老师目录起会话:

```sh
cd ~/cotutor/ming/agents/math-teacher
claude --agent math-teacher -p "<上下文包 + 消息>" --output-format stream-json
```

工作区解析顺序:`--workspace` > `COTUTOR_WORKSPACE` > cwd 或祖先有 `cotutor.json` > `~/.config/cotutor/config.json` > `~/cotutor/` 下唯一的孩子目录。

发消息走的路:应用拼上下文包(谁在说、几点、本周计划里本老师的行、本学科最近观察)→ 按 `cotutor.json` 的预设 spawn(当天已有会话就 `--resume`)→ stream-json 落 `conversations/<老师>/<日期>.<job>.log` → 索引 `<日期>.json` 物化孩子视图(最后一段、剥待裁量与转交、按字数截)。换预设(claude ↔ qwen)新开会话;模型、预算这些旋钮写在预设模板里(如 claude 加 `--model sonnet`)。

接口:`GET /api/conversations/<老师>`(日期)、`GET /api/conversations/<老师>/<日期|today>`(索引 + 转录行)、`POST /api/conversations/<老师>/messages` `{text, from?, focus?, preset?}`(202;忙 409)、`PATCH /api/config`(只收 title / policyDefaults / teachers / agents.default)。孩子端:`GET /api/kid/home`、`GET /api/kid/conversations/<老师>/today`(服务端过滤:只有问句、回复、配音、pending)、`POST /api/kid/conversations/<老师>/messages` `{text}`(from 固定 kid;每日上限到了 429)、`GET /api/audio/<老师>/<文件>`。

## 当库用

契约(zod)与纯函数层可以单独引,子路径导出、带类型:

```ts
import { CotutorConfigSchema, explainIssues } from 'cotutor/schema';  // 各文件的形状,校验失败变修复指南
import { deriveKidView, parseSections } from 'cotutor/lib';           // 转录、精简视图、账本等纯函数
import { loadWorkspace } from 'cotutor/workspace';                    // 解析链 + 校验
```

## 开发

```sh
pnpm i
pnpm typecheck && pnpm test     # tests/*.test.ts 每文件一子进程
node bin/cotutor.js --help      # bin 在仓库内直跑 src(Node 原生 type stripping,零构建)
pnpm build && pnpm smoke        # 出厂检查:体检要发的那份(dist + agents/)
```

MIT。
