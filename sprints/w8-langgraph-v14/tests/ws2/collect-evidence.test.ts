// Round 3: 8 个 it() 用例覆盖 collect-evidence.sh 全部 BEHAVIOR；
// 不动代码跑（脚本未实现）→ 8 个全红，命令：
//   npx vitest run sprints/w8-langgraph-v14/tests/ws2/ --reporter=verbose
// 新增第 8 条覆盖 R4 mitigation：evidence 中 evaluator_worktree_path 含 task- 前缀。
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
  'evaluator_worktree_path',  // R4 mitigation 新增
];

describe('Workstream 2 — collect evidence + anti-spoofing PR + worktree path [BEHAVIOR]', () => {
  // L20 — 未实现红证据：existsSync(COLLECT) === false
  it('collect-evidence.sh 文件存在且可执行', () => {
    expect(existsSync(COLLECT)).toBe(true);
    const mode = statSync(COLLECT).mode;
    expect((mode & 0o111) !== 0).toBe(true);
  });

  // L28 — 未实现红证据：readFileSync 抛 ENOENT
  it('collect-evidence.sh 含查 tasks / harness_state_transitions 表的 SQL', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('tasks');
    expect(c).toContain('parent_task_id');
    expect(c).toContain('harness_state_transitions');
  });

  // L36 — 未实现红证据：readFileSync 抛 ENOENT
  it('collect-evidence.sh 调 gh pr view 校验 PR 真存在（R2 反 result 字段假写 URL）', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('gh pr view');
    expect(c).toMatch(/state|OPEN|MERGED/);
  });

  // L42 — 未实现红证据：readFileSync 抛 ENOENT
  it('collect-evidence.sh 输出路径硬编码为 sprints/w8-langgraph-v14/run-evidence.md', () => {
    const c = readFileSync(COLLECT, 'utf8');
    expect(c).toContain('sprints/w8-langgraph-v14/run-evidence.md');
  });

  // L50 — 未实现红证据：execSync ENOENT；evidence 文件不存在
  it('执行 collect-evidence.sh 后 run-evidence.md 含 6 个 key 且非占位', () => {
    execSync(`bash ${COLLECT}`, { stdio: 'inherit', timeout: 120_000 });
    expect(existsSync(EVIDENCE)).toBe(true);
    const c = readFileSync(EVIDENCE, 'utf8');
    for (const k of REQUIRED_KEYS) {
      const re = new RegExp(`^${k}:\\s*\\S+`, 'm');
      expect(c, `key '${k}' 缺失或值为空`).toMatch(re);
    }
    expect(c).toMatch(/^initiative_task_id:\s*[0-9a-f]{8}-/m);
    expect(c).toMatch(/^tasks_table_status:\s*completed/m);
    expect(c).toMatch(/^pr_url:\s*https:\/\/github\.com\//m);
    expect(c).toMatch(/^gan_proposer_rounds:\s*[1-9][0-9]*/m);
  }, 120_000);

  // L65 — 未实现红证据：evidence 文件不存在 → existsSync false
  it('run-evidence.md mtime 在最近 2 小时内（防 stale 文件造假）', () => {
    expect(existsSync(EVIDENCE)).toBe(true);
    const mtime = statSync(EVIDENCE).mtimeMs;
    const ageSec = (Date.now() - mtime) / 1000;
    expect(ageSec).toBeLessThan(7200);
  });

  // L75 — 未实现红证据：evidence 文件不存在 → readFileSync 抛 ENOENT；
  //          即使存在但 PR 是假 URL → gh pr view 退非 0 → execSync 抛错
  // R2 mitigation: result.pr_url 假写实证
  it('run-evidence.md 中 pr_url 经 gh pr view 校验真实存在（R2 反造假实证）', () => {
    const c = readFileSync(EVIDENCE, 'utf8');
    const m = c.match(/^pr_url:\s*(https:\/\/github\.com\/[^\s]+\/pull\/(\d+))/m);
    expect(m, 'pr_url 行缺失或形态非法').not.toBeNull();
    const prNum = m![2];
    const state = execSync(`gh pr view ${prNum} --json state --jq .state`, { encoding: 'utf8' }).trim();
    expect(['OPEN', 'MERGED']).toContain(state);
  });

  // L86 — 未实现红证据：evidence 文件不存在 → readFileSync 抛 ENOENT；
  //          即使存在 evaluator_worktree_path 也不会有 task- 前缀
  // R4 mitigation: H8 修复后 evaluator 切到 generator 的 task worktree（路径以 'task-' 开头）
  // evidence 必须把该路径固化为可观测证据，避免只是引用 PR #2854 而无运行时实证
  it('run-evidence.md 中 evaluator_worktree_path 含 task- 前缀（R4 worktree 串扰 mitigation 实证）', () => {
    const c = readFileSync(EVIDENCE, 'utf8');
    const m = c.match(/^evaluator_worktree_path:\s*(\S+)/m);
    expect(m, 'evaluator_worktree_path 行缺失').not.toBeNull();
    const path = m![1];
    expect(path, 'evaluator_worktree_path 必须含 task- 前缀（H8 修复后 evaluator 切到 generator task worktree）').toMatch(/task-/);
  });
});
