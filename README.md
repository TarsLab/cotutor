# cotutor

家里的 AI 老师团,和家长一起教。几位可以直接对话的老师(数学、语文、英语),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

> 家长端与孩子端都能用:老师的回复是一页板书(卡 + 逐句讲稿),家长在幕后把要画出来讲的题做成小课堂;学完家长打星记账进 Obsidian 日记,作业照片在学科老师页上拍。

## 五分钟用起来

需要 Node ≥ 22.18 和 Qwen Code ≥ 0.25。老师采用 realtime + 脑模型:默认 `qwen3.8-omni-flash-realtime` 负责听说,Qwen Code 运行脑模型生成讲稿和板书。出厂运行时为 `qwen`(`qwen3.8-max`,默认)与 `qwen-flash`(`qwen3.8-flash`)。

实时语音需要百炼按量 key 与业务空间 id,在家长端「首页」配置;脑模型支持千问 Token Plan 或百炼按量 key,配置方式见下文。

```sh
npm i -g cotutor
cotutor init ming --name 小明 --grade 2     # 建 ~/cotutor/ming/:三位老师、十个 skill、账本、对话目录、cotutor.json
cotutor doctor                    # 逐项体检,不过的每条都带修复命令;--live 真起一次老师
cotutor serve                     # 孩子端 http://<ip>:5180/,家长端 /parent
```

为兼容已有 workspace,老师与技能沿用 `.claude/` 历史数据目录,无需安装 Claude CLI。`init` 把出厂老师拷进 `.claude/agents/`,把做课包用的四个领域 skill(随 drawtell 包来)和五个机器件 cotutor-tutor / cotutor-board / cotutor-analyze / cotutor-tune / cotutor-home 拷进 `.claude/skills/`;
做课包用的 drawtell 随包装好(`.cotutor/drawtell`),不用另外装。要在 iPad 上用(按住说话要 HTTPS):`cotutor cert` 签一张
自签证书,把根证书装到 iPad,重启 `serve`。步骤见 [iPad 与 iPhone](docs/iPad与iPhone.md)。

然后在浏览器里:

- **家长端 `/parent`**:只看。按天看孩子和每位老师的板书(答案不剥)、看录像、打星、记账、删话题。
- **工作台 `/dev`**:给有技术背景的家长与开发者。和任何一位老师说话、看一轮的原文;老师团页改人设、政策、老师文件,加新老师;音色页试听挑声音;设置页改路径、端口、配音。
- **孩子端 `/`**:首页每位老师一张卡,卡上的按钮是家长排好的(新话题、接着以前的话题、带讲法的开场、先看一堂小课堂);点了进板书页,按住说话或打字。老师的回答是一页板书:卡先铺开(选择题、点读、田字格、单词、图、小课堂、画板、拍照),讲稿一句句念、笔跟着声音标注,末句问句停下来等孩子。点一张卡进舞台做题,做完「交给老师」。孩子永远看不到工具、报错、评判。

