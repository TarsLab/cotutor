# word — 单词卡

## 是什么

单词卡:孩子问「X 英语怎么说」、一节里教新词时用的卡。一张卡一个英文单词,写在四线三格里,讲到这张卡时一笔一笔写一遍。卡上没有中文。点开是慢速:慢念,再按自然拼读一段一段慢写。

## 什么时候用 / 别用

- 用:孩子问「X 英语怎么说」「X 怎么拼」。
- 用:一节里的新词,一个词一张。
- 用:短词组也行,如 `ice cream`、`T-shirt`。
- 别用:一串词一起跟读 → `read`。
- 别用:句子、课文 → `read`。
- 别用:中文意思写进卡里 → 说在讲稿里,英文在前、中文在后。

## 写法

- 第一行:emoji 和英文单词,如 `🍎 apple`。
- 能画出来的东西配一个 emoji。抽象的词(like、the)不用配。
- 第二行:自然拼读分段,用 `-` 隔开,如 `ap-ple`、`sh-ee-p`。
- 分段拼起来要和单词一模一样。一个字母一段也行,如 `c-a-t`。
- 一张卡一个词,最多三个词、16 个字母。
- 只写字母、空格、撇号和连字符。不写音标,不写中文谐音。

## 例子

<!-- expect {"kind":"word","props":{"word":"apple","chunks":["ap","ple"],"emoji":"🍎"}} -->
```word
🍎 apple
ap-ple
```

<!-- expect {"kind":"word","props":{"word":"sheep","chunks":["sh","ee","p"],"emoji":"🐑"}} -->
```word
🐑 sheep
sh-ee-p
```

<!-- expect {"kind":"word","props":{"word":"ice cream","chunks":["ice ","cr","ea","m"],"emoji":"🍦"}} -->
```word
🍦 ice cream
ice cr-ea-m
```

<!-- expect {"kind":"word","props":{"word":"like"}} -->
```word
like
```

## 反例

写了中文意思,中文会被去掉,卡照常出:

<!-- expect {"kind":"word","props":{"word":"apple","emoji":"🍎"}} -->
```word
🍎 apple 苹果
```

分段拼不回这个词,分段不要了,卡照常出:

<!-- expect {"kind":"word","props":{"word":"apple"}} -->
```word
apple
a-pl
```

整句写不进一张单词卡,会退成一段文字:

<!-- expect {"kind":"text","warning":true} -->
```word
I like apples very much
```

只有中文也解析不成:

<!-- expect {"kind":"text","warning":true} -->
```word
苹果
```

## 孩子看到什么

卡上是 emoji 和四线三格里的单词,右边一个「听」。讲到这张卡时一笔一笔写一遍。点「听」按正常速度念这个词。点卡打开大的:先慢念一遍,再按分段一段一段慢写,两段两个颜色,写完合拢成一个词,再慢念一遍。孩子点哪一段,那段再慢写一遍。讲稿的 `[apple]` 落在这张卡上,整个词涂一道荧光。

## 你会收回什么

没有——单词卡不记状态(点了几遍不告诉你)。

## 状态的形状

没有。
