# cotutor

家里的 AI 老师团,和家长一起教。几位可以直接对话的老师(数学、语文、英语),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

> 家长端与孩子端都能用:老师的回复是一页板书(卡 + 逐句讲稿),家长在幕后把要画出来讲的题做成小课堂;学完家长打星记账进日记(普通 markdown,想用 Obsidian 看也行),作业照片在学科老师页上拍。

## 五分钟用起来

**让 AI 助手帮你装:** 把这句话发给能在电脑上跑命令的 AI 助手(WorkBuddy、Claude Code、Codex 这类),它会一步步带你做。不用输网址:安装说明跟着 npm 包走,和装上的版本对得上。百炼的 Key 由你自己填在页面上,不用告诉它。

```text
帮我在这台电脑上装 cotutor:先跑 npx cotutor@latest guide,照它说的一步步做。没有 Node 就先告诉我
```

网页版的聊天机器人跑不了命令,换这句,它会一次告诉你一步:

```text
请阅读 https://cdn.jsdelivr.net/npm/cotutor@latest/INSTALL.md ,一步一步带我在这台电脑上安装 cotutor
```

**自己装:** 需要一台电脑(Mac 最省事)、[Node.js](https://nodejs.org) ≥ 22.18(装 LTS 版),和一个百炼账号(北京地域,按量付费)。老师的嘴和脑都走百炼,由应用直接调用,不用另装模型客户端:嘴是 `qwen3.8-omni-flash-realtime`,听孩子说、照着讲稿念;脑是 `qwen3.8-max`,写讲稿和板书。

一行装好(会查 Node 的版本、连不上 npm 就用国内镜像;不用 sudo、不改系统设置)。最后那三个是孩子的短名(小写字母,不用真名)、称呼、年级,不写就只装程序:

```sh
# Mac(终端里)
curl -fsSL https://cdn.jsdelivr.net/npm/cotutor@latest/install.sh | sh -s -- ming 小明 2
```

```powershell
# Windows(PowerShell 里;这行长一点:jsDelivr 不说文件是什么编码,要自己按 UTF-8 解开,不然中文是乱码)
& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString((iwr -useb https://cdn.jsdelivr.net/npm/cotutor@latest/install.ps1).Content))) ming 小明 2
```

连不上 jsDelivr 就从 GitHub 取:

```sh
curl -fsSL https://raw.githubusercontent.com/TarsLab/cotutor/main/install.sh | sh -s -- ming 小明 2
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TarsLab/cotutor/main/install.ps1))) ming 小明 2
```

也可以一条条自己来:

```sh
npm i -g cotutor
cotutor init ming --name 小明 --grade 2     # 建 cotutor 文件夹 ~/cotutor/ming/(三位老师、技能、账本、对话目录、cotutor.json)和旁边的笔记文件夹 ~/cotutor/ming-vault/(档案、日记、记忆)
cotutor service install                    # 装成这台电脑的后台服务,第一次装会打开家长端,孩子的平板在那里扫码
```

Windows 的 PowerShell 缺省禁止运行脚本,报这个错时把 `npm`、`cotutor` 写成 `npm.cmd`、`cotutor.cmd`,不用改系统设置。

以后要打开家长端,点菜单栏(任务栏)的 cotutor 图标或跑 `cotutor open`,服务重启、登录电脑都不会自己弹出来。不想第一次弹,安装时加 `--no-open`。

后台服务登录后自己起来、崩了自己再起、关了终端照样跑,日志按天落文件:`cotutor service status` 看在不在跑,`cotutor service logs` 看日志,`cotutor service restart` 重起。Mac 上用 launchd,Linux 上用 systemd 用户服务,Windows 上是一条用户自己的登录项(不用管理员、没有黑窗口);第一次起来 Windows 可能弹窗问「允许访问」,点允许,平板才连得进来。要在终端里调试用 `cotutor serve`,先 `cotutor service stop` 让出端口。

Mac 和 Windows 上,`service install` 会一起装一个菜单栏(任务栏)图标,不用开终端就能看状态:正常时就是 logo;有事要处理出橙点;后台服务没在跑时 logo 变淡并出红点。状态变差时通知一次。点开图标能看原因、打开家长端、重启服务、看日志。「退出 cotutor」会停掉这台电脑上所有孩子的后台服务,平板打不开,下次登录自动恢复。Windows 的新图标先收在任务栏右下角的 `^` 里。不要图标就 `cotutor tray off`,装服务时加 `--no-tray` 也行。Linux 上没做,用 `cotutor service status` 看。

地址认电脑名,换 Wi-Fi、路由器换 IP 都不用重签证书、不用重扫。端口在 `init` 时选一次写进 `cotutor.json`,以后不变:优先 443,地址里不用写端口(`https://<电脑名>.local/`);443 被占着或系统不让用(Linux 默认不让)就用 8443,再往后 8445、8447;几个孩子各用各的,自动让开。运行时被占只报错说明是谁占着,不会自己换,因为换了端口平板要重新扫码、重加图标。试用(`--sandbox`)的端口永远是真 workspace 的 +1,`cotutor open --sandbox` 打开。

接着三件事:

1. **填百炼**:在这台电脑上打开家长端 `/parent` 的「首页」,填百炼「按量付费」的 API Key 和业务空间 ID,保存前会先试连。API Key 在百炼控制台的「密钥管理」里创建,业务空间 ID 在控制台的业务空间详情里看,以百炼文档为准:[获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)、[首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)(里面讲了业务空间 ID)。Key 跟地域绑定,控制台右上角先选北京。Token Plan 的 `sk-sp-` 不行。没填时孩子端只出「老师们还没到」。
2. **填档案**:笔记文件夹(vault,`~/cotutor/<孩子>-vault/`)里的 `孩子.md` 写 `school_start`(读一年级的年月,如 `2025-09`;`init --grade` 已经算好了),老师据此知道现在是几年级哪个学期;正文写孩子的情况。笔记文件夹里全是普通 markdown,不用装 Obsidian,想用 Obsidian 看就把它当库打开。想用自己已有的 Obsidian 库,第一次 init 时加 `--vault <路径>`(一个孩子一个库;Mac 上别用「文稿」「桌面」和 iCloud 云盘里的,后台服务读不到)。
3. **体检**:`cotutor doctor` 逐项检查,不过的每条都带修法。

装好以后也可以让编程助手帮你管:在孩子的 cotutor 文件夹(`~/cotutor/<孩子>/`)里打开 Claude Code 或 Codex,已带的技能直接能用。`cotutor-home` 排孩子的首页,`cotutor-tune` 调老师的口气和规矩,`cotutor-analyze` 分析某次对话为什么那样答。

`init` 把出厂老师拷进 `agents/<老师>.md`,把做课包用的四个技能 chalk-* 和五个机器件 cotutor-tutor / cotutor-board / cotutor-analyze / cotutor-tune / cotutor-home 拷进 `.agents/skills/`(Codex、Qwen Code 直接读;Claude Code 读的 `.claude/skills` 是链到它的);
做小课堂的课包用 `cotutor chalk`(check / build / bake / snap / dub),烤画面与截图用本机的 Chrome(Windows 上没有 Chrome 就用 Edge)。要在平板上用(按住说话要 HTTPS):`cotutor cert` 签一张
自签证书(要 mkcert:Mac 上 `brew install mkcert`;Windows 上 `winget install FiloSottile.mkcert`,重开终端;Ubuntu、Debian 上 `sudo apt install mkcert libnss3-tools`。再跑 `cotutor cert`,这台电脑还没信任根证书时它会打印要跑的那一行:Mac 弹框输登录密码、Windows 弹窗点「是」,都不用管理员终端),把根证书装到平板并打开信任,`cotutor service restart`(在终端里跑的就重开 `cotutor serve`),扫码打开。iPad 的步骤见 [iPad 与 iPhone](docs/iPad与iPhone.md)。

然后在浏览器里:

- **家长端 `/parent`**:「首页」设孩子的首页(按钮、这周的词、老师的先后),扫码打开(孩子的平板一张、家长自己的手机一张),给老师换头像和声音;「设置」定孩子的平板上按住说话那一栏放哪边;「记录」按天看孩子和每位老师的板书(答案不剥)、看录像、打星、记账、删话题,看这天写进 vault 的每一行,不要的一行一行撤回。右上角「工作台 ↗」去工作台。
- **工作台 `/dev`**:给有技术背景的家长与开发者。和任何一位老师说话、看一轮的原文;老师团页改人设、政策、老师文件,加新老师;设置页改路径、端口。头像与声音只在家长端改。
- **孩子端 `/`**:首页每位老师一张卡,卡上的按钮是家长排好的(新话题、接着以前的话题、带讲法的开场、先看一堂小课堂);点了进板书页,按住说话或打字。老师的回答是一页板书:卡先铺开(选择题、点读、田字格、单词、图、小课堂、画板、拍照),讲稿一句句念、笔跟着声音标注,末句问句停下来等孩子。点一张卡进舞台做题,做完「交给老师」。孩子永远看不到工具、报错、评判。

实时老师的声音由 realtime 模型提供;点读、单词等卡片的配音也走百炼(同一把 key),出厂三位各有一个缺省的。在家长端「首页」点老师的「样子与声音」,再点「换一个」在弹窗里挑(全部音色都在,能搜,能按男女、口音、中英、年纪、场景筛,能试听)。
不花钱先看孩子端长什么样:`cotutor mock` 起一份模拟接口,不经真实老师。

## 年级教学包

面向中国大陆小学一至六年级,当前提供二年级教学包。`cotutor grades` 查看可用年级;新建时未指定 `--grade` 默认二年级,未提供的年级不会自动回退。

出厂文件在 `grades/grade-2/`。三科分别提供预习、检查作业、复习(孩子端老师牌上常驻三块方砖);语文有写话与看图写话,英语有口语课,数学小课堂配合提前做好的课包。家长按教材版本、学期和孩子实际进度设置材料。

孩子当前学期仍由档案决定;升年级不会自动替换家长的老师文件。旧 workspace 执行 `cotutor refresh` 补记二年级来源,保留自定义内容。贡献其他年级与验证方式见 [年级教学包设计](docs/年级教学包.md)。

## 老师是文件

每位老师 = 一个 Markdown 文件(frontmatter + 正文即系统提示)+ cotutor.json 里的一条(显示名、头像、音色、开关、政策)+ 自己的目录与对话。出厂三位(数学、语文、英语)随包发布,init **拷贝**进你的老师们,改了就是你家的;`cotutor refresh` 只换没改过的,改过的打印差异让你定;想回出厂的那份,`cotutor reset <老师>`(你那份存成 .bak)。再加一位:

```sh
cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬
```

名字以 `-tutor` 结尾的是老师(有脸),其余是孩子看不到的工具人。没设头像时,语文、数学、英语老师用包里自带的
出厂头像(包根 `avatars/`,三个木钉娃娃),别的老师显示学科首字。头像可以是 emoji,也可以是
workspace 里的一张图(`avatars/<老师>.png`):用 [figshot](https://github.com/tarslab/figshot)
`figshot pick --workspace ~/cotutor/<孩子>` 让孩子自己搭一个乐高人仔当老师,存盘直接落到这里。
`cotutor.json` 里加一行 `"figshot": { "port": 8477 }`,孩子端首页就多一张「给老师们换个样子」,iPad 上点了直接进去(figshot 没开着时这张卡不出现)。

或者工作台(`/dev`)老师团页点「新老师」。没有注册表,删掉文件和那条配置就是删老师。

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

百炼欠费、key 失效或这台电脑连不上百炼时,图标出橙点并通知,家长端首页说清楚是哪一种;要家长动手的那几种,孩子端显示「老师们还没到,叫爸爸妈妈来看一下」。处理好以后几分钟内自己恢复,也可以在家长端点「试连」。

`cotutor doctor` 检查缺失配置并给修复建议;`--fix` 把能自动修的修掉,`--live` 会实际连接服务。页面上的老师起不来时,先看 doctor 和 `conversations/<老师>/<日期>.<job>.err.log`。家长端与工作台需要访问锁时,运行 `cotutor pin` 设置本机 PIN。

## 遇到问题

家长端「首页」顶部的「还差几步」和橙色提示会说要做什么。还解决不了,到家长端「设置」点「生成诊断信息」(或在电脑上跑 `cotutor report`),看一遍再复制,到 [GitHub Issues](https://github.com/TarsLab/cotutor/issues) 反馈,或者贴给帮你的 AI 助手。里面没有孩子的对话、照片、录音、档案和 key,名字和 IP 已经抹掉。

## 数据与升级

默认 workspace(孩子的 cotutor 文件夹)是 `~/cotutor/<孩子>/`:配置在 `cotutor.json`,老师在 `agents/<老师>.md`,activity 在 `agents/<老师>/activities/`,技能在 `.agents/skills/`,对话在 `conversations/`,账本在 `ledger/`,照片在 `captures/`,课包在 `bundles/`,首页在 `home/`。长期档案、记忆和日记在 vault(笔记文件夹),和 workspace 分开放:缺省是旁边的 `~/cotutor/<孩子>-vault/`,位置写在 `cotutor.json` 的 `paths.vault`(0.4.4 及以前建的没写,vault 就是 workspace 本身,照旧能用,`cotutor doctor` 的 `vault.separate` 说怎么分开),规则见 [obsidian 仓库设计](docs/obsidian仓库设计.md)。workspace 与 vault 都要留着。

**备份**放在 cotutor 文件夹旁边的 `.backups/<孩子>/`,一份就是一个普通目录。服务开着时每天自动备一份(留 14 份),`cotutor refresh` 前也备一份(留 5 份),没变的文件不占第二份地方;`cotutor backup` 随时手动备。**录音(wav)不在备份里**,它占了绝大部分地方;想留就自己拷 `conversations/`。笔记文件夹里的 md 也备一份(在那一份的 `_vault/` 里);恢复时不动笔记文件夹,只告诉你那份在哪,要不要拿回来你定。硬盘坏了这些也跟着没了,重要的话把 `.backups` 再拷到别处。

```sh
cotutor backup list                   # 看有哪些
cotutor backup restore <名字> --yes    # 恢复:先把现在的样子也备一份,再拷回去
```

**有新版本时**,后台服务每天问一次 npm(只发一个普通请求,不带孩子或使用的任何信息),菜单栏(任务栏)图标的菜单和家长端「首页」顶部会说,通知一次,孩子端不说。不会自动升级,因为要重启服务,孩子可能正在上课。不想让它问:在 `~/.config/cotutor/update.json` 写 `{"off": true}`。

升级挑孩子不用的时候,运行一条命令就够了(Windows 上写成 `cotutor.cmd update`,因为 PowerShell 缺省禁止运行脚本,提示里给的就是这样):

```sh
cotutor update
```

它问 npm 有没有新版本,换上新程序,把每个孩子未修改的出厂老师、activity、主题与技能更新掉,再重起服务和图标。孩子正在通话时它不动;下载没成时服务也不动,还跑旧版。每个版本改了什么见 [更新说明](CHANGELOG.md)。

0.4.1 及更早的版本还没有这条命令,第一次要依次运行下面三条,Windows 上同样写成 `npm.cmd`、`cotutor.cmd`。几个孩子的话,后两条每个孩子各跑一次,加 `--workspace ~/cotutor/<孩子>`:

```sh
npm i -g cotutor                      # 换上新版程序
cotutor refresh                       # 更新未修改的出厂老师、activity、主题与技能
cotutor service restart               # 服务和图标换上新代码(在终端里跑的就重开 serve)
```

升完它提示要迁移配置时再跑:

```sh
cotutor refresh --config --dry-run    # 预览 cotutor.json 的迁移
cotutor refresh --config              # 执行配置迁移
```

家长改过的老师与主题保留并显示差异;机器技能会随版本覆盖。配置迁移补缺,并更新未自定义的旧命令模板,保留自定义配置。换了 Node 版本、或包装到了别处,再 `cotutor service install` 一次。

2026-10-30 之前建的 workspace,老师在 `.claude/agents/`、技能在 `.claude/skills/`。`cotutor refresh`(或 `init`)先把它们原样挪到新位置,再照常升级;新位置已有同名的不挪,会点名。`.claude/` 里别的文件不动。

### 旧 workspace 换运行时

2026-11-02 起不再起命令行(Qwen Code;Claude CLI 更早就去掉了),老师只走应用直连百炼。2026-10-31 之前建的 workspace 缺省走 Qwen Code,doctor 会报「命令行运行时不再支持」:先 `cotutor refresh --config` 补上出厂的 `api` / `api-flash`,把 `runtimes.default` 和 `tutors.*.runtime` 改成 `api`,在家长端「首页」填好百炼,再删掉 `qwen`、`qwen-flash`(或更早的 Claude)条目。换之前聊的话题照上面「配置模型」说的办:记录照样能看,不导入、不记账。旧 `proxy` 字段可删除,对应命令已移除。

### 试用不进孩子的记录

自己手动试功能时,命令加 `--sandbox`:第一次从真 workspace 分出一份到旁边的 `.sandbox/<目录名>/`(`~/cotutor/ray` → `~/cotutor/.sandbox/ray`)。老师、activity、首页、主题、课包照拷,对话、照片、听写、账本不带,vault 拷一份;试的对话、记忆、日记都写在这份里。页面标题前带「试用」,端口是真的那个 +1,可以同时开;自动记账关着(要试记账,家长端点「记账」)。

```sh
cotutor serve --sandbox               # 试用的那份;没有就先分出来
cotutor send math-tutor 你好 --sandbox
cotutor serve --sandbox --fresh       # 丢掉试过的,从真 workspace 重新分(真的那边改了老师文件、vault 也用这个带过来)
```

## 卸载

孩子的 cotutor 文件夹(`~/cotutor/<孩子>/`)、笔记文件夹(`~/cotutor/<孩子>-vault/`)和备份(`~/cotutor/.backups/`)是家里的记录,删了找不回来,卸载程序不会碰它们;真不要了自己删。Windows 上命令写成 `cotutor.cmd`、`npm.cmd`。

```sh
cotutor service uninstall --workspace ~/cotutor/<孩子>   # 每个孩子一次;最后一个卸掉时,菜单栏(任务栏)图标也一起卸
npm rm -g cotutor
```

还留在电脑上的,不要了可以删:

- `~/.config/cotutor/`:百炼的 key、证书、家长端密码、几项设置
- 日志:Mac 在 `~/Library/Logs/cotutor/`,Windows 在 `%LOCALAPPDATA%\cotutor\`(里面还有图标的文件),Linux 在 `~/.local/state/cotutor/`;Mac 的图标文件在 `~/Library/Application Support/cotutor/`
- 签证书时装的根证书:跑 `mkcert -uninstall` 从这台电脑的信任里拿掉,再删 `mkcert -CAROOT` 说的那个目录
- 平板上:设置 › 通用 › VPN 与设备管理里删掉那个描述文件,主屏幕上的图标长按删掉
- Windows 防火墙里给 Node.js 开的「允许」:Windows 安全中心 › 防火墙和网络保护 › 允许应用通过防火墙,别的程序也用 Node.js 时留着

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

根目录的 [INSTALL.md](INSTALL.md) 给替家长安装的 AI 助手看。`docs/` 只保留以下六篇,历史讨论查 Git:

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