实时老师的声音由 realtime 模型提供;点读、单词等卡片的配音可选装 [voxtell](https://github.com/tarslab/voxtell)。
不花钱先看孩子端长什么样:`cotutor mock` 起一份模拟接口,不经真实老师。

## 年级教学包

面向中国大陆小学一至六年级,当前提供二年级教学包。`cotutor grades` 查看可用年级;新建时未指定 `--grade` 默认二年级,未提供的年级不会自动回退。

出厂文件在 `grades/grade-2/`。三科分别提供预习、批改、复习;语文有写话与看图写话,英语有口语课,数学小课堂配合提前做好的课包。家长按教材版本、学期和孩子实际进度设置材料。

孩子当前学期仍由档案决定;升年级不会自动替换家长的老师文件。旧 workspace 执行 `cotutor upgrade` 补记二年级来源,保留自定义内容。贡献其他年级与验证方式见 [年级教学包设计](docs/年级教学包.md)。

## 老师是文件

每位老师 = 一个 Markdown 文件(frontmatter + 正文即系统提示)+ cotutor.json 里的一条(显示名、头像、音色、开关、政策)+ 自己的目录与对话。出厂三位(数学、语文、英语)随包发布,init **拷贝**进你的老师们,改了就是你家的;`cotutor upgrade` 只换没改过的,改过的打印差异让你定。再加一位:

```sh
cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬
```

名字以 `-tutor` 结尾的是老师(有脸),其余是孩子看不到的工具人。头像可以是 emoji,也可以是
workspace 里的一张图(`avatars/<老师>.png`):用 [figshot](https://github.com/tarslab/figshot)
`figshot pick --workspace ~/cotutor/<孩子>` 让孩子自己搭一个乐高人仔当老师,存盘直接落到这里。
`cotutor.json` 里加一行 `"figshot": { "port": 8477 }`,孩子端首页就多一张「给老师们换个样子」,iPad 上点了直接进去(figshot 没开着时这张卡不出现)。

或者家长端老师团页点「新老师」。没有注册表,删掉文件和那条配置就是删老师。

`cotutor.json` 首行指向一份 JSON Schema(`.cotutor/cotutor.schema.json`),编辑器里有补全与说明。

## 当库用

```ts
import { CotutorConfigSchema, cotutorJsonSchema } from 'cotutor/schema';  // 契约(zod)与 JSON Schema
import { deriveKidView, parseSections } from 'cotutor/lib';               // 转录、孩子视图、账本等纯函数
import { loadWorkspace } from 'cotutor/workspace';                        // 解析链 + 校验
```

## 配置模型

嘴使用百炼按量 API key 与业务空间 id。在家长端「首页」填写,保存到本机 `~/.config/cotutor/bailian.json`;也可在启动服务的终端设置 `DASHSCOPE_API_KEY` 与 `DASHSCOPE_WORKSPACE_ID`。Token Plan 的 key 不能用于 realtime。

脑模型可用 `QWENCLOUD_TOKEN_PLAN_API_KEY`(千问 Token Plan)或 `DASHSCOPE_API_KEY`(百炼按量),也可先运行 `qwen` 配好本机 Qwen 设置。两类 key 对应不同端点,由适配器选择。模型、预算与老师运行时在 workspace 的 `cotutor.json` 中配置,编辑器按首行 `$schema` 提供字段说明。

`cotutor doctor` 检查缺失配置并给修复建议;`--live` 会实际连接服务。页面上的老师起不来时,先看 doctor 和 `conversations/<老师>/<日期>.<job>.err.log`。家长端与工作台需要访问锁时,运行 `cotutor pin` 设置本机 PIN。

## 数据与升级

默认 workspace 是 `~/cotutor/<孩子>/`:配置在 `cotutor.json`,老师在 `.claude/agents/`,activity 在 `agents/<老师>/activities/`,对话在 `conversations/`,账本在 `ledger/`,照片在 `captures/`,课包在 `bundles/`,首页在 `home/`。长期档案、记忆和日记在配置的 Obsidian vault,规则见 [obsidian 仓库设计](docs/obsidian仓库设计.md)。备份时保留整个 workspace 与 vault。

```sh
cotutor upgrade                      # 更新未修改的出厂老师、activity、主题与技能
cotutor upgrade --config --dry-run    # 预览 cotutor.json 的迁移
cotutor upgrade --config              # 执行配置迁移
cotutor doctor
```

家长改过的老师与主题保留并显示差异;机器技能会随版本覆盖。配置迁移补缺,并更新未自定义的旧命令模板,保留自定义配置。升级程序后重新启动 `serve`。

### 旧 workspace 切换到 Qwen

先运行 `cotutor upgrade --config` 补齐 Qwen 模板,再把 `runtimes.default` 和仍指向旧运行时的 `tutors.*.runtime` 改为 `qwen` 或 `qwen-flash`,删除旧 Claude 运行时条目。旧 `proxy` 字段可删除,对应命令已移除。`.claude/` 是共用的历史数据目录,老师与技能不用搬动。

## 开发

先把 [drawtell](https://github.com/tarslab/drawtell) 检出到本仓旁边,在它的目录执行 `pnpm i && pnpm build`;本仓通过 `link:../drawtell` 引用它。

```sh
pnpm i
pnpm typecheck
pnpm test
node bin/cotutor.js --help        # 仓库内直跑 src,Node ≥ 22.18
pnpm build
pnpm build:stage                 # build 清空 dist 后重建舞台
pnpm smoke                      # 检查待发布内容
node bin/cotutor.js mock         # 假模型接口,查看前端
```

本地 `link:../drawtell` 不能直接用于发布包,发布前需换成可打包的依赖并通过 smoke。改卡片文档或技能生成代码后运行 `pnpm gen:skills`。开发约定与分模块验证见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

正式文档只保留以下六篇,历史讨论查 Git:

- [iPad 与 iPhone](docs/iPad与iPhone.md)
- [obsidian 仓库设计](docs/obsidian仓库设计.md)
- [写提示词](docs/写提示词.md)
- [卡片协议](docs/卡片协议.md)
- [年级教学包](docs/年级教学包.md)
- [词表](docs/词表.md)

## 许可

cotutor 按 Apache-2.0 加附加条件授权,全文见 [LICENSE](LICENSE)。白话说:

- 家里自己用、自己改都行,几个孩子几个 workspace 都算自己家。
- 替别的家庭或别人运营 cotutor(收不收钱都算),要先拿到书面许可。
- 家长端页脚和工作台的 cotutor 标记不能去掉(自己家用也一样);主题、老师的名字与头像、标题照常改。

这段只是说明,以 LICENSE 原文为准。要许可或商业授权,到仓库开 issue。
