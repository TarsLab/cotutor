# cotutor

家里的 AI 助教团队。老师 = 一个可直接对话的 agent 文件 + 自己的会话;一孩一 workspace;家长看全部过程,孩子看精简后的对话与产物。

设计文档在仓库的 [docs/](https://github.com/TarsLab/cotutor/tree/main/docs):《产品规划.md》《agent层设计.md》《契约草案.md》。

> R1:骨架与契约。init / doctor / serve 可用,serve 只有查询接口;发消息与页面在 R2。

## 装与用

需要 Node ≥ 22.18,以及 `claude`(Claude Code)或 `qwen`(Qwen Code)至少一个。

```sh
npm i -g cotutor          # 装全局,别用 npx:老师定义是链进 workspace 的,npx 缓存被回收链就断(doctor 会报断链)
cotutor init ming --name 小明   # 建 ~/cotutor/ming/
cotutor doctor                  # 逐项体检,不过的每条都带修复指南
cotutor serve                   # 一 workspace 一进程
```

老师定义随包发布(数学老师、语文老师、朗读老师、作业助教、规划老师),init 把它们**链**进 workspace 的 `.claude/agents/` 与 `.qwen/agents/`——共享的是定义,不共享记忆与账本。人设、音色、开关、政策不在老师文件里,在 workspace 的 `cotutor.json`。从老师目录起会话:

```sh
cd ~/cotutor/ming/agents/math-teacher
claude --agent math-teacher -p "<上下文包 + 消息>" --output-format stream-json
```

工作区解析顺序:`--workspace` > `COTUTOR_WORKSPACE` > cwd 或祖先有 `cotutor.json` > `~/.config/cotutor/config.json` > `~/cotutor/` 下唯一的孩子目录。

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
