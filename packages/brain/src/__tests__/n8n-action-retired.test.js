import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), callLLM: vi.fn(), check: vi.fn(), save: vi.fn(), log: vi.fn(), trigger: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), triggerN8n: mocks.trigger, setMemory: vi.fn(), batchUpdateTasks: vi.fn() }));
vi.mock('../intent.js', () => ({ parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {}, extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn() }));
vi.mock('../decision-executor.js', () => ({ getPendingActions: vi.fn(), approvePendingAction: vi.fn(), rejectPendingAction: vi.fn(), addProposalComment: vi.fn(), selectProposalOption: vi.fn(), expireStaleProposals: vi.fn() }));
vi.mock('../proposal.js', () => ({ createProposal: vi.fn(), approveProposal: vi.fn(), rollbackProposal: vi.fn(), rejectProposal: vi.fn(), getProposal: vi.fn(), listProposals: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: mocks.callLLM, callLLMStream: vi.fn() }));
vi.mock('../routes/shared.js', () => ({ ALLOWED_ACTIONS: { 'trigger-n8n': { required: ['webhook_path'] } }, checkIdempotency: mocks.check, saveIdempotency: mocks.save, internalLogDecision: mocks.log }));
import router from '../routes/actions.js';


const app = express(); app.use(express.json()); app.use(router);
const generic = express(); generic.use(express.json());
generic.post('/action/:actionName', router.stack.find(layer => layer.route?.path === '/action/:actionName').route.stack[0].handle);
describe('n8n 旧动作退役', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.check.mockReturnValue({ isDuplicate: true, previousResult: { success: true } }); mocks.trigger.mockResolvedValue({ success: true }); });
  it.each([['快捷', app], ['通用', generic]])('%s 入口先于参数、幂等、执行和数据库拒绝', async (_label, target) => {
    for (const payload of [{}, { webhook_path: 'hook', idempotency_key: 'old-success' }]) {
      const res = await request(target).post('/action/trigger-n8n').send(payload);
      expect(res.status).toBe(410); expect(res.body).toMatchObject({ success: false, error: 'n8n_retired' });
      for (const fn of [mocks.check, mocks.save, mocks.log, mocks.trigger, mocks.query]) expect(fn).not.toHaveBeenCalled();
    }
  });
});
