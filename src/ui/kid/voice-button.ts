/** 共用老师签。保留同一颗 C 环，使状态刷新和从想转到看图都能沿用本轮等待时间。 */
import type { VoiceView } from './voice-view.ts';

export function voiceFace(el: HTMLElement, face: VoiceView['face']) {
  for (const f of ['think', 'talk', 'dim', 'listen']) el.classList.toggle('vb-' + f, face === f);
}

export function voiceButton(el: HTMLButtonElement) {
  el.classList.add('vb');
  el.innerHTML = '<span class="vb-av"><span class="vb-flag" hidden></span></span><span class="vb-side"><span class="vb-big"><b></b></span><span class="vb-small"></span></span>';
  const av = el.querySelector<HTMLElement>('.vb-av')!, flag = av.querySelector<HTMLElement>('.vb-flag')!;
  const big = el.querySelector('b')!, small = el.querySelector<HTMLElement>('.vb-small')!;
  let previous: VoiceView | undefined, inviteTimer = 0;
  const shake = () => {
    el.classList.remove('vb-shake');
    void el.offsetWidth;
    el.classList.add('vb-shake');
  };
  return {
    el, shake,
    avatar(node: HTMLElement) { av.replaceChildren(node, flag); },
    side(side: string) { el.classList.toggle('vb-right', side === 'right'); },
    set(v: VoiceView) {
      if (previous?.breathe !== v.breathe) {
        clearTimeout(inviteTimer);
        el.classList.toggle('vb-invite', v.breathe);
        if (v.breathe) inviteTimer = window.setTimeout(() => el.classList.remove('vb-invite'), 2400);
      }
      if (previous?.key === v.key && previous.mic === v.mic && previous.photo === v.photo) return;
      previous = v;
      el.dataset.voice = v.key;
      voiceFace(av, v.face);
      big.textContent = v.big;
      small.textContent = v.small;
      small.hidden = !v.small;
      flag.hidden = !v.mic;
      flag.textContent = v.mic;
      el.classList.toggle('vb-wait', v.face === 'think');
      el.classList.toggle('vb-photo', v.photo);
      el.classList.toggle('lit', v.face === 'listen' || v.face === 'think' || v.key === 'cancel' || v.shake);
      el.setAttribute('aria-label', [v.big, v.small].filter(Boolean).join('，'));
      if (v.mic) el.setAttribute('aria-pressed', String(v.mic === '开'));
      else el.removeAttribute('aria-pressed');
    },
  };
}
