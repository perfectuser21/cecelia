/**
 * zenithjoy-db-drift-monitor.test.js
 *
 * 刀1c/1d 双写验证期监控——对比 cecelia.zenithjoy 与独立 zenithjoy 库的关键表行数。
 * 仅在 ZENITHJOY_DB_NAME 已设时生效；未设时幂等 no-op。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEY = 'ZENITHJOY_DB_NAME';
const SENTINEL_KEY = 'scheduler_job_last_run:zenithjoy-db-drift-monitor';

// ── mock helpers ──────────────────────────────────────────────────────────────
function makePool(countsByTable) {
  return {
    query: vi.fn(async (sql) => {
      for (const [table, count] of Object.entries(countsByTable)) {
        if (sql.includes(table)) return { rows: [{ cnt: String(count) }] };
      }
      return { rows: [{ cnt: '0' }] };
    }),
  };
}

vi.mock('../db.js', () => ({ default: null }));
vi.mock('../zenithjoy-db.js', () => ({ getZenithjoyPool: vi.fn() }));
vi.mock('../sendBark.js', () => ({ sendBark: vi.fn() }));

const { getZenithjoyPool } = await import('../zenithjoy-db.js');
const { sendBark } = await import('../sendBark.js');
const { runZenithjoyDbDriftMonitor } = await import('../zenithjoy-db-drift-monitor.js');

describe('runZenithjoyDbDriftMonitor', () => {
  let savedEnv;
  beforeEach(() => { savedEnv = process.env[ENV_KEY]; delete process.env[ENV_KEY]; vi.clearAllMocks(); });
  afterEach(() => { if (savedEnv === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = savedEnv; });

  it('ZENITHJOY_DB_NAME 未设时立即返回 null（no-op）', async () => {
    const pool = makePool({});
    const result = await runZenithjoyDbDriftMonitor(pool);
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('ZENITHJOY_DB_NAME 已设且行数一致时写入 sentinel ok:true', async () => {
    process.env[ENV_KEY] = 'zenithjoy';
    const mainPool = makePool({
      wechat_publish_task: 7,
      works: 89,
      publish_logs: 131,
      tenants: 250,
    });
    const zjPool = makePool({
      wechat_publish_task: 7,
      works: 89,
      publish_logs: 131,
      tenants: 250,
    });
    getZenithjoyPool.mockReturnValue(zjPool);

    const result = await runZenithjoyDbDriftMonitor(mainPool);

    expect(result).not.toBeNull();
    expect(result.ok).toBe(true);
    expect(result.drift).toHaveLength(0);
    expect(sendBark).not.toHaveBeenCalled();
    // sentinel 写入 working_memory
    const sentinelCall = mainPool.query.mock.calls.find((c) => c[0].includes('working_memory'));
    expect(sentinelCall).toBeDefined();
    const sentinelValue = JSON.parse(sentinelCall[1][1]);
    expect(sentinelValue.ok).toBe(true);
    expect(sentinelValue.db).toBe('zenithjoy');
  });

  it('drift 超阈值时写 sentinel ok:false 且发 Bark', async () => {
    process.env[ENV_KEY] = 'zenithjoy';
    const mainPool = makePool({ wechat_publish_task: 7, works: 89, publish_logs: 131, tenants: 250 });
    // zenithjoy DB 行数落后（应该与 cecelia 一致）
    const zjPool = makePool({ wechat_publish_task: 7, works: 50, publish_logs: 100, tenants: 250 });
    getZenithjoyPool.mockReturnValue(zjPool);

    const result = await runZenithjoyDbDriftMonitor(mainPool);

    expect(result.ok).toBe(false);
    expect(result.drift.length).toBeGreaterThan(0);
    expect(result.drift[0].table).toBeDefined();
    expect(sendBark).toHaveBeenCalledOnce();
    const [_token, title] = sendBark.mock.calls[0];
    expect(title).toContain('drift');
  });

  it('zjPool 连接失败时写 sentinel error 不抛出', async () => {
    process.env[ENV_KEY] = 'zenithjoy';
    const mainPool = makePool({ wechat_publish_task: 7, works: 89, publish_logs: 131, tenants: 250 });
    const brokenPool = { query: vi.fn().mockRejectedValue(new Error('connection refused')) };
    getZenithjoyPool.mockReturnValue(brokenPool);

    const result = await runZenithjoyDbDriftMonitor(mainPool);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('6h gate: 上次跑在 4h 前时跳过执行', async () => {
    process.env[ENV_KEY] = 'zenithjoy';
    const recentAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const mainPool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('working_memory') && sql.startsWith('SELECT')) {
          return { rows: [{ value_json: JSON.stringify({ at: recentAt, ok: true }) }] };
        }
        return { rows: [{ cnt: '0' }] };
      }),
    };
    const zjPool = makePool({});
    getZenithjoyPool.mockReturnValue(zjPool);

    const result = await runZenithjoyDbDriftMonitor(mainPool);

    expect(result).toBeNull();
    expect(zjPool.query).not.toHaveBeenCalled();
  });
});
