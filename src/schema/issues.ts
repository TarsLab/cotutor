/**
 * zod 问题 → 修复指南行。契约校验失败时给人和 agent 看的不是 zod 的英文 issue,
 * 是「哪个字段、该是什么、现在是什么」——错误信息即修复指南(仓库老规矩)。
 */
import type { z } from 'zod';

const EXPECT: Record<string, string> = {
  string: '字符串',
  number: '数字',
  boolean: '布尔值(true/false)',
  object: '对象',
  array: '数组',
  int: '整数',
};

export function explainIssues(issues: z.core.$ZodIssue[]): string[] {
  return issues.map((i) => {
    const path = i.path.length ? i.path.map(String).join('.') : '(根)';
    switch (i.code) {
      case 'invalid_type':
        return `${path}:应为${EXPECT[i.expected] ?? i.expected}${i.input === undefined ? ',现在缺失' : ''}`;
      case 'invalid_value':
        return `${path}:只能是 ${i.values.map((v) => JSON.stringify(v)).join(' / ')}`;
      case 'too_small':
        return `${path}:${i.origin === 'string' ? '不能为空' : `不能小于 ${i.minimum}`}`;
      case 'too_big':
        return `${path}:不能大于 ${i.maximum}`;
      case 'invalid_format':
        return `${path}:格式不对(${i.format}${i.pattern ? ` ${i.pattern}` : ''})`;
      case 'unrecognized_keys':
        return `${path}:不认识的字段 ${i.keys.join(', ')}`;
      case 'invalid_union': {
        // 挑问题最少的那个分支解释(如观察行:缺 claim 比缺 retracted+by 更接近)
        const branches = (i as { errors?: z.core.$ZodIssue[][] }).errors ?? [];
        const best = branches.slice().sort((a, b) => a.length - b.length)[0];
        if (best?.length) return explainIssues(best.map((e) => ({ ...e, path: [...i.path, ...e.path] }))).join(';');
        return `${path}:不符合任何一种允许的形状`;
      }
      default:
        return `${path}:${i.message}`;
    }
  });
}
