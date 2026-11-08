import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const io = vi.hoisted(() => ({ query: vi.fn(), list: vi.fn(), exists: vi.fn(), read: vi.fn(), forbidden: vi.fn(() => { throw Error('external action forbidden'); }) }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('fs', () => ({ readdirSync: io.list, existsSync: io.exists, readFileSync: io.read }));
vi.mock('node:fs', () => ({ readdirSync: io.list, existsSync: io.exists, readFileSync: io.read }));
vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: async () => ({ copy_rules: { min_word_count: { short_copy: 2, long_form: 3 }, keywords_required: ['AI'] } }),
  listContentTypes: io.forbidden, getContentTypeFromYaml: io.forbidden, listContentTypesFromYaml: io.forbidden,
}));
vi.mock('../topic-selection-scheduler.js', () => ({ triggerDailyTopicSelection: io.forbidden, hasTodayTopics: io.forbidden }));
vi.mock('../llm-caller.js', () => ({ callLLM: io.forbidden }));
vi.mock('../actions.js', () => ({ createTask: io.forbidden }));
import router from '../routes/content-pipeline.js';
import { validateAllVariants, validateContentQuality } from '../content-quality-validator.js';

const id = '30000000-0000-4000-8000-000000000001';
const home = '/owned/virtual/content-quality';
const outputBase = home + '/claude-output';
const outputDir = outputBase + '/owned-topic-fixture';
let server;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/brain/pipelines', router);
  server = await new Promise(resolve => { const owned = app.listen(0, '127.0.0.1', () => resolve(owned)); });
});
afterAll(async () => { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => {
  vi.stubEnv('HOME', home);
  vi.clearAllMocks();
  io.query.mockImplementation(async (sql, values) => {
    expect(sql).toMatch(/^SELECT id, title, payload, status FROM tasks/);
    expect(values).toEqual([id]);
    return { rows: [{ id, title: 'owned-topic', payload: { keyword: 'owned-topic' }, status: 'completed' }] };
  });
  io.list.mockImplementation(path => { expect(path).toBe(outputBase); return ['owned-topic-fixture']; });
});
afterEach(() => { expect(io.forbidden).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });
function files(contentMap) {
  const tracked = new Map();
  if ('short_copy' in contentMap) tracked.set(outputDir + '/cards/copy.md', contentMap.short_copy);
  if ('long_form' in contentMap) tracked.set(outputDir + '/article/article.md', contentMap.long_form);
  io.exists.mockImplementation(path => { expect([outputDir + '/cards/copy.md', outputDir + '/article/article.md']).toContain(path); return tracked.has(path); });
  io.read.mockImplementation((path, encoding) => { expect(tracked.has(path)).toBe(true); expect(encoding).toBe('utf-8'); return tracked.get(path); });
}
async function check(contentMap) {
  files(contentMap);
  const response = await request(server).post(`/api/brain/pipelines/${id}/pre-publish-check`).send({});
  expect(response.status).toBe(200);
  expect(io.query).toHaveBeenCalledOnce();
  return response.body;
}

it.each([
  { short_copy: '' }, { long_form: '' }, { short_copy: '', long_form: '' },
  { short_copy: 'AI useful words', long_form: '' }, { short_copy: ' \n\t' },
])('实际HTTP读取空变体%j必须保留blocking结果', async map => {
  const body = await check(map);
  expect(body.passed).toBe(false);
  const emptyVariants = Object.entries(map).filter(([, value]) => !value.trim()).map(([variant]) => variant);
  expect(emptyVariants.length).toBeGreaterThan(0);
  for (const variant of emptyVariants) {
    expect(body.results[variant]).toMatchObject({ passed: false, word_count: 0 });
    expect(body.issues).toContainEqual(expect.objectContaining({ rule: 'min_word_count', severity: 'blocking', variant }));
  }
});
it('非空单变体可通过，不把未生成的可选长文当空内容', async () => {
  const body = await check({ short_copy: 'AI useful words' });
  expect(body.passed).toBe(true);
  expect(Object.keys(body.results)).toEqual(['short_copy']);
  expect(body.results.short_copy).toEqual(validateContentQuality('AI useful words', { copy_rules: { min_word_count: { short_copy: 2 }, keywords_required: ['AI'] } }));
});
it('未找到任何内容仍保留现有content_not_found失败合同', async () => {
  const body = await check({});
  expect(body.passed).toBe(false);
  expect(body.issues).toContainEqual(expect.objectContaining({ rule: 'content_not_found', severity: 'blocking' }));
});
it.each(['', null, undefined])('显式存在的空值%j由真实validator校验而非跳过', value => {
  const body = validateAllVariants({ short_copy: value });
  expect(body.passed).toBe(false);
  expect(body.results.short_copy).toEqual(validateContentQuality(value));
});
