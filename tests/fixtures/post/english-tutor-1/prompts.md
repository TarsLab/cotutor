<!-- ===== 拍 0(卡 0) ===== -->
下面是一节板书讲到一半的样子(孩子看到的结构):div.row 一行、div.c 一张卡、data-tint / data-look 是它现在的底色与字形、data-marked 是这张卡上已经画了的标注;class 带 now 的那张卡是刚出现的这一拍,后面的 p.line 是老师讲这张卡时说的话(它的 data-marked 是念到这句时已经要画的)。

```html
<!-- 这是第一张卡,前面没有 -->
<div class="c c-text now" id="c0" data-tint="sky"><h3>Fruits</h3><p>水果</p></div>
<!-- 这拍没有讲稿 -->
```

已标过的词(老师标的或前面定的,已经画在卡上了,不要再标):
(还没有)

你是这节板书的后期(排版与划重点),不是老师。老师已经决定了卡上写什么、讲稿说什么、答案是什么;你只决定这一拍:now 这张卡接上一行还是另起一行、用哪个底色槽 / 字形槽、要不要一个 emoji、讲到每句时在卡上标哪个词、用哪支笔。

## 端
这节要在 phone 上看:手机竖屏,很窄:一行一张为主,只有两张都很短(各不到 20 字、没有选项)的卡才并排。

## 底色槽 tint(缺省 paper;一张卡一个)
- paper:公式、图、代码:白底,不抢
- sky:结论、定义、要记住的一句
- moss:方法、那一下、验算
- sand:事实、例子、列表、引言
- plum:题目、要孩子做的
- night:封面、反面、一节的收尾

## 字形槽 look(不写 = 缺省)
- plain:缺省:小标题 + 正文
- title:一句话看懂:大字居中
- formula:算式:衬线居中
- quote:引一句原文:斜体居中

## 笔 pen
- marker:荧光笔:要记住的一句 / 一个公式
- tint:术语底:正在定义的词
- underline:下划线:事实里的关键数字 / 词
- box:方框:列表的引导词、选项
- circle:圈:并列几项里点到的那个

## 规则
- **标注的词只从卡上取,不从讲稿里取**:<mark> 里的词必须**逐字**出现在那张卡自己的文字里(上面 HTML 里那张卡的 h3 / p / li / code 里的字)。p.line 是老师嘴里说的话,孩子看不到,讲稿里有、卡上没有的词标不上,会被整处丢掉。反例:卡上写「14 − 8 = 6」,讲稿说「14减8,先看个位」,标「14减8」✗(卡上没有这几个字),标「14」✓;卡上没有合适的词就不标。
- class 带 c-tianzige 的卡(田字格)格里是笔顺动画不是文字,注释只是告诉你写的是哪几个字:**不要给它放任何 <mark>**,只定 data-row / data-tint / data-emoji。
- 补丁是 now 那张卡的壳 <div class="c" id="…">(class 就写 "c",别的类名不抄),正文不抄,属性是你的决定:data-row="same" 接在上一张卡那一行(兄弟卡:两种情况、公式和它所属的那一步、三步搞懂),data-row="new" 另起一行;一行最多 3 张,标题行(h2.heading)与 class 带 alone 的卡永远独占(写了 same 也会被改成 new)。data-tint / data-look / data-emoji 只给需要的;同类卡用同一个底色槽(前后呼应);emoji 只给要记住的那一两张,单个 emoji(📐 🌙 这种;不要 👨‍🏫 👩‍👧 这类几个拼成的组合,不要带肤色、不要文字)。
- 壳里每个 <mark data-pen="…">词</mark> 是一处新标注:词取自卡上(见第一条),数字与拉丁词要整个词;一句最多 2 处,一张卡整节最多 3 处;缺省标 now 这张卡,data-card="c1" 只能指前面已定的卡;data-marked 里已经有的词不要再标(那是老师的决定,已经画上了),也不要标封面标题和整句;这一拍没有值得标的就不放 <mark>,多数封面、题目卡都不用标。
- data-said="…":讲稿念到这个词时动笔,页面靠它决定念到哪个字才画;**只有 said 从讲稿里取**(必须逐字出现在这一拍的某句 p.line 里,一字不差),卡上的词讲稿里原样说了就不用写,拿不准就不写。
- 壳里放一个空的 <p class="line" data-n="1" data-for="c0"></p>:这一拍的第 n 句(0 起)其实在讲前面的卡(回头讲公式、指结论卡);不写 = 讲 now 这张卡。

## 现在就为上面 now 那张卡回一个补丁
补丁 = 那张卡的 <div class="c" id="…"> 壳(class 就写 "c",id 照抄 now 那张卡的),只带你的决定和新标注,正文不抄。<mark> 里的词只从卡上的字里取,不从 p.line 讲稿里取;卡上没有合适的词、或者是田字格卡,就一个 <mark> 都不放。回答的第一个字符就是 <,不要分析、不要解释、不要围栏、不要别的字。形状:
<div class="c" id="c0" data-row="same|new" data-tint="sky" data-look="plain" data-emoji="📐"><mark data-pen="tint" data-said="…">…</mark><p class="line" data-n="1" data-for="c0"></p></div>


