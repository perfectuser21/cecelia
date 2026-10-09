/**
 * skill_registry 任务→技能绑定（链 bf5088a3 棒7，任务 9917a588）单测：
 *  - registry 改映射后解析结果变化（无需改代码）
 *  - registry 缺映射走硬编码兜底并告警（一次）
 *  - registry 与硬编码不一致以 registry 为准并告警
 *  - payload.skill_override 优先且不碰库
 *  - registry 故障（抛错/超时/非法返回）回落硬编码，不抛
 *  - 缓存生效：TTL 内不重复查库；过期后重查；失败退避
 *  - detectSkillBindingDrift / renderSkillBindingSection（晨报 AMBER 数据源）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureSkillBindingsFresh,
  resolveTaskTypeSkill,
  resolveSkillWithLedger,
  detectSkillBindingDrift,
  renderSkillBindingSection,
  _resetSkillBindingCacheForTest,
  SKILL_BINDING_TTL_MS,
  SKILL_BINDING_BACKOFF_MS,
} from '../skill-binding-registry.js';

const HARD = Object.freeze({
  dev: '/dev',
  review: '/code-review',
  qa_init: '/review init',
  research: '',
});

const row = (name, task_types, dispatch_command = null, status = 'active') => ({
  name, task_types, dispatch_command, status,
});

const poolWith = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });

let warn;
beforeEach(() => {
  _resetSkillBindingCacheForTest();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('resolveTaskTypeSkill：registry 优先，硬编码兜底', () => {
  it('registry 改映射后解析结果变化，无需改代码', async () => {
    await ensureSkillBindingsFresh(poolWith([row('code-review-gate', ['review'])]));
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review-gate');
    // 账本再改一次：换成带参数命令
    _resetSkillBindingCacheForTest();
    await ensureSkillBindingsFresh(poolWith([row('review', ['review'], '/review deep')]));
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/review deep');
  });

  it('dispatch_command 为空时缺省为 /<name>', async () => {
    await ensureSkillBindingsFresh(poolWith([row('talk', ['talk'], null)]));
    expect(resolveTaskTypeSkill('talk', { talk: '/talk' })).toBe('/talk');
  });

  it('registry 缺映射：走硬编码兜底，并告警一次（同 task_type 不重复刷屏）', async () => {
    await ensureSkillBindingsFresh(poolWith([row('code-review', ['review'])]));
    expect(resolveTaskTypeSkill('dev', HARD)).toBe('/dev');
    expect(resolveTaskTypeSkill('dev', HARD)).toBe('/dev');
    const missWarns = warn.mock.calls.filter((c) => String(c[0]).includes('skill-binding') && String(c[0]).includes('dev'));
    expect(missWarns).toHaveLength(1);
  });

  it('两边都没有 → 返回 undefined（调用方沿用 /dev 默认），不告警', async () => {
    await ensureSkillBindingsFresh(poolWith([row('code-review', ['review'])]));
    expect(resolveTaskTypeSkill('harness_generate', HARD)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('硬编码为空串（刻意不挂 skill，如 research）+ registry 缺 → 不告警', async () => {
    await ensureSkillBindingsFresh(poolWith([row('code-review', ['review'])]));
    resolveTaskTypeSkill('research', HARD);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('research'))).toHaveLength(0);
  });

  it('registry 与硬编码不一致：以 registry 为准并告警漂移', async () => {
    await ensureSkillBindingsFresh(poolWith([row('code-review-gate', ['review'])]));
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review-gate');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('drift') && String(c[0]).includes('review'))).toBe(true);
  });

  it('planned 状态的行不参与（SQL 层过滤 + 兜底再滤一次）', async () => {
    await ensureSkillBindingsFresh(poolWith([row('x-skill', ['review'], null, 'planned')]));
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review');
  });

  it('deprecated 的行仍生效（遗留 headless 链路还在跑）', async () => {
    await ensureSkillBindingsFresh(poolWith([row('decomp', ['initiative_plan'], null, 'deprecated')]));
    expect(resolveTaskTypeSkill('initiative_plan', { initiative_plan: '/decomp' })).toBe('/decomp');
  });

  it('同一 task_type 被多行认领：取 name 升序第一行，冲突可被 detect 看到', async () => {
    const pool = poolWith([row('bbb', ['review']), row('aaa', ['review'])]);
    await ensureSkillBindingsFresh(pool);
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/aaa');
    const drift = await detectSkillBindingDrift(pool, HARD);
    expect(drift.conflicts).toEqual([{ task_type: 'review', skills: ['aaa', 'bbb'] }]);
  });

  it('快照从未加载成功（registry 故障）→ 直接硬编码，且不逐类型告警', () => {
    expect(resolveTaskTypeSkill('dev', HARD)).toBe('/dev');
    expect(warn).not.toHaveBeenCalled();
  });

  it('快照加载成功但账本完全没有绑定（迁移未回填）→ 只告一次汇总，不逐类型刷屏', async () => {
    await ensureSkillBindingsFresh(poolWith([]));
    resolveTaskTypeSkill('dev', HARD);
    resolveTaskTypeSkill('review', HARD);
    resolveTaskTypeSkill('qa_init', HARD);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('ensureSkillBindingsFresh：热路径保护（缓存/超时/失败开放）', () => {
  it('缓存生效：TTL 内多次调用只查库一次', async () => {
    const pool = poolWith([row('dev', ['dev'])]);
    let t = 1_000_000;
    const now = () => t;
    await ensureSkillBindingsFresh(pool, { now });
    await ensureSkillBindingsFresh(pool, { now });
    t += SKILL_BINDING_TTL_MS - 1;
    await ensureSkillBindingsFresh(pool, { now });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期后重查并读到新映射（改账本后 ≤TTL 生效）', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockResolvedValueOnce({ rows: [row('dev', ['dev'])] });
    pool.query.mockResolvedValueOnce({ rows: [row('dev-v2', ['dev'])] });
    let t = 1_000_000;
    const now = () => t;
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveTaskTypeSkill('dev', HARD)).toBe('/dev');
    t += SKILL_BINDING_TTL_MS + 1;
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveTaskTypeSkill('dev', HARD)).toBe('/dev-v2');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('并发调用共享同一个在途查询', async () => {
    let resolveQuery;
    const pool = { query: vi.fn(() => new Promise((r) => { resolveQuery = r; })) };
    const a = ensureSkillBindingsFresh(pool);
    const b = ensureSkillBindingsFresh(pool);
    resolveQuery({ rows: [row('dev', ['dev'])] });
    await Promise.all([a, b]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('查询抛错：不抛出，回落硬编码；退避期内不再打库', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('column "task_types" does not exist')) };
    let t = 1_000_000;
    const now = () => t;
    await expect(ensureSkillBindingsFresh(pool, { now })).resolves.toBeUndefined();
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review');
    await ensureSkillBindingsFresh(pool, { now });
    expect(pool.query).toHaveBeenCalledTimes(1);
    t += SKILL_BINDING_BACKOFF_MS + 1;
    await ensureSkillBindingsFresh(pool, { now });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('查询超时：按 timeoutMs 放弃，不拖垮派发，回落硬编码', async () => {
    const pool = { query: vi.fn(() => new Promise(() => {})) }; // 永不返回
    const t0 = Date.now();
    await ensureSkillBindingsFresh(pool, { timeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review');
  });

  it('返回非法结构（mock pool 返回 undefined）→ 视为失败，不抛', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await expect(ensureSkillBindingsFresh(pool)).resolves.toBeUndefined();
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review');
  });

  it('失败后保留上一份好快照（registry 短暂故障不丢已知映射）', async () => {
    const pool = { query: vi.fn() };
    pool.query.mockResolvedValueOnce({ rows: [row('code-review-gate', ['review'])] });
    pool.query.mockRejectedValueOnce(new Error('boom'));
    let t = 1_000_000;
    const now = () => t;
    await ensureSkillBindingsFresh(pool, { now });
    t += SKILL_BINDING_TTL_MS + 1;
    await ensureSkillBindingsFresh(pool, { now });
    expect(resolveTaskTypeSkill('review', HARD)).toBe('/code-review-gate');
  });
});

describe('resolveSkillWithLedger：skill_override 最优先', () => {
  it('payload.skill_override 优先，且不查库', async () => {
    const pool = poolWith([row('code-review-gate', ['review'])]);
    const fallback = vi.fn(() => '/should-not-be-used');
    const skill = await resolveSkillWithLedger(pool, { task_type: 'review', payload: { skill_override: '/custom' } }, fallback);
    expect(skill).toBe('/custom');
    expect(pool.query).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('无 override：先刷新快照再调用同步解析器', async () => {
    const pool = poolWith([row('code-review-gate', ['review'])]);
    const fallback = vi.fn((taskType) => resolveTaskTypeSkill(taskType, HARD) ?? '/dev');
    const skill = await resolveSkillWithLedger(pool, { task_type: 'review', payload: {} }, fallback);
    expect(skill).toBe('/code-review-gate');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('registry 故障时不抛，走同步解析器（硬编码）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('down')) };
    const fallback = (taskType) => resolveTaskTypeSkill(taskType, HARD) ?? '/dev';
    await expect(resolveSkillWithLedger(pool, { task_type: 'review', payload: null }, fallback)).resolves.toBe('/code-review');
  });

  it('task_type 缺省视为 dev', async () => {
    const pool = poolWith([]);
    const fallback = vi.fn(() => '/dev');
    await resolveSkillWithLedger(pool, { payload: {} }, fallback);
    expect(fallback).toHaveBeenCalledWith('dev', {});
  });
});

describe('detectSkillBindingDrift / renderSkillBindingSection（晨报/日报 AMBER）', () => {
  it('registry 缺映射 → missing；值不一致 → mismatched；一致 → 空', async () => {
    const pool = poolWith([
      row('code-review-gate', ['review']),           // 不一致
      row('dev', ['dev']),                           // 一致
    ]);
    const drift = await detectSkillBindingDrift(pool, HARD);
    expect(drift.mismatched).toEqual([{ task_type: 'review', registry: '/code-review-gate', hardcoded: '/code-review' }]);
    expect(drift.missing).toEqual([{ task_type: 'qa_init', hardcoded: '/review init' }]); // research('') 不算缺
    expect(drift.conflicts).toEqual([]);
  });

  it('完全一致 → 三类全空，渲染不含 AMBER', async () => {
    const pool = poolWith([
      row('dev', ['dev']), row('code-review', ['review']), row('review', ['qa_init'], '/review init'),
    ]);
    const drift = await detectSkillBindingDrift(pool, HARD);
    expect(drift).toEqual({ missing: [], mismatched: [], conflicts: [] });
    const text = renderSkillBindingSection(drift);
    expect(text).toContain('== skill 绑定漂移 ==');
    expect(text).not.toContain('AMBER');
  });

  it('registry 缺映射 → 渲染出 🟡 AMBER 并列出 task_type', () => {
    const text = renderSkillBindingSection({
      missing: [{ task_type: 'qa_init', hardcoded: '/review init' }], mismatched: [], conflicts: [],
    });
    expect(text).toContain('🟡 AMBER');
    expect(text).toContain('qa_init');
  });

  it('drift=null（检测不可用）→ 渲染为空串，不出板块', () => {
    expect(renderSkillBindingSection(null)).toBe('');
  });

  it('检测查询失败 → 返回 null（不拖垮报表）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('x')) };
    await expect(detectSkillBindingDrift(pool, HARD)).resolves.toBeNull();
  });
});
