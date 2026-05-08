import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPORT = 'docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md';
const LEARN = 'docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md';
const PRD = 'sprints/w8-langgraph-v9/sprint-prd.md';
const TASK_ID_FILE = '/tmp/w8v9-task-id';
const DB = process.env.DB || 'postgresql://localhost/cecelia';

function readTaskId(): string {
  if (!existsSync(TASK_ID_FILE)) throw new Error(`${TASK_ID_FILE} not present`);
  return readFileSync(TASK_ID_FILE, 'utf8').trim();
}

function psql(sql: string): string {
  return execSync(`psql "${DB}" -t -A -c ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

describe('Workstream 3 — 最终 acceptance 报告 + learnings [BEHAVIOR]', () => {
  it('报告文件存在 + 6 段必填内容齐全（task_id / graph_node_update / KR / failure_reason 全空 / loop_verdict / task_verdict）', () => {
    expect(existsSync(REPORT)).toBe(true);
    const text = readFileSync(REPORT, 'utf8');
    const id = readTaskId();
    expect(text).toContain(id);
    expect(text).toMatch(/graph_node_update/);
    expect(text).toMatch(/KR|key_result|管家闭环/);
    expect(text).toMatch(/failure_reason.*(NULL|空|none|null)/i);
    // R2 双 verdict 模型：报告必须显式区分管道 vs 任务
    expect(text).toMatch(/loop_verdict/);
    expect(text).toMatch(/task_verdict/);
  });

  it('报告 sub_task PR 链接段：含至少一个 GitHub PR URL，或显式标注本轮无 PR（B 形态退化时）', () => {
    expect(existsSync(REPORT)).toBe(true);
    const text = readFileSync(REPORT, 'utf8');
    const hasPr = /https:\/\/github\.com\/.+\/pull\/\d+/.test(text);
    const hasNoPrNote = /(no_pr|无.{0,4}PR|task_fail_reason|sub_task_failed)/i.test(text);
    expect(hasPr || hasNoPrNote).toBe(true);
  });

  it('learnings 文件存在 + ≥ 60 字节 + 含 PRD 之外的细节', () => {
    expect(existsSync(LEARN)).toBe(true);
    const learn = readFileSync(LEARN, 'utf8');
    expect(Buffer.byteLength(learn, 'utf8')).toBeGreaterThanOrEqual(60);
    // 不能完全是 PRD 的子集（必须含 PRD 文本里没有的某句子或片段）
    const prd = existsSync(PRD) ? readFileSync(PRD, 'utf8') : '';
    const learnLines = learn.split('\n').map(s => s.trim()).filter(s => s.length >= 8);
    const hasNovelLine = learnLines.some(line => !prd.includes(line));
    expect(hasNovelLine).toBe(true);
  });

  it('Brain task 状态已回写：tasks.status=completed AND result 含 loop_success=true（result.merged 为软字段，task FAIL 时可为 false）', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(*) FROM tasks WHERE id='${id}' AND status='completed' AND (result->>'loop_success')='true' AND updated_at > NOW() - interval '180 minutes'`
    );
    expect(parseInt(out, 10)).toBe(1);
  });
});
