/**
 * Qwen Code(`qwen`)的适配器。输出与 claude 同族(stream-json.ts)。
 */
import type { Runtime } from '../schema/index.ts';
import { parseStreamJson, streamJsonUserMessage } from './stream-json.ts';
import type { CliAdapter, ToolKind } from './types.ts';

const KINDS: Record<string, ToolKind> = {
  read_file: 'read',
  read_many_files: 'read',
  zoom_image: 'read',
  list_directory: 'read',
  run_shell_command: 'shell',
  glob: 'search',
  grep_search: 'search',
  edit: 'edit',
  write_file: 'edit',
  notebook_edit: 'edit',
  skill: 'skill',
};

export const qwen: CliAdapter = {
  name: 'qwen',
  parse: parseStreamJson,
  stdinMessage: streamJsonUserMessage,
  toolList: (set) => (set === 'on' ? 'read_file,glob,grep_search' : ''),
  toolArgs: () => [],
  toolKind: (name) => KINDS[name] ?? 'other',
  env: (env) => env,
  runtimes: (): Record<string, Runtime> => ({
    qwen: {
      run: ['qwen', '-p', '{prompt}', '--append-system-prompt', '{systemBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
      resume: ['qwen', '-p', '{prompt}', '--resume', '{session}', '--append-system-prompt', '{systemBody}', '--yolo', '--output-format', 'stream-json', '--max-wall-time', '10m'],
    },
  }),
};
