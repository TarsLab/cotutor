# 参与 cotutor

## 先读什么

- `AGENTS.md`:这个仓怎么长的(目录、约定、验证方式)。人和 agent 都按它来。
- `README.md`:安装配置、升级、检出后怎么跑与怎么验证。
- `src/schema/`:数据契约(zod,类型即文档);对应模块的测试说明行为边界。
- `docs/iPad与iPhone.md`:HTTPS、证书与 iPad 真机使用。
- 改提示词、卡或教学包,分别读 `docs/写提示词.md`、`docs/卡片协议.md`、`docs/年级教学包.md`。

## 规矩

- **纯函数进 `src/lib/`,带测试**;文件与进程在 `src/cli/` 与 `src/server/`。`tests/*.test.ts` 每文件一子进程,零依赖 `check()`,不用登记。
- **错误信息即修复指南**:每条报错说「哪个文件、该是什么、现在是什么、怎么修」。doctor 是它的集中体现。
- **文件是真相,页面是视图**:cotutor.json、老师文件、账本、课程表都是文本;页面只写这些文件,不藏状态。
- **孩子端永远没有错误与评判**:过滤在服务端做(`/api/kid/*`),不靠前端隐藏。
- **不动用户数据**:init 幂等补缺,政策文件与家规只在缺失时写;老师文件拷进 workspace 后归家长,upgrade 不覆盖改过的。
- **只支持 Qwen Code**:实时模型负责听说(默认 `qwen3.8-omni-flash-realtime`),脑模型通过 Qwen Code 生成讲稿与板书。Qwen 的工具、环境与命令模板集中在 `src/clis/qwen.ts`;不再维护 Claude CLI。
- 老师文件与技能仍沿用 `.claude/agents/`、`.claude/skills/` 这两个历史数据目录,由应用读取并传给 Qwen,不依赖 Claude CLI。

## 提交前

```sh
pnpm typecheck && pnpm test && pnpm build && pnpm build:stage && pnpm smoke
```

`cotutor doctor --json` 的输出是 issue 里最有用的东西;报老师起不来时附上 `conversations/<老师>/<日期>.<job>.err.log` 的尾巴。

## 加一位出厂老师

在对应年级的 `grades/grade-<n>/agents/<name>.md` 写文件(frontmatter:name / description / maxTurns / permissionMode,正文即系统提示,只写人设与这一科的做法,照现有几位有脸的老师,写法见 `docs/写提示词.md`;公共守则在 `skills/cotutor-tutor/SKILL.md`,名字要以 `-tutor` 结尾才拿得到),`src/cli/skeleton.ts` 的 `TUTOR_DEFAULTS` 加人设缺省。用户侧加老师不用改仓库:`cotutor add`。

## 贡献年级教学包

当前只提供 `grades/grade-2/`。其他年级按 [年级教学包设计](docs/年级教学包.md) 新建独立目录,补齐三位老师、activity 与对话例子,注明教材和能力前提。不要只替换年级数字。新增例子先静态检查,再用真实模型跑并人工核对输出。

## 许可

贡献的代码按 [LICENSE](LICENSE) 授权:Apache-2.0 加三条附加条件。提交即同意其中第 3 条(贡献):项目方以后可以调整许可,贡献也可用于商业目的。
