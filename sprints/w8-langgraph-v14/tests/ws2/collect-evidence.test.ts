import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const COLLECT = 'sprints/w8-langgraph-v14/scripts/collect-evidence.sh';
const EVIDENCE = 'sprints/w8-langgraph-v14/run-evidence.md';
const REQUIRED_KEYS = [
  'initiative_task_id',
  'tasks_table_status',
  'pr_url',
  'gan_proposer_rounds',
  'node_durations',
];

describe('Workstream 2 — collect evidence [BEHAVIOR]', () => {
  it('collect-evidence.sh 文件存在且可执行', () => {
    expect(existsSync(COLLECT)).toBe(true);
    const mode = statSync(COLLECT).mode;
    expect((mode & 0o111) !== 0).toBe(true);
  });

  it('collect-evidence.sh 含查 tasks / harness_state_transitions 表的 SQL', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('tasks');
    expect(c).toContain('parent_task_id');
    expect(c).toContain('harness_state_transitions');
  });

  it('collect-evidence.sh 调 gh pr view 校验 PR 存在', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('gh pr view');
  });

  it('collect-evidence.sh 输出路径硬编码为 sprints/w8-langgraph-v14/run-evidence.md', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('sprints/w8-langgraph-v14/run-evidence.md');
  });

  it('执行 collect-evidence.sh 后 run-evidence.md 含 5 个 key 且非占位', () => {
    execSync(`bash ${COLLECT}`, { stdio: 'inherit', timeout: 120_000 });
    expect(existsSync(EVIDENCE)).toBe(true);
    const c = readFileSync(EVIDENCE, 'utf8');
    for (const k of REQUIRED_KEYS) {
      const re = new RegExp(`^${k}:\\s*\\S+`, 'm');
      expect(c).toMatch(re);
    }
    expect(c).toMatch(/^initiative_task_id:\s*[0-9a-f]{8}-/m);
    expect(c).toMatch(/^tasks_table_status:\s*completed/m);
    expect(c).toMatch(/^pr_url:\s*https:\/\/github\.com\//m);
    expect(c).toMatch(/^gan_proposer_rounds:\s*[1-9][0-9]*/m);
  }, 120_000);

  it('run-evidence.md mtime 在最近 2 小时内（防 stale 文件造假）', () => {
    expect(existsSync(EVIDENCE)).toBe(true);
    const mtime = statSync(EVIDENCE).mtimeMs;
    const ageSec = (Date.now() - mtime) / 1000;
    expect(ageSec).toBeLessThan(7200);
  });
});
