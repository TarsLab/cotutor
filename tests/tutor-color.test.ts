/**
 * 学科色与学科别名(《首页设计.md》拍板 26):三门主科固定、别名归一;其余按先后分、同一家不撞色;cotutor.json 的 color 优先;
 * 自动分的八种都是白字压得住的深色。
 */
import { check, done } from './_check.ts';
import { MIN_CONTRAST, NEUTRAL_COLOR, SUBJECT_COLORS, TUTOR_PALETTE, contrastWithWhite, tutorColors } from '../src/lib/tutor-color.ts';
import { canonicalSubject, subjectLang, tutorExtras, TutorSchema } from '../src/schema/config.ts';

try {
  check('别名归一:英文 / English / english 是英语,中文 / Chinese 是语文,Math 是数学;别的原样、去两头空白', canonicalSubject('英文') === '英语' && canonicalSubject(' English ') === '英语' && canonicalSubject('中文') === '语文' && canonicalSubject('Chinese') === '语文' && canonicalSubject('Math') === '数学' && canonicalSubject(' 口播 ') === '口播' && canonicalSubject('') === null && canonicalSubject(undefined) === null);
  check('听写写哪种跟着别名:英文、English 是 en;语文、没写是 zh', subjectLang('英文') === 'en' && subjectLang('English') === 'en' && subjectLang('英语') === 'en' && subjectLang('语文') === 'zh' && subjectLang(undefined) === 'zh');
  check('语文缺省带听写,别名也算', tutorExtras({ subject: '中文' }).join() === 'dictation' && tutorExtras({ subject: '数学' }).length === 0 && tutorExtras({ subject: '语文', extras: [] }).length === 0);

  const c = tutorColors({ 'chinese-tutor': { subject: '语文' }, 'math-tutor': { subject: '数学' }, 'english-tutor': { subject: 'English' }, 'koubo-tutor': { subject: '口播' }, 'music-tutor': { subject: '音乐' }, 'pe-tutor': { subject: '体育' } });
  check('三门主科固定(别名也认)', c['chinese-tutor'] === SUBJECT_COLORS['语文'] && c['math-tutor'] === SUBJECT_COLORS['数学'] && c['english-tutor'] === SUBJECT_COLORS['英语'], JSON.stringify(c));
  check('其余按先后从调色板里挑,不撞色(原来音乐、体育都是紫的)', c['koubo-tutor'] === TUTOR_PALETTE[0] && c['music-tutor'] === TUTOR_PALETTE[1] && c['pe-tutor'] === TUTOR_PALETTE[2] && new Set(Object.values(c)).size === 6, JSON.stringify(c));
  const d = tutorColors({ 'koubo-tutor': { subject: '口播', color: '#C2410C' }, 'art-tutor': { subject: '美术' }, 'english-tutor': { subject: '英语', color: '#123456' } });
  check('cotutor.json 写了 color 优先(主科也能改);写了的颜色别人不再分到', d['english-tutor'] === '#123456' && d['koubo-tutor'] === '#c2410c' && d['art-tutor'] === TUTOR_PALETTE[1], JSON.stringify(d));
  const many = tutorColors(Object.fromEntries(Array.from({ length: 12 }, (_x, k) => [`t${k}-tutor`, { subject: `科${k}` }])));
  check('老师比颜色多:八种用完从头轮,每位都有颜色', Object.values(many).length === 12 && Object.values(many).every((x) => (TUTOR_PALETTE as readonly string[]).includes(x)));
  check('自动分的八种、三门主科、中性灰:白字对比度都 ≥ 4.5', [...TUTOR_PALETTE, ...Object.values(SUBJECT_COLORS).filter((x) => x !== SUBJECT_COLORS['英语']), NEUTRAL_COLOR].every((x) => contrastWithWhite(x) >= MIN_CONTRAST), [...TUTOR_PALETTE, NEUTRAL_COLOR].map((x) => `${x} ${contrastWithWhite(x).toFixed(2)}`).join(' '));
  check('英语绿 4.38:差一点,大字(新话题 24px 粗体)够 3', contrastWithWhite(SUBJECT_COLORS['英语']) > 4.3);
  check('color 只收 #rrggbb', TutorSchema.safeParse({ display: '口播老师', color: '#a33a2a' }).success && !TutorSchema.safeParse({ display: '口播老师', color: 'red' }).success && !TutorSchema.safeParse({ display: '口播老师', color: '#fff' }).success);
} finally {
  done();
}
