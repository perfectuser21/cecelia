/**
 * vocab-alias.test.js — 行业词汇 API 别名中间件（决策 a340f100 · 任务 7b550e31）
 * [BEHAVIOR] 新路径重写到旧路径且保留子路径/查询串；非别名路径原样放行；旧路径不受影响。
 */
import { describe, it, expect } from 'vitest';
import vocabAlias, { ALIAS_MAP } from '../vocab-alias.js';

function run(url) {
  const req = { url };
  vocabAlias(req, null, () => {});
  return req.url;
}

describe('vocabAlias', () => {
  it('[BEHAVIOR] /value-streams → /journeys（裸路径）', () => {
    expect(run('/value-streams')).toBe('/journeys');
  });

  it('[BEHAVIOR] 子路径与查询串保留：/capabilities/abc?x=1 → /golden-paths/abc?x=1', () => {
    expect(run('/capabilities/abc?x=1')).toBe('/golden-paths/abc?x=1');
  });

  it('[BEHAVIOR] 查询串直挂：/acceptance-criteria?journey_id=j1 → /journey_step_links?journey_id=j1', () => {
    expect(run('/acceptance-criteria?journey_id=j1')).toBe('/journey_step_links?journey_id=j1');
  });

  it('[BEHAVIOR] 旧路径与无关路径原样放行', () => {
    expect(run('/journeys')).toBe('/journeys');
    expect(run('/value-streams-x')).toBe('/value-streams-x');
    expect(run('/tasks?status=queued')).toBe('/tasks?status=queued');
  });

  it('六组映射齐全', () => {
    expect([...ALIAS_MAP.keys()].sort()).toEqual([
      '/acceptance-criteria', '/backbone-activities', '/capabilities',
      '/features-registry', '/value-streams', '/work-items',
    ]);
  });
});
