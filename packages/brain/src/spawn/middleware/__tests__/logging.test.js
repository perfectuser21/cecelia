import { describe, it, expect } from 'vitest';
import { createSpawnLogger } from '../logging.js';

function makeLog() {
  const calls = [];
  return { calls, log: (...args) => calls.push(args.join(' ')) };
}

describe('createSpawnLogger()', () => {
  it('logStart emits [spawn] start with task/type/skill', () => {
    const logger = makeLog();
    const l = createSpawnLogger(
      { task: { id: 't1', task_type: 'dev' }, skill: '/dev', env: {} },
      { log: logger.log },
    );
    l.logStart();
    expect(logger.calls[0]).toMatch(/\[spawn\] start task=t1 type=dev skill=\/dev account=auto/);
  });

  it('logEnd emits [spawn] end with exit/duration/cost', () => {
    const logger = makeLog();
    const l = createSpawnLogger(
      { task: { id: 't2' }, skill: '/x', env: { CECELIA_CREDENTIALS: 'account1' } },
      { log: logger.log },
    );
    l.logEnd({ exit_code: 0, cost_usd: 0.05 });
    expect(logger.calls[0]).toMatch(/\[spawn\] end task=t2 exit=0 duration=\d+ms account=account1.*cost=\$0\.0500/);
  });

  it('logEnd handles missing cost_usd as n/a', () => {
    const logger = makeLog();
    const l = createSpawnLogger({ task: { id: 't3' }, skill: '/x', env: {} }, { log: logger.log });
    l.logEnd({ exit_code: 1 });
    expect(logger.calls[0]).toMatch(/cost=n\/a/);
  });

  it('logEnd falls back to result.account_used when env missing', () => {
    const logger = makeLog();
    const l = createSpawnLogger({ task: { id: 't4' }, skill: '/x', env: {} }, { log: logger.log });
    l.logEnd({ exit_code: 0, account_used: 'account2' });
    expect(logger.calls[0]).toContain('account=account2');
  });
});
