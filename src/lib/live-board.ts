/**
 * 实时老师的孩子端:谁出声、谁停、谁让谁(《工作流程.md》§孩子端「实时老师」那张表)。纯函数,页面只 dispatch、照单执行。
 * 实时时孩子端不念讲稿(嘴照念,声音从 WebSocket 下来,src/live/call.ts);出声的只有嘴和卡自己的声音(朗读卡点读、单词卡、录音卡的示范与回放)。
 * 和板书的 step(kid-board.ts)是两个状态机,页面按这位老师这一次是不是实时 dispatch 到其中一个。
 * 改规则的顺序:先改表 → 再改 tests/live-player.test.ts → 最后改这里。
 * 一直听(《wip/实时老师常开麦设计.md》,全双工):孩子不用按,服务端的 VAD 判开口 / 说完;推不推孩子的声音是状态的函数(liveGate),一变就告诉服务端 gate。
 * 口语课(《wip/口语课改实时老师设计.md》§三之四):热身的 [[echo]] / [[say]] 那句放完,那张卡亮「轮到你」(turn);[[call]] 那句放完响铃(孩子端自己的声音),嘴一出声铃停。
 * 字幕重放(《wip/实时老师设想.md》拍板 21):字幕下「再听一遍」,孩子端放这一轮嘴照念过的声音(服务端按轮留的那份);只在安静、脑不在写时开始,不告诉服务端任何东西。
 */

/** quiet 安静 · holding 孩子按着说话 · mouth 嘴的声音在放(或还在来)· card 卡的声音在念 · recording 录音卡在录 · lecture 在放小课堂卡上那一段(讲稿的 [[play]])· ring 在响铃(讲稿的 [[call]])· replay 在重放这一轮嘴说过的 */
export type LiveStatus = 'quiet' | 'holding' | 'mouth' | 'card' | 'recording' | 'lecture' | 'ring' | 'replay';

export interface LiveModel {
  status: LiveStatus;
  /** 孩子按下时嘴正在说:字幕上那句变淡、加省略号;嘴再出声就清 */
  cut: boolean;
  /** 一直听(右上角那颗开着);hearing = 服务端说孩子在说;ducked = 嘴的声音压低着;muted = 孩子点胶囊关了麦 */
  open: boolean;
  hearing: boolean;
  ducked: boolean;
  muted: boolean;
  /** 口语课热身:刚放完 [[echo]] / [[say]] 那句,那张卡亮着「轮到你」 */
  turn: boolean;
}

/**
 * 孩子做的:press 按满 150 毫秒 · release 松手 · cancel 上滑松手 · cardTap 点卡上的声音 · send 打字发出、交答案、发照片 ·
 * stage 开 / 关舞台、拿起相机 · recStart 按下录音键 · recEnd 松手、上滑、关舞台(停录);
 * 声音的:audio 嘴的一块声音到了 · drained 孩子端的队列放完了(play:刚念完的那句 [[play]] 到小课堂卡,open = 能放、skip = 课包读不出来;
 * echo:刚念完的是热身的 [[echo]] / [[say]];call:刚念完的是 [[call]])· cardEnded 卡的声音念完 / 停了 · lectureDone 小课堂那一段放完 / 孩子关了 · ringEnd 铃响够了;
 * 服务端的:flush 清播放队列 · cards 卡铺上来、老师写完 · drop 连不上 / 断了;页面的:reset 换老师、关老师页;
 * 一直听:listen 孩子点右上角的开关 · mute / unmute 点麦克风胶囊 · vad 服务端说孩子开口 / 说完 · duck / unduck 服务端让嘴的声音压低 / 恢复;
 * 重放:replay 点「再听一遍」(pending = 脑在写,不放)· replayStop 点「停」· replayEnded 放完了
 */
export type LiveEvent =
  | { type: 'press' }
  | { type: 'release' }
  | { type: 'cancel' }
  | { type: 'audio' }
  | { type: 'drained'; play?: 'open' | 'skip'; echo?: true; call?: true }
  | { type: 'lectureDone' }
  | { type: 'ringEnd' }
  | { type: 'flush' }
  | { type: 'cardTap' }
  | { type: 'cardEnded' }
  | { type: 'send' }
  | { type: 'cards' }
  | { type: 'stage' }
  | { type: 'recStart' }
  | { type: 'recEnd' }
  | { type: 'drop' }
  | { type: 'reset' }
  | { type: 'listen'; open: boolean }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'vad'; on: boolean }
  | { type: 'duck' }
  | { type: 'unduck' }
  | { type: 'replay'; pending?: boolean }
  | { type: 'replayStop' }
  | { type: 'replayEnded' };

