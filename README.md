# cotutor

家里的 AI 老师团,和家长一起教。几位可以直接对话的老师(数学、语文、英语),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

> 家长端与孩子端都能用:老师的回复是一页板书(卡 + 逐句讲稿),家长在幕后把要画出来讲的题做成小课堂;学完家长打星记账进 Obsidian 日记,作业照片在学科老师页上拍。

## 五分钟用起来

需要一台电脑(Mac 最省事)、Node ≥ 22.18,和一个百炼账号(北京地域,按量付费)。老师的嘴和脑都走百炼,由应用直接调用,不用另装模型客户端:嘴是 `qwen3.8-omni-flash-realtime`,听孩子说、照着讲稿念;脑是 `qwen3.8-max`,写讲稿和板书。

```sh
npm i -g cotutor
cotutor init ming --name 小明 --grade 2     # 建 ~/cotutor/ming/:三位老师、技能、账本、对话目录、cotutor.json
cotutor service install                    # 装成这台电脑的后台服务,打印家长端首页 https://localhost:5180/parent/home,孩子的平板在那里扫码
```

后台服务登录后自己起来、崩了自己再起、关了终端照样跑,日志按天落文件:`cotutor service status` 看在不在跑,`cotutor service logs` 看日志,`cotutor service restart` 重起。Mac 上用 launchd,Linux 上用 systemd 用户服务,Windows 上是一条用户自己的登录项(不用管理员、没有黑窗口);第一次起来 Windows 可能弹窗问「允许访问」,点允许,平板才连得进来。要在终端里调试用 `cotutor serve`,先 `cotutor service stop` 让出端口。

接着三件事:

1. **填百炼**:在这台电脑上打开家长端 `/parent` 的「首页」,填百炼「按量付费」的 API Key 和业务空间 ID,保存前会先试连。API Key 在百炼控制台的「密钥管理」里创建,业务空间 ID 在控制台的业务空间详情里看,以百炼文档为准:[获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)、[首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)(里面讲了业务空间 ID)。Key 跟地域绑定,控制台右上角先选北京。Token Plan 的 `sk-sp-` 不行。没填时孩子端只出「老师们还没到」。
2. **填档案**:workspace 里的 `孩子.md` 填 `school_start`(读一年级的年月,如 `2025-09`),老师据此知道现在是几年级哪个学期。想用自己的 Obsidian 库,改 `cotutor.json` 的 `paths.vault`。
3. **体检**:`cotutor doctor` 逐项检查,不过的每条都带修复命令。

`init` 把出厂老师拷进 `agents/<老师>.md`,把做课包用的四个技能 chalk-* 和五个机器件 cotutor-tutor / cotutor-board / cotutor-analyze / cotutor-tune / cotutor-home 拷进 `.agents/skills/`(Codex、Qwen Code 直接读;Claude Code 读的 `.claude/skills` 是链到它的);
做小课堂的课包用 `cotutor chalk`(check / build / bake / snap / dub),烤画面与截图用本机的 Chrome(Windows 上没有 Chrome 就用 Edge)。要在平板上用(按住说话要 HTTPS):`cotutor cert` 签一张
自签证书(要 mkcert:Mac 上 `brew install mkcert && mkcert -install`;Windows 上 `winget install FiloSottile.mkcert`,重开终端再 `mkcert -install`),把根证书装到平板并打开信任,`cotutor service restart`(在终端里跑的就重开 `cotutor serve`),扫码打开。iPad 的步骤见 [iPad 与 iPhone](docs/iPad与iPhone.md)。

然后在浏览器里:

- **家长端 `/parent`**:「首页」设孩子的首页(按钮、这周的词、老师的先后),扫码打开(孩子的平板一张、家长自己的手机一张),给老师换头像和声音;「设置」定孩子的平板上按住说话那一栏放哪边;「记录」按天看孩子和每位老师的板书(答案不剥)、看录像、打星、记账、删话题,看这天写进 vault 的每一行,不要的一行一行撤回。右上角「工作台 ↗」去工作台。
- **工作台 `/dev`**:给有技术背景的家长与开发者。和任何一位老师说话、看一轮的原文;老师团页改人设、政策、老师文件,加新老师;设置页改路径、端口。头像与声音只在家长端改。
- **孩子端 `/`**:首页每位老师一张卡,卡上的按钮是家长排好的(新话题、接着以前的话题、带讲法的开场、先看一堂小课堂);点了进板书页,按住说话或打字。老师的回答是一页板书:卡先铺开(选择题、点读、田字格、单词、图、小课堂、画板、拍照),讲稿一句句念、笔跟着声音标注,末句问句停下来等孩子。点一张卡进舞台做题,做完「交给老师」。孩子永远看不到工具、报错、评判。

实时老师的声音由 realtime 模型提供;点读、单词等卡片的配音也走百炼(同一把 key),出厂三位各有一个缺省的。在家长端「首页」点老师的「样子与声音」,再点「换一个」在弹窗里挑(全部音色都在,能搜,能按男女、口音、中英、年纪、场景筛,能试听)。
不花钱先看孩子端长什么样:`cotutor mock` 起一份模拟接口,不经真实老师。

## 年级教学包

面向中国大陆小学一至六年级,当前提供二年级教学包。`cotutor grades` 查看可用年级;新建时未指定 `--grade` 默认二年级,未提供的年级不会自动回退。

出厂文件在 `grades/grade-2/`。三科分别提供预习、检查作业、复习(孩子端老师牌上常驻三块方砖);语文有写话与看图写话,英语有口语课,数学小课堂配合提前做好的课包。家长按教材版本、学期和孩子实际进度设置材料。

孩子当前学期仍由档案决定;升年级不会自动替换家长的老师文件。旧 workspace 执行 `cotutor upgrade` 补记二年级来源,保留自定义内容。贡献其他年级与验证方式见 [年级教学包设计](docs/年级教学包.md)。

## 老师是文件

每位老师 = 一个 Markdown 文件(frontmatter + 正文即系统提示)+ cotutor.json 里的一条(显示名、头像、音色、开关、政策)+ 自己的目录与对话。出厂三位(数学、语文、英语)随包发布,init **拷贝**进你的老师们,改了就是你家的;`cotutor upgrade` 只换没改过的,改过的打印差异让你定。再加一位:

```sh
cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬
```

名字以 `-tutor` 结尾的是老师(有脸),其余是孩子看不到的工具人。没设头像时,语文、数学、英语老师用包里自带的
出厂头像(包根 `avatars/`,三个木钉娃娃),别的老师显示学科首字。头像可以是 emoji,也可以是
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

**缺省:应用直连百炼。** 嘴和脑都用家长端「首页」填的那份百炼按量 API Key 与业务空间 ID,存在本机 `~/.config/cotutor/bailian.json`(几个孩子的 workspace 共用)。老师用哪个模型写在 `cotutor.json` 的 `runtimes` 里:出厂的 `api`(`qwen3.8-max`,三位老师都用它)和 `api-flash`(`qwen3.8-flash`,便宜些;换之前先跑 `cotutor activity eval` 看例子过不过)。卡的配音、听写认字、口语单、画图也用这份 key。

**key 只放 `~/.config/cotutor/`**,所有命令(`serve`、`send`、`replay`、`doctor`……)读同一处,环境变量(`DASHSCOPE_API_KEY` 之类)和别的工具的配置都不看:

| 文件 | 内容 | 谁写 |
|---|---|---|
| `bailian.json` | `{"apiKey": "sk-…", "workspaceId": "llm-…"}`,百炼按量 | 家长端「首页」;没有浏览器的机器照格式手写,或从别的机器拷过来 |
| `token-plan.json` | `{"apiKey": "sk-sp-…"}`,千问 Token Plan | 订了 Token Plan 的开发者手写;有它,Token Plan 有的模型先走它 |

