# 在家长的电脑上安装 cotutor

这篇写给替家长安装的 AI 助手。cotutor 是家里的 AI 老师团：程序装在家长的电脑上，孩子在平板上用。要开发本仓库，看 `AGENTS.md`。

- **能跑命令的：** 照下面一步步跑。每步先看「成功」；不符合再看「不成功」。这里没写的 cotutor 命令不要自己编，用法不确定就看 `cotutor --help`。
- **不能跑命令的（网页聊天）：** 一次只告诉家长一步，等家长贴回结果再走下一步。
- **【交给家长】的步骤必须停下：** 告诉家长做什么，等家长说做完了再继续。不要替家长做，也不要绕过去。

跟家长说话时用家常话：`slug` 说成「孩子的短名」，workspace 说成「孩子的文件夹」。

## 不能做

- 不要让家长把百炼的 API Key 贴进对话，对话内容会传到你的厂商那里。家长贴了，提醒他们到百炼控制台换一把。也不要读 `~/.config/cotutor/bailian.json`。
- 不要 `git clone` 本仓库，用 npm 装。
- 不要用 `sudo` 跑 npm。
- 不要跑 `cotutor upgrade --force`。
- 不要跑 `cotutor backup restore`，除非家长明确说要恢复。
- 不要删孩子的文件夹（缺省 `~/cotutor/<slug>/`）和 vault，里面的记录删了找不回来。
- 不要关防火墙，不要改系统安全设置或 PowerShell 执行策略。

## 1. 看环境

```sh
node -v
```

**成功：** `v22.18` 或更高。系统是 macOS、Windows 或 Linux。

**不成功：** 没有 Node 或版本太低：**【交给家长】** 到 https://nodejs.org 装 LTS 版，装完重开终端。

**已经装过：** 如果 `cotutor doctor --json` 能跑，而且 `root` 不是 `null`，这台电脑已经有孩子的文件夹了。问家长是要升级，还是再加一个孩子。升级看 README 的「数据与升级」，这篇不用接着做。再加一个孩子就接着做，并且从第 4 步起，除 `cotutor cert` 外，每条 cotutor 命令都加 `--workspace ~/cotutor/<slug>`。

## 2. 装程序

```sh
npm i -g cotutor
cotutor --version
```

**成功：** 打印出版本号。

**不成功：**
- 下载慢或超时：加上 `--registry=https://registry.npmmirror.com` 再装一次。
- 报 `EACCES`（没权限）：不要加 `sudo`。跑 `npm config set prefix ~/.npm-global`，把 `~/.npm-global/bin` 加进 PATH，再装一次。
- 找不到 `cotutor`：重开终端再试。还不行，跑 `npm prefix -g` 看装到了哪，把那个目录下的 `bin`（Windows 上是目录本身）加进 PATH。
- Windows 的 PowerShell 说禁止运行脚本：这篇里所有的 `npm`、`cotutor` 都改用 `npm.cmd`、`cotutor.cmd`。不要改执行策略。

## 3. 建孩子的文件夹

问家长三件事：
- **短名（slug）：** 小写字母、数字、连字符，如 `ming`。不要用真名，它会出现在路径和对话里。
- **称呼：** 老师怎么叫孩子，小名就行。
- **年级：** 1 到 6。

```sh
cotutor grades --json
cotutor init <slug> --name <称呼> --grade <年级>
```

**成功：** 第一行是「cotutor init →」加文件夹路径，缺省是 `~/cotutor/<slug>/`。cotutor 的输出把家目录写成 `$HOME`（为了不把用户名传出去），`$HOME/cotutor/<slug>` 就是这个文件夹，不是别的地方。重复跑只补缺，已有的文件不动。

**不成功：** 家长说的年级不在 `grades` 列出的里面：这个年级还没有教学包，不要换成别的年级。告诉家长，问他们想怎么办。

## 4. 装后台服务

```sh
cotutor service install --no-open
```

`--no-open` 是先不打开家长端，第 7 步再开：第 6 步切到 HTTPS 后，之前开的页面会打不开。

**成功：** 退出码 0，输出里有「后台服务」和「家长端」两行。Mac 和 Windows 上还会多一个菜单栏（任务栏）图标。以 `!` 开头的行都记下来，第 7 步转告家长。

**不成功：**
- 退出码不是 0：跑 `cotutor service logs`，把原因告诉家长。
- 说端口上有一个 `cotutor serve` 在终端里跑着：请家长关掉那个终端，再装一次。

