# image — 图片

## 是什么

一张图 + 图注:产物里的图、网上的图。

## 什么时候用 / 别用

- 别用:讲孩子拍来的作业 → 照片板(```照片):照片铺在板上,你在上面圈、裁题、写,孩子在上面动手。
- 用:一张现成的插图能说清的概念。
- 别用:要孩子自己画 → `canvas`。
- 别用:路径不存在的图(孩子端只会空一块)。

## 写法

- 第一行是图:workspace 里的相对路径,或 http(s) 地址。只认图片后缀。
- 后面几行是图注。

## 例子

<!-- expect {"kind":"image","props":{"src":"vault/图/三角形的高.png","caption":"三角形的高,从顶点垂直画到底边。"}} -->
```image
vault/图/三角形的高.png
三角形的高,从顶点垂直画到底边。
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
