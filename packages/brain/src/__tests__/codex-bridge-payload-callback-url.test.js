/**
 * Codex bridge payload 新 oracle：callback 保留，但执行授权只来自 broker receipt。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCodexBridgePayload } from '../executor.js';

const slot = Object.freeze({
  agent_id: 'xian-m1',
  lease_id: '11111111-1111-4111-8111-111111111111',
  receipt: 'fixture-receipt-without-secret',
  session_id: '22222222-2222-4222-8222-222222222222',
});

const task = Object.freeze({
  id: 'research-task-id-0001',
  task_type: 'research',
  payload: { repo_path: '/workspace' },
});

const originalBrainUrl = process.env.BRAIN_URL;

afterEach(() => {
  if (originalBrainUrl === undefined) delete process.env.BRAIN_URL;
  else process.env.BRAIN_URL = originalBrainUrl;
});

describe('buildCodexBridgePayload broker/receipt-only', () => {
  it('research payload 保留 callback_url 并逐字段透传 receipt', () => {
    const payload = buildCodexBridgePayload(task, 'prompt', 'branch', slot, false, false);
    expect(payload.callback_url).toMatch(/\/api\/brain\/execution-callback$/);
    expect(payload.slot).toEqual(slot);
  });

  it('BRAIN_URL 配置决定 callback_url', () => {
    process.env.BRAIN_URL = 'http://hk-vps:5221';
    const payload = buildCodexBridgePayload(task, 'prompt', 'branch', slot, false, false);
    expect(payload.callback_url).toBe('http://hk-vps:5221/api/brain/execution-callback');
  });

  it('BRAIN_URL 缺失时 callback_url 降级 localhost', () => {
    delete process.env.BRAIN_URL;
    const payload = buildCodexBridgePayload(task, 'prompt', 'branch', slot, false, false);
    expect(payload.callback_url).toBe('http://localhost:5221/api/brain/execution-callback');
  });

  it('codex_dev runner 仍使用同一 broker receipt', () => {
    const payload = buildCodexBridgePayload(
      { ...task, task_type: 'codex_dev' },
      'prompt',
      'cp-test',
      slot,
      true,
      false,
    );
    expect(payload.runner).toBe('packages/engine/runners/codex/runner.sh');
    expect(payload.slot).toEqual(slot);
  });

  it('payload 不含 raw token、account 或 home authority', () => {
    const payload = buildCodexBridgePayload(task, 'prompt', 'branch', slot, false, false);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/access_token|refresh_token|auth_json|CODEX_HOMES/);
    expect(payload).not.toHaveProperty('account');
    expect(payload).not.toHaveProperty('account_ref');
    expect(payload).not.toHaveProperty('codex_home');
  });
});
