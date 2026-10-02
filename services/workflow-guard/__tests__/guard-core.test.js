import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizeWrite, WRITE_INTENTS } from '../src/guard-core.js';

// 背景：worker 跑在 XIAN-M4-PHONE（Mac），Commander 账本在 hk-vps 容器里。
// 原实现是 worker 本地执行 workflow-write-guard.mjs，而该脚本必须读 Commander 账本文件
// → 跨机器根本读不到 → 2026-09-07 final6 四次重试全挂在
// "guard path was unavailable in the worker environment"，视频其实已经找到了。
// 核心逻辑抽到这里，CLI 与 HTTP 服务共用同一份，避免两套校验漂移。
describe('authorizeWrite — 与原 CLI 行为逐条对齐', () => {
  let dir;
  const runId = 'test-run';
  const attemptId = 'a1';
  const executionId = `${runId}:${attemptId}`;
  const leaseId = `${executionId}:lease`;
  const base = {
    schema_version: 2,
    run_id: runId, attempt_id: attemptId, execution_id: executionId,
    worker_agent_id: 'tenant-worker', lease_id: leaseId,
    pending_relay: null, terminal: null,
    events: [{ marker: 'WORKFLOW_EVENT', payload: {
      event: 'stage_started', event_id: `${executionId}:2`, stage_id: 'collection', stage_attempt: 2 } }],
  };
  const params = (o = {}) => ({
    run_id: runId, attempt_id: attemptId, execution_id: executionId, lease_id: leaseId,
    worker_agent_id: 'tenant-worker', stage_id: 'collection', stage_attempt: 2,
    intent: 'raw_comment_insert', state_dir: dir, ...o,
  });
  const write = (v) => fs.writeFileSync(path.join(dir, `${runId}__${attemptId}.json`), JSON.stringify(v));

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('正常授权：返回 fence_token 与 commander_event_id', () => {
    write(base);
    const r = authorizeWrite(params());
    expect(r.ok).toBe(true);
    expect(r.authorized).toBe(true);
    expect(r.commander_event_id).toBe(`${executionId}:2`);
    expect(r.fence_token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('陈旧/乱序尝试被拒（防慢的旧重试覆盖新结果）', () => {
    write(base);
    const r = authorizeWrite(params({ stage_attempt: 1 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Stale or out-of-order/);
  });

  it('intent 与阶段不匹配被拒', () => {
    write(base);
    expect(authorizeWrite(params({ intent: 'final_lead_write' })).error).toMatch(/not allowed for this stage/);
  });

  it('scoring 阶段允许 raw_comment_update 但不允许 final_lead_write', () => {
    write({ ...base, events: [{ marker: 'WORKFLOW_EVENT', payload: {
      event: 'stage_started', event_id: `${executionId}:3`, stage_id: 'scoring', stage_attempt: 1 } }] });
    expect(authorizeWrite(params({ stage_id: 'scoring', stage_attempt: 1, intent: 'raw_comment_update' })).authorized).toBe(true);
    expect(authorizeWrite(params({ stage_id: 'scoring', stage_attempt: 1, intent: 'final_lead_write' })).error).toMatch(/not allowed/);
  });

  it('终态执行不可再写', () => {
    write({ ...base, terminal: { status: 'completed' } });
    expect(authorizeWrite(params()).error).toMatch(/terminal and immutable/);
  });

  it('lease 不匹配被拒——lease_id 就是这次 run 的通行证', () => {
    write(base);
    expect(authorizeWrite(params({ lease_id: 'someone-elses-lease' })).error).toMatch(/lease mismatch/);
  });

  it('worker 身份不匹配被拒', () => {
    write(base);
    expect(authorizeWrite(params({ worker_agent_id: 'other-worker' })).error).toMatch(/Worker agent mismatch/);
  });

  it('pending_relay 期间写入被栅栏挡住', () => {
    write({ ...base, pending_relay: { event_id: 'x' } });
    expect(authorizeWrite(params()).error).toMatch(/relay is pending/);
  });

  it('账本不存在 → 明确报错不抛异常（跨机器时这是最常见的失败）', () => {
    const r = authorizeWrite(params({ run_id: 'no-such-run' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Cannot read Commander ledger/);
  });

  it('非法 id 格式被拒（防路径穿越）', () => {
    write(base);
    expect(authorizeWrite(params({ run_id: '../../etc/passwd' })).error).toMatch(/Invalid run_id/);
  });

  it('未知 intent 被拒', () => {
    write(base);
    expect(authorizeWrite(params({ intent: 'rm_rf' })).error).toMatch(/Unknown write intent/);
  });

  it('WRITE_INTENTS 表保持原样（改这张表等于改权限模型）', () => {
    expect(WRITE_INTENTS.raw_comment_insert).toEqual(new Set(['collection']));
    expect(WRITE_INTENTS.keyword_cursor_write).toEqual(new Set(['delivery']));
    expect(WRITE_INTENTS.artifact_write.has('discovery')).toBe(true);
  });

  it('同样输入必须算出同样 token——新旧实现必须可互换', () => {
    write(base);
    const a = authorizeWrite(params());
    const b = authorizeWrite(params());
    expect(a.fence_token).toBe(b.fence_token);
    // token 由 execution|lease|worker|stage|attempt|intent|event_id 派生，改任一项即变
    const c = authorizeWrite(params({ intent: 'artifact_write' }));
    expect(c.fence_token).not.toBe(a.fence_token);
  });
});
