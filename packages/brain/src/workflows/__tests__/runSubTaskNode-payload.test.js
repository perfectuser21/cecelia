import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../harness-initiative.graph.js');

describe('runSubTaskNode payload [BEHAVIOR]', () => {
  const code = readFileSync(SRC, 'utf8');

  it('注入 logical_task_id 让 extractWorkstreamIndex 能解出 WORKSTREAM_INDEX', () => {
    expect(code).toContain('logical_task_id: subTask.id');
  });

  it('不再传 state.worktreePath 给 sub-graph（让 sub-graph 自己建独立 worktree）', () => {
    // 找 invoke 调用范围内不能含没注释的 worktreePath: state.worktreePath
    const invokeBlock = code.match(/await compiled\.invoke\([\s\S]*?\),\s*config\s*\)/);
    expect(invokeBlock).toBeTruthy();
    expect(invokeBlock[0]).not.toMatch(/^\s*worktreePath:\s*state\.worktreePath/m);
  });
});
