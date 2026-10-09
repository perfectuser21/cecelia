/**
 * POST /pending-actions/:id/approve|reject 对 owner_decision 的入参透传与状态码映射
 * （链 bf5088a3 棒 9，任务 8aa79219）。执行器本体的行为由真库集成测试覆盖，这里只测路由层。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const approvePendingAction = vi.fn();
const rejectPendingAction = vi.fn();

vi.mock('../../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../../actions.js', () => ({
  createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(),
  triggerN8n: vi.fn(), setMemory: vi.fn(), batchUpdateTasks: vi.fn(),
}));
vi.mock('../../intent.js', () => ({
  parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn(),
}));
vi.mock('../../decision-executor.js', () => ({
  getPendingActions: vi.fn(),
  approvePendingAction: (...a) => approvePendingAction(...a),
  rejectPendingAction: (...a) => rejectPendingAction(...a),
  addProposalComment: vi.fn(), selectProposalOption: vi.fn(), expireStaleProposals: vi.fn(),
}));
vi.mock('../../proposal.js', () => ({
  createProposal: vi.fn(), approveProposal: vi.fn(), rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(), getProposal: vi.fn(), listProposals: vi.fn(),
}));
vi.mock('../../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../shared.js', () => ({
  ALLOWED_ACTIONS: [], checkIdempotency: vi.fn(), saveIdempotency: vi.fn(), internalLogDecision: vi.fn(),
}));

let app;
beforeEach(async () => {
  approvePendingAction.mockReset();
  rejectPendingAction.mockReset();
  const { default: router } = await import('../actions.js');
  app = express();
  app.use(express.json());
  app.use('/', router);
});

describe('POST /pending-actions/:id/approve', () => {
  it('body.choice / reviewer 透传给 approvePendingAction 第三个参数', async () => {
    approvePendingAction.mockResolvedValue({ success: true, execution_result: {} });
    const res = await request(app).post('/pending-actions/pa-1/approve').send({ reviewer: 'alex', choice: 'B' });
    expect(res.status).toBe(200);
    expect(approvePendingAction).toHaveBeenCalledWith('pa-1', 'alex', { choice: 'B' });
  });

  it('二次批准（executor 回 409）→ HTTP 409', async () => {
    approvePendingAction.mockResolvedValue({ success: false, error: 'Action is approved, not pending_approval', status: 409 });
    const res = await request(app).post('/pending-actions/pa-1/approve').send({ reviewer: 'alex' });
    expect(res.status).toBe(409);
  });

  it('未知 choice（executor 回 400 + code）→ HTTP 400 带 code', async () => {
    approvePendingAction.mockResolvedValue({ success: false, error: 'x', code: 'owner_decision_unknown_choice', status: 400 });
    const res = await request(app).post('/pending-actions/pa-1/approve').send({ choice: 'Z' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('owner_decision_unknown_choice');
  });
});

describe('POST /pending-actions/:id/reject', () => {
  it('reject 成功 200；已处理（executor 回 409）→ HTTP 409', async () => {
    rejectPendingAction.mockResolvedValueOnce({ success: true });
    const ok = await request(app).post('/pending-actions/pa-1/reject').send({ reviewer: 'alex', reason: '不想选' });
    expect(ok.status).toBe(200);
    expect(rejectPendingAction).toHaveBeenCalledWith('pa-1', 'alex', '不想选');

    rejectPendingAction.mockResolvedValueOnce({ success: false, error: 'Action already processed', status: 409 });
    const dup = await request(app).post('/pending-actions/pa-1/reject').send({ reviewer: 'alex' });
    expect(dup.status).toBe(409);
  });
});
