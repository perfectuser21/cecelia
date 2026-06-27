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

  // Slice4 透传 gap（真 run 2937fd5e 暴露）：runSubTaskNode 透传了 machine/executor/sprint_dir
  // 但漏了 target_environment → sub-graph extractTargetEnv 默认 local_api → generator/evaluator
  // 走 docker，mac_web 的 Playwright 自验在无浏览器容器卡死。透传 target_environment 让其走 host 逃逸。
  it('Slice4 gap 修复：透传 target_environment 到 sub-task payload（mac_web generator/evaluator 走 host）', () => {
    const fnMatch = code.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];
    expect(/target_environment:\s*state\.task\??\.payload\??\.target_environment/.test(fnBody)).toBe(true);
  });
});
