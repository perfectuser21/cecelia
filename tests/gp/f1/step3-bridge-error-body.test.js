// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：remote bridge 派发失败必须留可诊断原因
//
// 第 61 批（generator 单模块预演案卷）：fleet 对 4xx 把结构化错误码放在响应体 {error}，
// 透传层此前丢弃 → 调用方只见 remote_bridge_prepare_http_400 只能靠猜（memory
// failure-without-reason-pattern 立案的系统病）。本断言锁死：
// a) 4xx 且响应体带合法短码 → 错误信息拼 :code；
// b) 错误码不合法（含空格/敏感串）→ 不拼接不泄露。
// 真 import 被改模块，不 mock 它。
import { describe, expect, it, vi } from 'vitest';
import { createRemoteBridgeTransport } from '../../../packages/brain/src/orchestrator/remote-bridge-transport.js';

const SECRET = 'bridge-secret-that-is-at-least-32-bytes';
const CALLBACK_TOKEN = 'callback-token-that-must-never-leak';
const MACHINE = 'xian-mac-m4';

function makeTransport(status, body) {
  return createRemoteBridgeTransport({
    enabled: true,
    bridgeUrls: { [MACHINE]: 'http://100.86.57.69:3458' },
    sharedSecret: SECRET,
    brainUrl: 'http://brain.internal:5221',
    fetchFn: vi.fn(async () => ({ ok: false, status, json: async () => body })),
    credentialBroker: { issue: vi.fn(async () => ({ payload: 'x' })) },
    githubCredentialBroker: { issue: vi.fn(async () => ({ payload: 'y' })) },
    now: () => Date.parse('2026-09-01T00:00:00.000Z'),
  });
}

function prepareInput() {
  return {
    attempt: { id: 'attempt-1', run_id: 'run-1', lease_owner: 'd-1', lease_generation: 1, callbackSecret: CALLBACK_TOKEN },
    bundle: {
      role: 'generator',
      inputs: {
        execution_surface: 'fleet-worker',
        workspace_spec: {
          repo: 'perfectuser21/cecelia', base_sha: '0'.repeat(40), branch: 'cp-x',
          expected_head_sha: null, mode: 'read-write', run_id: 'run-1', attempt_id: 'attempt-1',
        },
      },
      constraints: { timeout_seconds: 3600 },
    },
    spec: { provider: 'codex', command: 'codex', args: [], stdin: 's', output: { format: 'jsonl' } },
    target: { provider: 'codex', account: 'team3', machine: MACHINE },
  };
}

describe('第61批：桥接派发失败留可诊断原因', () => {
  it('4xx 响应体带合法错误码 → remote_bridge_prepare_http_400:<code>', async () => {
    const transport = makeTransport(400, { error: 'frozen_contract_identity_invalid' });
    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_prepare_http_400:frozen_contract_identity_invalid',
    );
  });

  it('错误码不合法（含敏感串）→ 不拼接不泄露', async () => {
    const transport = makeTransport(400, { error: `bad ${CALLBACK_TOKEN} value` });
    const prepare = transport.prepare(prepareInput());
    await expect(prepare).rejects.toThrow('remote_bridge_prepare_http_400');
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });
});
