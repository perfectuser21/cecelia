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

  it('(a) generator sub_task status === "completed"', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    const genStatus = psql(`SELECT status FROM tasks WHERE id='${generatorTaskId}'`);
    expect(genStatus).toBe('completed');
  });

  it('(b) generator sub_task result.pr_url 匹配 GitHub PR URL 正则', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    const prUrl = psql(`SELECT result->>'pr_url' FROM tasks WHERE id='${generatorTaskId}'`);
    expect(prUrl).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
  });

  it('(c) generator.updated_at 与 evaluator.callback_at 漂移 ≤ 300s（证明非人工 PATCH）', () => {
    const initiativeId = getInitiativeId();
    const generatorTaskId = getGeneratorTaskId(initiativeId);
    const evalCallback = psql(
      `SELECT result->>'callback_at' FROM tasks WHERE parent_task_id='${initiativeId}' AND task_type='harness_evaluate' AND status='completed' ORDER BY updated_at DESC LIMIT 1`
    );
    const driftStr = psql(
      `SELECT ABS(EXTRACT(EPOCH FROM (updated_at - '${evalCallback}'::timestamp)))::int FROM tasks WHERE id='${generatorTaskId}'`
    );
    const driftSeconds = Number.parseInt(driftStr, 10);
    expect(driftSeconds).toBeLessThanOrEqual(300);
  });
});
