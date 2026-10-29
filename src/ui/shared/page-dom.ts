/**
 * 页面内联脚本共用的几样小工具:孩子端老师页(kid-page,家长端 / 录像 / 预览也是它)、工作台、家长端首页、口语课、听写的录像外壳,插在各页脚本里原来定义它们的地方。
 * - $(选择器, 根):取一个元素。
 * - h(tag, attrs, ...kids):建元素。attrs 里 class / html / on 特别处理,别的值是 null、undefined、false 不写,true 写成空串(布尔属性);
 *   kids 摊平一层,null、undefined、false 跳过,不是节点的转成文字。
 * - toast(字):#toast 底部提示,过 toastMs 收起;页面没有 #toast 就不做(工作台没有)。
 * - api(方法, 路径, 体):JSON 进出、不走缓存;回的不是 JSON 给 null;不是 2xx 抛错,错带 status 与 body,信息取 body 的 message / error。
 *   页面给了 apiSeen 就每个响应先给它看一眼(孩子端拿启动号判断服务重起过,见 kid-page 的 staleReload)。
 * 听写那三页(dictation/page、en-page、parent-page)是 var 写法、h 认 text 不认 html、回的不是 JSON 给 {},自成一套,没并进来。
 * 插进去的地方是模板字符串:这里不写反斜杠、反引号、美元加花括号。
 */
export function pageDomJs(toastMs: number): string {
  return `  const $ = (s, root = document) => root.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  let toastTimer = 0;
  const toast = (text) => { const t = $('#toast'); if (!t) return; t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ${toastMs}); };
  let apiSeen = null;
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (apiSeen) apiSeen(r);
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((j && (j.message || j.error)) || 'HTTP ' + r.status); e.status = r.status; e.body = j; throw e; }
    return j;
  };
`;
}
