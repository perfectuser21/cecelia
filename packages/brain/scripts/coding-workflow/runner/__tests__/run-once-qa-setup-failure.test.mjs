import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { useQaEnv } from './helpers/qa-env.mjs';

describe('QA 工作树准备失败的连续阈值', () => {
  const E = useQaEnv();
  it('真实准备子进程三次失败后升级，后续 tick 不再准备或调用模型且保留 bad', async () => {
    E.addToBranch('.skills-source.json', '{}\n');
    E.addToBranch('scripts/ensure-skills-source.sh', '#!/bin/bash\nprintf "attempt\\n" >> "$FAIL_SETUP_LOG"\nexit 23\n');
    const attempts = path.join(E.sb.root, 'setup-attempts.log');
    const extra = { FAIL_SETUP_LOG: attempts, CODING_WF_QA_MAX_BAD_STREAK: '3' };
    const gh = () => E.green({ prs: [E.pr({ headRefOid: E.remoteHead() })] });
    for (let n = 1; n <= 3; n++) {
      const r = await E.go(gh(), { extra });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stderr).toContain('skill_source_restore_failed');
      expect(E.state().bad).toBe(n);
      expect(E.state().rounds).toEqual([]);
      expect(E.qaCalls()).toEqual([]);
      expect(E.judge.calls).toEqual([]);
      if (n < 3) expect(E.state().escalated).toBeUndefined();
      else {
        expect(E.state().escalated).toMatchObject({ type: 'qa_evaluator_broken', reason_code: 'skill_source_restore_failed', pr: 77 });
        expect(E.brainResults().at(-1).escalations).toEqual([expect.objectContaining({ type: 'qa_evaluator_broken', reason_code: 'skill_source_restore_failed' })]);
      }
      await E.closeBrain();
    }
    const before = E.state();
    const r = await E.go(gh(), { extra });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state()).toEqual(before);
    expect(fs.readFileSync(attempts, 'utf8')).toBe('attempt\nattempt\nattempt\n');
    expect(E.qaCalls()).toEqual([]);
    expect(E.judge.calls).toEqual([]);
  });
});
