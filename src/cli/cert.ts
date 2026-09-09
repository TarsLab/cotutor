/**
 * cotutor cert:用 mkcert 给这台机器签一张证书到 <ws>/certs/(cert.pem + key.pem),serve 看到就走 HTTPS。
 * 为什么要:iPad Safari 的录音 / 语音识别只在安全上下文里给;局域网 IP 不是 localhost,得自签。
 * 主机名 = 本机名、本机名.local、所有局域网 IPv4、localhost、127.0.0.1,再加 --host 给的。已有证书就覆盖(证书可再生)。
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CERT_DIR, lanAddresses } from './serve.ts';
import { UsageError, loadWorkspace } from './workspace.ts';

const execFileP = promisify(execFile);

export interface CertResult {
  cert: string;
  key: string;
  hosts: string[];
  caRoot: string;
}

export async function makeCert(workspace: string | undefined, extraHosts: string[] = []): Promise<CertResult> {
  const ws = loadWorkspace(workspace);
  let caRoot: string;
  try {
    caRoot = (await execFileP('mkcert', ['-CAROOT'], { timeout: 8000 })).stdout.trim();
  } catch {
    throw new UsageError('PATH 里没有 mkcert。装:brew install mkcert && mkcert -install(在 Mac 上信任一次根证书);iPad 端见 cert 命令输出的提示。');
  }
  const host = hostname();
  const hosts = [...new Set([host, host.endsWith('.local') ? host : `${host}.local`, ...lanAddresses(), 'localhost', '127.0.0.1', ...extraHosts])];
  const dir = join(ws.root, CERT_DIR);
  await mkdir(dir, { recursive: true });
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  try {
    await execFileP('mkcert', ['-cert-file', cert, '-key-file', key, ...hosts], { timeout: 60_000 });
  } catch (err) {
    throw new UsageError(`mkcert 签证书失败:${err instanceof Error ? err.message : String(err)}\n先跑 mkcert -install,再重试。`);
  }
  return { cert, key, hosts, caRoot };
}
