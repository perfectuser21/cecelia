import { beforeEach, describe, expect, it, vi } from 'vitest';
const importer = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../directory-areas.js', () => ({ syncDirectoryAreas: importer.sync }));
import { runDirectoryJob } from '../directory-job.js';
import { runtimeFixture } from './directory-runtime.fixture.js';

beforeEach(() => importer.sync.mockReset());
describe('目录定时任务的入口顺序', () => {
  it('组织入口失败不写页面、成功收据或继续投影', async () => {
    const f = runtimeFixture();
    importer.sync.mockRejectedValue(new Error('directory_areas:parent_cycle'));
    await expect(runDirectoryJob(f.pool, { token: 'test', notionReq: f.notionReq, force: true })).rejects.toThrow(/parent_cycle/);
    expect(f.writes).toEqual([]); expect(f.links).toEqual([]);
    expect(importer.sync).toHaveBeenCalledOnce();
  });
  it('先同步人工组织，再取真身快照；调用方不能替换必要入口', async () => {
    const f = runtimeFixture(); let imported = false, sourceRead = false;
    const connect = f.pool.connect;
    f.pool.connect = async () => {
      const client = await connect(), query = client.query;
      client.query = (...args) => {
        if (args[0].includes('AS source')) { expect(imported).toBe(true); sourceRead = true; }
        return query(...args);
      };
      return client;
    };
    importer.sync.mockImplementation(async (_pool, options) => {
      expect(options.dbId).toBe(f.dbs.areas); expect(options.actor).toBe('directory-scheduler');
      imported = true; return { changed: 0 };
    });
    const override = vi.fn();
    await runDirectoryJob(f.pool, { token: 'test', notionReq: f.notionReq, force: true, beforeSource: override });
    expect(sourceRead).toBe(true); expect(override).not.toHaveBeenCalled(); expect(f.links.length).toBeGreaterThan(0);
  });
});
