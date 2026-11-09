/** 旧三provider relay均已退役；有头与无头调用都不得触及执行现场。 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';

const cases = ['codex', 'grok', 'claude', 'unknown', undefined]
  .flatMap(executor => ['headed', 'headless'].map(mode => ({ executor, mode })));

describe('旧provider relay新启动拒绝', () => {
  it.each(cases)('payload %j 不触及凭据、launcher、数据库或worktree', async payload => {
    const effect = vi.fn();
    const result = await spawnSkillRelaySession({ id: 'old', payload: { orchestrator: 'skill-relay', ...payload } }, {
      env: { GROK_RELAY_HOME: '', CODEX_RELAY_HOME: '/unused' },
      execFn: effect, sshSpawnFn: effect, spawnFn: effect, loadSkill: effect,
      ensureWt: effect, pool: { query: effect },
    });
    expect(result).toMatchObject({ ok: false, error: 'kernel_runtime_retired' });
    expect(effect).not.toHaveBeenCalled();
  });
});
