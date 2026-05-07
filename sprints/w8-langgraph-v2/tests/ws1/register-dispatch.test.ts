import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';

const SCRIPT = 'scripts/acceptance/w8-v2/register-and-dispatch.sh';
const FIXED_UUID = '39d535f3-520a-4a92-a2b6-b31645e11664';

describe('Workstream 1 — register-and-dispatch.sh [BEHAVIOR]', () => {
  it('脚本文件存在且可读', () => {
    expect(() => accessSync(SCRIPT, constants.R_OK)).not.toThrow();
  });

  it('脚本以 #!/bin/bash 开头并启用 set -euo pipefail', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toMatch(/^#!\/bin\/bash/);
    expect(c).toMatch(/set -[eu]+o\s+pipefail/);
  });

  it('脚本含 fixed UUID 字面量与清理 SQL（DELETE 或 UPDATE initiative_runs）', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toContain(FIXED_UUID);
    expect(c).toMatch(/DELETE FROM|UPDATE\s+initiative_runs/i);
  });

  it('脚本通过 curl -f -X POST localhost:5221/api/brain/tasks 注册任务', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toMatch(/curl[^\n]*-f[^\n]*-X POST[^\n]*\/api\/brain\/tasks/);
  });

  it('脚本调用 dispatch endpoint /api/brain/tasks/.../dispatch', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toMatch(/\/api\/brain\/tasks\/[^\s]*\/dispatch/);
  });

  it('脚本注册 payload 含 sprint_dir / budget_usd / timeout_sec / thin_features 关键字', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    for (const k of ['sprints/w8-langgraph-v2', 'budget_usd', 'timeout_sec', 'thin_features']) {
      expect(c, `missing token: ${k}`).toContain(k);
    }
  });

  it('脚本含 task_events tail 段（graph_node_update + dispatch.log 输出）', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toContain('graph_node_update');
    expect(c).toMatch(/dispatch\.log/);
  });

  it('脚本结尾打印 DISPATCH_COMPLETE: phase=...', () => {
    const c = readFileSync(SCRIPT, 'utf8');
    expect(c).toMatch(/DISPATCH_COMPLETE:\s*phase=/);
  });

  it('脚本 bash -n 语法合法', () => {
    expect(() => execSync(`bash -n ${SCRIPT}`, { stdio: 'pipe' })).not.toThrow();
  });
});
