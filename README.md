# cotutor

家里的 AI 助教团队。几位可以直接对话的老师(数学、语文、朗读、作业助教、规划),孩子在 iPad 上按住说话就能问,家长在自己的页面上看全部过程、管每位老师的性子和规矩。数据全在自家电脑上。

> 现在到 R3:家长端与孩子端都能用,老师能问答、能配音;出课件、记账、规划在后面的里程碑。iPad 真机的语音识别还没实测。

## 五分钟用起来

需要 Node ≥ 22.18,以及 Claude Code 或 Qwen Code 至少一个(老师是它们跑出来的)。

```sh
npm i -g cotutor
cotutor init ming --name 小明     # 建 ~/cotutor/ming/:五位老师、账本、对话目录、cotutor.json
cotutor doctor                    # 逐项体检,不过的每条都带修复命令;--live 真起一次老师
cotutor serve                     # 孩子端 http://<ip>:5180/,家长端 /parent
```

然后在浏览器里:

- **家长端 `/parent`**:和任何一位老师说话,看原始过程;助教团页改人设、政策、老师的性子(老师文件),加新老师;设置页改路径、端口、配音。
- **孩子端 `/`**:一周小路、今天的时段、一排老师头像;点头像进聊天窗,按住说话或打字,老师的回答会念出来。孩子永远看不到工具、报错、评判。

想在 iPad 上按住说话:`cotutor cert` 签一张自签证书,把根证书装到 iPad,重启 serve 走 HTTPS。想听老师的声音:装 [voxtell](https://github.com/tarslab/voxtell),给老师填音色。细节见 [docs/家长手册.md](docs/家长手册.md)。

## 老师是文件

每位老师 = 一个 Markdown 文件(frontmatter + 正文即系统提示)+ cotutor.json 里的一条(显示名、头像、音色、开关、政策)+ 自己的目录与会话。出厂五位随包发布,init **拷贝**进你的书房,改了就是你家的;`cotutor upgrade` 只换没改过的,改过的打印差异让你定。再加一位:

```sh
cotutor add science-teacher --display 科学老师 --subject 科学 --avatar 🔬
```

或者家长端助教团页点「新老师」。没有注册表,删掉文件和那条配置就是删老师。

`cotutor.json` 首行指向一份 JSON Schema(`.cotutor/cotutor.schema.json`),编辑器里有补全与说明。

## 当库用

```ts
import { CotutorConfigSchema, cotutorJsonSchema } from 'cotutor/schema';  // 契约(zod)与 JSON Schema
import { deriveKidView, parseSections } from 'cotutor/lib';               // 转录、精简视图、账本等纯函数
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
