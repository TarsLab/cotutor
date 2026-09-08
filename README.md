# cotutor

家里的 AI 助教团队。老师 = 一个可直接对话的 agent 文件 + 自己的会话;一孩一 workspace;家长看全部过程,孩子看精简后的对话与产物。

设计文档暂在 growth-apps 仓根:《cotutor产品规划.md》《cotutor-agent层设计.md》《cotutor契约草案.md》(R8 迁入本仓)。

## 现在能做什么(R1 骨架与契约)

```sh
pnpm i
node bin/cotutor.js init <slug> [--dir <path>] [--name <孩子名>] [--port <n>]   # 建 ~/cotutor/<slug>/
node bin/cotutor.js doctor                                                     # 逐项体检
node bin/cotutor.js serve                                                      # 一 workspace 一进程
```

老师定义在本仓 `agents/`(数学老师、语文老师、朗读老师、作业助教、规划老师),init 把它们**链**进 workspace 的 `.claude/agents/` 与 `.qwen/agents/`。从老师目录起会话:

```sh
cd ~/cotutor/<slug>/agents/math-teacher
claude --agent math-teacher -p "<上下文包 + 消息>" --output-format stream-json
```

## 验证

```sh
pnpm typecheck && pnpm test
```

MIT。
