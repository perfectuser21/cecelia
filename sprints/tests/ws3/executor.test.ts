import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Workstream 3 — executor.js 写入 initiative_run_events [BEHAVIOR]', () => {
  it('executor.js import 含 writeInitiativeRunEvent', () => {
    const content = readFileSync('packages/brain/src/executor.js', 'utf8');
    expect(content).toContain('writeInitiativeRunEvent');
  });

  it('executor.js 函数体内含 writeInitiativeRunEvent( 调用', () => {
    const content = readFileSync('packages/brain/src/executor.js', 'utf8');
    expect(content).toContain('writeInitiativeRunEvent(');
  });

  it('writeInitiativeRunEvent 调用返回 Promise（可 await）', async () => {
    const m = await import('../../../../packages/brain/src/events/initiativeRunEvents.js');
    const result = m.writeInitiativeRunEvent({
      initiativeId: 'cccccccc-dddd-eeee-ffff-aa0000000020',
      node: 'proposer',
      label: 'Proposer',
      attempt: 1,
    });
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.not.toThrow();
  });

  it('writeInitiativeRunEvent 写入后 DB 有对应行（node 字段值正确）', async () => {
    const m = await import('../../../../packages/brain/src/events/initiativeRunEvents.js');
    const initiativeId = 'cccccccc-dddd-eeee-ffff-aa0000000021';
    await m.writeInitiativeRunEvent({
      initiativeId,
      node: 'evaluator',
      label: 'Evaluator',
      attempt: 2,
    });
    const { execSync } = await import('child_process');
    const db = process.env.DATABASE_URL ?? 'postgresql://localhost/cecelia';
    const row = execSync(
      `psql "${db}" -t -c "SELECT node FROM initiative_run_events WHERE initiative_id='${initiativeId}' ORDER BY ts DESC LIMIT 1"`
    )
      .toString()
      .trim();
    expect(row).toBe('evaluator');
  });
});
