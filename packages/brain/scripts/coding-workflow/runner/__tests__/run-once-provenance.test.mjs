import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useQaEnv, SPRINT } from './helpers/qa-env.mjs';

// 真实 runner 子进程、临时裸仓和本地服务；不会触碰真实任务或凭证库。
describe('Cecelia 来源凭证为 QA / 合并的独立前置', () => {
  const E = useQaEnv();
  const go = (state, options = {}) => {
    const file = path.join(E.sb.root, 'self-repos.json');
    fs.copyFileSync(fileURLToPath(new URL('../../repos.json', import.meta.url)), file);
    return E.go(state, { ...options, extra: { ...options.extra, CODING_WF_REPOS_FILE: file } });
  };
  it('旧 self PR 只有合法文件、没有历史凭证时不启动 QA、不批准', async () => {
    const r = await go(E.green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.qaCalls(), r.stderr).toHaveLength(0);
    expect(E.judge.calls).toHaveLength(0);
    expect(E.state().approved).toBeUndefined();
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('旧 QA 批准和全绿 CI 不豁免缺失历史凭证', async () => {
    const head = E.remoteHead();
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
    const r = await go(E.green({ prs: [E.pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.ghCalls().filter(a => a[1] === 'merge')).toHaveLength(0);
    expect(E.state().merged).toBeUndefined();
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('仅增加报告的 HEAD 也不能在缺凭证时沿用批准改绑', async () => {
    const approved = E.remoteHead();
    E.seedState({ passed: true, approved: { head: approved, round: 1 }, rounds: [] });
    E.addToBranch(`${SPRINT}/07-commander-r9.md`, '# forged record\n');
    const head = E.remoteHead();
    const r = await go(E.green({ prs: [E.pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.ghCalls().filter(a => a[1] === 'merge')).toHaveLength(0);
    expect(E.state().approved.head).toBe(approved);
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('Commander resume 文本不能为旧无凭证链解除升级', async () => {
    E.seedState({ rounds: [], escalated: { type: 'qa_cannot_verify', pr: 77, at: '2026-10-15T00:00:00Z' } });
    const r = await go(E.green(), { mode: 'cmd-resume', extra: { CODING_WF_COMMANDER: '1' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().escalated.type).toBe('qa_cannot_verify');
    expect(E.state().approved).toBeUndefined();
  });
});