手写的存成 UTF-8(不带 BOM)。配了什么、通不通看 `cotutor doctor`(`--live` 真连一次)。

换了运行时,之前的话题接不上,也不导入历史:孩子接着说会开新话题;换之前聊的话题不记账,家长端卡上标「换过运行时 · 不记账」,记录照样能看。模型、预算与老师运行时都在 workspace 的 `cotutor.json` 里,编辑器按首行 `$schema` 提供字段说明。

`cotutor doctor` 检查缺失配置并给修复建议;`--live` 会实际连接服务。页面上的老师起不来时,先看 doctor 和 `conversations/<老师>/<日期>.<job>.err.log`。家长端与工作台需要访问锁时,运行 `cotutor pin` 设置本机 PIN。

## 数据与升级

默认 workspace 是 `~/cotutor/<孩子>/`:配置在 `cotutor.json`,老师在 `agents/<老师>.md`,activity 在 `agents/<老师>/activities/`,技能在 `.agents/skills/`,对话在 `conversations/`,账本在 `ledger/`,照片在 `captures/`,课包在 `bundles/`,首页在 `home/`。长期档案、记忆和日记在配置的 Obsidian vault,规则见 [obsidian 仓库设计](docs/obsidian仓库设计.md)。备份时保留整个 workspace 与 vault。

```sh
cotutor upgrade                      # 更新未修改的出厂老师、activity、主题与技能
cotutor upgrade --config --dry-run    # 预览 cotutor.json 的迁移
cotutor upgrade --config              # 执行配置迁移
cotutor doctor
```

家长改过的老师与主题保留并显示差异;机器技能会随版本覆盖。配置迁移补缺,并更新未自定义的旧命令模板,保留自定义配置。升级程序后 `cotutor service restart`(在终端里跑的就重开 `serve`);换了 Node 版本、或包装到了别处,再 `cotutor service install` 一次。

2026-10-30 之前建的 workspace,老师在 `.claude/agents/`、技能在 `.claude/skills/`。`cotutor upgrade`(或 `init`)先把它们原样挪到新位置,再照常升级;新位置已有同名的不挪,会点名。`.claude/` 里别的文件不动。

### 旧 workspace 换运行时

2026-11-02 起不再起命令行(Qwen Code;Claude CLI 更早就去掉了),老师只走应用直连百炼。2026-10-31 之前建的 workspace 缺省走 Qwen Code,doctor 会报「命令行运行时不再支持」:先 `cotutor upgrade --config` 补上出厂的 `api` / `api-flash`,把 `runtimes.default` 和 `tutors.*.runtime` 改成 `api`,在家长端「首页」填好百炼,再删掉 `qwen`、`qwen-flash`(或更早的 Claude)条目。换之前聊的话题照上面「配置模型」说的办:记录照样能看,不导入、不记账。旧 `proxy` 字段可删除,对应命令已移除。

### 试用不进孩子的记录

自己手动试功能时,命令加 `--sandbox`:第一次从真 workspace 分出一份到旁边的 `.sandbox/<目录名>/`(`~/cotutor/ray` → `~/cotutor/.sandbox/ray`)。老师、activity、首页、主题、课包照拷,对话、照片、听写、账本不带,vault 拷一份;试的对话、记忆、日记都写在这份里。页面标题前带「试用」,端口是真的那个 +1,可以同时开;自动记账关着(要试记账,家长端点「记账」)。

```sh
cotutor serve --sandbox               # 试用的那份;没有就先分出来
cotutor send math-tutor 你好 --sandbox
cotutor serve --sandbox --fresh       # 丢掉试过的,从真 workspace 重新分(真的那边改了老师文件、vault 也用这个带过来)
```

## 开发

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

改卡片文档或技能生成代码后运行 `pnpm gen:skills`。开发约定与分模块验证见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

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
