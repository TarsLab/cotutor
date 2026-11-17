/**
 * 舞台包与孩子端页面之间的 postMessage 协议:页面在 iframe 里装 /stage/?card=<id>,
 * 小课堂、一节课的页的交互都在包里做,页面只管顶栏、字幕行与输入条。两边都只认带 source 的消息。
 * 这份文件不能有运行时 import(页面那边不用它,只照着写;这里是包的真相)。
 */

export const STAGE_SOURCE = 'cotutor-stage';

/** 页面 → 舞台 */
export type ToStage =
  /** 一节课此刻的样子(src/schema/lesson.ts):页面一句一句落好老师的动作、孩子做的事也落上,变了就发;舞台照它画页(book.tsx:课本、作业照片、白纸;lecture.tsx:小课堂) */
  | { source: typeof STAGE_SOURCE; type: 'lesson'; id: string; lesson: unknown; readonly?: boolean; hand?: 'left' | 'right';
    /** 现在这一页是小课堂:课包 / 视频在哪、孩子手上还没交的画、录像跟着放(follow);play = 页面要放老师那一段了(look 的 n,变了就放) */
    lecture?: { url: string; marks: unknown[]; follow?: boolean; play?: number } }
  /** peek = 板此刻的样子导一张小图(话题的预览图,首页「今天」用;回 peek) */
  | { source: typeof STAGE_SOURCE; type: 'control'; action: 'toggle' | 'next' | 'prev' | 'play' | 'pause' | 'submit' | 'peek' }
  /** 家长看录像时的小课堂(lesson 的 lecture.follow):录像这一刻停在课里的哪儿、在不在放、倍速、到这一刻画过的几处;页面每 100 毫秒发一次 */
  | { source: typeof STAGE_SOURCE; type: 'follow'; ms: number; playing: boolean; rate: number; marks: unknown[] };

/** 舞台 → 页面 */
export type FromStage =
  | { source: typeof STAGE_SOURCE; type: 'ready' }
  /** 小课堂上老师那一段放完了(停在末帧):页面接着念 */
  | { source: typeof STAGE_SOURCE; type: 'phase'; phase: 'done' }
  /** 点字:孩子点中了页上一个字(汉字)或一个英文单词,页面在页上面弹它的田字格 / 四线三格 */
  | { source: typeof STAGE_SOURCE; type: 'pick'; text: string }
  /** 点开了一块盖住的(老师写的「遮」「盖」) */
  | { source: typeof STAGE_SOURCE; type: 'reveal'; text: string }
  /** 一节课:孩子自己挪了窗、放大了,停下来的地方(场景坐标 [左, 上, 右, 下]);页面报给服务端说成一句给老师 */
  | { source: typeof STAGE_SOURCE; type: 'view'; box: [number, number, number, number] }
  /** 一节课:窗停下来以后窗里那一块的图(jpeg data URL,长边 1024);页面交给服务端,下一轮附给老师 */
  | { source: typeof STAGE_SOURCE; type: 'shot'; box: [number, number, number, number]; image: string }
  /** 「给老师看」(窗里的图已经先交了,shot) */
  | { source: typeof STAGE_SOURCE; type: 'submit' }
  /** 一节课:笔落下了(孩子写着,应用不替他交给老师;抬笔就是下面的 stroke) */
  | { source: typeof STAGE_SOURCE; type: 'pen' }
  /** 一节课:孩子落了一笔(场景坐标)/ 擦掉了自己画的;页面照 lessonStep 改状态、报给服务端 */
  | { source: typeof STAGE_SOURCE; type: 'stroke'; pts: [number, number][]; /** 落在开着的白纸条上 */ strip?: string }
  /** 一节课:白纸条里的方向盘转到了多少度(item = <白纸条>#<第几样>) */
  | { source: typeof STAGE_SOURCE; type: 'turn'; item: string; deg: number }
  | { source: typeof STAGE_SOURCE; type: 'wipe' }
  /** control peek 的回话:板此刻的样子(长边 480 的 jpeg data URL;课本是窗里那块;导不出、小课堂这种不是板的 null) */
  | { source: typeof STAGE_SOURCE; type: 'peek'; image: string | null }
  | { source: typeof STAGE_SOURCE; type: 'close' }
  /** 小课堂:放到结尾一次 = finished(停在最后一帧);带看了多久、停过几次 */
  | { source: typeof STAGE_SOURCE; type: 'lecture'; event: 'finished'; watchedMs: number; finished: boolean; pauses: number }
  /** 小课堂看的过程一条(录像用):那一刻(Date.now())停在课里的哪儿、之后在不在放 */
  | { source: typeof STAGE_SOURCE; type: 'watch'; at: number; pos: number; play: boolean }
  /** 小课堂里画了 / 擦了 / 截好图了:整张单子(时刻、SVG 停在哪、课包坐标的几笔、截图);页面是画的主人(卡 props.marks 发进来的就是它) */
  | { source: typeof STAGE_SOURCE; type: 'marks'; marks: { atMs: number; svgMs: number; strokes: [number, number][][]; image?: string; at?: number }[] }
  | { source: typeof STAGE_SOURCE; type: 'error'; message: string };
