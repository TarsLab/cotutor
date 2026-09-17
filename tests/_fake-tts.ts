/**
 * 假配音命令:模仿 voxtell 的两个子命令——
 * say 形状是 <text> --voice <v> --json -o <out>,把一小段字节写到 -o;--voice fail 时失败;
 * voices --json 吐三个音色(与 voxtell voices --json 同形:{voices: [{voice, name, gender, age, trait, scene, lang}]})。
 */
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'voices') {
  const voices = [
    { voice: 'v-math', name: '假数学', gender: '女', age: 26, trait: '温柔亲和音', scene: '日常对话', lang: '中文' },
    { voice: 'v-kid', name: '假少年', gender: '男', age: 10, trait: '机灵少年音', scene: '日常对话', lang: '中文' },
    { voice: 'fail', name: '坏音色', gender: '女', age: 30, trait: '合成会失败', scene: '测试', lang: '中文' },
  ];
  process.stdout.write(JSON.stringify({ command: 'voices', total: voices.length, matched: voices.length, voices }) + '\n');
  process.exit(0);
}
const out = argv[argv.indexOf('-o') + 1];
const voice = argv[argv.indexOf('--voice') + 1];
if (voice === 'fail') {
  process.stderr.write('voxtell: 音色不存在\n');
  process.exit(1);
}
writeFileSync(out, Buffer.from(`fake-mp3:${voice}:${argv[0]}`));
process.stdout.write(JSON.stringify({ ok: true, file: out }) + '\n');
