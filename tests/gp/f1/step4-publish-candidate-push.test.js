// F1「工厂 · 开发闭环」步骤 4「交付有回执」—— 边：publish-pr 端点 × V4 候选推送线
//
// 预演发现（r40 nm83sq 抢修，决策 44f8cc31 后续）：V4 设计里候选一路不推远端
// （generate/evaluate/judge 全在 fleet 本地工作区），而 publish-pr 开 PR 前先查
// GitHub 远端 ref——全链没有任何环节推送候选分支，publish 格必死
// publish_branch_unavailable。
//
// 修（第 72 批）：端点收 `source_attempt_id`（candidate_coordinates 既有字段），
// 远端 ref 缺失（404）时调 pushCandidateFn 从 fleet 候选工作区
// （fleet-mounts/worktrees/<attempt>，judge 验过头的那份）推送
// `<head_sha>:refs/heads/<cp-branch>` 后再走原有开 PR 流程。
// 远端已存在但头不一致 → 仍 409 publish_head_mismatch（绝不 force push）。
//
// 真 import 被改模块 harness-attempt-run.js（守卫在边上），不 mock 它。
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHarnessAttemptRunRouter } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const SRC_ATTEMPT = '442d1009-27e2-44c3-8017-0fc9e5eeb460';
const pubBody = {
  branch: 'cp-harness-propose-r1-x', head_sha: 'a'.repeat(40),
  title: 'Harness approved candidate xyz', body: 'body',
  source_attempt_id: SRC_ATTEMPT,
};

function makeApp({ refStatus = 404, refSha, pushResult } = {}) {
  const calls = [];
  const fetchFn = vi.fn(async (url, opts = {}) => {
    calls.push([url, opts.method ?? 'GET']);
    if (/git\/ref\/heads/.test(url)) {
      if (refStatus !== 200) return { ok: false, status: refStatus, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ object: { sha: refSha ?? 'a'.repeat(40) } }) };
    }
    if (/\/pulls$/.test(url)) return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/x/y/pull/9', number: 9 }) };
    return { ok: false, status: 500, json: async () => ({}) };
  });
  const pushCandidateFn = vi.fn(async () => pushResult ?? { ok: true });
  const router = createHarnessAttemptRunRouter({
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
    buildDeps: async () => ({ dispatch: vi.fn() }),
    attemptStoreFactory: async () => ({ getById: async () => null }),
    createTaskFn: async () => ({ success: true, task: { id: 'x' } }),
    publishDepsFactory: async () => ({ resolveToken: async () => 'tok', fetchFn, pushCandidateFn }),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return { app, fetchFn, calls, pushCandidateFn };
}

describe('F1 step4 — publish-pr 候选推送线（r40 抢修契约）', () => {
  it('远端 ref 404 + source_attempt_id + 推送成功 → 推送后开 PR → 200', async () => {
    const { app, calls, pushCandidateFn } = makeApp({ refStatus: 404 });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(pushCandidateFn).toHaveBeenCalledWith(expect.objectContaining({
      sourceAttemptId: SRC_ATTEMPT,
      branch: pubBody.branch,
      headSha: pubBody.head_sha,
      repo: 'perfectuser21/cecelia',
      token: 'tok',
    }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, pr_number: 9, pushed: true });
    expect(calls.some(([url, m]) => /\/pulls$/.test(url) && m === 'POST')).toBe(true);
  });

  it('远端 ref 404 + 无 source_attempt_id → 409 publish_branch_unavailable（行为不变）', async () => {
    const { app, pushCandidateFn } = makeApp({ refStatus: 404 });
    const body = { ...pubBody }; delete body.source_attempt_id;
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_branch_unavailable');
    expect(pushCandidateFn).not.toHaveBeenCalled();
  });

  it('推送失败（候选工作区已释放）→ 409 candidate_workspace_unavailable，不开 PR', async () => {
    const { app, calls } = makeApp({
      refStatus: 404,
      pushResult: { ok: false, error: 'candidate_workspace_unavailable', detail: 'bind source path does not exist' },
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('candidate_workspace_unavailable');
    expect(calls.some(([url, m]) => /\/pulls$/.test(url) && m === 'POST')).toBe(false);
  });

  it('第76批：远端已存在但头不一致（planner 预推提案分支，r47 案卷）→ 尝试非强制推送，成功则开 PR', async () => {
    const { app, pushCandidateFn, calls } = makeApp({ refStatus: 200, refSha: 'f'.repeat(40) });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(pushCandidateFn).toHaveBeenCalledWith(expect.objectContaining({ headSha: pubBody.head_sha }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, pushed: true });
    expect(calls.some(([url, m]) => /\/pulls$/.test(url) && m === 'POST')).toBe(true);
  });

  it('第76批：头不一致且推送失败（非 fast-forward）→ 409 publish_head_mismatch 带 push_error', async () => {
    const { app } = makeApp({
      refStatus: 200, refSha: 'f'.repeat(40),
      pushResult: { ok: false, error: 'candidate_push_failed', detail: 'non-fast-forward' },
    });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_head_mismatch');
    expect(res.body.push_error).toBe('candidate_push_failed');
  });

  it('第76批：头不一致但无 source_attempt_id → 仍直接 409（无处可推）', async () => {
    const { app, pushCandidateFn } = makeApp({ refStatus: 200, refSha: 'f'.repeat(40) });
    const body = { ...pubBody }; delete body.source_attempt_id;
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_head_mismatch');
    expect(pushCandidateFn).not.toHaveBeenCalled();
  });

  it('source_attempt_id 非 UUID → 视同缺席（不调推送）→ 409 publish_branch_unavailable', async () => {
    const { app, pushCandidateFn } = makeApp({ refStatus: 404 });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr')
      .send({ ...pubBody, source_attempt_id: '../../etc' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_branch_unavailable');
    expect(pushCandidateFn).not.toHaveBeenCalled();
  });

  it('远端 ref 非 404 的失败（如 500）→ 409 publish_branch_unavailable，不盲目推送', async () => {
    const { app, pushCandidateFn } = makeApp({ refStatus: 500 });
    const res = await request(app).post('/api/brain/harness/attempt-run/publish-pr').send(pubBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('publish_branch_unavailable');
    expect(pushCandidateFn).not.toHaveBeenCalled();
  });
});
