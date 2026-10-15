import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../lib/pr-branch.mjs', () => ({ remoteTaskId: vi.fn(), remoteTaskIdByPr: vi.fn() }));
import { remoteTaskId, remoteTaskIdByPr } from '../lib/pr-branch.mjs';
import { mirrorStates, restoreStates } from '../lib/state-store.mjs';
const ID = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const PR = { number: 77, headRefName: 'cp-10091835-cw-c954ebfd', url: 'https://github.com/x/y/pull/77' };
describe('终态镜像可靠写回', () => {
  let dir, ctx, remote;
  const file = () => path.join(dir, 'qa-77.json');
  const write = (value) => fs.writeFileSync(file(), JSON.stringify(value));
  const local = () => JSON.parse(fs.readFileSync(file(), 'utf8'));
  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sync-'));
    remote = { id: ID, result: { qa_state: { historical_note: { evidence: 'original' }, closed: { at: 'old' }, preview_stopped: true, escalated: { type: 'old' } } } };
    remoteTaskId.mockResolvedValue(ID);
    remoteTaskIdByPr.mockResolvedValue(ID);
    ctx = { cfg: { logDir: dir, repoKey: 'cecelia', repoSlug: 'x/y' }, log: vi.fn(), brain: {
      getTask: vi.fn(async () => ({ ok: true, body: remote })),
      patch: vi.fn(async (_id, body) => { remote.result = { ...remote.result, ...body.result }; return { ok: true }; }),
    } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('分支已删时通过 refs/pull 关联任务，写回 merged', async () => {
    remoteTaskId.mockResolvedValue(null);
    write({ passed: true, merged: { head: 'a'.repeat(40) } });
    await mirrorStates(ctx, [PR]);
    expect(remoteTaskIdByPr).toHaveBeenCalledWith(ctx.cfg, 77, PR.headRefName);
    expect(remote.result.qa_state.merged).toEqual({ head: 'a'.repeat(40) });
  });
  it('保留远端扩展历史，并移除本地已删除的镜像字段', async () => {
    write({ passed: false, rounds: [{ verdict: 'FAIL' }] });
    await mirrorStates(ctx, [PR]);
    expect(remote.result.qa_state).toEqual({ historical_note: { evidence: 'original' }, passed: false, rounds: [{ verdict: 'FAIL' }] });
  });
  it('GET 失败不拿空 prior 覆盖，不记录镜像成功', async () => {
    ctx.brain.getTask.mockResolvedValue({ ok: false, status: 503 });
    write({ merged: { head: 'a'.repeat(40) } });
    await mirrorStates(ctx, [PR]);
    expect(ctx.brain.patch).not.toHaveBeenCalled();
    expect(local().mirrored).toBeUndefined();
  });
  it('错 task_id 或非 CW branch 不可回写', async () => {
    remoteTaskId.mockResolvedValue('ffffffff-469f-4006-a95f-b277fa6564f6');
    remoteTaskIdByPr.mockResolvedValue(null);
    write({ passed: true });
    await mirrorStates(ctx, [PR, { ...PR, headRefName: 'unrelated-branch' }]);
    expect(ctx.brain.patch).not.toHaveBeenCalled();
  });
  it('PATCH 失败后仍 dirty；成功幂等，读写间的新字段保留且下轮补发', async () => {
    write({ passed: true });
    ctx.brain.patch.mockResolvedValueOnce({ ok: false, status: 503 });
    await mirrorStates(ctx, [PR]);
    expect(local().mirrored).toBeUndefined();
    ctx.brain.patch.mockImplementationOnce(async () => { write({ passed: true, preview_stopped: true }); return { ok: true }; });
    await mirrorStates(ctx, [PR]);
    expect(local().preview_stopped).toBe(true);
    expect(JSON.parse(local().mirrored)).not.toHaveProperty('preview_stopped');
    await mirrorStates(ctx, [PR]);
    expect(remote.result.qa_state.preview_stopped).toBe(true);
    const count = ctx.brain.patch.mock.calls.length;
    await mirrorStates(ctx, [PR]);
    expect(ctx.brain.patch).toHaveBeenCalledTimes(count);
  });
  for (const conflict of [{ id: 'wrong-id' }, { payload: { repo: 'other/repo' } }, { result: { pr_url: 'https://github.com/x/other/pull/77' } }, { result: { coding_workflow: { pr_url: 'https://github.com/x/y/pull/78' } } }]) {
    it(`任务读回显式身份矛盾不写: ${JSON.stringify(conflict)}`, async () => {
      remote = { ...remote, ...conflict };
      write({ passed: true });
      await mirrorStates(ctx, [PR]);
      expect(ctx.brain.patch).not.toHaveBeenCalled();
      expect(local().mirrored).toBeUndefined();
    });
  }

  it('恢复状态也拒绝错误body.id，不把别的任务批准落到本地', async () => {
    remote = { id: 'wrong-id', result: { qa_state: { passed: true, approved: { head: 'a'.repeat(40) } } } };
    await restoreStates(ctx, [PR]);
    expect(fs.existsSync(file())).toBe(false);
  });

});
