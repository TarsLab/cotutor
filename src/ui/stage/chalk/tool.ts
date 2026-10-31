/**
 * 做课包时在浏览器里跑的两样(cotutor chalk bake / snap 起 Chrome 打开 /stage/?chalk=…&bundle=<课包 URL>,src/app/cli/chalk/):
 * - bake:用 excalidraw 把课包的画面烤一次(./bake.ts),结果放 window.__chalkBake;
 * - snap:烤好的画面(没烤过现烤)停在第 step 步画完那一刻(0 = 空板,不带下一笔的痕迹),画在 #chalk-snap 里;&cursor=0 不画笔尖。
 * 好了 body[data-chalk-done="1"];出错放 window.__chalkError。和孩子端是同一个渲染(./render.ts),截到的就是孩子看到的。
 */
import { FREEZE_EPS_MS, frameAt, lessonClock } from '../../../chalk/index.ts';
import { loadBaked, loadBundle } from '../bundle.ts';
import { mountBaked } from './render.ts';

interface ToolWindow {
  __chalkBake?: unknown;
  __chalkError?: string;
}

export async function runTool(q: URLSearchParams): Promise<void> {
  const w = window as unknown as ToolWindow;
  const raw = q.get('bundle') ?? '';
  const bundle = raw.endsWith('/') ? raw : `${raw}/`;
  try {
    const scene = await loadBundle(bundle);
    const bake = async () => (await import('./bake.ts')).bakeSkeletons(scene.skeletons, { background: scene.background });
    if (q.get('chalk') === 'bake') w.__chalkBake = await bake();
    else {
      const picture = (await loadBaked(bundle)) ?? (await bake());
      const clock = lessonClock(scene.skeletons, scene.steps);
      const step = Number(q.get('step') ?? 0);
      const seg = step > 0 ? clock.segments[step - 1] : undefined;
      const ms = step <= 0 ? 0 : seg ? seg.start + seg.len - FREEZE_EPS_MS : clock.total;
      const base = new URL(bundle, location.href);
      const m = mountBaked(picture, { assetHref: (src) => new URL(src, base).href, pointer: q.get('cursor') !== '0' });
      const box = document.createElement('div');
      box.id = 'chalk-snap';
      box.style.cssText = 'width:1200px;height:900px;background:#fff;display:flex';
      m.svg.setAttribute('width', '100%');
      m.svg.setAttribute('height', '100%');
      box.append(m.svg);
      // 舞台的 #root 占满一屏,不拿掉的话画框落在视口外,截到的是空白
      document.getElementById('root')?.remove();
      document.body.style.margin = '0';
      document.body.prepend(box);
      m.paint(frameAt(clock, ms));
    }
  } catch (e) {
    w.__chalkError = e instanceof Error ? e.message : String(e);
  }
  document.body.dataset.chalkDone = '1';
}
