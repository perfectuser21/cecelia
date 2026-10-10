// QA 门 / CI 修复状态的外部真相（审计 #34）：关键字段写进 Brain result.qa_state / ci_fix_state；
// 本机状态文件丢了（换机、被删）从 Brain 恢复，已升级的 PR 不会被当新的重新处理。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { useQaEnv, TASK } from './helpers/qa-env.mjs';

describe('QA / CI 修复状态写进 Brain', () => {
  const E = useQaEnv();
  const { green, go, state, statePath, qaCalls } = E;
  const brainTask = (extra = {}) => ({ id: TASK, status: 'completed', ...extra });
  const qaStates = () => E.brainStateResults().map((x) => x?.qa_state).filter(Boolean);

  it('QA 升级 → Brain result.qa_state 带 escalated；状态没变的下一轮不重复写', async () => {
    let r = await go(green(), { mode: 'fatal', tasks: [brainTask()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaStates().at(-1)).toMatchObject({ escalated: { type: 'qa_evaluator_broken', reason_code: 'evaluate_touched_production' } });
    expect(state().mirrored).toBeTruthy();
    await E.closeBrain();
    r = await go(green(), { mode: 'fatal', tasks: [brainTask()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaStates()).toEqual([]);
  });

  it('本机 qa-<pr>.json 丢了：从 Brain 恢复 escalated，不重跑 QA', async () => {
    const saved = { rounds: [], bad: 1, escalated: { type: 'qa_evaluator_broken', reason_code: 'evaluate_touched_production', pr: 77 } };
    fs.rmSync(statePath(), { force: true });
    const r = await go(green(), { mode: 'pass', tasks: [brainTask({ result: { qa_state: saved } })] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    expect(state().escalated).toMatchObject({ type: 'qa_evaluator_broken' });
    expect(r.stderr).toContain('已从 Brain 任务');
  });

  it('CI 修复状态同样写进 Brain result.ci_fix_state（次数、升级）', async () => {
    fs.mkdirSync(E.sb.logDir, { recursive: true });
    fs.writeFileSync(`${E.sb.logDir}/cifix-77.json`, JSON.stringify({ attempts: [{ head: 'a'.repeat(40), result: 'pushed' }], escalated: { type: 'ci_fix_exhausted' } }));
    const r = await go(green(), { mode: 'pass', tasks: [brainTask()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.brainStateResults().map((x) => x?.ci_fix_state).filter(Boolean).at(-1)).toMatchObject({
      attempts: [{ result: 'pushed' }], escalated: { type: 'ci_fix_exhausted' },
    });
  });

  it('Brain 里也没有（新 PR）→ 照常 QA', async () => {
    fs.rmSync(statePath(), { force: true });
    const r = await go(green(), { mode: 'pass', tasks: [brainTask()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toHaveLength(1);
  });
});
