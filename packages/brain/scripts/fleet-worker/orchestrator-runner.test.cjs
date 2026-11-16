'use strict';
/* global vi, describe, it, expect */
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function build(overrides = {}) {
  const { createOrchestratorRunner } = require('./orchestrator-runner.cjs');
  const prepared = [], spawned = [];
  const runner = createOrchestratorRunner({
    hostname: 'test-host',
    workspaceManager: { prepare: vi.fn(async spec => { prepared.push(spec); }) },
    spawnFn: vi.fn((...args) => { spawned.push(args); }),
    ...overrides,
  });
  return { runner, prepared, spawned };
}

describe('orchestrator-runner', () => {

  it('inspect/terminal：非法 run_id → 400 orchestrator_run_id_invalid', async () => {
    const { runner } = build();
    await expect(runner.inspect('not-a-uuid')).rejects.toThrow('orchestrator_run_id_invalid');
    await expect(runner.terminal('not-a-uuid', {})).rejects.toThrow('orchestrator_run_id_invalid');
  });

  it('默认 probeCredentialHome：根下无任何 .codex-team{1..5}/auth.json 可读 → 抛错；有则返回根属主 uid', () => {
    const { probeCredentialHome } = require('./orchestrator-runner.cjs');
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-root-'));
    try {
      expect(() => probeCredentialHome(root)).toThrow('credential_home_no_accounts');
      fs.mkdirSync(path.join(root, '.codex-team2'));
      fs.writeFileSync(path.join(root, '.codex-team2', 'auth.json'), '{}');
      expect(probeCredentialHome(root)).toEqual({ root, uid: process.getuid() });
      expect(() => probeCredentialHome('')).toThrow('orbstack_home_invalid');
      expect(() => probeCredentialHome(path.join(root, 'missing'))).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

it.each(['prepare','start'])('retired %s never allocates workspace/process/logs',async(action)=>{
 const effect=vi.fn();const {runner,prepared,spawned}=build({openFn:effect,mkdirFn:effect,probeCredentialHome:effect});
 await expect(action==='prepare'?runner.prepare({run_id:RUN_ID,task_id:RUN_ID}):runner.start(RUN_ID,{})).rejects.toMatchObject({statusCode:410,message:'kernel_runtime_retired'});
 expect(prepared).toEqual([]);expect(spawned).toEqual([]);expect(effect).not.toHaveBeenCalled();
});
