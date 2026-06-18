/**
 * Lifecycle 纯逻辑契约测试 — Harness Pipeline Cockpit Phase 2（全生命周期 read-only 视图）
 *
 * TDD Red：实现前 `apps/dashboard/src/pages/harness-pipeline/lifecycle.ts` 不存在，
 * import 直接失败 → 全部用例红。实现后转绿。
 *
 * 在 node env（根 vitest.config.js include sprints/**）下运行——故只测纯函数/常量，
 * 不引入 React / DOM（DOM 级断言在 apps/dashboard 的 happy-dom 测试里）。
 *
 * 覆盖 Golden Path：
 *  - Step 1: 七项分区按生命周期顺序
 *  - Step 3: 缺失项「未到该步」占位、有源项 markdown、decisions 空「暂无决策」
 *  - Step 4: 占位文案绝不为「文件不存在」
 *  - Step 5: 单项取数失败 → 降级占位
 */

import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_SECTIONS,
  NOT_REACHED,
  selectSectionContent,
  type LifecycleSources,
} from '../../../apps/dashboard/src/pages/harness-pipeline/lifecycle';

const EXPECTED_KEYS = [
  'prep_prd',
  'sprint_prd',
  'contract',
  'dod',
  'decisions',
  'progress',
  'report',
];

describe('Lifecycle 契约 [BEHAVIOR]', () => {
  it('七项分区按生命周期顺序', () => {
    expect(LIFECYCLE_SECTIONS).toHaveLength(7);
    expect(LIFECYCLE_SECTIONS.map((s) => s.key)).toEqual(EXPECTED_KEYS);
    // 每项有非空 label
    for (const s of LIFECYCLE_SECTIONS) {
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
    }
    // 占位常量字面值锁定
    expect(NOT_REACHED).toBe('未到该步');
  });

  it('缺失项返回未到该步占位', () => {
    // 全空 sources → 每项都是 placeholder
    const empty: LifecycleSources = {};
    for (const { key } of LIFECYCLE_SECTIONS) {
      const c = selectSectionContent(key, empty);
      expect(c.kind).toBe('placeholder');
    }
    // 有源项 → markdown
    const prep = selectSectionContent('prep_prd', { prepPrdBody: '# Prep\n\n正文' });
    expect(prep.kind).toBe('markdown');
    if (prep.kind === 'markdown') expect(prep.body).toContain('# Prep');

    const prd = selectSectionContent('sprint_prd', { prdContent: '# PRD' });
    expect(prd.kind).toBe('markdown');

    const contract = selectSectionContent('contract', { contractContent: '## Contract' });
    expect(contract.kind).toBe('markdown');

    // decisions 空数组 → 占位，且文案为「暂无决策」语义化
    const noDec = selectSectionContent('decisions', { decisions: [] });
    expect(noDec.kind).toBe('placeholder');
    if (noDec.kind === 'placeholder') expect(noDec.text).toContain('决策');

    // decisions 有行 → markdown
    const dec = selectSectionContent('decisions', {
      decisions: [{ id: 'd1', decision: '采用 DB 读取' }],
    });
    expect(dec.kind).toBe('markdown');
  });

  it('取数失败降级占位', () => {
    // 即便该项原本有内容，errors[key]=true（fetch 失败）也降级为占位，绝不抛错
    const sources: LifecycleSources = {
      contractContent: '## Contract 本应有内容',
      errors: { contract: true },
    };
    const c = selectSectionContent('contract', sources);
    expect(c.kind).toBe('placeholder');
    if (c.kind === 'placeholder') expect(c.text).toBe(NOT_REACHED);
  });

  it('占位文案绝不为文件不存在', () => {
    // 遍历所有分区 × 空源 / 失败源，占位文案永不等于旧死字
    const cases: LifecycleSources[] = [
      {},
      { errors: Object.fromEntries(EXPECTED_KEYS.map((k) => [k, true])) },
    ];
    for (const src of cases) {
      for (const { key } of LIFECYCLE_SECTIONS) {
        const c = selectSectionContent(key, src);
        if (c.kind === 'placeholder') {
          expect(c.text).not.toContain('文件不存在');
        }
      }
    }
  });
});
