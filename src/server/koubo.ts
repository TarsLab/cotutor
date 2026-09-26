/**
 * 录音卡的评测(《口播老师设计.md》§4):存录音时后台起一条 koubo card(一个服务进程一条队列,串行),结果落在录音旁边的 rec-<k>.heard.json;
 * 交给老师时取:有就用;还在跑就等,从存录音那一刻起最多 timeoutMs;没有也没在跑(服务重启过)→ 现起再等;等超了 → 'pending',结果晚到照样落盘。
 * 失败 = 没有:koubo 不在 / 退出码非 0 / 超时 / JSON 不对 → {ok: false, error},孩子端什么都不显示。花费与账本归 koubo(它的 ledger/assess.jsonl)。
 */
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { HeardSchema, type Heard, type RecordProps } from '../cards/index.ts';
import { fillKouboCard, type Koubo } from '../schema/index.ts';

/** 录音旁边的评测结果:rec-1.webm → rec-1.heard.json */
export function heardFile(audio: string): string {
  return audio.replace(/\.[a-z0-9]+$/i, '.heard.json');
}

/** 这条录音的评测结果;没有、坏了 → null */
export function readHeard(audio: string): Promise<Heard | null> {
  return readHeardFile(heardFile(audio));
}

async function readHeardFile(file: string): Promise<Heard | null> {
  try {
    const r = HeardSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** koubo 出错时说的那个代号(stderr 一行 {error, message});没有就退出码 */
function errorCode(err: { code?: string | number | null; killed?: boolean; signal?: string | null }, stderr: string): string {
  if (err.code === 'ENOENT') return 'koubo 不在';
  if (err.killed || err.signal === 'SIGTERM') return 'timeout';
  for (const line of stderr.trim().split('\n').reverse()) {
    try {
      const j = JSON.parse(line) as { error?: unknown };
      if (typeof j.error === 'string') return j.error;
    } catch {
      /* 不是 JSON 行 */
    }
  }
  return `退出码 ${typeof err.code === 'number' ? err.code : '?'}`;
}

/** 跑一条 koubo card;不抛,失败也回一份 heard */
export function runKoubo(root: string, cfg: Koubo, audio: string, props: RecordProps, env?: NodeJS.ProcessEnv): Promise<Heard> {
  const argv = fillKouboCard(cfg.card, { audio, text: props.text, mode: props.mode === 'pinyin' ? '8' : '1', pairs: props.focus?.length ? props.focus.join(',') : 'auto' });
  const bin = !isAbsolute(argv[0]) && argv[0].includes('/') ? join(root, argv[0]) : argv[0];
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(bin, argv.slice(1), { cwd: root, env: env ?? process.env, timeout: cfg.timeoutMs, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      const ms = Date.now() - t0;
      if (err) return resolve({ ok: false, error: errorCode(err, String(stderr ?? '')), ms });
      try {
        const j = JSON.parse(String(stdout).trim().split('\n').pop() ?? '') as Record<string, unknown>;
        const r = HeardSchema.safeParse({ ok: true, ...j, ms });
        resolve(r.success ? r.data : { ok: false, error: 'bad_json', ms });
      } catch {
        resolve({ ok: false, error: 'bad_json', ms });
      }
    });
  });
}

/** 等的计时器不拖住进程退出(测试、关服) */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

export class KouboQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly jobs = new Map<string, { at: number; done: Promise<Heard> }>();
  private readonly env?: NodeJS.ProcessEnv;
  constructor(env?: NodeJS.ProcessEnv) {
    this.env = env;
  }

  /** 存录音时:排进队,跑完落 heard.json;同一条录音只起一次 */
  start(root: string, cfg: Koubo, audio: string, props: RecordProps): Promise<Heard> {
    const existing = this.jobs.get(audio);
    if (existing) return existing.done;
    const done = this.tail
      .then(() => runKoubo(root, cfg, audio, props, this.env))
      .then(async (h) => {
        await writeFile(heardFile(audio), `${JSON.stringify(h, null, 2)}\n`).catch(() => {});
        this.jobs.delete(audio);
        return h;
      });
    this.tail = done.catch(() => {});
    this.jobs.set(audio, { at: Date.now(), done });
    return done;
  }

  /** 交给老师时:这条录音的评测;等到存录音之后 timeoutMs 还没好 → 'pending'。noStart = 回放,不起新的 */
  async take(root: string, cfg: Koubo, audio: string, props: RecordProps, opts: { noStart?: boolean } = {}): Promise<Heard | 'pending' | undefined> {
    const job = this.jobs.get(audio);
    if (!job) {
      const saved = await readHeard(audio);
      if (saved) return saved;
      if (opts.noStart) return undefined;
      this.start(root, cfg, audio, props);
      return this.take(root, cfg, audio, props, opts);
    }
    const left = job.at + cfg.timeoutMs - Date.now();
    if (left <= 0) return 'pending';
    return Promise.race([job.done, sleep(left).then(() => 'pending' as const)]);
  }

  /** 等队列里的都跑完(测试、关服前) */
  async flush(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs.values()].map((j) => j.done.catch(() => {})));
  }
}

/** 一位老师一天在 koubo 上花了多少元:那天所有录音(重录的也算)的 heard.json 里 costYuan 加总;家长端清单上显示 */
export async function kouboYuanOfDay(dir: string, date: string): Promise<number> {
  let sum = 0;
  const days = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.startsWith(`${date}.`) && f.endsWith('.cards'));
  for (const d of days) {
    for (const n of await readdir(join(dir, d)).catch(() => [] as string[])) {
      for (const f of await readdir(join(dir, d, n)).catch(() => [] as string[])) {
        if (!/^rec-\d+\.heard\.json$/.test(f)) continue;
        const h = await readHeardFile(join(dir, d, n, f));
        if (h?.ok) sum += h.costYuan;
      }
    }
  }
  return Math.round(sum * 1000) / 1000;
}
