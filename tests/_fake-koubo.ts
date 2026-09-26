/**
 * 假 koubo:只认 `card --audio <f> --text <t> --mode <m> --pairs <p> --json`,不花钱、不联网(record-hook.test 用)。
 * 看参考文本决定怎么回:带「慢」睡 5 秒(测超时);带「钱」exit 1、stderr {"error":"cost_limit"};带「乱」stdout 不是 JSON;其余回一份判(重录,原因带风险字)。
 * 每次调用往 $FAKE_KOUBO_LOG 追加一行 {cwd, args},测试据此查模板占位与 cwd。
 */
import { appendFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const flag = (k: string) => args[args.indexOf(k) + 1];
if (process.env.FAKE_KOUBO_LOG) appendFileSync(process.env.FAKE_KOUBO_LOG, `${JSON.stringify({ cwd: process.cwd(), args })}\n`);
const text = flag('--text') ?? '';
const audio = flag('--audio') ?? '';
if (args[0] !== 'card' || !existsSync(audio)) {
  process.stderr.write(`${JSON.stringify({ error: 'usage', message: '要 card --audio <在的文件>' })}\n`);
  process.exit(2);
}
if (text.includes('慢')) await new Promise((r) => setTimeout(r, 5000));
if (text.includes('钱')) {
  process.stderr.write(`${JSON.stringify({ error: 'cost_limit', message: '今天已花 5.000 元' })}\n`);
  process.exit(1);
}
if (text.includes('乱')) {
  process.stdout.write('not json at all\n');
  process.exit(0);
}
const take = `20260926-162203-${basename(audio).replace(/\W/g, '')}`;
const pinyin = flag('--mode') === '8';
process.stdout.write(`${JSON.stringify({ command: 'card', take, refText: text, mode: pinyin ? 8 : 1, seconds: 2, verdict: pinyin ? '过' : '重录', reasons: pinyin ? ['全部过线'] : ['句准确度 36 < 80', '山 的 sh 19 < 65,读成 s', `pairs=${flag('--pairs')}`], accuracy: 36, charsPerMin: 92, chars: [{ ch: '山', phone: 'sh', score: 19, ok: false, risk: ['sh_s'], readAs: 's' }], costYuan: 0.02, cached: false, ms: 40 })}\n`);
