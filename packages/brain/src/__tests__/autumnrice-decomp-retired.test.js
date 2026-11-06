import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), callLLM: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(), batchUpdateTasks: vi.fn() }));
vi.mock('../intent.js', () => ({ parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {}, extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn() }));
vi.mock('../decision-executor.js', () => ({ getPendingActions: vi.fn(), approvePendingAction: vi.fn(), rejectPendingAction: vi.fn(), addProposalComment: vi.fn(), selectProposalOption: vi.fn(), expireStaleProposals: vi.fn() }));
vi.mock('../proposal.js', () => ({ createProposal: vi.fn(), approveProposal: vi.fn(), rollbackProposal: vi.fn(), rejectProposal: vi.fn(), getProposal: vi.fn(), listProposals: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: mocks.callLLM, callLLMStream: vi.fn() }));
vi.mock('../routes/shared.js', () => ({ ALLOWED_ACTIONS: {}, checkIdempotency: vi.fn(), saveIdempotency: vi.fn(), internalLogDecision: vi.fn() }));
import router from '../routes/actions.js';

const app = express();
app.use(express.json());
app.use(router);

describe('秋米旧重拆入口退役', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'action-1', status: 'pending_approval', context: { kr_id: 'kr-1' }, comments: [] }] });
    mocks.query.mockResolvedValue({ rows: [{ id: 'action-1' }], rowCount: 1 });
    mocks.callLLM.mockResolvedValue({ text: '已启动重拆' });
  });
  it('明确告知退役，不调用旧模型、不修改 KR，并保留对话记录', async () => {
    const res = await request(app).post('/autumnrice/chat').send({ pending_action_id: 'action-1', message: '请重新拆一次' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('已退役');
    expect(res.body.redecomp_triggered).toBe(false);
    expect(mocks.callLLM).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE\s+key_results/i.test(sql))).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE\s+pending_actions/i.test(sql))).toBe(true);
  });
  it('普通 KR 讨论仍调用对话，不将“重新分析”误判成重拆', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'action-1', status: 'pending_approval', context: {}, comments: [] }] });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.callLLM.mockResolvedValue({ text: '这是 KR 的分析' });
    const res = await request(app).post('/autumnrice/chat').send({ pending_action_id: 'action-1', message: '请重新分析目标是否合理' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('这是 KR 的分析');
    expect(res.body.redecomp_triggered).toBe(false);
    expect(mocks.callLLM).toHaveBeenCalledOnce();
    expect(mocks.callLLM.mock.calls[0][1]).not.toContain('/decomp Skill 完整版');
  });

  it('审批已变化时返回冲突，不声称评论已保存', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'action-1', status: 'pending_approval', context: {}, comments: [] }] });
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).post('/autumnrice/chat').send({ pending_action_id: 'action-1', message: '请重拆' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });
  it('否定重拆的讨论应正常交给模型，不误判成重拆请求', async () => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'action-1', status: 'pending_approval', context: {}, comments: [] }] });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.callLLM.mockResolvedValue({ text: '继续讨论' });
    const res = await request(app).post('/autumnrice/chat').send({ pending_action_id: 'action-1', message: '不要进行重拆，请讨论现有目标' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('继续讨论');
    expect(mocks.callLLM).toHaveBeenCalledOnce();
  });

  it('重拆请求超出每分钟上限后在数据库查询前拒绝', async () => {
    mocks.query.mockImplementation(async sql => /SELECT.*pending_actions/s.test(sql)
      ? { rows: [{ id: 'action-1', status: 'pending_approval', context: {}, comments: [] }] }
      : { rows: [{ id: 'action-1' }], rowCount: 1 });
    let limited = false;
    for (let i = 0; i < 70; i++) {
      const countBefore = mocks.query.mock.calls.length;
      const res = await request(app).post('/autumnrice/chat').send({ pending_action_id: 'action-1', message: '请重拆' });
      if (res.status === 429) {
        expect(mocks.query).toHaveBeenCalledTimes(countBefore);
        limited = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(limited).toBe(true);
  });

});
