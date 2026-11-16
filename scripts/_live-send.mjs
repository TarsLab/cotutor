/**
 * 探针造数据:像孩子端一样经实时那条连接发一条(/api/live/<老师>/ws 的 {t:'send', body};孩子端 2026-10-22 起只走这条路,HTTP 的发 2026-11-04 删了)。
 * 连上等嘴 ready → 发 → 等 {t:'turn'}(收下了)或 {t:'err'}(拒了)→ 挂掉(只收连接,脑那一轮照样写完)。
 * 回 {status, json}:收下 202 + {job, thread};拒了是拒的码 + {error}。真服务要有嘴(假百炼 COTUTOR_LIVE_ENDPOINT),mock 自带假嘴。
 * 用法:const r = await liveSend(base, 'chinese-tutor', { text: '你好' });(真服务上今天还没有话题时先 startChat)
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

/**
 * 真服务上开一个话题(2026-11-16 起新话题都从一个 activity 开始):往 workspace 里写测试用的 activity「聊」(tests/_chat.ts),
 * 经工作台那条路(/api/conversations/<老师>/messages,带 activity)发第一句;之后孩子端不带按钮的话都接着它。回 {status, json}
 */
export async function startChat(base, root, tutor, text = '开始') {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { CHAT, chatActivity } = await import('../tests/_chat.ts');
  const dir = join(root, 'agents', tutor, 'activities');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${CHAT}.md`), chatActivity());
  const r = await fetch(`${base}/api/conversations/${tutor}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, activity: CHAT }) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
