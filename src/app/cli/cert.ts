/**
 * cotutor cert:用 mkcert 给这台机器签一张证书到 ~/.config/cotutor/certs/(cert.pem + key.pem),serve 看到就走 HTTPS。
 * 为什么要:平板、手机浏览器的录音 / 语音识别只在安全上下文里给;局域网 IP 不是 localhost,得自签。
 * 为什么放机器级而不是 workspace:签的是电脑名与局域网 IP,与孩子无关;多个 workspace 共用一张。
 * 主机名 = 电脑名、电脑名.local、所有局域网 IPv4、localhost、127.0.0.1,再加 --host 给的。已有证书就覆盖(证书可再生)。不需要 workspace。
 * 地址认电脑名,IP 变了不用重签;证书里的 IP 只给手输数字地址的退路用。改了电脑名才要重签。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { computerName, lanAddresses } from './serve.ts';
import { USER_CERT_DIR, UsageError } from '../workspace.ts';

const execFileP = promisify(execFile);

/**
 * 这台电脑信任根证书的命令(只管这台电脑的浏览器;cotutor cert 不等它,mkcert 没有根证书时自己建一个照样签)。
 * Mac 不用 mkcert -install:它 sudo 写系统钥匙串,要在终端里输管理员密码,标准账户跑不了。信任到当前用户的登录钥匙串就够了(Safari、Chrome 都认,
 * mkcert 看 trusted 用的 security verify-cert 也认),系统弹框要登录密码,agent 起的也弹得出来(2026-11-10 在 macOS 27 上从 VS Code 里试过,点之前命令一直等着);经 SSH 弹不出框。
 * Windows 的 mkcert -install 装进当前用户的根证书,不用管理员,弹窗点「是」。Linux 要 sudo。
 */
export function trustCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db "$(mkcert -CAROOT)/rootCA.pem"' : 'mkcert -install';
}

/** 跑 trustCommand 时人要做什么 */
export function trustPrompt(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '弹框要这台电脑的登录密码,输在框里';
  if (platform === 'win32') return '弹窗问装不装根证书,点「是」;不用管理员';
  return '要 sudo 密码';
}

/**
 * 这个系统上怎么装 mkcert、信任一次根证书(doctor 与 cert 共用)。
 * 没有 winget 的(11-02 那台就没有)下官方的 exe。
 */
export function mkcertHint(platform: NodeJS.Platform = process.platform): string {
  const trust = `${trustCommand(platform)}(${trustPrompt(platform)})`;
  if (platform === 'darwin') return `brew install mkcert,再 ${trust}`;
  if (platform === 'win32') return `winget install FiloSottile.mkcert(没有 winget 就到 https://github.com/FiloSottile/mkcert/releases 下 windows-amd64 那个,改名 mkcert.exe 放进 PATH),重开终端跑 ${trust}`;
  // libnss3-tools 给 mkcert 一个 certutil,这台电脑上的 Chrome、Firefox 才认证书(2026-11-09 Ubuntu 22.04 上装过)
  return '用系统的包管理器装 mkcert(Ubuntu、Debian 上 sudo apt install mkcert libnss3-tools),再 mkcert -install(要 sudo 密码)';
}

/** mkcert 在、根证书建过了:cotutor cert 不用人就能跑(没建过时 cotutor cert 也能自己建,doctor 只是保守) */
export async function mkcertReady(caRootOf: () => Promise<string> = async () => (await execFileP('mkcert', ['-CAROOT'], { timeout: 8000 })).stdout.trim()): Promise<boolean> {
  try {
    return existsSync(join(await caRootOf(), 'rootCA.pem'));
  } catch {
    return false;
  }
}

/** 根证书没进这台电脑的系统信任。mkcert 没有根证书时自己建一个、照样签成功,只在 stderr 说一句(Firefox、Java 的信任库它也说,那些不算);没有单独的查询命令,只能这样看 */
export const mkcertUntrusted = (stderr: string): boolean => stderr.includes('not installed in the system trust store');

export interface CertResult {
  cert: string;
  key: string;
  hosts: string[];
  caRoot: string;
  /** 这台电脑信任根证书了;false 时证书能用,但这台电脑的浏览器会报警告 */
  trusted: boolean;
}

export async function makeCert(extraHosts: string[] = []): Promise<CertResult> {
  let caRoot: string;
  try {
    caRoot = (await execFileP('mkcert', ['-CAROOT'], { timeout: 8000 })).stdout.trim();
  } catch {
    throw new UsageError(`PATH 里没有 mkcert。装:${mkcertHint()}(这台电脑信任一次根证书);平板、手机端见 cert 命令输出的提示与 docs/iPad与iPhone.md。`);
  }
  const name = computerName();
  // os.hostname() 也带上:和电脑名不一样时(macOS 上可能跟着网络变),以前能开的地址别丢
  const hosts = [...new Set([name, `${name}.local`, hostname(), ...lanAddresses(), 'localhost', '127.0.0.1', ...extraHosts])];
  const dir = USER_CERT_DIR;
  await mkdir(dir, { recursive: true });
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  let trusted: boolean;
  try {
    const { stderr } = await execFileP('mkcert', ['-cert-file', cert, '-key-file', key, ...hosts], { timeout: 60_000 });
    trusted = !mkcertUntrusted(stderr);
  } catch (err) {
    throw new UsageError(`mkcert 签证书失败:${err instanceof Error ? err.message : String(err)}\n先跑 ${trustCommand()}(${trustPrompt()}),再重试。`);
  }
  return { cert, key, hosts, caRoot, trusted };
}