**【交给家长】（只在出现时）：**
- Windows 弹窗问「允许访问」：点允许，平板才连得进来。
- Linux 输出里有 `sudo loginctl enable-linger`：请家长自己跑那一行，不登录时服务才会继续跑。

## 5. 体检

```sh
cotutor doctor --fix
cotutor doctor --json
```

`--fix` 把能自动修的都修掉（幂等，不碰孩子的数据，不用人输东西）。然后看 `--json` 的输出：`checks` 是一个列表，逐条看 `ok` 为 `false` 的：

- **有 `human: true`：** 不要动手。记下 `detail` 和 `fix`，第 7 步交给家长。
- **还有 `cmd`：** `--fix` 跑过了还在，说明修不好。停下，把 `detail` 告诉家长，不要试别的办法。

**成功：** 不过的条目里已经没有 `cmd`。这时退出码可能还是 1，没关系：百炼要家长自己填，填之前 `bailian` 这条过不了。

## 6. 让平板能用

平板上按住说话要 HTTPS，所以要签一张证书。

```sh
cotutor service status --json
```

`cert.serving` 已经是 `true` 就跳过这一步。

先装 mkcert：
- Mac：`brew install mkcert`。
- Windows：`winget install FiloSottile.mkcert`，然后重开终端。
- 别的情况（Linux、没有 brew 或 winget）：**【交给家长】** 照 `cotutor doctor --json` 里 `https` 那条的 `fix` 装。

**【交给家长】** 请家长在这台电脑的终端里自己跑 `mkcert -install`。Mac 上要输开机密码，Windows 上弹窗点「是」。密码不要说给你听。

家长做完后：

```sh
cotutor cert
cotutor service restart
cotutor service status --json
```

**成功：** `cert.present`、`cert.coversName`、`cert.serving` 都是 `true`。

**不成功：**
- 说 PATH 里没有 mkcert：重开终端再试。
- 说要先跑 `mkcert -install`（包括 `cotutor cert` 输出里以 `!` 开头的那行，这时证书签好了，但这台电脑的浏览器会报警告）：回到上面，交给家长。做完不用重签。

**【交给家长】** 把根证书装到每台平板上，并打开信任开关：最省事是在家长端「扫码打开」点「装证书」，用平板的相机扫；步骤见 [iPad 与 iPhone](https://github.com/TarsLab/cotutor/blob/main/docs/iPad与iPhone.md) 的第 3、4 节。`cotutor cert` 的输出写了根证书的位置，安卓怎么装也写在那里。

## 7. 告诉家长

```sh
cotutor service status --json
```

**成功：** `health.mode` 是 `service`，`health.version` 和 `version` 一样。

**不成功：** `health` 是 `null`：看 `portHolder`（端口被谁占着）和 `cotutor service logs`，把原因告诉家长。解决不了就跑 `cotutor report`，把输出给家长，请家长到 https://github.com/TarsLab/cotutor/issues 反馈；里面没有孩子的对话和 key。

确认成功后，跑 `cotutor open`，在这台电脑上打开家长端。再告诉家长这些，安装就结束了：

1. **家长端地址：** `parentPage`，刚才已经打开了。以后点图标或跑 `cotutor open` 就能打开，登录电脑时不会自己弹出来。
2. **二维码：** 在家长端「首页」的「扫码打开」，孩子的平板扫一张，家长的手机扫一张。不扫码时，平板上要输的地址是 `tabletUrl`。
3. **后台服务装好了：** 关了终端照样跑，登录这台电脑后自己起来。Mac 看菜单栏的 cotutor 图标，Windows 看任务栏右下角 `^` 里的图标；图标上出橙点是有事要处理，变淡加红点是没在跑。Linux 上没有图标，用 `cotutor service status` 看。
4. **还要家长做的事：**
   - **【交给家长】填百炼（必做）：** `bailian` 是 `false` 时，在这台电脑上打开家长端「首页」，填百炼「按量付费」的 API Key 和业务空间 ID，保存前会先试连。控制台右上角先选北京；`sk-sp-` 开头的 Token Plan 不行。没填时孩子端只显示「老师们还没到」。提醒家长：**直接填在页面上，不要贴到对话里。**
   - **【交给家长】第 4 步记下的 `!` 行和第 5 步记下的 `human` 条目：** 逐条转告。通常有填孩子档案（`vault.profile`，老师靠它知道孩子几年级）、设家长端密码（`server.access`，家长在旁边可以不设）、电脑别睡（`mac.sleep`、`windows.sleep`，睡着时平板连不上）。

不用等家长填完。家长填好百炼后，`cotutor doctor --json` 的 `ok` 会变成 `true`。
