# cotutor

家里的 AI 老师团,和家长一起教。几位可以直接对话的老师(数学、语文、朗读、作业老师、规划、画图),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

> 现在到 R3 + 板书:家长端与孩子端都能用,老师的回复是一页板书(卡 + 逐句讲稿),画图老师能把一道题做成能播的课包;记账、作业照片、规划在后面的里程碑。iPad 真机试用还没开始。

## 五分钟用起来

需要 Node ≥ 22.18,以及 Claude Code 或 Qwen Code 至少一个(老师是它们跑出来的)。

```sh
npm i -g cotutor
cotutor init ming --name 小明     # 建 ~/cotutor/ming/:六位老师、四个领域 skill、账本、对话目录、cotutor.json
cotutor doctor                    # 逐项体检,不过的每条都带修复命令;--live 真起一次老师
cotutor serve                     # 孩子端 http://<ip>:5180/,家长端 /parent
```

`init` 把出厂老师(含画图老师)拷进 `.claude/agents/`,把画图用的四个领域 skill 拷进 `.claude/skills/`;
画图老师跑的 drawtell 随包装好,不用另外装。要在 iPad 上用(按住说话要 HTTPS):`cotutor cert` 签一张
自签证书,把根证书装到 iPad,重启 `serve`。

然后在浏览器里:

- **家长端 `/parent`**:和任何一位老师说话,看原始过程;老师团页改人设、政策、老师的性子(老师文件),加新老师;设置页改路径、端口、配音。
- **孩子端 `/`**:一周小路、今天的时段、一排老师头像;点头像进板书页,按住说话或打字。老师的回答是一页板书:卡先铺开(选择题、填空、点读、图、动画课包、画板),讲稿一句句念、笔跟着声音标注,末句问句停下来等孩子。点一张卡进舞台做题,做完「交给老师」。孩子永远看不到工具、报错、评判。

想听老师的声音:装 [voxtell](https://github.com/tarslab/voxtell),给老师填音色;没装就退回浏览器合成的声音。
不花钱先看孩子端长什么样:`cotutor mock` 起一份模拟接口,不经真实老师。细节见 [docs/家长手册.md](docs/家长手册.md)。

## 老师是文件

每位老师 = 一个 Markdown 文件(frontmatter + 正文即系统提示)+ cotutor.json 里的一条(显示名、头像、音色、开关、政策)+ 自己的目录与对话。出厂六位(数学、语文、朗读、作业、规划、画图)随包发布,init **拷贝**进你的老师们,改了就是你家的;`cotutor upgrade` 只换没改过的,改过的打印差异让你定。再加一位:

```sh
cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬
```

或者家长端老师团页点「新老师」。没有注册表,删掉文件和那条配置就是删老师。

`cotutor.json` 首行指向一份 JSON Schema(`.cotutor/cotutor.schema.json`),编辑器里有补全与说明。

## 当库用

```ts
import { CotutorConfigSchema, cotutorJsonSchema } from 'cotutor/schema';  // 契约(zod)与 JSON Schema
import { deriveKidView, parseSections } from 'cotutor/lib';               // 转录、孩子视图、账本等纯函数
import { loadWorkspace } from 'cotutor/workspace';                        // 解析链 + 校验
```

## 开发

改代码的看 [docs/开发者手册.md](docs/开发者手册.md)(检出、冒烟、iPad 真机)与 [CONTRIBUTING.md](CONTRIBUTING.md);设计与拍板在 [docs/](docs/)(产品规划、agent 层设计、契约草案)。

```sh
pnpm i && pnpm typecheck && pnpm test
node bin/cotutor.js --help        # bin 在仓库内直跑 src,零构建
pnpm build && pnpm smoke          # 出厂检查:体检要发的那份
```

MIT。
