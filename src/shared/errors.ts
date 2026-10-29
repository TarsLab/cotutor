/** 跨模块共用的错误(从 cli/workspace.ts 挪来,2026-10-29) */
import { redactHome } from './home.ts';

/** 用法错误:main 捕获后 exit 2,错误信息即修复指南。 */
export class UsageError extends Error {}

/** 配置文件损坏或形状不对:文件在,但用不了。 */
export class ConfigError extends UsageError {
  readonly file: string;
  constructor(file: string, cause: string) {
    super(`配置文件用不了:${redactHome(file)}\n${cause}\n修好它;文件在 git 里就 git diff 看改动、git checkout 回退。cotutor doctor 可逐项体检。`);
    this.file = file;
  }
}
