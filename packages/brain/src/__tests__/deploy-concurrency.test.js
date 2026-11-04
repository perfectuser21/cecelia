import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock ops.js 的所有重依赖，确保测试轻量
vi.mock('../db.js', () => ({ default: { query: boundary.forbidden } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn() }));
vi.mock('../tick.js', () => ({ check48hReport: vi.fn() }));
vi.mock('../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(),
  runTaskCleanup: vi.fn(),
  getCleanupAuditLog: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));
vi.mock('../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));
vi.mock('./shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));
const boundary = vi.hoisted(() => ({spawn:vi.fn(), write:vi.fn(), receipt:vi.fn(async()=> 'fixture-receipt'), forbidden:vi.fn(() => {throw Error('external action forbidden');})}));
vi.mock('child_process', () => ({spawn:boundary.spawn,exec:boundary.forbidden,execSync:boundary.forbidden,execFile:boundary.forbidden,execFileSync:boundary.forbidden}));
vi.mock('node:child_process', () => ({spawn:boundary.spawn,exec:boundary.forbidden,execSync:boundary.forbidden,execFile:boundary.forbidden,execFileSync:boundary.forbidden}));
vi.mock('../receipt-collector.js', () => ({recordActionReceipt:boundary.receipt,resolveActionReceipt:boundary.forbidden}));
vi.mock('fs', async original => ({...await original(),
  readFileSync:() => {throw Error('no fixture deployment status file');},
  writeFileSync:boundary.write,mkdirSync:boundary.write,writeSync:boundary.write,closeSync:boundary.write,openSync:() => 123,
}));


let app, deployState;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch',boundary.forbidden);
  vi.stubEnv('DEPLOY_TOKEN','fixture-token');
  vi.stubEnv('REPO_ROOT','/owned/fixture/repo');
  boundary.spawn.mockImplementation(() => ({unref:vi.fn(),on:vi.fn()}));
  const mod = await import('../routes/ops.js');
  deployState = mod.deployState;
  Object.assign(deployState,{status:'idle',started_at:null,error:null});
  app = express();app.use(express.json());app.use('/api/brain',mod.default);
});
afterEach(() => {vi.unstubAllEnvs();vi.unstubAllGlobals();});
const deploy = () => request(app).post('/api/brain/deploy').set('Authorization','Bearer fixture-token').send({});

describe('真实POST部署handler互斥合同，全部部署/磁盘/账本边界隔离', () => {
  it.each(['running','rolling_back'])('%s返回409且零部署副作用', async status => {
    deployState.status = status;
    const res = await deploy();
    expect(res.status).toBe(409);
    expect(res.body.current_status).toBe(status);
    expect(boundary.spawn).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(boundary.receipt).not.toHaveBeenCalled();
    expect(boundary.forbidden).not.toHaveBeenCalled();
  });
  it.each(['idle','success','failed','rolled_back'])('%s实际进入受控spawn分支且先占running', async status => {
    deployState.status = status;
    expect((await deploy()).status).toBe(202);
    await vi.waitFor(() => expect(boundary.spawn).toHaveBeenCalledTimes(1));
    expect(deployState.status).toBe('running');
    expect(boundary.receipt).toHaveBeenCalledTimes(1);
    expect(boundary.spawn).toHaveBeenCalledWith('bash',expect.any(Array),expect.objectContaining({detached:true,cwd:'/owned/fixture/repo'}));
    expect(boundary.forbidden).not.toHaveBeenCalled();
  });
  it('并发两请求只能一个202，其余409且仅一份spawn/receipt', async () => {
    const responses = await Promise.all([deploy(),deploy()]);
    expect(responses.map(r => r.status).sort()).toEqual([202,409]);
    await vi.waitFor(() => expect(boundary.spawn).toHaveBeenCalledTimes(1));
    expect(boundary.receipt).toHaveBeenCalledTimes(1);
    expect(boundary.forbidden).not.toHaveBeenCalled();
  });
});
