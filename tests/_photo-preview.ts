/**
 * 拍照的「预习」(以板为主、孩子拍课本的一页、认字):出厂的语文预习 2026-11-14 改成了课本做底(base: textbook),
 * 测照片板这条路的测试(board-page、photo-words、live-board)把改之前的那份放进自己的 workspace,不随出厂文件变。
 */
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

export function pinPhotoPreview(root: string, tutor = 'chinese-tutor'): void {
  copyFileSync(new URL('./fixtures/activities/预习-拍照.md', import.meta.url), join(root, 'agents', tutor, 'activities', '预习.md'));
}
