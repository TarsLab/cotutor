# 接一个 CLI

cotutor 的老师是一个本地的 agent CLI 跑出来的(现在有 claude、qwen)。本篇写给想再接一家的开发者:要满足什么条件、写哪个文件、怎么测、怎么验。设计与拍板在《agent层设计.md》§6、拍板 15。

## 一、CLI 要能做到

缺一样就接不上,先在终端里手跑确认:

| 要求 | 为什么 | claude / qwen 怎么做 |
|---|---|---|
| 无界面跑一轮,跑完退出 | 应用一轮起一个进程 | `-p` / 消息走 stdin |
| 能整份换掉或追加系统提示 | 老师正文 + 板书写法要进系统提示 | `--append-system-prompt-file {boardFile}` / `--system-prompt {systemBody}` |
| 按 id 接着一个会话说 | 同一个话题多轮 | `--resume {session}` |
| 输出一行一个 JSON,带会话 id、正文、工具调用、收尾 | 应用要读 | `--output-format stream-json` |
| 一个字一个字吐(最好有) | 孩子端边写边出卡 | `--include-partial-messages` |
| 能读本地文件,包括图片 | 作业照片、教材 | Read / read_file |
| 能把工具关干净,或只留只读的几样 | 孩子的话不带工具才快;老师不能写 vault | `--tools` / `--core-tools` + `--exclude-tools` |
| 不弹确认 | 没人点 | `--dangerously-skip-permissions` / `--approval-mode default` 加可读目录 |

没有系统提示旗标的 CLI 也能接:模板里不写 `{boardFile}` / `{systemBody}`,应用会把板书写法放进话题第一条。

## 二、两层:模板是数据,适配器是代码

- **运行时模板**(`cotutor.json` 的 `runtimes`):用哪个 CLI、哪个模型、预算、时限。家长和开发者改数据就行。
- **适配器**(`src/clis/<cli>.ts`):这个 CLI 怎么说话。一个 CLI 一个文件,应用的其余部分只认适配器给的统一事件。

模板里能用的占位见 `src/schema/config.ts` 的 `RuntimeSchema` 注释。和适配器有关的两个:

- `{tools}`:填适配器给的一串工具名,和别的字拼在一个参数里。
- `{toolArgs}`:独占一个参数,展开成适配器给的几个参数(可以是零个)。

## 三、写适配器

照 `src/clis/qwen.ts` 抄一份。接口在 `src/clis/types.ts`,逐项:

| 钩子 | 必需 | 做什么 |
|---|---|---|
| `name` | 是 | 适配器名。运行时写 `cli` 字段就按它找,没写按 `run[0]` 的文件名 |
| `parse(line)` | 是 | 一行输出读成统一事件:`session` `init` `start` `delta` `thinking` `assistant` `results` `result`。和 Claude Code 同族的直接用 `stream-json.ts` 的 `parseStreamJson` |
| `stdinMessage(prompt)` | 是 | 消息走 stdin 时写进去的那一行 |
| `toolList(set)` / `toolArgs(set, { readDirs })` | 是 | 这轮带(`on`)或不带(`off`)工具,展开成什么。`on` 时 `readDirs` 是该读得到的目录 |
| `toolKind(name)` | 是 | 工具名属于哪一类:读文件 / shell / 搜索 / 改 / 技能 / 别的。家长端「读了几个文件」、回读板书写法的检查靠它 |
| `env(env, ctx)` | 是 | 起进程前最后过一遍环境:注代理、补 key、去掉会干扰的变量 |
| `runtimes()` | 是 | 出厂模板,`cotutor init` 写进新 workspace |
| `expectedTools(set)` | 否 | 这轮进程起来该报哪些工具;多出来的记提醒 |
| `planEnv(ctx)` | 否 | 按这轮的计划定的环境变量(qwen 按 effort 选配置文件)。会进预热的比对 |
| `prepare(root)` | 否 | 起进程前在 workspace 里备好机器文件(qwen 的隔离家目录),要幂等 |
| `nestedEnv` | 否 | 在别的 agent 会话里起它会被当嵌套拒掉的环境变量 |
| `check(ctx)` | 否 | `cotutor doctor` 多查几样(版本、key) |
| `retired` | 否 | 以前出厂过的旧模板;没人改过的,`upgrade --config` 整份换新 |

写完在 `src/clis/index.ts` 的 `ADAPTERS` 里加一行。

几条要守的:

- **key 不落盘。** workspace 是 git 仓。从环境变量或本机这个 CLI 自己的配置里现读,只放进子进程的环境。
- **老师不能写 vault。** 只读那轮只给读文件、按名找、按内容找;shell 能写文件,不给。
- **用户自己的配置不进来。** 本机装的技能、插件、MCP、记忆功能都会改老师的行为。claude 用 `--setting-sources project` 和 `--strict-mcp-config`,qwen 用隔离的家目录。
- **工具名不进提示词。** 提示词里写着 claude 的 `Read`,别的 CLI 的模型大多认得;认不得就在适配器里想办法,不改提示词。

## 四、测

不花钱的:

1. `tests/clis.test.ts` 加你这家的读法(拿真跑的几行输出当样本)、工具旗标展开、环境变量。
2. `tests/_fake-cli.ts` 加你这家的方言(看 qwen 方言那段:按命令行里的旗标认出来),再照 `tests/qwen.test.ts` 写一份走完整条路的测试:孩子的话工具表为空、系统轮只读、超时当出错、费用或 token 记上。
3. `pnpm typecheck && pnpm test`。

## 五、验

花一点钱的,在 workspace 的**拷贝**上跑(vault 也拷一份,`paths.vault` 指过去):

1. `cotutor doctor --workspace <拷贝> --live`:适配器的体检、真起一轮。
2. 给一位老师配上你的运行时(`tutors.<老师>.runtime`),`cotutor replay` 回放几道真题,至少要有一道带照片的。
3. `cotutor send` 发两条孩子的话,`cotutor bookkeep` 记一天的账。

每轮看:

- 孩子的话:工具表为空,没有「不该有的工具」的提醒,讲稿一句一句流出来。
- 照片题:真读了图(`cotutor show` 的「读了什么」),第一句说出认出的题。
- 记账:只用了读的工具,日记是应用落的(消息上有 `diaryBlock`),vault 的拷贝里没有别的改动。
- 用时与费用:`cotutor send` 最后一行。

## 六、qwen 踩过的坑

接下一家时先查一遍:

- `--bare` 这类「最小模式」常常也不认关工具的旗标。
- 读会话 cwd 外面的文件要确认,而消息走 stdin 时没人回答,进程就一直等。
- 思考关掉以后,模型可能连该用的工具都不用。
- 数组旗标会吞掉跟在后面的位置参数(消息)。
- 超时退出可能不吐收尾那一行,要当出错。
- CLI 默认会往外发使用统计。
