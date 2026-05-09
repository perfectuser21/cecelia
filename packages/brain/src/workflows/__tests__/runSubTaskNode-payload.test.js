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
    // 锁定到 runSubTaskNode 函数体（不影响 spawnNode 等其他用 state.worktreePath 的节点）
    const fnMatch = code.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];
    // runSubTaskNode 内不含未注释的 worktreePath: state.worktreePath
    const lines = fnBody.split('\n');
    const uncommented = lines.filter((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//')) return false;
      return /worktreePath:\s*state\.worktreePath/.test(l);
    });
    expect(uncommented).toEqual([]);
  });
});
