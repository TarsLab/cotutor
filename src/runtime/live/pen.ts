/**
 * 收笔:孩子在页上写完了,什么时候替他交给老师(2026-11-16《多模态教学harness-开发计划》阶段 3 任务 3;《底层设计》第二节「什么时候交给脑」)。
 * 语音有 VAD 判说完,笔没有:抬笔以后停一会儿没再落笔,就算写完了。纯函数 turnStep(状态, 事, 秒数) → 新状态和要做的事,
 * 实时那条线(src/runtime/live/call.ts)照它起、停计时,到点交一轮(嘴先说一句「我看看你写的」,src/realtime/cues.ts 的 pen)。规矩:
 *  1. 落笔(down):正在等的计时取消。老师在说也不打断(写字不是打断,开口才是)
 *  2. 抬笔(up):起一个计时。在题目的空位上写的短(blankMs),在白纸条上列式、画图的长(stripMs)。再落笔重来
 *  3. 到点(due):老师在说、脑在写、孩子在说(busy)就再等一会儿(retryMs);不然交给老师,带上窗里的图
 *  4. 孩子开口、点了「给老师看」、别的什么开了一轮(turn):计时取消;这一轮自然带着页上的样子,不另交
 *  5. 什么都没写的 12 秒(still)照旧在 call.ts,不归这里
 * 秒数是起点,在 cotutor.json 的 live.pen 里(真机上看孩子实际怎么写再调)。
 */

export interface PenTimes {
  /** 在题目的空位上写完以后等多久(毫秒) */
  blankMs: number;
  /** 在白纸条上写、画完以后等多久 */
  stripMs: number;
  /** 到点了老师还在说:再等多久看一次 */
  retryMs: number;
}

export interface PenState {
  /** 笔在页上 */
  down: boolean;
  /** 什么时候交(毫秒,和事件的 at 同一个钟);没在等 = null */
  due: number | null;
}

export type PenEvent =
  | { e: 'down'; at: number }
  | { e: 'up'; at: number; strip: boolean }
  | { e: 'due'; at: number; busy: boolean }
  | { e: 'turn' };

/** 要做的:在 at 时候叫一次 due(之前的作废)、不等了、交给老师 */
export type PenDo = { k: 'arm'; at: number } | { k: 'cancel' } | { k: 'send' };

export const penInit = (): PenState => ({ down: false, due: null });

export function turnStep(s: PenState, ev: PenEvent, t: PenTimes): { s: PenState; do: PenDo[] } {
  switch (ev.e) {
    case 'down':
      return { s: { down: true, due: null }, do: s.due !== null ? [{ k: 'cancel' }] : [] };
    case 'up': {
      const due = ev.at + (ev.strip ? t.stripMs : t.blankMs);
      return { s: { down: false, due }, do: [{ k: 'arm', at: due }] };
    }
    case 'due': {
      // 早到的(被再落笔取代了的)、笔还在页上的:不算
      if (s.due === null || s.down || ev.at < s.due) return { s, do: [] };
      if (ev.busy) { const due = ev.at + t.retryMs; return { s: { ...s, due }, do: [{ k: 'arm', at: due }] }; }
      return { s: { down: false, due: null }, do: [{ k: 'send' }] };
    }
    case 'turn':
      return { s: { down: false, due: null }, do: s.due !== null ? [{ k: 'cancel' }] : [] };
  }
}
