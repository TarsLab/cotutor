---
name: chalk-cli
description: 做课包的命令 cotutor chalk 怎么用:反馈阶梯(check / snap)与 index.json 契约、build 出课包、烤画面 bake、配音 dub、在舞台上预览。跑工具、自检截图、配音、预览时读。不是:这道题怎么讲(→ chalk-teaching)、场景怎么写(→ chalk-scene)、截图怎么评(→ chalk-verify)。
---

# 工具用法

## 在哪儿跑

在孩子的 workspace 里跑 `cotutor chalk …`(或任何目录下加 `--workspace <dir>`)。
课包出到 workspace 的 `bundles/<id>/`(`--bundles <dir>` 换),孩子端的小课堂、lecture 卡就从这里放;
截图出到 `bundles/` 旁边的 `snaps/<id>/`(`--out` 换)。`bundles/`、`snaps/` 是派生物,能随时重出,**别往里放手写文件**。
场景源放哪都行(workspace 的 `scenes/`,或单独一个做课的目录),位置参数与 `--out` / `--bundles` 的相对路径按当前目录。
每条命令都有 `--json`(路径里的家目录脱敏成 `$HOME`)。

## 反馈阶梯(便宜层先消化)

1. 类型层:`cotutor chalk check` 自带(内嵌 tsc,把场景里的 `import type … from 'cotutor/chalk'` 映射到包内类型;工作区不需要
   tsconfig、不需要装 typescript),类型错误与结构错误一起出在 findings 里(rule `types`,带 文件:行:列 TS 号);
   `--no-types` 可跳过
2. `cotutor chalk check scenes/<id>.ts --json`——修到 0 错误;警告逐条判断。文字宽按字宽表算
   (真播放器量的:汉字 1em,数字、字母各有各的宽;行高 1.25),和真实渲染差不到 2%,排版按同一把尺子算
3. `cotutor chalk snap scenes/<id>.ts --no-cursor` → `snaps/<id>/step-*.png` + `index.json`(先 check + build;要本机的 Chrome)。
   `--no-cursor` 不画笔尖,帧里只剩笔迹;不加也行,但要知道笔尖停在本步末笔处,不算画面元素。
   index.json(v2)的 shots[] 把每张图和该步讲稿配好对,并列出该步新增元素
   (`added[]`:id / type / strokeColor / backgroundColor / text / 近似 bbox)与画板 `board.viewBox`——
   数数对着 added 数,越界对着 viewBox 判(bbox 是场景坐标,图像像素 =
   (坐标 − viewBox 原点) × 图宽 / viewBox 宽)。
   修单步后 `--step <n>` 只重截那一步(index.json 合并写入);若改动影响了整体包围盒
   (播放器按整场等比缩放),其他帧比例会陈旧,最后再全量截一次

## 出课包 build

`cotutor chalk build scenes/<id>.ts` → `bundles/<id>/`(scene.json + manifest.json;先 check,有错不出)。
背景图拷进课包。已有的 `audio/` 不动:讲稿没改的步,build 照旧挂上那一步的配音;改了的步等重新 dub。

## 烤画面 bake

`cotutor chalk bake <id>`(或 `scenes/<id>.ts`,先 check + build)→ `bundles/<id>/bake.json`:画面在本机 Chrome 里静态导出一次,
存每一笔的路径与长度、笔尖轨迹、内嵌字体。孩子端照它现画,不再在孩子的设备上跑 excalidraw。

- **snap 会顺手烤**:没烤过或画面改过才烤。走完反馈阶梯,课包就是烤好的;截图用的就是孩子端那套渲染。
- **只改了讲稿、配音,不用重烤**;改了画面(元素、背景图)要重烤,不重烤应用会当它没烤过(服务端发现了会在后台补烤)。

## 配音 dub

`cotutor chalk dub <id>`:音色用 `--voice <音色 id>`,或 `--tutor <老师>`(缺省 math-tutor)在 cotutor.json 里配的卡的音色;
语气 `--instruction <一句话>` 可选。先 `--dry-run` 算账;讲稿与音色都没变的步不重配。
dub 会报每步"音 X s / 画 Y s → 拉伸 ×n":播放器把该步笔画拉伸到
讲稿长度(只拉不缩,封顶 5 倍),"一边画一边数"就真的一个一个出来;超过 5 倍怎么办是讲法问题,
口径在 chalk-teaching 讲稿套路。

## 预览

`cotutor serve` 起着时,在电脑上打开 `/stage/?bundle=/api/bundles/<id>/&autoplay=1`,就是孩子看到的小课堂(从头放、能拖)。
要孩子在首页看到它,挂到首页(cotutor-home 技能)。

## 待引擎(写场景时按现状)

- 播放器按整场包围盒等比缩放,**不按宽缩放、不跟笔滚动**——试卷式布局(chalk-scene)先把高度控制在一屏内。
- `snap` 的 index.json `added[]` 不带 `customData`(role 看不到);verify 按位置与类型判段落。
- `check` 不核 `steps[].line` 与说明文件的讲稿是否一致——试跑期靠纪律。
