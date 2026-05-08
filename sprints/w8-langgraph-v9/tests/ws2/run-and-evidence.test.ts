import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const EVIDENCE = 'sprints/w8-langgraph-v9/acceptance-evidence.md';
const TASK_ID_FILE = '/tmp/w8v9-task-id';
const DB = process.env.DB || 'postgresql://localhost/cecelia';

function readTaskId(): string {
  if (!existsSync(TASK_ID_FILE)) throw new Error(`${TASK_ID_FILE} not present — WS1 未跑`);
  const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
  if (!id || id === 'null') throw new Error(`task_id 为空`);
  return id;
}

function psql(sql: string): string {
  return execSync(`psql "${DB}" -t -A -c ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

describe('Workstream 2 — 跑通全图 + 收 evidence [BEHAVIOR]', () => {
  it('A 阶段：60min 时间窗内 distinct planning node 计数 ≥ 6', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(DISTINCT (data->>'node')) FROM task_events WHERE task_id='${id}' AND event_type='graph_node_update' AND data->>'node' IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert') AND created_at > NOW() - interval '60 minutes'`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(6);
  });

  it('A 阶段尾：sub_task 行 ≥ 1 且 payload.contract_dod_path 字符串非空', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(*) FROM tasks WHERE parent_task_id='${id}' AND payload ? 'contract_dod_path' AND (payload->>'contract_dod_path') <> '' AND created_at > NOW() - interval '60 minutes'`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(1);
  });

  it('B 阶段：120min 时间窗内 interrupt_pending ≥ 1 且 interrupt_resumed ≥ 1', () => {
    const id = readTaskId();
    const pending = psql(
      `SELECT count(*) FROM task_events WHERE (task_id='${id}' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='${id}')) AND event_type='interrupt_pending' AND created_at > NOW() - interval '120 minutes'`
    );
    const resumed = psql(
      `SELECT count(*) FROM task_events WHERE (task_id='${id}' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='${id}')) AND event_type='interrupt_resumed' AND created_at > NOW() - interval '120 minutes'`
    );
    expect(parseInt(pending, 10)).toBeGreaterThanOrEqual(1);
    expect(parseInt(resumed, 10)).toBeGreaterThanOrEqual(1);
  });

  it('B 阶段：thread_lookup 表（任一）命中 ≥ 1', () => {
    const out = psql(
      `SELECT (SELECT count(*) FROM walking_skeleton_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes') + (SELECT count(*) FROM harness_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes')`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(1);
  });

  it('B 阶段：loop closure 必过 — sub_task ≥ 1 行 status=completed 且 verdict ∈ {DONE, FAIL}（合同硬阈值，R3 binary verdict 模型）', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(*) FROM tasks WHERE parent_task_id='${id}' AND status='completed' AND COALESCE(result->>'verdict', custom_props->>'verdict') IN ('DONE','FAIL') AND created_at > NOW() - interval '120 minutes'`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(1);
  });

  it('C 阶段：final_evaluate + report 两节点都有 graph_node_update（loop closure 到底）', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(DISTINCT (data->>'node')) FROM task_events WHERE task_id='${id}' AND event_type='graph_node_update' AND data->>'node' IN ('final_evaluate','report') AND created_at > NOW() - interval '180 minutes'`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(2);
  });

  it('happy path（软阈值，软失败仍写 evidence）：至少 1 sub_task verdict=DONE + pr_url 匹配 GitHub PR URL + gh pr view 显示 MERGED 到 main', () => {
    const id = readTaskId();
    const prUrl = psql(
      `SELECT COALESCE(result->>'pr_url', custom_props->>'pr_url') FROM tasks WHERE parent_task_id='${id}' AND status='completed' AND COALESCE(result->>'verdict', custom_props->>'verdict')='DONE' LIMIT 1`
    );
    expect(prUrl).toMatch(/^https:\/\/github\.com\/.+\/pull\/\d+$/);
    const prNum = prUrl.match(/(\d+)$/)![1];
    const json = execSync(`gh pr view ${prNum} --json state,mergedAt,baseRefName`, { encoding: 'utf8' });
    const meta = JSON.parse(json);
    expect(meta.state).toBe('MERGED');
    expect(meta.mergedAt).toBeTruthy();
    expect(meta.baseRefName).toBe('main');
  });

  it('evidence 文档存在 + 含 task_id + 4 个 hotfix PR + 无占位符 + SQL 截关键字 + 双 verdict 字段（R2 新增）', () => {
    expect(existsSync(EVIDENCE)).toBe(true);
    const text = readFileSync(EVIDENCE, 'utf8');
    const id = readTaskId();
    expect(text).toContain(id);
    expect(text).toMatch(/#2845/);
    expect(text).toMatch(/#2846/);
    expect(text).toMatch(/#2847/);
    expect(text).toMatch(/#2850/);
    expect(text).not.toMatch(/TBD|TODO|PLACEHOLDER|XXXX|<填写>/);
    expect(text).toMatch(/graph_node_update|interrupt_pending|interrupt_resumed/);
    // R2 binary verdict 模型：evidence 必须显式记录两个 verdict
    expect(text).toMatch(/loop_verdict[\s\S]{0,40}(PASS|true|success)/);
    expect(text).toMatch(/task_verdict[\s\S]{0,40}(PASS|FAIL)/);
  });
});
