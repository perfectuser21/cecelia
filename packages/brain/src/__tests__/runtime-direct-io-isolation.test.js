import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
const { readFileSync: readSource } = await vi.importActual('node:fs');

const io = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn(), query: vi.fn(), openai: vi.fn(), embedding: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: io.read }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../embedding-service.js', () => ({ generateProfileFactEmbeddingAsync: vi.fn() }));
vi.mock('../notion-memory-sync.js', () => ({ pushFactToNotion: vi.fn() }));
vi.mock('openai', () => ({ default: io.openai }));
import { extractAndSaveUserFacts, _resetApiKey } from '../user-profile.js';
import { generateEmbedding, generateEmbeddingsBatch } from '../openai-client.js';
import { assertExternalExecutionAllowed } from '../runtime-safety.js';

beforeEach(() => {
  vi.clearAllMocks(); _resetApiKey();
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('OPENAI_API_KEY', 'fixture-only');
  vi.stubGlobal('fetch', io.fetch);
  io.read.mockReturnValue('{"api_key":"fixture-only"}');
  io.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"facts":[]}' } }] }) });
  io.query.mockResolvedValue({ rows: [] });
  io.openai.mockImplementation(() => ({ embeddings: { create: io.embedding } }));
  io.embedding.mockResolvedValue({ data: [{ embedding: new Array(1536).fill(0) }] });
});
afterEach(() => { _resetApiKey(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('直接模型I/O不得绕过运行隔离', () => {
  it('extractAndSaveUserFacts在读凭据前拒绝', async () => {
    await expect(extractAndSaveUserFacts({ query: io.query }, 'owner', [{ role: 'user', content: 'fixture' }]))
      .rejects.toMatchObject({ code: 'LLM_RUNTIME_ISOLATED' });
    expect(io.read).not.toHaveBeenCalled(); expect(io.fetch).not.toHaveBeenCalled(); expect(io.query).not.toHaveBeenCalled();
  });
  it.each(['single', 'batch'])('embedding %s在创建SDK或调用模型前拒绝', async mode => {
    const result = mode === 'single' ? generateEmbedding('fixture') : generateEmbeddingsBatch(['fixture']);
    await expect(result).rejects.toMatchObject({ code: 'LLM_RUNTIME_ISOLATED' });
    expect(io.openai).not.toHaveBeenCalled(); expect(io.embedding).not.toHaveBeenCalled();
  });
});

describe('导出的执行函数使用真实隔离判断', () => {
  it.each(['triggerCodexReview', 'triggerCodexBridge', 'triggerMiniMaxExecutor'])('%s在第一个I/O依赖前拒绝', async name => {
    const source = readSource(new URL('../executor.js', import.meta.url), 'utf8');
    const expression = source.match(new RegExp(`async function ${name}\\([^]*?^\\}`, 'm'))[0];
    const boundary = vi.fn(() => { throw new Error('reached forbidden I/O'); });
    const fn = vm.runInNewContext(`(${expression})`, {
      process: { env: { NODE_ENV: 'test' } }, assertExternalExecutionAllowed,
      generateRunId: () => 'fixture-run', mkdir: boundary, buildCodexPromptContent: boundary,
      fetch: boundary, CODEX_REVIEW_LOCK_DIR: '/fixture', HK_MINIMAX_URL: 'http://fixture', AbortSignal,
      console: { log() {}, error() {} },
    });
    await expect(fn({ id: 'fixture', task_type: 'review' })).rejects.toMatchObject({ code: 'EXECUTION_RUNTIME_ISOLATED' });
    expect(boundary).not.toHaveBeenCalled();
  });
});
