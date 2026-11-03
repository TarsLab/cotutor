/**
 * 老师的出厂头像:三门主科各一张木钉娃娃(包根 avatars/<学科>.webp,出处与重渲见 scripts/avatars/peg.py)。
 * cotutor.json 里这位老师没写 avatar,或还是旧版 init 写进去的那个 emoji(🧮 📚 🔤),就用它;家长写了别的(emoji 或图片路径)照家长的。
 * 不拷进 workspace:图跟着包走,换了包就换了图。页面按 avatar 的后缀判定是不是图,所以下发的是一个带后缀的名字(FACTORY_PREFIX 打头),
 * 图本身和 figshot 的一样从 /api/kid/avatar/<老师> 取。
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSubject } from '../../schema/index.ts';

/** 本包自带的头像目录(仓库检出与 npm 安装都在包根 avatars/) */
export const PACKAGE_AVATARS_DIR = fileURLToPath(new URL('../../../avatars/', import.meta.url));
const SUBJECT_AVATARS: Readonly<Record<string, string>> = { 语文: 'chinese.webp', 数学: 'math.webp', 英语: 'english.webp' };
/** 2026-11-02 以前 init 写进 cotutor.json 的出厂 emoji:当作没写 */
const OLD_FACTORY_EMOJI = new Set(['📚', '🧮', '🔤']);
/** 下发给页面的出厂头像名的前缀(不是 workspace 里的路径) */
export const FACTORY_PREFIX = 'factory:';

type AvatarOf = { avatar?: string; subject?: string };

/** 用出厂头像的话是哪张(文件名);家长自己定了、或不是三门主科 → null */
const factoryName = (t: AvatarOf): string | null => (t.avatar && !OLD_FACTORY_EMOJI.has(t.avatar) ? null : SUBJECT_AVATARS[canonicalSubject(t.subject) ?? ''] ?? null);

/** 这门学科的出厂头像在包里的文件(不管这位老师现在用不用);不是三门主科 → null */
export function subjectAvatarFile(subject: string | undefined): string | null {
  const f = SUBJECT_AVATARS[canonicalSubject(subject) ?? ''];
  return f ? join(PACKAGE_AVATARS_DIR, f) : null;
}

/** cotutor.json 里家长定的头像:没写或还是旧版出厂的 emoji → null(用出厂的) */
export const ownAvatar = (t: AvatarOf): string | null => (t.avatar && !OLD_FACTORY_EMOJI.has(t.avatar) ? t.avatar : null);

/** 出厂头像在包里的文件;不用出厂的 → null */
export function factoryAvatarFile(t: AvatarOf): string | null {
  const f = factoryName(t);
  return f ? join(PACKAGE_AVATARS_DIR, f) : null;
}

/** 下发给页面的 avatar:出厂的给「factory:<文件名>」,家长写的原样,都没有 null(页面显示学科首字) */
export function shownAvatar(t: AvatarOf): string | null {
  const f = factoryName(t);
  return f ? FACTORY_PREFIX + f : (t.avatar ?? null);
}
