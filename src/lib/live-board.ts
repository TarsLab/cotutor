/**
 * 实时老师的孩子端:谁出声、谁停、谁让谁(《工作流程.md》§孩子端「实时老师」那张表)。纯函数,页面只 dispatch、照单执行。
 * 实时时孩子端不念讲稿(嘴照念,声音从 WebSocket 下来,src/live/call.ts);出声的只有嘴和卡自己的声音(朗读卡点读、单词卡、录音卡的示范与回放)。
 * 和板书的 step(kid-board.ts)是两个状态机,页面按这位老师这一次是不是实时 dispatch 到其中一个。
 * 改规则的顺序:先改表 → 再改 tests/live-player.test.ts → 最后改这里。
 */

/** quiet 安静 · holding 孩子按着说话 · mouth 嘴的声音在放(或还在来)· card 卡的声音在念 · recording 录音卡在录 · lecture 在放小课堂卡上那一段(讲稿的 [[play]]) */
export type LiveStatus = 'quiet' | 'holding' | 'mouth' | 'card' | 'recording' | 'lecture';

export interface LiveModel {
  status: LiveStatus;
  /** 孩子按下时嘴正在说:字幕上那句变淡、加省略号;嘴再出声就清 */
  cut: boolean;
}

/**
 * 孩子做的:press 按满 150 毫秒 · release 松手 · cancel 上滑松手 · cardTap 点卡上的声音 · ask 点卡上的「?」· send 打字发出、交答案、发照片 ·
 * stage 开 / 关舞台、拿起相机 · recStart 按下录音键 · recEnd 松手、上滑、关舞台(停录);
 * 声音的:audio 嘴的一块声音到了 · drained 孩子端的队列放完了(play:刚念完的那句 [[play]] 到小课堂卡,open = 能放、skip = 课包读不出来)·
 * cardEnded 卡的声音念完 / 停了 · lectureDone 小课堂那一段放完 / 孩子关了;
 * 服务端的:flush 清播放队列 · cards 卡铺上来、老师写完 · drop 连不上 / 断了;页面的:reset 换老师、关老师页
 */
export type LiveEvent =
  | { type: 'press' }
  | { type: 'release' }
  | { type: 'cancel' }
  | { type: 'audio' }
  | { type: 'drained'; play?: 'open' | 'skip' }
  | { type: 'lectureDone' }
  | { type: 'flush' }
  | { type: 'cardTap' }
  | { type: 'cardEnded' }
  | { type: 'ask' }
  | { type: 'send' }
  | { type: 'cards' }
  | { type: 'stage' }
  | { type: 'recStart' }
  | { type: 'recEnd' }
  | { type: 'drop' }
  | { type: 'reset' };

/**
 * 要做的事,按顺序执行。hold / release / hush / send = 告诉服务端(send 的 body 页面带上);enqueue = 放刚到的这块嘴的声音(没有就丢掉);
 * flush = 清掉孩子端没放的嘴的声音;stopCard / playCard = 停 / 念卡上的声音;openLecture / stopLecture = 铺满放 / 停下小课堂那一段(舞台停在那一帧);
 * staged = 告诉服务端那一段放完了(后面的讲稿接着交给嘴);board = 这位老师这一次回到板书;render = 重画字幕与头像
 */
export type LiveEffect =
  | { kind: 'hold' }
  | { kind: 'release' }
  | { kind: 'hush' }
  | { kind: 'send' }
  | { kind: 'enqueue' }
  | { kind: 'flush' }
  | { kind: 'stopCard' }
  | { kind: 'playCard' }
  | { kind: 'openLecture' }
  | { kind: 'stopLecture' }
  | { kind: 'staged' }
  | { kind: 'board' }
  | { kind: 'render' };

export function initialLive(): LiveModel {
  return { status: 'quiet', cut: false };
}

/** 停掉孩子端在出的声音:嘴的清掉、卡的停、小课堂那一段停下 */
function hushLocal(m: LiveModel, fx: LiveEffect[]): void {
  if (m.status === 'mouth') fx.push({ kind: 'flush' });
  if (m.status === 'card') fx.push({ kind: 'stopCard' });
  if (m.status === 'lecture') fx.push({ kind: 'stopLecture' });
}

export function liveStep(model: LiveModel, ev: LiveEvent): { model: LiveModel; effects: LiveEffect[] } {
  const fx: LiveEffect[] = [];
  let m = model;
  const to = (status: LiveStatus, extra: Partial<LiveModel> = {}): void => { m = { ...m, status, ...extra }; };
  switch (ev.type) {
    case 'press':
      // 在录时输入条那颗不接(录音卡自己的键在录)
      if (m.status === 'recording' || m.status === 'holding') break;
      hushLocal(m, fx);
      fx.push({ kind: 'hold' });
      to('holding', { cut: m.status === 'mouth' });
      break;
    case 'release':
      if (m.status !== 'holding') break;
      fx.push({ kind: 'release' });
      to('quiet');
      break;
    case 'cancel':
      if (m.status !== 'holding') break;
      fx.push({ kind: 'hush' });
      to('quiet');
      break;
    case 'audio':
      // 按着、在录:按下前已经在路上的那几块丢掉
      if (m.status === 'holding' || m.status === 'recording') break;
      if (m.status === 'card') fx.push({ kind: 'stopCard' });
      if (m.status === 'lecture') fx.push({ kind: 'stopLecture' });
      fx.push({ kind: 'enqueue' });
      if (m.status !== 'mouth') { to('mouth', { cut: false }); fx.push({ kind: 'render' }); }
      break;
    case 'drained':
      if (m.status !== 'mouth') break;
      // [[play]]:那句念完了铺满放那一段;放不了就告诉服务端接着交
      if (ev.play === 'open') { fx.push({ kind: 'openLecture' }); to('lecture'); }
      else { if (ev.play === 'skip') fx.push({ kind: 'staged' }); to('quiet'); }
      fx.push({ kind: 'render' });
      break;
    case 'lectureDone':
      if (m.status !== 'lecture') break;
      fx.push({ kind: 'staged' });
      to('quiet');
      fx.push({ kind: 'render' });
      break;
    case 'flush':
      fx.push({ kind: 'flush' });
      if (m.status === 'mouth') { to('quiet'); fx.push({ kind: 'render' }); }
      break;
    case 'cardTap':
      if (m.status !== 'quiet' && m.status !== 'card') break;
      fx.push({ kind: 'playCard' });
      to('card');
      break;
    case 'cardEnded':
      if (m.status === 'card') to('quiet');
      break;
    case 'ask':
    case 'send':
      // 同说了一句:手还按着(两根手指)先把那一下作废
      if (m.status === 'holding') fx.push({ kind: 'hush' });
      hushLocal(m, fx);
      fx.push({ kind: 'send' });
      to('quiet', { cut: m.status === 'mouth' });
      fx.push({ kind: 'render' });
      break;
    case 'cards':
    case 'stage':
      break;
    case 'recStart':
      hushLocal(m, fx);
      fx.push({ kind: 'hush' });
      to('recording');
      fx.push({ kind: 'render' });
      break;
    case 'recEnd':
      if (m.status === 'recording') { to('quiet'); fx.push({ kind: 'render' }); }
      break;
    case 'drop':
      fx.push({ kind: 'flush' }, { kind: 'stopCard' }, { kind: 'stopLecture' }, { kind: 'board' });
      m = initialLive();
      break;
    case 'reset':
      fx.push({ kind: 'flush' }, { kind: 'stopCard' }, { kind: 'stopLecture' });
      m = initialLive();
      break;
  }
  return { model: m, effects: fx };
}
