/**
 * Codex bridge receipt-only 回归。
 *
 * 旧 setupInjectedAccounts/loadRawAuth oracle 已退役；receiver 不得再读取或复制
 * 公司 auth。这里只验证真实 receipt record、私有 CODEX_HOME 与凭据环境清理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  exactSlot,
  receiptEnv,
  resolveReceiptHome,
  validateRunRequest,
} = require('../../scripts/codex-bridge/codex-bridge.cjs');

const slot = Object.freeze({
  agent_id: 'xian-m1',
  lease_id: '11111111-1111-4111-8111-111111111111',
  receipt: 'fixture-receipt-not-a-secret-token',
  session_id: '22222222-2222-4222-8222-222222222222',
});

let root;
let privateHome;
const oldRoot = process.env.CODEX_SLOT_RECEIPT_ROOT;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-slot-receipt-'));
  privateHome = path.join(root, 'private', slot.session_id);
  fs.mkdirSync(privateHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(root, `${slot.session_id}.json`),
    JSON.stringify({ ...slot, private_home: privateHome }),
    { mode: 0o600 },
  );
  process.env.CODEX_SLOT_RECEIPT_ROOT = root;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (oldRoot === undefined) delete process.env.CODEX_SLOT_RECEIPT_ROOT;
  else process.env.CODEX_SLOT_RECEIPT_ROOT = oldRoot;
});

describe('receipt envelope', () => {
  it('只接受 agent/lease/receipt/session exact 四字段', () => {
    expect(exactSlot(slot)).toBe(true);
    expect(exactSlot({ ...slot, account_ref: 'team1' })).toBe(false);
  });

  it('拒绝未知 agent', () => {
    expect(exactSlot({ ...slot, agent_id: 'xian-m9' })).toBe(false);
  });

  it('拒绝非 UUID lease', () => {
    expect(exactSlot({ ...slot, lease_id: 'lease-1' })).toBe(false);
  });

  it('真实 receipt record 解析到 root 内私有 HOME', () => {
    expect(resolveReceiptHome(slot)).toBe(fs.realpathSync(privateHome));
  });

  it('record 字段不匹配时失败关闭', () => {
    expect(() => resolveReceiptHome({ ...slot, receipt: 'different-receipt-value' }))
      .toThrow(/mismatch/);
  });

  it('record private_home 逃逸 root 时失败关闭', () => {
    fs.writeFileSync(
      path.join(root, `${slot.session_id}.json`),
      JSON.stringify({ ...slot, private_home: os.tmpdir() }),
    );
    expect(() => resolveReceiptHome(slot)).toThrow(/escapes/);
  });
});

describe('receiver child environment', () => {
  it('注入 receipt 五字段', () => {
    const env = receiptEnv(slot, privateHome);
    expect(env.CODEX_HOME).toBe(privateHome);
    expect(env.CODEX_SLOT_AGENT_ID).toBe(slot.agent_id);
    expect(env.CODEX_SLOT_LEASE_ID).toBe(slot.lease_id);
    expect(env.CODEX_SLOT_RECEIPT).toBe(slot.receipt);
    expect(env.CODEX_SLOT_SESSION_ID).toBe(slot.session_id);
  });

  it('统一删除公司 home 与 API key 环境', () => {
    const env = receiptEnv(slot, privateHome, {
      CODEX_HOMES: '/company',
      CODEX_RELAY_HOME: '/relay',
      CODEX_REVIEW_HOME: '/review',
      OPENAI_API_KEY: 'openai-secret',
      CODEX_API_KEY: 'codex-secret',
    });
    for (const key of [
      'CODEX_HOMES',
      'CODEX_RELAY_HOME',
      'CODEX_REVIEW_HOME',
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('run body 禁止 raw credential/account 字段', () => {
    const req = { headers: { 'idempotency-key': '33333333-3333-4333-8333-333333333333' } };
    expect(() => validateRunRequest({
      task_id: 'task',
      prompt: 'p',
      slot,
      token: 'raw',
    }, req)).toThrow(/forbidden credential field/);
  });

  it('合法 run body 只由 receipt 授权', () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const req = { headers: { 'idempotency-key': requestId } };
    expect(validateRunRequest({ task_id: 'task', prompt: 'p', slot }, req)).toBe(requestId);
  });
});
