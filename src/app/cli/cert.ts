/**
 * cotutor cert:用 mkcert 给这台机器签一张证书到 ~/.config/cotutor/certs/(cert.pem + key.pem),serve 看到就走 HTTPS。
 * 为什么要:平板、手机浏览器的录音 / 语音识别只在安全上下文里给;局域网 IP 不是 localhost,得自签。
 * 为什么放机器级而不是 workspace:签的是本机名与局域网 IP,与孩子无关;多个 workspace 共用一张,IP 变了只重签一次。
 * 主机名 = 本机名、本机名.local、所有局域网 IPv4、localhost、127.0.0.1,再加 --host 给的。已有证书就覆盖(证书可再生)。不需要 workspace。
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { lanAddresses } from './serve.ts';
import { USER_CERT_DIR, UsageError } from '../workspace.ts';

const execFileP = promisify(execFile);

/**
 * 这个系统上怎么装 mkcert、信任一次根证书(doctor 与 cert 共用)。Windows 上 mkcert -install 装进当前用户的根证书,会弹窗问,点「是」;
 * 没有 winget 的(11-02 那台就没有)下官方的 exe。
 */
export function mkcertHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'brew install mkcert && mkcert -install';
  if (platform === 'win32') return 'winget install FiloSottile.mkcert(没有 winget 就到 https://github.com/FiloSottile/mkcert/releases 下 windows-amd64 那个,改名 mkcert.exe 放进 PATH),重开终端跑 mkcert -install(弹窗问装不装根证书,点「是」)';
  return '用系统的包管理器装 mkcert(如 apt install mkcert),再 mkcert -install';
}

export interface CertResult {
  cert: string;
  key: string;
  hosts: string[];
  caRoot: string;
}

export async function makeCert(extraHosts: string[] = []): Promise<CertResult> {
  let caRoot: string;
  try {
    caRoot = (await execFileP('mkcert', ['-CAROOT'], { timeout: 8000 })).stdout.trim();
  } catch {
    throw new UsageError(`PATH 里没有 mkcert。装:${mkcertHint()}(这台电脑信任一次根证书);平板、手机端见 cert 命令输出的提示与 docs/iPad与iPhone.md。`);
  }
  const host = hostname();
  const hosts = [...new Set([host, host.endsWith('.local') ? host : `${host}.local`, ...lanAddresses(), 'localhost', '127.0.0.1', ...extraHosts])];
  const dir = USER_CERT_DIR;
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