/**
 * 要做的事,按顺序执行。hold / release / hush / send = 告诉服务端(send 的 body 页面带上);enqueue = 放刚到的这块嘴的声音(没有就丢掉);
 * flush = 清掉孩子端没放的嘴的声音;stopCard / playCard = 停 / 念卡上的声音;openLecture / stopLecture = 铺满放 / 停下小课堂那一段(舞台停在那一帧);
 * staged = 告诉服务端那一段放完了(后面的讲稿接着交给嘴);retry = 连不上、断了:回到「正在叫老师」,过一会儿再连(不回板书,《产品规划.md》拍板 30);render = 重画字幕与头像;
 * 一直听:listen = 告诉服务端换了模式;gate = 告诉服务端推 / 不推了(on);duck / unduck = 嘴的声音压到三成 / 恢复;
 * 口语课:ring / stopRing = 响铃 / 铃停(卡亮不亮看 turn,随 render 画);重放:playReplay / stopReplay = 从这一轮第一句放 / 停(页面取服务端留的那份声音)
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
  | { kind: 'retry' }
  | { kind: 'render' }
  | { kind: 'listen' }
  | { kind: 'gate'; on: boolean }
  | { kind: 'duck' }
  | { kind: 'unduck' }
  | { kind: 'ring' }
  | { kind: 'stopRing' }
  | { kind: 'playReplay' }
  | { kind: 'stopReplay' };

export function initialLive(): LiveModel {
  return { status: 'quiet', cut: false, open: false, hearing: false, ducked: false, muted: false, turn: false };
}

/** 一直听时推不推孩子的声音:没关麦,卡没在念、没在录、小课堂没在放、没在响铃、没在重放(这些时候进麦的不是对老师说的;重放的是嘴从前说的,服务端比字比不到) */
export function liveGate(m: LiveModel): boolean {
  return m.open && !m.muted && m.status !== 'card' && m.status !== 'recording' && m.status !== 'lecture' && m.status !== 'ring' && m.status !== 'replay' && m.status !== 'holding';
}

/** 停掉孩子端在出的声音:嘴的清掉、卡的停、小课堂那一段停下、铃停、重放停 */
function hushLocal(m: LiveModel, fx: LiveEffect[]): void {
  if (m.status === 'mouth') fx.push({ kind: 'flush' });
  if (m.status === 'card') fx.push({ kind: 'stopCard' });
  if (m.status === 'lecture') fx.push({ kind: 'stopLecture' });
  if (m.status === 'ring') fx.push({ kind: 'stopRing' });
  if (m.status === 'replay') fx.push({ kind: 'stopReplay' });
}

export function liveStep(model: LiveModel, ev: LiveEvent): { model: LiveModel; effects: LiveEffect[] } {
  const r = liveTransition(model, ev);
  // 推不推变了就告诉服务端(一直听;关的时候孩子说到一半的那句作废)
  if (liveGate(model) !== liveGate(r.model)) r.effects.push({ kind: 'gate', on: liveGate(r.model) });
  return r;
}

