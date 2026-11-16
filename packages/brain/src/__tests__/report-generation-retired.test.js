import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const io = vi.hoisted(() => ({ query: vi.fn(), generate: vi.fn(), trigger: vi.fn(), llm: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../cortex.js', () => ({ generateSystemReport: io.generate, searchRelevantAnalyses: vi.fn() }));
vi.mock('../tick.js', () => ({ check48hReport: io.trigger }));
vi.mock('../llm-caller.js', () => ({ callLLM: io.llm, callLLMStream: io.llm }));
vi.mock('../battle-report.js', () => ({ buildBattleReportData: io.generate, renderBattleReportHTML: io.generate }));
vi.mock('../routes/instruction-book.js', () => ({ registerInstructionBookRoute: vi.fn() }));
vi.mock('../lib/deploy-retention-runtime.js', () => ({ loadDeploymentRetentionRuntime: vi.fn() }));
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt: vi.fn(), resolveActionReceipt: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../task-cleanup.js', () => ({ getCleanupStats: vi.fn(), runTaskCleanup: vi.fn(), getCleanupAuditLog: vi.fn() }));
vi.mock('../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../task-router.js', () => ({ ASYNC_CALLBACK_TYPES: [] }));
vi.mock('../suggestion-triage.js', () => ({ createSuggestion: vi.fn(), executeTriage: vi.fn(), getTopPrioritySuggestions: vi.fn(), updateSuggestionStatus: vi.fn(), cleanupExpiredSuggestions: vi.fn(), getTriageStats: vi.fn() }));
vi.mock('../pr-callback-handler.js', () => ({ verifyWebhookSignature: vi.fn(), extractPrInfo: vi.fn(), handlePrMerged: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getAllStates: vi.fn() }));
vi.mock('../routes/shared.js', () => ({ getActiveExecutionPaths: vi.fn(), INVENTORY_CONFIG: {} }));
vi.mock('../stats.js', () => ({ getMonthlyPRCount: vi.fn(), getMonthlyPRsByKR: vi.fn(), getPRSuccessRate: vi.fn(), getPRTrend: vi.fn() }));
vi.mock('../cortex-quality.js', () => ({ evaluateQualityInitial: vi.fn(), checkShouldCreateRCA: vi.fn(), getQualityStats: vi.fn() }));
import ops from '../routes/ops.js';
import analytics from '../routes/analytics.js';
import docs from '../routes/design-docs.js';
const app = express();
app.use(express.json());
app.use('/api/brain/design-docs', docs);
app.use('/api/brain', ops, analytics);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('禁止外部网络'); }));
  io.query.mockResolvedValue({ rows: [] });
  io.generate.mockResolvedValue({ id: 'generated' });
  io.trigger.mockResolvedValue({ id: 'generated' });
});
afterAll(() => vi.unstubAllGlobals());
describe('内置报告生成入口退役', () => {
  for (const [method, path] of [
    ['post', '/reports/generate'], ['post', '/reports/trigger'],
    ['post', '/cortex/generate-report'], ['get', '/design-docs/battle-report-html'],
  ]) {
    it(`${method} ${path} 返回410且没有数据库或生成副作用`, async () => {
      const response = await request(app)[method](`/api/brain${path}`).send({ time_range_hours: 1 });
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({ error: 'report_generation_retired' });
      expect(io.query).not.toHaveBeenCalled();
      expect(io.generate).not.toHaveBeenCalled();
      expect(io.trigger).not.toHaveBeenCalled();
      expect(io.llm).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  }
  it('历史报告GET仍返回持久化正文', async () => {
    io.query.mockResolvedValue({ rows: [{ id: 'historic', content: '历史正文' }] });
    const response = await request(app).get('/api/brain/design-docs/historic');
    expect(response.status).toBe(200);
    expect(response.body.data.content).toBe('历史正文');
    expect(io.generate).not.toHaveBeenCalled();
  });
  it('外置Skill提供的正文仍可通过通用入口持久化', async () => {
    io.query.mockResolvedValue({ rows: [{ id: 'external', content: '任务结果正文' }] });
    const response = await request(app).post('/api/brain/design-docs').send({ type: 'diary', title: 'Task产物', content: '任务结果正文' });
    expect(response.status).toBe(201);
    expect(response.body.data.content).toBe('任务结果正文');
    expect(io.query.mock.calls[0][0]).toContain('INSERT INTO design_docs');
    expect(io.generate).not.toHaveBeenCalled();
  });
});
