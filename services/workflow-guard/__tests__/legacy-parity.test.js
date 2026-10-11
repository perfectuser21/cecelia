import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 等价护栏：本用例逐条复刻 hk-vps 上原 workflow-write-guard.mjs 自带测试
// （/opt/openclaw/.../scripts/workflow-write-guard.test.mjs）的断言与调用方式。
// 原脚本已在生产跑了数周，它的行为就是既有契约——新实现必须逐条对齐，
// 否则切换后会静默签发不同的 fence_token，产物校验全线失效且不报错。
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.mjs');

describe('与原 workflow-write-guard.mjs 行为等价', () => {
  const runId = 'test-run';
  const attemptId = 'a1';
  const executionId = `${runId}:${attemptId}`;
  const leaseId = `${executionId}:lease`;
  const baseState = {
    schema_version: 2, run_id: runId, attempt_id: attemptId, execution_id: executionId,
    worker_agent_id: 'tenant-worker', lease_id: leaseId, pending_relay: null, terminal: null,
    events: [{ marker: 'WORKFLOW_EVENT', payload: {
      event: 'stage_started', event_id: `${executionId}:2`, stage_id: 'collection', stage_attempt: 2 } }],
  };

  function withState(state, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    try {
      fs.writeFileSync(path.join(dir, `${runId}__${attemptId}.json`), `${JSON.stringify(state)}\n`);
      const invoke = (overrides = {}) => {
        const values = {
          'run-id': runId, 'attempt-id': attemptId, 'execution-id': executionId,
          'lease-id': leaseId, 'worker-agent-id': 'tenant-worker',
          'stage-id': 'collection', 'stage-attempt': '2',
          intent: 'raw_comment_insert', 'state-dir': dir, ...overrides,
        };
        const argv = ['authorize'];
        for (const [k, v] of Object.entries(values)) argv.push(`--${k}`, v);
        return spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8' });
      };
      return fn(invoke);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('授权成功：exit 0 + authorized + 正确的 commander_event_id + 64位 token', () => {
    withState(baseState, (invoke) => {
      const r = invoke();
      expect(r.status, r.stderr).toBe(0);
      const receipt = JSON.parse(r.stdout);
      expect(receipt.authorized).toBe(true);
      expect(receipt.commander_event_id).toBe(`${executionId}:2`);
      expect(receipt.fence_token).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it('陈旧尝试：exit 2 + Stale or out-of-order worker attempt', () => {
    withState(baseState, (invoke) => {
      const r = invoke({ 'stage-attempt': '1' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/Stale or out-of-order worker attempt/);
    });
  });

  it('intent 与阶段不符：exit 2 + not allowed for this stage', () => {
    withState(baseState, (invoke) => {
      const r = invoke({ intent: 'final_lead_write' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/not allowed for this stage/);
    });
  });

  it('scoring 阶段：raw_comment_update 放行，final_lead_write 拒绝', () => {
    const scoring = { ...baseState, events: [{ marker: 'WORKFLOW_EVENT', payload: {
      event: 'stage_started', event_id: `${executionId}:3`, stage_id: 'scoring', stage_attempt: 1 } }] };
    withState(scoring, (invoke) => {
      const ok = invoke({ 'stage-id': 'scoring', 'stage-attempt': '1', intent: 'raw_comment_update' });
      expect(ok.status, ok.stderr).toBe(0);
      expect(JSON.parse(ok.stdout).authorized).toBe(true);
      const bad = invoke({ 'stage-id': 'scoring', 'stage-attempt': '1', intent: 'final_lead_write' });
      expect(bad.status).toBe(2);
      expect(bad.stderr).toMatch(/not allowed for this stage/);
    });
  });

  it('终态执行：exit 2 + terminal and immutable', () => {
    withState({ ...baseState, terminal: { status: 'completed' } }, (invoke) => {
      const r = invoke();
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/terminal and immutable/);
    });
  });
});
