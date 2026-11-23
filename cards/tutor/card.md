# tutor — 老师卡

## 是什么

老师卡:首页上一位老师一张,卡上几个按钮,孩子点哪个就带着哪个意思进这位老师——进一个 activity(带着家长填的范围、重点),或者先看一堂做好的小课堂。每个按钮进去都是一个新话题。只用在首页。

## 什么时候用 / 别用

- 用:排首页时,给每位要推荐下一步的老师写一张:预习下一课、看一堂小课堂再聊。
- 用:同一位老师有两三件事,写在同一张卡上,一行一个按钮。
- 别用:在板书里写老师卡 → 板书里退成一段文字;老师之间不互相推荐。
- 别用:没什么要推荐的老师不必写 → 应用会补一张(只有每天都在的方砖)。
- 别用:同一位老师写两张 → 只认第一张,检查会让你合并。

## 写法

围栏标签 `tutor <老师的键>`(cotutor.json tutors 里的英文名,如 `chinese-tutor`)。正文一行一个按钮,只有两种;孩子看到的字最多 16 个字,孩子的口吻;最多 4 个按钮。

- `activity <名> [孩子看到的字]` = **activity 按钮**:进这位老师的一个 activity(`agents/<老师>/activities/<名>.md`,如看图说话)。字不写就是 activity 的名字。孩子点了新开一个话题,老师照那个 activity 文件带。
- `小课堂 <课包或视频的 id> <孩子看到的字>` = **小课堂按钮**:孩子点了先铺满看这一课(课包 `bundles/<id>/`,或视频 `lectures/<id>/`),看完才能开口;开口那句新开一个话题,老师拿到课的每句原话与孩子看的情况。
- 小课堂按钮下面可以挂一行 `activity: <名>`:孩子看完课开口那条起,老师照那个 activity 带(参数用缺省)。如看图说话的课,挂 `activity: 看图说话`。
- activity 按钮下面 `名: 值` 的行是这个 activity 的参数(家长填的),一行一个。有哪些参数、什么类型、能不能空,看那个文件的「## 家长填的」;检查会对。孩子看不到。
- 做练习册(`activity 做练习册`)要填 `练习册: <名>`:vault `练习册/` 下那一册的文件夹名。那一册读不出来,检查报一句,孩子端不出这颗按钮。
- `讲法: …` 挂在上一个按钮下面,写给老师的:从哪开始、重点是什么、讲到哪收。可以写多行。孩子看不到。
- `留到: <日期>` 挂在上一个按钮下面:这个按钮留到那天(含那天),过了孩子就看不到。不写就一直留着。
- 方砖不用写:课本(语文、数学)、预习与复习(英语)、检查作业,老师家里有那个 activity 文件就常驻在牌上(家长端「每天都在」能关),点了参数全用缺省。课本还要 vault 里有这一科的课本 PDF,没有就不出。要带范围、重点,才另写一个 `activity 课本` 按钮;两个都留着,方砖不占按钮的名额。
- 没有开场按钮(普通的一行)、接着按钮、新话题(2026-11-16 删了):话题都从 activity 开始;今天聊过的话题孩子在首页「今天」那一行接。

## 例子

activity 按钮(看图说话没有参数;课本填了「范围」,孩子看到的字另写):

<!-- expect {"kind":"tutor","props":{"tutor":"chinese-tutor","buttons":[{"kind":"activity","label":"看图说话","activity":"看图说话","params":{}},{"kind":"activity","label":"我要预习小蝌蚪","activity":"课本","params":{"范围":"第 22 课 1–3 自然段"},"brief":"他上周「披」「鼓」读不准,读到时停一下"}]}} -->
```tutor chinese-tutor
activity 看图说话
activity 课本 我要预习小蝌蚪
范围: 第 22 课 1–3 自然段
讲法: 他上周「披」「鼓」读不准,读到时停一下
```

小课堂按钮(课包在 `bundles/` 里,或视频在 `lectures/` 里,检查会查):

<!-- expect {"kind":"tutor","props":{"tutor":"math-tutor","buttons":[{"kind":"lecture","label":"13 减 8 怎么拆","bundle":"2026-09-18-po13-jian-8","brief":"他常把 13 当成 1 和 3"}]}} -->
```tutor math-tutor
小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆
讲法: 他常把 13 当成 1 和 3
```

