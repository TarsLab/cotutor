/**
 * 根证书(mkcert 的 rootCA.pem,公钥)在哪:平板扫码装证书时从这里给(serve.ts 的 http 那一面,GET /ca.crt)。
 * 只认 rootCA.pem;同目录的 rootCA-key.pem 是私钥,永远不读、不给。
 * 先看 CAROOT 环境变量和 mkcert 的缺省目录(后台服务的 PATH 里不一定有 mkcert),都没有再问 mkcert -CAROOT。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
export const ROOT_CA = 'rootCA.pem';

export function defaultCaRoot(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'mkcert');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'mkcert');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'mkcert');
}

export async function rootCaFile(o: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string; askMkcert?: () => Promise<string> } = {}): Promise<string | null> {
  const env = o.env ?? process.env;
  for (const dir of [env.CAROOT, defaultCaRoot(o.platform, env, o.home)]) {
    if (dir && existsSync(join(dir, ROOT_CA))) return join(dir, ROOT_CA);
  }
  try {
    const dir = await (o.askMkcert ?? (async () => (await execFileP('mkcert', ['-CAROOT'], { timeout: 5000, env })).stdout.trim()))();
    if (dir && existsSync(join(dir, ROOT_CA))) return join(dir, ROOT_CA);
  } catch { /* 没装 mkcert */ }
  return null;
}
