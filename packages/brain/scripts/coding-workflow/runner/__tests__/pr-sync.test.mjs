import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../lib/cifix-scan.mjs', () => ({ ghJson: vi.fn(), CW_BRANCH_RE: /^cp-\d{8,10}-cw-[0-9a-f]{8}$/ }));
vi.mock('../lib/pr-branch.mjs', () => ({ remoteTaskId: vi.fn(), remoteTaskIdByPr: vi.fn() }));
import { ghJson } from '../lib/cifix-scan.mjs';
import { remoteTaskId, remoteTaskIdByPr } from '../lib/pr-branch.mjs';
import { rememberPr, syncEntry, prepareStateSync, syncTaskId, updateSync } from '../lib/pr-sync.mjs';
import { recordMergeLearning } from '../lib/merge-learning.mjs';
const ID = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const PR = { number: 77, headRefName: 'cp-10091835-cw-c954ebfd', state: 'CLOSED', url: 'https://github.com/x/y/pull/77' };
describe('持久待办的身份、窗口与真实状态', () => {
  let dir, ctx;
  beforeEach(() => {
    vi.resetAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-pending-'));
    ctx = { cfg: { logDir: dir, repoKey: 'cecelia', repoSlug: 'x/y' }, log: vi.fn() };
    remoteTaskId.mockResolvedValue(ID);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('重开以实际 GitHub OPEN 为准；unknown 不返回陈旧 CLOSED', async () => {
    rememberPr(ctx, PR);
    ghJson.mockResolvedValue(null);
    await prepareStateSync(ctx, []);
    expect(ctx.syncPrs.size).toBe(0);
    expect(syncEntry(ctx.cfg, PR)).toBeTruthy();
    ghJson.mockResolvedValue({ ...PR, state: 'OPEN' });
    await prepareStateSync(ctx, []);
    expect(ctx.syncPrs.get(77).state).toBe('OPEN');
  });
  it('窗口外待办最多核30项并轮转，不截掉第31项', async () => {
    for (let i = 1; i <= 31; i++) rememberPr(ctx, { ...PR, number: i });
    ghJson.mockImplementation(async (_cfg, argv) => ({ ...PR, number: Number(argv[2]) }));
    await prepareStateSync(ctx, []);
    expect(ghJson).toHaveBeenCalledTimes(30);
    expect(ghJson.mock.calls.some(([, args]) => args[2] === '31')).toBe(false);
    ghJson.mockClear();
    await prepareStateSync(ctx, []);
    expect(ghJson).toHaveBeenCalledTimes(30);
    expect(ghJson.mock.calls[0][1][2]).toBe('31');
  });
  it('实际身份不符时不采用；非CW分支不登记', async () => {
    rememberPr(ctx, PR);
    rememberPr(ctx, { ...PR, number: 88, headRefName: 'main' });
    ghJson.mockResolvedValue({ ...PR, headRefName: 'cp-10091835-cw-ffffffff' });
    await prepareStateSync(ctx, []);
    expect(ctx.syncPrs.size).toBe(0);
    expect(syncEntry(ctx.cfg, { ...PR, number: 88 })).toBeNull();
  });
  it('同PR号按repo namespace隔离；错仓账fail-closed', async () => {
    rememberPr(ctx, PR, { receipt_pending: true });
    const zj = { ...ctx, cfg: { ...ctx.cfg, repoSlug: 'x/zj', stateNs: 'zj' } };
    expect(syncEntry(zj.cfg, PR)).toBeNull();
    rememberPr(zj, { ...PR, state: 'OPEN' });
    expect(syncEntry(ctx.cfg, PR).receipt_pending).toBe(true);
    expect(syncEntry(zj.cfg, PR).receipt_pending).toBeUndefined();
    expect(() => syncEntry({ ...ctx.cfg, repoSlug: 'x/wrong' }, PR)).toThrow('pr_sync_scope_invalid');
  });
  it('缓存task必须来自已核branch/ref；删branch后可沿用，外来task不采用', async () => {
    rememberPr(ctx, PR, { task_id: 'ffffffff-469f-4006-a95f-b277fa6564f6', task_source: 'branch' });
    expect(await syncTaskId(ctx, PR)).toBe(ID);
    remoteTaskId.mockResolvedValue(null);
    remoteTaskIdByPr.mockResolvedValue(null);
    expect(await syncTaskId(ctx, PR)).toBe(ID);
    expect(remoteTaskId).toHaveBeenCalledTimes(1);
  });
});

describe('Learning 不具幂等API，重试仅核读回', () => {
  let dir, ctx;
  const body = { task_id: ID, next_steps_suggested: ['AI QA 第 1 轮 FAIL', 'AI QA 第 2 轮 PASS'] };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-learning-'));
    ctx = { cfg: { logDir: dir }, log: vi.fn(), brain: {
      postLearnings: vi.fn(async () => ({ ok: true, body: { success: true, learnings_inserted: 2, learning_ids: ['one', 'two'] } })),
      listLearnings: vi.fn(async () => ({ ok: true, body: { learnings: [{ id: 'one', content: body.next_steps_suggested[0] }, { id: 'two', content: body.next_steps_suggested[1] }] } })),
    } };
    rememberPr(ctx, PR, { learning_pending: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('数量、唯一ID与真实原文都确认后才清pending；重复tick不POST', async () => {
    await recordMergeLearning(ctx, PR, body);
    expect(syncEntry(ctx.cfg, PR)).toMatchObject({ learning_pending: false, learning_status: 'confirmed' });
    await recordMergeLearning(ctx, PR, body);
    expect(ctx.brain.postLearnings).toHaveBeenCalledTimes(1);
  });
  for (const reply of [{ ok: false, status: 0 }, { ok: true, body: { success: true, learnings_inserted: 1, learning_ids: ['one'] } }, { ok: true, body: { success: true, learnings_inserted: 2, learning_ids: ['one', 'one'] } }]) {
    it(`HTTP结果未知或partial不重POST: ${JSON.stringify(reply)}`, async () => {
      ctx.brain.postLearnings.mockResolvedValue(reply);
      await recordMergeLearning(ctx, PR, body);
      await recordMergeLearning(ctx, PR, body);
      expect(ctx.brain.postLearnings).toHaveBeenCalledTimes(1);
      expect(syncEntry(ctx.cfg, PR).learning_pending).toBe(true);
    });
  }
  it('读回失败或内容不符保留pending；下轮只读确认', async () => {
    ctx.brain.listLearnings.mockResolvedValueOnce({ ok: false, status: 503 });
    await recordMergeLearning(ctx, PR, body);
    expect(syncEntry(ctx.cfg, PR).learning_status).toBe('readback_pending');
    ctx.brain.listLearnings.mockResolvedValueOnce({ ok: true, body: { learnings: [{ id: 'one', content: '错误原文' }] } });
    await recordMergeLearning(ctx, PR, body);
    expect(syncEntry(ctx.cfg, PR).learning_pending).toBe(true);
    await recordMergeLearning(ctx, PR, body);
    expect(syncEntry(ctx.cfg, PR).learning_status).toBe('confirmed');
    expect(ctx.brain.postLearnings).toHaveBeenCalledTimes(1);
  });
  it('发送后崩溃留下unknown，恢复不重POST', async () => {
    updateSync(ctx, PR, { learning_attempted: true, learning_status: 'unknown' });
    await recordMergeLearning(ctx, PR, body);
    expect(ctx.brain.postLearnings).not.toHaveBeenCalled();
    expect(syncEntry(ctx.cfg, PR).learning_pending).toBe(true);
  });
});
