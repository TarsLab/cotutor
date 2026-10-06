---
name: drawtell-cli
description: drawtell 工具链用法领域:工作区解析、CLI 调用方式、反馈阶梯(typecheck / check / snap)与 index.json 契约、烤画面 bake、配音 dub、预览 serve。跑工具、自检截图、配音、起预览时读。不是:机制实现(在 drawtell 仓 src/cli)、这道题怎么讲(→ drawtell-teaching)、场景怎么写(→ drawtell-scene)。
---

# 工具用法

## 工作区

在**内容工作区**根目录工作,或任何目录下用全局参数 `--workspace <dir>` 指定工作区
(优先级:`--workspace` > cwd 的 drawtell.json > `~/.config/drawtell/config.json` 的 workspace > cwd 兜底;
场景文件等位置参数仍按 cwd 解析)。`scenes/`(讲解动画源)相对工作区根;
`bundles/`、`snaps/` 相对**派生根**(缺省 = 工作区,建议就用缺省;`drawtell.json` 的 `paths` 可指到别处,见下);
工具与工作区分离见 drawtell 的 docs/文件系统.md,drawtell 仓自身也可以当工作区用。

家庭真题、作业照片一般放一个**自己的私有工作区**——本包所有 skill 一律写作"工作区",不假定路径,
内容也不进包。

**进来先跑 `drawtell ls`**:agent 无记忆,它一行一个场景把五态给全——源 / 课包 / 音频 / 截图 / 验收。
标 `orphan` 的是「课包在、工作区没有源」,多半是工具仓种子(`seed:<id>` build 进来的);
全量重建时别只扫 `scenes/`,会漏掉它们。

`drawtell.json` 的 `paths` 段能把派生物 `bundles/`、`snaps/` 指到别处(缺省且建议就在工作区下、`.gitignore` 排除);
`attachments` 是 `note` 落终帧的目录角色(可指到工作区外的绝对路径,可能含空格,shell 里加引号)。
每条 `--json` 都回报解析到了哪个工作区与各角色目录,家目录脱敏成 `$HOME`。家长面的其它目录(日记、档案、照片)由调用它的应用定义,本 skill 只管命令。
`title` 是孩子端界面标题,缺省 `drawtell`——serve 的课包清单页与应用层页面都经 `/api/config` 读它。
验收状态在工作区根 `reviews.json`(网页写、`drawtell ls` 读)。

## CLI 调用

装了 npm 包(`npm i -g drawtell`)直接 `drawtell`;从仓库检出跑用绝对路径 `node <drawtell 检出>/bin/drawtell.js`。
应用可能给你一个壳脚本(cotutor 是 `../../.cotutor/drawtell`,指向它自己 node_modules 里的这份),有壳就用壳,别找别处。

## 反馈阶梯(便宜层先消化)

1. 类型层:`drawtell check` 自带(内嵌 tsc,把场景里的 `import type … from 'drawtell'` 映射到包内类型;工作区不需要
   tsconfig、不需要装 typescript),类型错误与结构错误一起出在 findings 里(rule `types`,带 文件:行:列 TS 号);
   `--no-types` 可跳过。仓库内另有 `pnpm typecheck` 管全仓
2. `drawtell check scenes/<id>.ts --json`——修到 0 错误;警告逐条判断。文字宽按字宽表算
   (真播放器量的:汉字 1em,数字、字母各有各的宽;行高 1.25),和真实渲染差不到 2%,排版按同一把尺子算
3. `drawtell snap scenes/<id>.ts --no-cursor` → `snaps/<id>/step-*.png` + `index.json`。
   `--no-cursor` 不画笔尖,帧里只剩笔迹;不加也行,但要知道笔尖停在本步末笔处,不算画面元素。
   index.json(v2)的 shots[] 把每张图和该步讲稿配好对,并列出该步新增元素
   (`added[]`:id / type / strokeColor / backgroundColor / text / 近似 bbox)与画板 `board.viewBox`——
   数数对着 added 数,越界对着 viewBox 判(bbox 是场景坐标,图像像素 =
   (坐标 − viewBox 原点) × 图宽 / viewBox 宽)。
   修单步后 `--step <n>` 只重截那一步(index.json 合并写入);若改动影响了整体包围盒
   (播放器按整场等比缩放),其他帧比例会陈旧,最后再全量截一次

## 烤画面 bake

`drawtell bake <id>`(或 `scenes/<id>.ts`,先 check + build)→ `bundles/<id>/bake.json`:画面在浏览器里静态导出一次,
存每一笔的路径与长度、笔尖轨迹、内嵌字体。孩子端照它现画,不再在孩子的设备上跑 excalidraw。

- **snap 会顺手烤**:没烤过或画面改过才烤。走完反馈阶梯,课包就是烤好的。
- **只改了讲稿、配音,不用重烤**;改了画面(元素、背景图)要重烤,不重烤应用会当它没烤过。
- 要 playwright,同 snap。

## 配音 dub

`drawtell dub <id>`(音色/语气政策在工作区根 `drawtell.json` 的 dub 段,先 `--dry-run` 算账;
改一句讲稿只重合成一句)。dub 会报每步"音 X s / 画 Y s → 拉伸 ×n":播放器把该步笔画拉伸到
讲稿长度(只拉不缩,封顶 5 倍),"一边画一边数"就真的一个一个出来;超过 5 倍怎么办是讲法问题,
口径在 drawtell-teaching 讲稿套路。

## 预览 serve

工作区 `drawtell serve` 后,`http://localhost:5175/`(iPad 用局域网地址)**无参即课包清单页**(读 `/api/bundles`,标题 = 工作区 `title`),
点卡片进 `?scene=<id>`;`&bench=1` 是大人用的打磨台。`bundles/`、`snaps/` 是可随时 `rm -rf` 的派生物,**别往 `bundles/` 里放手写文件**。

## 待引擎(写场景时按现状)

- 播放器按整场包围盒等比缩放,**不按宽缩放、不跟笔滚动**——试卷式布局(drawtell-scene)先把高度控制在一屏内。
- `snap` 的 index.json `added[]` 不带 `customData`(role 看不到);verify 按位置与类型判段落。
- `check` 不核 `steps[].line` 与说明文件的讲稿是否一致——试跑期靠纪律。

三条落在 CLI 仓后本节删。
