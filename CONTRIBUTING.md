# 参与 cotutor

## 先读什么

- `CLAUDE.md`:这个仓怎么长的(目录、约定、验证方式)。人和 agent 都按它来。
- `docs/产品规划.md`:定位、里程碑 R0–R8、拍板记录。改设计先改这里。
- `docs/契约草案.md` 只剩「为什么」,契约的真相是 `src/schema/`(zod,类型即文档)。
- `docs/开发者手册.md`:检出后怎么跑起来、怎么冒烟、iPad 真机怎么试。

## 规矩

- **纯函数进 `src/lib/`,带测试**;文件与进程在 `src/cli/` 与 `src/server/`。`tests/*.test.ts` 每文件一子进程,零依赖 `check()`,不用登记。
- **错误信息即修复指南**:每条报错说「哪个文件、该是什么、现在是什么、怎么修」。doctor 是它的集中体现。
- **文件是真相,页面是视图**:cotutor.json、老师文件、账本、课程表都是文本;页面只写这些文件,不藏状态。
- **孩子端永远没有错误与评判**:过滤在服务端做(`/api/kid/*`),不靠前端隐藏。
- **不动用户数据**:init 幂等补缺,政策文件与家规只在缺失时写;老师文件拷进 workspace 后归家长,upgrade 不覆盖改过的。
- 两个 CLI(claude / qwen)都要能跑:老师文件只用 frontmatter 的公共子集,CLI 差异写在 cotutor.json 的预设模板里。

## 提交前

```sh
pnpm typecheck && pnpm test && pnpm build && pnpm smoke
```

`cotutor doctor --json` 的输出是 issue 里最有用的东西;报老师起不来时附上 `conversations/<老师>/<日期>.<job>.err.log` 的尾巴。

## 加一位出厂老师

在 `agents/<name>.md` 写文件(frontmatter:name / description / maxTurns / permissionMode / memory,正文即系统提示,约定照现有五位),`src/cli/skeleton.ts` 的 `TUTOR_PRESETS` 加人设缺省,`scripts/smoke.ts` 的老师数改一下。用户侧加老师不用改仓库:`cotutor add`。
