# cotutor

家里的 AI 老师团,和家长一起教。几位可以直接对话的老师(数学、语文、英语),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

孩子拍的作业、课本或一堂小课堂铺在页上,老师一句句地讲,讲到哪句就在页上圈、盖、写。学完家长打星、记账,记进日记(普通 markdown,想用 Obsidian 看也行)。

面向中国大陆小学,当前提供二年级教学包。

## 五分钟用起来

**让 AI 助手帮你装:** 把这句话发给能在电脑上跑命令的 AI 助手(WorkBuddy、Claude Code、Codex 这类),它会一步步带你做。不用输网址:安装说明跟着 npm 包走,和装上的版本对得上。百炼的 Key 由你自己填在页面上,不用告诉它。

```text
帮我在这台电脑上装 cotutor:先跑 npx cotutor@latest guide,照它说的一步步做。没有 Node 就先告诉我
```

网页版的聊天机器人跑不了命令,换这句,它会一次告诉你一步:

```text
请阅读 https://cdn.jsdelivr.net/npm/cotutor@latest/INSTALL.md ,一步一步带我在这台电脑上安装 cotutor
```

**自己装:** 需要一台电脑(Mac 最省事)、[Node.js](https://nodejs.org) ≥ 22.18(装 LTS 版),和一个百炼账号(北京地域,按量付费)。老师听、说、写讲稿都走百炼,由应用直接调用,不用另装模型客户端。

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
cotutor init ming --name 小明 --grade 2     # 建孩子的 cotutor 文件夹 ~/cotutor/ming/ 和旁边的笔记文件夹 ~/cotutor/ming-vault/
cotutor service install                    # 装成这台电脑的后台服务,第一次装会打开家长端
```

Windows 的 PowerShell 缺省禁止运行脚本,报这个错时把 `npm`、`cotutor` 写成 `npm.cmd`、`cotutor.cmd`,不用改系统设置;下面的命令都一样。

装好以后服务一直在后台跑,登录电脑自己起来。以后要打开家长端,点菜单栏(任务栏)的 cotutor 图标,或跑 `cotutor open`。

## 接着四步

1. **填百炼**:在这台电脑上打开家长端的「首页」,填百炼「按量付费」的 API Key 和业务空间 ID,保存前会先试连。
   - API Key 在百炼控制台的「密钥管理」里创建,业务空间 ID 在业务空间详情里看:[获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)、[首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)。
   - Key 跟地域绑定,控制台右上角先选北京。Token Plan 的 `sk-sp-` 不行。
   - 没填时孩子端只出「老师们还没到」。
2. **填档案**:笔记文件夹(`~/cotutor/<孩子>-vault/`)里的 `孩子.md` 正文写孩子的情况;头上的 `school_start` 是读一年级的年月(`init --grade` 已经算好),老师据此知道现在是几年级哪个学期。
3. **让平板连上**:按住说话要 HTTPS。跑 `cotutor cert` 签一张证书(要先装 mkcert,它会说怎么装),把根证书装到平板上并打开信任,`cotutor service restart`,再在家长端「首页」扫码打开。一步步的做法见 [iPad 与 iPhone](docs/iPad与iPhone.md)。
4. **体检**:`cotutor doctor` 逐项检查,不过的每条都带修法;`--fix` 把能自动修的修掉。

不花钱先看孩子端长什么样:`cotutor mock` 起一份模拟的,不经真实老师。

## 三个页面

- **孩子端 `/`**:首页是桌上一本书,老师们是屏幕下沿的便利贴小旗(头像和学科);翻到哪位,左页摆着他每天都在的课本(英语是预习、复习)、检查作业和家长排好的按钮,右页是今天在他这儿学过的。点了先拍照(或铺课本、铺一堂小课堂),老师一句句地讲,末句问句停下来等孩子;孩子按住说话,用 Apple Pencil 在页上写,写完停一会儿老师就看。孩子永远看不到工具、报错、评判。
- **家长端 `/parent`**:「首页」排孩子的首页、扫码、给老师换头像和声音;「记录」按天看讲稿和录像、打星、记账,写进笔记的每一行都能撤回;「设置」里有诊断信息。
- **工作台 `/dev`**:给有技术背景的家长与开发者。和任何一位老师说话、看一轮的原文,改老师怎么带,加新老师。

也可以让编程助手帮你管:在孩子的 cotutor 文件夹(`~/cotutor/<孩子>/`)里打开 Claude Code 或 Codex,带的技能直接能用。`cotutor-home` 排孩子的首页,`cotutor-tune` 调老师的口气和规矩,`cotutor-analyze` 分析某次对话为什么那样答,`cotutor-workbook` 照教材出一册练习册,`cotutor-textbook` 把课本的分块改好(哪是一道题、哪格能写、老师怎么叫,建议用 Codex)。

## 遇到问题

家长端「首页」顶部的「还差几步」和橙色提示会说要做什么。还解决不了,到家长端「设置」点「生成诊断信息」(或在电脑上跑 `cotutor report`),看一遍再复制,到 [GitHub Issues](https://github.com/TarsLab/cotutor/issues) 反馈,或者贴给帮你的 AI 助手。里面没有孩子的对话、照片、录音、档案和 key,名字和 IP 已经抹掉。

## 数据与升级

孩子的记录在两个文件夹里,都要留着:cotutor 文件夹 `~/cotutor/<孩子>/`(配置、老师、对话、账本、照片)和笔记文件夹 `~/cotutor/<孩子>-vault/`(档案、记忆、日记)。服务开着时每天自动备份一份到旁边的 `.backups/<孩子>/`,录音不在备份里。

有新版本时,菜单栏(任务栏)图标和家长端「首页」顶部会说。后台服务每天问一次 npm(只发一个普通请求,不带孩子或使用的任何信息);不会自动升级,因为要重启服务,孩子可能正在上课。不想让它问:在 `~/.config/cotutor/update.json` 写 `{"off": true}`。

升级挑孩子不用的时候,一条命令(Windows 上写成 `cotutor.cmd update`):

```sh
cotutor update
```

它换上新程序,把每个孩子没改过的出厂老师、activity、主题与技能更新掉,再重起服务和图标;你改过的保留。孩子正在通话时它不动。每个版本改了什么见 [更新说明](CHANGELOG.md)。

## 想了解更多

| 想知道 | 看 |
|---|---|
| 平板怎么装证书、加到主屏幕、常见毛病 | [iPad 与 iPhone](docs/iPad与iPhone.md) |
| 后台服务与图标、地址与端口、备份与恢复、升级的细节、试用不进孩子的记录 | [日常使用](docs/日常使用.md) |
| 老师是哪些文件、加一位老师、换头像、年级教学包、用哪个模型、key 放哪 | [老师与配置](docs/老师与配置.md) |
| 笔记文件夹里放什么、怎么用自己的 Obsidian 库 | [obsidian 仓库设计](docs/obsidian仓库设计.md) |
| 改老师怎么带、写 activity | [写提示词](docs/写提示词.md)、[词表](docs/词表.md) |
| 给首页加一种牌(改代码) | [首页的牌](docs/dev/首页的牌.md) |
| 做别的年级的教学包 | [年级教学包](docs/年级教学包.md) |

## 卸载

孩子的 cotutor 文件夹(`~/cotutor/<孩子>/`)、笔记文件夹(`~/cotutor/<孩子>-vault/`)和备份(`~/cotutor/.backups/`)是家里的记录,删了找不回来,卸载程序不会碰它们;真不要了自己删。

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

开发约定与分模块验证见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md);根目录的 [INSTALL.md](INSTALL.md) 给替家长安装的 AI 助手看。

也能当库用:

```ts
import { CotutorConfigSchema, cotutorJsonSchema } from 'cotutor/schema';  // 契约(zod)与 JSON Schema
import { deriveKidView, parseSections } from 'cotutor/lib';               // 转录、孩子视图、账本等纯函数
import { loadWorkspace } from 'cotutor/workspace';                        // 解析链 + 校验
```

## 许可

cotutor 按 Apache-2.0 加附加条件授权,全文见 [LICENSE](LICENSE)。白话说:

- 家里自己用、自己改都行,几个孩子几个 workspace 都算自己家。
- 替别的家庭或别人运营 cotutor(收不收钱都算),要先拿到书面许可。
- 家长端页脚和工作台的 cotutor 标记不能去掉(自己家用也一样);主题、老师的名字与头像、标题照常改。

这段只是说明,以 LICENSE 原文为准。要许可或商业授权,到仓库开 issue。
