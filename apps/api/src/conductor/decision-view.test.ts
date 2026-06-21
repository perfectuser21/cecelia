// decision-view 测试 — Notion「待决策」写入 + 轮询读裁决。
// Notion fetch 全部 mock; env 缺失必须降级回本地文件队列(不崩)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readVerdict,
  publishContract,
  QUEUE_DIR,
  notionEnabled,
} from './decision-view.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const task = { id: 'task-abc', title: '给报表加缓存', description: '慢' };
const contract = { approach: '服务端 Redis 缓存', risk: '低', dod: ['CI 绿'] };

function cleanLocal() {
  for (const ext of ['.contract.json', '.verdict']) {
    const f = path.join(QUEUE_DIR, `${task.id}${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('demo 模式不动(命门: --demo 必须稳过)', () => {
  it('demo 走剧本数组, 不碰 Notion 不碰本地', async () => {
    const script = [{ action: 'redirect', steer: 'x' }, { action: 'approve' }];
    expect(await readVerdict({ mode: 'demo', script, round: 1, taskId: task.id })).toEqual(script[0]);
    expect(await readVerdict({ mode: 'demo', script, round: 2, taskId: task.id })).toEqual(script[1]);
  });
});

describe('env 缺失 → 降级本地文件队列', () => {
  beforeEach(() => {
    delete process.env.NOTION_API_KEY;
    delete process.env.AUTOPILOT_DECISION_DB_ID;
    cleanLocal();
  });
  afterEach(cleanLocal);

  it('notionEnabled() 为 false', () => {
    expect(notionEnabled()).toBe(false);
  });

  it('publishContract 写本地 contract.json, 不调 fetch', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const out = await publishContract(task, contract);
    expect(spy).not.toHaveBeenCalled();
    expect(fs.existsSync(out)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('readVerdict(once) 无本地 verdict → null(pause-in-place)', async () => {
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toBeNull();
  });

  it('readVerdict(once) 读到本地 verdict 文件', async () => {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.writeFileSync(path.join(QUEUE_DIR, `${task.id}.verdict`), JSON.stringify({ action: 'approve' }));
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toEqual({ action: 'approve' });
  });
});

describe('env 齐 → 走 Notion (fetch mock)', () => {
  beforeEach(() => {
    process.env.NOTION_API_KEY = 'secret_test';
    process.env.AUTOPILOT_DECISION_DB_ID = 'db-123';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTION_API_KEY;
    delete process.env.AUTOPILOT_DECISION_DB_ID;
  });

  it('notionEnabled() 为 true', () => {
    expect(notionEnabled()).toBe(true);
  });

  it('publishContract 调 Notion /pages 创建待决策页, 带 task/contract/风险', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'page-999' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await publishContract(task, contract);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/pages');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer secret_test');
    const body = JSON.parse(opts.body);
    expect(body.parent.database_id).toBe('db-123');
    // Contract 全文 + 风险必须进 properties(字段名按 C 推荐, 真接库时校准)
    const serialized = JSON.stringify(body.properties);
    expect(serialized).toContain(task.title);
    expect(serialized).toContain(contract.approach);
    expect(out).toBe('page-999');
  });

  it('readVerdict(once) 查 Notion: 状态=待审 → null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ properties: { 状态: { select: { name: '待审' } } } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toBeNull();
  });

  it('readVerdict(once) 查 Notion: 状态=approve → {action:approve}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ properties: { 状态: { select: { name: 'approve' } } } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toEqual({ action: 'approve' });
  });

  it('readVerdict(once) 查 Notion: 状态=redirect → 带 steer 文本', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          properties: {
            状态: { select: { name: 'redirect' } },
            裁决: { rich_text: [{ plain_text: '改放服务端' }] },
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toEqual({
      action: 'redirect',
      steer: '改放服务端',
    });
  });

  it('Notion 查询无结果 → null(还没在待决策视图建页/被删)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readVerdict({ mode: 'once', taskId: task.id })).toBeNull();
  });

  it('Notion fetch 抛错 → 降级 null, 不崩', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readVerdict({ mode: 'once', taskId: task.id })).resolves.toBeNull();
  });
});
