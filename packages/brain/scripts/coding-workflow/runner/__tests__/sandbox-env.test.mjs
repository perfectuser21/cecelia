// 测试环境隔离：外部 CODING_WF_* 不得泄漏进被测子进程（childEnv 本身保留它们，由测试侧剥离）。
import { describe, it, expect } from 'vitest';
import { cleanTestEnv, runnerEnv } from './helpers/sandbox.mjs';

describe('cleanTestEnv', () => {
  it('剥离全部 CODING_WF_* 与 GIT_DIR，保留其余变量，且不修改入参', () => {
    const base = { HOME: '/h', CODING_WF_REPO: '/x', CODING_WF_AUTOMERGE: '0', CODING_WF_MAIN_LOG: '/l', GIT_DIR: '/g', KEEP: '1' };
    const snapshot = { ...base };
    const env = cleanTestEnv(base);
    expect(Object.keys(env).filter((k) => k.startsWith('CODING_WF_'))).toEqual([]);
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env.HOME).toBe('/h');
    expect(env.KEEP).toBe('1');
    expect(base).toEqual(snapshot);
  });
});

describe('runnerEnv', () => {
  it('外部 CODING_WF_AUTOMERGE 不泄漏；显式 extra 仍生效', () => {
    const sb = { clone: '/c', worktreeBase: '/w', logDir: '/l', lockDir: '/k', execLog: '/e', ghLog: '/g' };
    const saved = process.env.CODING_WF_AUTOMERGE;
    process.env.CODING_WF_AUTOMERGE = '0';
    try {
      expect(runnerEnv(sb, 'http://x').CODING_WF_AUTOMERGE).toBeUndefined();
      expect(runnerEnv(sb, 'http://x', { CODING_WF_AUTOMERGE: '1' }).CODING_WF_AUTOMERGE).toBe('1');
    } finally {
      if (saved === undefined) delete process.env.CODING_WF_AUTOMERGE;
      else process.env.CODING_WF_AUTOMERGE = saved;
    }
  });
});
