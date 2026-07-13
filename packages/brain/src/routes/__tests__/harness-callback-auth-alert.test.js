/**
 * routes/harness-callback-auth-alert.test.js
 *
 * 回归守卫：cecelia-relay-* 容器的 callback 分支之前对任何失败（含认证失败）
 * 一律只 console.log + 200 ack，不做任何分类或告警——只能靠 relay-watchdog/zombie-reaper
 * 按"看起来卡住了"兜底，不关心失败原因。
 *
 * 现场：task d063b3e5 的 relay session 在 generator 完成后崩溃，result 是
 * "Not logged in · Please run /login"，exit_code=1，但没有任何通知，只能靠人工翻容器日志发现。
 *
 * 修复：exit_code 非 0 且 result/error 匹配认证失败特征时，sendBark 主动通知（不用 raise/飞书，
 * 账号登录失效只有人能处理，属于需要用户立即处理的告警）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@langchain/langgraph', () => ({
  Command: vi.fn().mockImplementation((args) => ({ __command: true, args })),
}));

vi.mock('../../lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));

vi.mock('../../notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(true),
}));

describe('routes/harness-callback — relay 容器认证失败 Bark 告警', () => {
  let app;
  let sendBark;
  let resetDedupe;

  beforeEach(async () => {
    vi.clearAllMocks();
    const notifierMod = await import('../../notifier.js');
    sendBark = notifierMod.sendBark;

    const routerMod = await import('../harness-callback.js');
    resetDedupe = routerMod._resetCallbackDedupeForTests;
    resetDedupe();

    app = express();
    app.use(express.json());
    app.use('/api/brain', routerMod.default);
  });

  it('relay 容器 exit_code!=0 且 result 含 "Not logged in" → 触发 sendBark 告警', async () => {
    const cid = 'cecelia-relay-d063b3e5-3acf8c63';
    const body = {
      result: 'Not logged in · Please run /login',
      exit_code: 1,
    };

    const res = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res.status).toBe(200);
    expect(res.body.relayAck).toBe(true);
    expect(sendBark).toHaveBeenCalledTimes(1);
    const [title, alertBody] = sendBark.mock.calls[0];
    expect(title).toContain('登录');
    expect(alertBody).toContain(cid);
  });

  it('relay 容器 result 含 "please run /login"（大小写不同）→ 同样触发告警', async () => {
    const cid = 'cecelia-relay-abcdef01-xyz12345';
    const body = {
      error: 'PLEASE RUN /LOGIN to continue',
      exit_code: 1,
    };

    await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  it('relay 容器 exit_code=0（成功）→ 不触发告警', async () => {
    const cid = 'cecelia-relay-success01-aaaaaaaa';
    const body = { result: 'completed successfully', exit_code: 0 };

    const res = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res.status).toBe(200);
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('relay 容器 exit_code!=0 但非认证类失败（如网络错误）→ 不触发告警（范围内只处理认证特征）', async () => {
    const cid = 'cecelia-relay-neterr001-bbbbbbbb';
    const body = { result: 'Connection refused: ECONNREFUSED', exit_code: 1 };

    const res = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res.status).toBe(200);
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('sendBark 内部抛错也不影响原有 200 relayAck 行为（告警失败不能拖累 ack）', async () => {
    sendBark.mockRejectedValueOnce(new Error('bark network down'));
    const cid = 'cecelia-relay-barkfail01-cccccccc';
    const body = { result: 'Not logged in · Please run /login', exit_code: 1 };

    const res = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res.status).toBe(200);
    expect(res.body.relayAck).toBe(true);
  });
});
