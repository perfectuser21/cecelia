/**
 * skill-inventory-sync 真库入库语义（cecelia_test）：
 *  新 skill 入账；已有行只更机器列；人管列与 status 不碰；没变化不写 updated_at；
 *  断链 → broken；来源不全不判缺席；缺席满 24h → gone。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { runSkillInventorySync, INVENTORY_STATE_KEY } from '../../skill-inventory-sync.js';

let pool;
const T = '__skinv_it_';
beforeAll(async () => { pool = (await import('../../db.js')).default; });
afterEach(async () => {
  await pool.query(`DELETE FROM skill_registry WHERE name LIKE '${T}%'`);
  await pool.query(`DELETE FROM working_memory WHERE key IN ($1, 'skill_manifest_drift')`, [INVENTORY_STATE_KEY]);
  // 来源齐全时扫描会对库里所有未扫到的行判缺席（含迁移 470 回填的派发行）——复位，免得污染同库其它集成测试
  await pool.query(`UPDATE skill_registry SET presence = 'unknown', absent_since = NULL, last_scanned_at = NULL
                     WHERE presence <> 'unknown' OR absent_since IS NOT NULL`);
});

const item = (name, digest) => ({ name, path: `/h/.claude/skills/${name}/SKILL.md`, real_path: `/h/.claude/skills/${name}/SKILL.md`, digest, lines: 2, truncated: false, files: ['SKILL.md'] });
const inventory = ({ names = [`${T}a`], broken = [], ocStatus = 'ok' } = {}) => ({
  ok: true, contents: { dA: '---\ndescription: 新描述\n---\n' },
  sources: {
    claude: { status: 'ok', items: names.map((n) => item(n, 'dA')), broken },
    agents: { status: 'ok', items: [], broken: [] },
    repo: { status: 'ok', items: [] },
    openclaw: ocStatus === 'ok' ? { status: 'ok', items: [] } : { status: 'fail', error: 'x' },
  },
});
async function seedDrift(now) {
  await pool.query(`INSERT INTO working_memory (key, value_json, updated_at) VALUES ('skill_manifest_drift', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $1`, [JSON.stringify({ checked_at: new Date(now).toISOString(), truth: { status: 'ok' }, machines: [] })]);
}
const run = (inv, now) => runSkillInventorySync(pool, { force: true, now, inContainer: false, exec: async () => JSON.stringify(inv) });

describe('skill-inventory-sync 真库', () => {
  it('新 skill 入账 present；已有行人管列/status 不碰；没变化不动 updated_at', async () => {
    const now = Date.now();
    await seedDrift(now);
    await pool.query(`INSERT INTO skill_registry (name, status, note, owner, description) VALUES ($1, 'deprecated', '人写的', 'alex', '旧描述')`, [`${T}a`]);
    const r = await run(inventory(), now);
    expect(r.ok).toBe(true);
    const { rows: [a] } = await pool.query(`SELECT * FROM skill_registry WHERE name=$1`, [`${T}a`]);
    expect(a.presence).toBe('present');
    expect(a.platforms_installed).toEqual(['claude-code']);
    expect(a.description).toBe('新描述');
    expect(a.status).toBe('deprecated');
    expect(a.note).toBe('人写的');
    expect(a.owner).toBe('alex');
    await run(inventory(), now + 1000);
    const { rows: [a2] } = await pool.query(`SELECT updated_at, last_seen_at FROM skill_registry WHERE name=$1`, [`${T}a`]);
    expect(a2.updated_at.getTime()).toBe(a.updated_at.getTime());
    expect(a2.last_seen_at.getTime()).toBeGreaterThan(a.last_seen_at.getTime());
  });

  it('断链 → broken；来源不全不判缺席；缺席满 24h → gone', async () => {
    const t0 = Date.parse('2026-09-30T00:00:00Z');
    await seedDrift(t0);
    await pool.query(`INSERT INTO skill_registry (name, presence) VALUES ($1,'present'), ($2,'present')`, [`${T}ghost`, `${T}old`]);
    await run(inventory({ broken: [`${T}ghost`], ocStatus: 'fail' }), t0);
    let { rows } = await pool.query(`SELECT name, presence, absent_since FROM skill_registry WHERE name IN ($1,$2) ORDER BY name`, [`${T}ghost`, `${T}old`]);
    expect(rows.find((x) => x.name === `${T}ghost`).presence).toBe('broken');
    expect(rows.find((x) => x.name === `${T}old`).absent_since).toBeNull();
    await run(inventory(), t0);
    await seedDrift(t0 + 25 * 3600e3);
    await run(inventory(), t0 + 25 * 3600e3);
    ({ rows } = await pool.query(`SELECT presence FROM skill_registry WHERE name=$1`, [`${T}old`]));
    expect(rows[0].presence).toBe('gone');
  });
});
