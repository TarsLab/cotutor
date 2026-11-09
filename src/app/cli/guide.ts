/**
 * cotutor guide:把随包发的 INSTALL.md 原样打印给替家长安装的 AI 助手。
 * 家长只要打一句「先跑 npx cotutor@latest guide」,不用输网址;走 npm(国内能换镜像),说明和装上的版本对得上。
 * src/app/cli/ 与 dist/app/cli/ 都在包根下三层,和 main.ts 读 package.json 一样往上找。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redactHome } from '../workspace.ts';

export const PACKAGE_INSTALL_MD = fileURLToPath(new URL('../../../INSTALL.md', import.meta.url));

/**
 * 第一行只用 ASCII:Windows PowerShell 5.1 把管道里的 UTF-8 按系统代码页(中文系统是 936)解,
 * 下面的中文会成乱码,这一行还读得懂,告诉助手直接按 UTF-8 读文件。
 */
export function guideText(version: string): string {
  const head = `# cotutor ${version} INSTALL.md (for the AI assistant installing cotutor; if the text below is garbled, read this file as UTF-8: ${redactHome(PACKAGE_INSTALL_MD)} , $HOME is the home directory)`;
  return `${head}\n\n${readFileSync(PACKAGE_INSTALL_MD, 'utf8')}`;
}
