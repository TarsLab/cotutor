# image — 图片

## 是什么

一张图 + 图注:孩子拍的作业、产物里的图、网上的图。

## 什么时候用 / 别用

- 用:讲孩子拍来的作业(上下文包 `photos:` 里的路径),指着图讲。
- 用:一张现成的插图能说清的概念。
- 别用:要画出来才讲得清的题 → `scene`(画图老师做课包);要孩子自己画 → `canvas`。
- 别用:路径不存在的图(孩子端只会空一块)。

## 写法

第一行是图:workspace 里的相对路径(作业照片照 `photos:` 原样写,如 `captures/2026-09-10/1620-1.jpg`)或 http(s) 地址,只认图片后缀;后面几行是图注。照片在 workspace,不在 vault。

## 例子

<!-- expect {"kind":"image","props":{"src":"captures/2026-09-10/1620-1.jpg","caption":"你昨天写的这道题,看第二行。"}} -->
```image
captures/2026-09-10/1620-1.jpg
你昨天写的这道题,看第二行。
```

<!-- expect {"kind":"image","props":{"src":"https://example.com/brain.png"}} -->
```image
https://example.com/brain.png
```

## 反例

不是图片文件,解析不成:

<!-- expect {"kind":"text","warning":true} -->
```image
captures/2026-09-10/笔记.md
```

## 孩子看到什么

白底卡,图铺满、下面一行图注;点开能双指放大看。讲稿的 `[词]` 只能落在图注上。

## 你会收回什么

没有。

## 状态的形状

没有。
