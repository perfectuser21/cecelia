import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { useQaEnv, SPRINT, TASK } from './helpers/qa-env.mjs';

// 真实 runner 子进程、临时裸仓和本地服务；不会触碰真实任务或凭证库。
describe('Cecelia 来源凭证为 QA / 合并的独立前置', () => {
  const E = useQaEnv();
  const go = (state, options = {}) => {
    const file = path.join(E.sb.root, 'self-repos.json');
    fs.copyFileSync(fileURLToPath(new URL('../../repos.json', import.meta.url)), file);
    // 仅测试包装器注入显式临时凭证根；生产无环境变量/任务payload逃生口。
    // 只替身远端身份查询；fetch/push/read/commit均走真实临时裸仓。
    const bin = path.join(E.sb.root, 'git-identity-bin');fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\ncase "$*" in *" remote get-url origin") echo https://github.com/perfectuser21/cecelia.git; exit 0;; esac\nexec /usr/bin/git "$@"\n', { mode: 0o755 });
    const processRunner = env => new Promise((resolve, reject) => {
      const core = new URL('../../lib/record-provenance.mjs', import.meta.url).href;
      const entry = new URL('../run-once.mjs', import.meta.url).href;
      const context = { root: path.join(E.sb.root, 'protected'), worktree: E.sb.seed, taskId: TASK, sprintDir: SPRINT, stage: 'judge', round: 1 };
      const code = `const {withRecordProvenance,controllerIdentity}=await import(${JSON.stringify(core)});const {main}=await import(${JSON.stringify(entry)});const c=JSON.parse(process.argv[1]);c.controller=controllerIdentity(${JSON.stringify(entry)});process.exitCode=await withRecordProvenance(c,()=>main());`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(context)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';child.stdout.on('data', b => { stdout += b; });child.stderr.on('data', b => { stderr += b; });
      child.on('error', reject);child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
    });
    return E.go(state, { ...options, processRunner, extra: { ...options.extra, PATH: `${bin}:${process.env.PATH}`, CODING_WF_REPOS_FILE: file } });
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
