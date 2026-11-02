/** 假的千问 key:key 只认 ~/.config/cotutor/ 的两个文件(src/shared/qianwen.ts),测试建一个临时的家写进去,把 HOME 指过去。 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 建一个家:给了 payg / workspaceId 写 bailian.json,给了 plan 写 token-plan.json;回家的路径 */
export function keysHome(o: { payg?: string; workspaceId?: string; plan?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'cotutor-keys-'));
  writeKeys(home, o);
  return home;
}

/** 往已有的家里写(测试自己的 HOME) */
export function writeKeys(home: string, o: { payg?: string; workspaceId?: string; plan?: string }): void {
  const dir = join(home, '.config', 'cotutor');
  mkdirSync(dir, { recursive: true });
  if (o.payg || o.workspaceId) writeFileSync(join(dir, 'bailian.json'), JSON.stringify({ apiKey: o.payg, workspaceId: o.workspaceId }));
  if (o.plan) writeFileSync(join(dir, 'token-plan.json'), JSON.stringify({ apiKey: o.plan }));
}
