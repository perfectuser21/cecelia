// 金标集 v0 + LLM 判定器 eval 通过率棘轮 —— 冻结契约测试（TDD RED）
// 本文件在 sprints/<sprint>/tests/ 下冻结（v9.27 死规则要求），root vitest include 覆盖。
// 绑定真实模块：packages/quality/eval/gold-eval.mjs（本 sprint 新建）+
//              packages/brain/src/harness-judge.js 的 arbitrateContractAppeal（既有真实 fail-closed 原语）。
// 禁 mock 被改的边：eval 聚合器 ↔ 判定器决策路径（真调 classifyToOutcome/fail-closed 逻辑，
//   只允许 spy/inject 最外层 LLM vision client 计数）；eval ↔ 棘轮阈值文件（真读写临时文件）。
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 真实 eval 模块（本 sprint 新建，未实现前 import 即 RED）
import {
  loadGoldSet,
  classifyToOutcome,
  readThreshold,
  applyRatchet,
  memoizeClassify,
  lintSkillContracts,
  runEval,
} from '../../../packages/quality/eval/gold-eval.mjs';

// 既有真实判定器 fail-closed 原语（harness-judge.js）
import { arbitrateContractAppeal } from '../../../packages/brain/src/harness-judge.js';

function seedGoldFixtures(dir: string) {
  mkdirSync(dir, { recursive: true });
  // 金标集 v0：五类标注（用户列表页=true；桌面/计算器/搜索历史/联想页=false）
  const manifest = {
    version: 'v0',
    items: [
      { id: 'g1-user-list', category: '用户列表页', label: true },
      { id: 'g2-desktop', category: '桌面', label: false },
      { id: 'g3-calculator', category: '计算器', label: false },
      { id: 'g4-search-history', category: '搜索历史', label: false },
      { id: 'g5-suggestion', category: '联想页', label: false },
    ],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

describe('金标集 v0 fixtures 与序列固化 [BEHAVIOR]', () => {
  it('loadGoldSet 返回 5 类标注且用户列表页为 true 其余为 false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-'));
    try {
      seedGoldFixtures(dir);
      const set = loadGoldSet(dir);
      expect(set.length).toBe(5);
      const byId = Object.fromEntries(set.map((x: any) => [x.id, x.label]));
      expect(byId['g1-user-list']).toBe(true);
      expect(byId['g2-desktop']).toBe(false);
      expect(byId['g3-calculator']).toBe(false);
      expect(byId['g4-search-history']).toBe(false);
      expect(byId['g5-suggestion']).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runEval 迭代顺序固化按 id 升序稳定不随判定结果变化', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-'));
    const tf = join(dir, 'threshold.json');
    try {
      seedGoldFixtures(dir);
      writeFileSync(tf, JSON.stringify({ pass_rate_threshold: 0 }));
      const r = runEval({ fixturesDir: dir, thresholdFile: tf, classify: (it: any) => it.label });
      expect(r.items.map((x: any) => x.id)).toEqual([
        'g1-user-list', 'g2-desktop', 'g3-calculator', 'g4-search-history', 'g5-suggestion',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空金标集 loadGoldSet 抛错防空集假绿', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-empty-'));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 'v0', items: [] }));
      expect(() => loadGoldSet(dir)).toThrow(/gold_set_empty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('视觉 null 必 fail-closed [BEHAVIOR]', () => {
  it('classifyToOutcome null 判 fail 且标记 failClosed 不当 pass', () => {
    expect(classifyToOutcome(null)).toEqual({ passed: false, failClosed: true });
    expect(classifyToOutcome(undefined)).toEqual({ passed: false, failClosed: true });
    // 正常布尔不触发 fail-closed
    expect(classifyToOutcome(true)).toEqual({ passed: true, failClosed: false });
    expect(classifyToOutcome(false)).toEqual({ passed: false, failClosed: false });
  });

  it('真实判定器 arbitrateContractAppeal 非布尔返回退化为 upheld null（真实 fail-closed 原语）', async () => {
    const r = await arbitrateContractAppeal({}, { llmFn: async () => ({ nonsense: 1 }) });
    expect(r.upheld).toBeNull();
    const r2 = await arbitrateContractAppeal({}, { llmFn: async () => { throw new Error('unavailable'); } });
    expect(r2.upheld).toBeNull();
  });

  it('runEval 中判定器返回 null 的条目计入失败率而非放行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-'));
    const tf = join(dir, 'threshold.json');
    try {
      seedGoldFixtures(dir);
      writeFileSync(tf, JSON.stringify({ pass_rate_threshold: 0 }));
      // g1 判定器返回 null（视觉不可用）→ 必须 fail-closed，不得因 label=true 而放行
      const r = runEval({
        fixturesDir: dir, thresholdFile: tf,
        classify: (it: any) => (it.id === 'g1-user-list' ? null : it.label),
      });
      const g1 = r.items.find((x: any) => x.id === 'g1-user-list');
      expect(g1.passed).toBe(false);
      expect(g1.failClosed).toBe(true);
      expect(r.passed).toBe(4); // g1 fail-closed，其余 4 条判对
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('缓存命中零视觉调用防成本回归 [BEHAVIOR]', () => {
  it('memoizeClassify 缓存命中时底层判定器零调用', () => {
    const cache = new Map<string, any>();
    let calls = 0;
    const spy = (item: any) => { calls += 1; return item.label; };
    const memo = memoizeClassify(spy, cache);
    const item = { id: 'g1-user-list', label: true };
    expect(memo(item)).toBe(true);
    expect(calls).toBe(1);
    // 第二次同 id → 缓存命中 → 底层零调用
    expect(memo(item)).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('棘轮阈值单调只升 [BEHAVIOR]', () => {
  it('applyRatchet 通过率更高才抬高阈值，更低时不下调', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
    const tf = join(dir, 'threshold.json');
    try {
      writeFileSync(tf, JSON.stringify({ pass_rate_threshold: 0.6 }));
      const up = applyRatchet(tf, 0.8);
      expect(up.ratcheted).toBe(true);
      expect(up.next).toBe(0.8);
      expect(readThreshold(tf)).toBe(0.8);
      // 更低通过率不得下调
      const down = applyRatchet(tf, 0.5);
      expect(down.ratcheted).toBe(false);
      expect(down.next).toBe(0.8);
      expect(readThreshold(tf)).toBe(0.8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runEval 通过率低于阈值时 gate 判 fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-'));
    const tf = join(dir, 'threshold.json');
    try {
      seedGoldFixtures(dir);
      writeFileSync(tf, JSON.stringify({ pass_rate_threshold: 1 }));
      // 让 g1 判错 → pass_rate=0.8 < 阈值 1 → gate fail
      const r = runEval({
        fixturesDir: dir, thresholdFile: tf,
        classify: (it: any) => (it.id === 'g1-user-list' ? false : it.label),
      });
      expect(r.pass_rate).toBeCloseTo(0.8, 5);
      expect(r.gate).toBe('fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('契约完备性 lint 每技能必有 pre post side_effects [BEHAVIOR]', () => {
  it('lintSkillContracts 缺 pre post side_effects 任一即 fail', () => {
    const good = [{ skill: 'a', pre: 'x', post: 'y', side_effects: 'z' }];
    expect(lintSkillContracts(good).ok).toBe(true);
    const missing = [{ skill: 'b', pre: 'x', post: 'y' }];
    const res = lintSkillContracts(missing);
    expect(res.ok).toBe(false);
    expect(res.missing).toContainEqual({ skill: 'b', field: 'side_effects' });
  });

  it('仓库 skill-contracts.json fixture lint 全绿', () => {
    const url = new URL('../../../packages/quality/eval/skill-contracts.json', import.meta.url);
    const contracts = JSON.parse(readFileSync(url, 'utf8'));
    expect(lintSkillContracts(contracts).ok).toBe(true);
  });
});
