import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const DB = process.env.DB || 'postgresql://localhost/cecelia';
const V16_DESC = '[W8 v16 — final] Walking Skeleton noop 真端到端';

function psql(sql: string): string {
  try {
    return execSync(`psql "${DB}" -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getInitiativeId(): string {
  return psql(
    `SELECT id FROM tasks WHERE task_type='harness_initiative' AND description LIKE '%${V16_DESC}%' AND parent_task_id IS NULL ORDER BY created_at DESC LIMIT 1`
  );
}

function getGeneratorTaskId(initiativeId: string): string {
  if (!initiativeId) return '';
  return psql(
    `SELECT id FROM tasks WHERE parent_task_id='${initiativeId}' AND task_type='harness_generate' ORDER BY created_at DESC LIMIT 1`
  );
}

describe('Workstream 1 — W8 v16 Walking Skeleton e2e completion [BEHAVIOR]', () => {

  it('v16 initiative task 存在且 payload.skeleton_mode=true', () => {
    const initiativeId = getInitiativeId();
    expect(initiativeId, 'v16 initiative task 不存在于 tasks 表').not.toBe('');
    const skeleton = psql(`SELECT (payload->>'skeleton_mode') FROM tasks WHERE id='${initiativeId}'`);
    expect(skeleton).toBe('true');
  });

  it('generator sub_task status=completed', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    expect(generatorTaskId, 'generator sub_task 不存在').not.toBe('');
    const status = psql(`SELECT status FROM tasks WHERE id='${generatorTaskId}'`);
    expect(status).toBe('completed');
  });

  it('generator sub_task result.pr_url 是合法 GitHub PR URL', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    const prUrl = psql(`SELECT result->>'pr_url' FROM tasks WHERE id='${generatorTaskId}'`);
    expect(prUrl).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
  });

  it('evaluator sub_task 写入 callback_at 且与 generator.updated_at 漂移 ≤ 300s（证明非人工 PATCH）', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    const evalCallback = psql(
      `SELECT result->>'callback_at' FROM tasks WHERE parent_task_id='${initiativeId}' AND task_type='harness_evaluate' AND status='completed' ORDER BY updated_at DESC LIMIT 1`
    );
    expect(evalCallback, 'evaluator sub_task 缺 callback_at — 无法证明 status 由 evaluator 写入而非人工 PATCH').not.toBe('');
    const driftStr = psql(
      `SELECT ABS(EXTRACT(EPOCH FROM (updated_at - '${evalCallback}'::timestamp)))::int FROM tasks WHERE id='${generatorTaskId}'`
    );
    const drift = Number.parseInt(driftStr, 10);
    expect(drift).toBeLessThanOrEqual(300);
  });
});