<!-- ===== 拍 1(卡 1) ===== -->
下面是一节板书讲到一半的样子(孩子看到的结构):div.row 一行、div.c 一张卡、data-tint / data-look 是它现在的底色与字形、data-marked 是这张卡上已经画了的标注;class 带 now 的那张卡是刚出现的这一拍,后面的 p.line 是老师讲这张卡时说的话(它的 data-marked 是念到这句时已经要画的)。

```html
<div class="c c-text" id="c0" data-tint="sky"><h3>Fruits</h3><p>水果</p></div>
<div class="c c-read now" id="c1" data-tint="sand" data-marked="「apple」「banana」「orange」"><p>apple 苹果</p><p>banana 香蕉</p><p>orange 橘子</p></div>
<p class="line" data-n="0" data-marked="c1「apple」 c1「banana」 c1「orange」">Listen and repeat: apple, banana, orange. 点一下听一下,跟着我读。</p>
<p class="line" data-n="1" data-marked="c1「apple」 c1「banana」 c1「orange」">Which one do you want to try first, apple, banana, or orange?你先读哪一个?</p>
```

已标过的词(老师标的或前面定的,已经画在卡上了,不要再标):
- c1:「apple」「banana」「orange」

你是这节板书的后期(排版与划重点),不是老师。老师已经决定了卡上写什么、讲稿说什么、答案是什么;你只决定这一拍:now 这张卡接上一行还是另起一行、用哪个底色槽 / 字形槽、要不要一个 emoji、讲到每句时在卡上标哪个词、用哪支笔。

## 端
这节要在 phone 上看:手机竖屏,很窄:一行一张为主,只有两张都很短(各不到 20 字、没有选项)的卡才并排。

## 底色槽 tint(缺省 paper;一张卡一个)
- paper:公式、图、代码:白底,不抢
- sky:结论、定义、要记住的一句
- moss:方法、那一下、验算
- sand:事实、例子、列表、引言
- plum:题目、要孩子做的
- night:封面、反面、一节的收尾

## 字形槽 look(不写 = 缺省)
- plain:缺省:小标题 + 正文
- title:一句话看懂:大字居中
- formula:算式:衬线居中
- quote:引一句原文:斜体居中

## 笔 pen
- marker:荧光笔:要记住的一句 / 一个公式
- tint:术语底:正在定义的词
- underline:下划线:事实里的关键数字 / 词
- box:方框:列表的引导词、选项
- circle:圈:并列几项里点到的那个

## 规则
- **标注的词只从卡上取,不从讲稿里取**:<mark> 里的词必须**逐字**出现在那张卡自己的文字里(上面 HTML 里那张卡的 h3 / p / li / code 里的字)。p.line 是老师嘴里说的话,孩子看不到,讲稿里有、卡上没有的词标不上,会被整处丢掉。反例:卡上写「14 − 8 = 6」,讲稿说「14减8,先看个位」,标「14减8」✗(卡上没有这几个字),标「14」✓;卡上没有合适的词就不标。
- class 带 c-tianzige 的卡(田字格)格里是笔顺动画不是文字,注释只是告诉你写的是哪几个字:**不要给它放任何 <mark>**,只定 data-row / data-tint / data-emoji。
- 补丁是 now 那张卡的壳 <div class="c" id="…">(class 就写 "c",别的类名不抄),正文不抄,属性是你的决定:data-row="same" 接在上一张卡那一行(兄弟卡:两种情况、公式和它所属的那一步、三步搞懂),data-row="new" 另起一行;一行最多 3 张,标题行(h2.heading)与 class 带 alone 的卡永远独占(写了 same 也会被改成 new)。data-tint / data-look / data-emoji 只给需要的;同类卡用同一个底色槽(前后呼应);emoji 只给要记住的那一两张,单个 emoji(📐 🌙 这种;不要 👨‍🏫 👩‍👧 这类几个拼成的组合,不要带肤色、不要文字)。
- 壳里每个 <mark data-pen="…">词</mark> 是一处新标注:词取自卡上(见第一条),数字与拉丁词要整个词;一句最多 2 处,一张卡整节最多 3 处;缺省标 now 这张卡,data-card="c1" 只能指前面已定的卡;data-marked 里已经有的词不要再标(那是老师的决定,已经画上了),也不要标封面标题和整句;这一拍没有值得标的就不放 <mark>,多数封面、题目卡都不用标。
- data-said="…":讲稿念到这个词时动笔,页面靠它决定念到哪个字才画;**只有 said 从讲稿里取**(必须逐字出现在这一拍的某句 p.line 里,一字不差),卡上的词讲稿里原样说了就不用写,拿不准就不写。
- 壳里放一个空的 <p class="line" data-n="1" data-for="c0"></p>:这一拍的第 n 句(0 起)其实在讲前面的卡(回头讲公式、指结论卡);不写 = 讲 now 这张卡。

## 现在就为上面 now 那张卡回一个补丁
补丁 = 那张卡的 <div class="c" id="…"> 壳(class 就写 "c",id 照抄 now 那张卡的),只带你的决定和新标注,正文不抄。<mark> 里的词只从卡上的字里取,不从 p.line 讲稿里取;卡上没有合适的词、或者是田字格卡,就一个 <mark> 都不放。回答的第一个字符就是 <,不要分析、不要解释、不要围栏、不要别的字。形状:
<div class="c" id="c1" data-row="same|new" data-tint="sky" data-look="plain" data-emoji="📐"><mark data-pen="tint" data-said="…">…</mark><p class="line" data-n="1" data-for="c0"></p></div>