/** 名字别和 kid-board.ts 的 step 撞:两份都内联进孩子端页面 */
function liveTransition(model: LiveModel, ev: LiveEvent): { model: LiveModel; effects: LiveEffect[] } {
  const fx: LiveEffect[] = [];
  let m = model;
  const to = (status: LiveStatus, extra: Partial<LiveModel> = {}): void => { m = { ...m, status, ...extra }; };
  switch (ev.type) {
    case 'press':
      // 在录时输入条那颗不接(录音卡自己的键在录);一直听时那条是胶囊,不是按住说话
      if (m.status === 'recording' || m.status === 'holding' || m.open) break;
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
      if (m.status === 'ring') fx.push({ kind: 'stopRing' });
      if (m.status === 'replay') fx.push({ kind: 'stopReplay' });
      fx.push({ kind: 'enqueue' });
      if (m.status !== 'mouth') { to('mouth', { cut: false, turn: false }); fx.push({ kind: 'render' }); }
      break;
    case 'drained':
      if (m.status !== 'mouth') break;
      // [[play]]:那句念完了铺满放那一段;放不了就告诉服务端接着交。[[call]]:响铃。[[echo]] / [[say]]:安静,那张卡亮「轮到你」
      if (ev.play === 'open') { fx.push({ kind: 'openLecture' }); to('lecture'); }
      else if (ev.call) { fx.push({ kind: 'ring' }); to('ring'); }
      else { if (ev.play === 'skip') fx.push({ kind: 'staged' }); to('quiet', ev.echo ? { turn: true } : {}); }
      fx.push({ kind: 'render' });
      break;
    case 'ringEnd':
      if (m.status !== 'ring') break;
      to('quiet');
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
      if (m.ducked) { fx.push({ kind: 'unduck' }); m = { ...m, ducked: false }; }
      if (m.status === 'mouth' || m.turn) { to(m.status === 'mouth' ? 'quiet' : m.status, { turn: false }); fx.push({ kind: 'render' }); }
      break;
    case 'cardTap':
      if (m.status !== 'quiet' && m.status !== 'card' && m.status !== 'replay') break;
      if (m.status === 'replay') fx.push({ kind: 'stopReplay' });
      fx.push({ kind: 'playCard' });
      to('card');
      break;
    case 'cardEnded':
      if (m.status === 'card') to('quiet');
      break;
    case 'send':
      // 同说了一句:手还按着(两根手指)先把那一下作废
      if (m.status === 'holding') fx.push({ kind: 'hush' });
      hushLocal(m, fx);
      fx.push({ kind: 'send' });
      to('quiet', { cut: m.status === 'mouth', turn: false });
      fx.push({ kind: 'render' });
      break;
    case 'cards':
    case 'stage':
      break;
    case 'recStart':
      hushLocal(m, fx);
      fx.push({ kind: 'hush' });
      to('recording', { turn: false });
      fx.push({ kind: 'render' });
      break;
    case 'recEnd':
      if (m.status === 'recording') { to('quiet'); fx.push({ kind: 'render' }); }
      break;
    case 'drop':
      fx.push({ kind: 'flush' }, { kind: 'stopCard' }, { kind: 'stopLecture' }, { kind: 'stopRing' }, { kind: 'stopReplay' }, { kind: 'retry' });
      if (m.ducked) fx.push({ kind: 'unduck' });
      // 一直听是孩子选的说话方式,不是声音的状态:清了也留着
      m = { ...initialLive(), open: m.open };
      break;
    case 'reset':
      fx.push({ kind: 'flush' }, { kind: 'stopCard' }, { kind: 'stopLecture' }, { kind: 'stopRing' }, { kind: 'stopReplay' });
      if (m.ducked) fx.push({ kind: 'unduck' });
      m = { ...initialLive(), open: m.open };
      break;
    case 'listen':
      // 手还按着就换了模式:那一下作废
      if (m.status === 'holding') { fx.push({ kind: 'hush' }); to('quiet'); }
      fx.push({ kind: 'listen' });
      if (m.ducked) fx.push({ kind: 'unduck' });
      m = { ...m, open: ev.open, hearing: false, ducked: false, muted: false };
      fx.push({ kind: 'render' });
      break;
    case 'mute':
    case 'unmute':
      if (!m.open || m.muted === (ev.type === 'mute')) break;
      m = { ...m, muted: ev.type === 'mute', hearing: false };
      fx.push({ kind: 'render' });
      break;
    case 'vad':
      if (!m.open || m.hearing === ev.on) break;
      m = { ...m, hearing: ev.on };
      fx.push({ kind: 'render' });
      break;
    case 'duck':
      if (m.ducked) break;
      m = { ...m, ducked: true };
      fx.push({ kind: 'duck' });
      break;
    case 'unduck':
      if (!m.ducked) break;
      m = { ...m, ducked: false };
      fx.push({ kind: 'unduck' });
      break;
    case 'replay':
      // 只在安静、脑不在写时放(那行字本来就只在这时露);不告诉服务端
      if (m.status !== 'quiet' || ev.pending) break;
      fx.push({ kind: 'playReplay' });
      to('replay');
      fx.push({ kind: 'render' });
      break;
    case 'replayStop':
      if (m.status !== 'replay') break;
      fx.push({ kind: 'stopReplay' });
      to('quiet');
      fx.push({ kind: 'render' });
      break;
    case 'replayEnded':
      if (m.status !== 'replay') break;
      to('quiet');
      fx.push({ kind: 'render' });
      break;
  }
  return { model: m, effects: fx };
}
