/**
 * cotutor.json 的 JSON Schema:从 zod 契约现生成(类型即文档,不手写第二份)。
 * init / upgrade 把它写到 workspace 的 .cotutor/cotutor.schema.json,cotutor.json 首行 "$schema" 指过去,
 * 编辑器(VS Code、Obsidian 的 JSON 插件……)就有补全、悬停说明与红线,家长不必背字段。
 */
import { z } from 'zod';
import { CotutorConfigSchema } from './config.ts';

export const CONFIG_SCHEMA_FILE = '.cotutor/cotutor.schema.json';

export function cotutorJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(CotutorConfigSchema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown> & { properties?: Record<string, unknown> };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/TarsLab/cotutor/cotutor.schema.json',
    title: 'cotutor.json',
    description: '一孩一 workspace 的政策文件:老师表、政策、运行时、配音、路径角色。家长改这里;机器不覆盖。',
    ...js,
    properties: {
      $schema: { type: 'string', description: '指向本 schema,给编辑器用' },
      ...(js.properties ?? {}),
      _note: { type: 'string', description: '给人看的备注,机器不读' },
    },
  };
}
