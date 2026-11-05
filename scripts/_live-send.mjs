/**
 * 探针造数据:像孩子端一样经实时那条连接发一条(/api/live/<老师>/ws 的 {t:'send', body};孩子端 2026-10-22 起只走这条路,HTTP 的发 2026-11-04 删了)。
 * 连上等嘴 ready → 发 → 等 {t:'turn'}(收下了)或 {t:'err'}(拒了)→ 挂掉(只收连接,脑那一轮照样写完)。
 * 回 {status, json}:收下 202 + {job, thread};拒了是拒的码 + {error}。真服务要有嘴(假百炼 COTUTOR_LIVE_ENDPOINT),mock 自带假嘴。
 * 用法:const r = await liveSend(base, 'chinese-tutor', { text: '你好', newThread: true });
 */
export async function liveSend(base, tutor, body, { timeoutMs = 15000 } = {}) {
  const url = `${base.replace(/^http/, 'ws')}/api/live/${tutor}/ws`;
  const ws = new WebSocket(url);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`liveSend ${tutor}:${timeoutMs} 毫秒没回`)), timeoutMs);
      const done = (r) => { clearTimeout(timer); resolve(r); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`liveSend ${tutor}:连不上 ${url}`)); };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data);
        if (m.t === 'ready') ws.send(JSON.stringify({ t: 'send', body }));
        else if (m.t === 'turn') done({ status: 202, json: { tutor, job: m.job, thread: m.thread } });
        else if (m.t === 'err') done({ status: m.status, json: { error: m.error } });
      };
    });
  } finally {
    try { ws.send(JSON.stringify({ t: 'bye' })); } catch {}
    ws.close();
  }
}
