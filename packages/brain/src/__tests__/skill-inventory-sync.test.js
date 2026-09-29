/**
 * skill-inventory-sync 编排：锁 / 间隔 / 开跑即写 started_at / ssh 失败不动行 / 命令构造。
 * 入库语义（人管列不碰、没变化不写 updated_at、缺席 24h）见 integration/skill-inventory-sync.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { runSkillInventorySync, buildInventoryCmd, INVENTORY_STATE_KEY } from '../skill-inventory-sync.js';

function fakePool({ locked = true, state = null } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked }] };
      if (/SELECT value_json FROM working_memory/.test(sql)) {
        if (params?.[0] === INVENTORY_STATE_KEY) return { rows: state ? [{ value_json: state }] : [] };
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client), query: client.query }, calls, client };
}

describe('runSkillInventorySync', () => {
  it('拿不到 advisory lock → 跳过且释放连接', async () => {
    const { pool, client } = fakePool({ locked: false });
    const r = await runSkillInventorySync(pool, { exec: vi.fn() });
    expect(r).toEqual({ skipped: true, reason: 'locked' });
    expect(client.release).toHaveBeenCalled();
  });

  it('2h 内跑过 → interval_gate，不执行 ssh', async () => {
    const now = Date.now();
    const { pool } = fakePool({ state: { started_at: new Date(now - 30 * 60e3).toISOString() } });
    const exec = vi.fn();
    const r = await runSkillInventorySync(pool, { exec, now });
    expect(r).toEqual({ skipped: true, reason: 'interval_gate' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('开跑先写 started_at；ssh 失败只记 last_error、不碰 skill_registry、解锁', async () => {
    const { pool, calls, client } = fakePool();
    const exec = vi.fn(async () => { throw Object.assign(new Error('ssh: timeout'), { killed: true }); });
    const r = await runSkillInventorySync(pool, { exec, now: Date.now(), inContainer: false });
    expect(r.ok).toBe(false);
    const writes = calls.filter((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(writes[0].params[1]).started_at).toBeTruthy();
    expect(JSON.parse(writes.at(-1).params[1]).last_error).toMatch(/timeout/);
    expect(calls.some((c) => /skill_registry/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /pg_advisory_unlock/.test(c.sql))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('exec 显式传 170s 超时', async () => {
    const { pool } = fakePool();
    const exec = vi.fn(async () => '{"ok":false,"error":"x"}');
    await runSkillInventorySync(pool, { exec, now: Date.now(), inContainer: false });
    expect(exec.mock.calls[0][1]).toEqual({ timeoutMs: 170_000 });
  });
});

describe('buildInventoryCmd', () => {
  it('宿主直跑：ssh mmv + 单引号包裹远端 shell', () => {
    const cmd = buildInventoryCmd({ program: 'console.log(1)', inContainer: false });
    expect(cmd).toMatch(/^ssh -o BatchMode=yes -o ConnectTimeout=10 mmv 'export PATH=/);
  });
  it('容器内：外层再包宿主逃逸 ssh', () => {
    const cmd = buildInventoryCmd({ program: 'console.log(1)', inContainer: true, keyExistsFn: () => true });
    expect(cmd).toMatch(/^ssh -i .* administrator@host\.docker\.internal /);
  });
});
