import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), createTask: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../actions.js', () => ({ createTask: mocks.createTask, updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(), batchUpdateTasks: vi.fn() }));
vi.mock('../intent.js', () => ({ parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {}, extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn() }));
vi.mock('../proposal.js', () => ({ createProposal: vi.fn(), approveProposal: vi.fn(), rollbackProposal: vi.fn(), rejectProposal: vi.fn(), getProposal: vi.fn(), listProposals: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../routes/shared.js', () => ({ ALLOWED_ACTIONS: {}, checkIdempotency: vi.fn(), saveIdempotency: vi.fn(), internalLogDecision: vi.fn() }));
import router from '../routes/actions.js';

const app = express();
app.use(express.json());
app.use(router);

describe('旧拆解决策真实 HTTP 入口退役', () => {
  beforeEach(() => vi.resetAllMocks());

  it('禁止新建旧待审动作，普通待审动作依然能创建', async () => {
    const retired = await request(app).post('/pending-actions').send({ action_type: 'assign_to_autumnrice', requester: 'owner' });
    expect(retired.status).toBe(410);
    expect(retired.body.code).toBe('decomposition_retired');
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'new-action', action_type: 'create_task' }] });
    const normal = await request(app).post('/pending-actions').send({ action_type: 'create_task', requester: 'owner' });
    expect(normal.status).toBe(201);
    expect(normal.body.id).toBe('new-action');
  });

  it.each(['approve', 'select'])('历史 %s 入口返回 410 并回滚，不创建任务或标为批准', async method => {
    const row = method === 'approve'
      ? { status: 'pending_approval', action_type: 'assign_to_autumnrice', params: {}, context: {} }
      : { status: 'pending_approval', options: [{ id: 'old', action: { type: 'assign_to_autumnrice', params: {} } }] };
    const client = { query: vi.fn(async sql => sql.includes('SELECT * FROM pending_actions') ? { rows: [row] } : { rows: [] }), release: vi.fn() };
    mocks.connect.mockResolvedValueOnce(client);
    const res = await request(app).post(`/pending-actions/legacy/${method}`).send(method === 'select' ? { option_id: 'old' } : {});
    expect(res.status).toBe(410);
    expect(res.body.error).toContain('decomposition_retired');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.includes("SET status = 'approved'"))).toBe(false);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