小课堂看完接着照 activity 带:

<!-- expect {"kind":"tutor","props":{"tutor":"chinese-tutor","buttons":[{"kind":"lecture","label":"看图说话怎么说","bundle":"2026-10-08-kantu","activity":"看图说话"}]}} -->
```tutor chinese-tutor
小课堂 2026-10-08-kantu 看图说话怎么说
activity: 看图说话
```

只今天用的按钮:

<!-- expect {"kind":"tutor","props":{"tutor":"chinese-tutor","buttons":[{"kind":"activity","label":"我要读课文","activity":"课本","params":{"范围":"第 22 课"},"until":"2026-10-10"}]}} -->
```tutor chinese-tutor
activity 课本 我要读课文
范围: 第 22 课
留到: 2026-10-10
```

只要方砖的老师,正文空着(也可以不写这张卡):

<!-- expect {"kind":"tutor","props":{"tutor":"english-tutor","buttons":[]}} -->
```tutor english-tutor
```

## 反例

普通的一行(以前的开场按钮)解析不成,整张卡退成一段文字,检查报「要改」:

<!-- expect {"kind":"text","warning":true} -->
```tutor math-tutor
再练两道退位减法
```

`接着`(以前的接着按钮)也一样:

<!-- expect {"kind":"text","warning":true} -->
```tutor chinese-tutor
接着 2026-09-16 1930-1 接着写看图写话
```

按钮的字太长(要跟老师说的话写进了按钮):

<!-- expect {"kind":"text","warning":true} -->
```tutor chinese-tutor
activity 课本 我要预习小蝌蚪找妈妈先把前三段读顺
```

`小课堂` 后面只写了课名,没写课包 id:

<!-- expect {"kind":"text","warning":true} -->
```tutor math-tutor
小课堂 13减8怎么拆
```

课包 id 写错(或课包还没做),解析得过,首页检查报「要改」:`bundles/<id>/` 不在或读不出来。

`留到:` 后面写的不是日期:

<!-- expect {"kind":"text","warning":true} -->
```tutor chinese-tutor
activity 看图说话
留到: 明天
```

`activity` 后面没写名字:

<!-- expect {"kind":"text","warning":true} -->
```tutor chinese-tutor
activity
```

`activity:` 挂在 activity 按钮下面(只能挂在小课堂按钮下面;activity 按钮下面写的是参数 `名: 值`,`activity:` 会被当成一个叫 activity 的参数,检查会说那个 activity 没有这个参数):

`讲法:` 前面没有按钮:

<!-- expect {"kind":"text","warning":true} -->
```tutor chinese-tutor
讲法: 先读课文
activity 看图说话
```

activity 的名字写错、参数写错或少了要填的,解析得过,首页检查报「要改」(对的是那个 activity 文件)。

## 孩子看到什么

首页是桌上一本书,一位老师一章,「XX的老师们」印在书下面的桌上:老师们是钉在屏幕下沿的便利贴小旗,上面是老师的头像和学科;点小旗(或在书页上左右划)翻到那位老师那一章。左页是入口,每个是一幅图画框(像课本上的图),框下写序号和题目,一行三格、格宽跟着屏幕宽:先是常驻的方砖(语文、数学是课本、检查作业,英语是预习、检查作业、复习,不写小字),然后是你写的(activity 按钮的图按它往页上铺什么来配:课本、照片、只说话;小课堂的框里是它的预览图,占两格,图上一个播放键,下面写课名与课长)。点 activity 按钮,老师页打开、铺好页,老师等孩子先开口(口语课老师先说)。右页是「今天」:今天在这位老师这儿聊过的话题一样一张别在页上,点一张接着聊,不占按钮。服务不通,小旗上的老师变灰、点不进去。讲法孩子永远看不到。

## 你会收回什么

没有卡上的状态。孩子点了哪个按钮,记在那条消息的 `via` 上(`cotutor home show` 汇总);老师那边,按钮开的那条消息的上下文包里有 `home:`(按钮的字与讲法),小课堂看完开口那条还有 `lecture:`(课的每句原话与看的情况);activity 按钮起的话题,每条都有 `activity:`(哪个 activity、家长填的参数);那个文件「老师怎么带」一节就是这个话题的系统提示,人设、卡、记忆都是它自己的。

## 状态的形状

没有。
