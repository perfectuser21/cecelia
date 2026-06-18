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
 *  - Step 5: 单项取数失败 → 降级为「取数失败」占位（Risk(a)/(b)：区别于「未到该步」）
 *  - Risk(c): DoD/Report 独立 source 字段，selectSectionContent 不从 contract 切段冒充
 */

import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_SECTIONS,
  NOT_REACHED,
  FETCH_FAILED,
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
    expect(FETCH_FAILED).toBe('取数失败');
  });

  it('缺失项返回未到该步占位', () => {
    // 全空 sources → 每项都是 placeholder
    const empty: LifecycleSources = {};
    for (const { key } of LIFECYCLE_SECTIONS) {
      const c = selectSectionContent(key, empty);
      expect(c.kind).toBe('placeholder');
    }
    // 有源项 → markdown（七项各自的专属 source 字段）
    const prep = selectSectionContent('prep_prd', { prepPrdBody: '# Prep\n\n正文' });
    expect(prep.kind).toBe('markdown');
    if (prep.kind === 'markdown') expect(prep.body).toContain('# Prep');

    const prd = selectSectionContent('sprint_prd', { prdContent: '# PRD' });
    expect(prd.kind).toBe('markdown');

    const contract = selectSectionContent('contract', { contractContent: '## Contract' });
    expect(contract.kind).toBe('markdown');

    // —— Reviewer 非阻塞项：补 dod/progress/report 三项 selectSectionContent 用例，对齐七项声明 ——
    const dod = selectSectionContent('dod', { dodContent: '## DoD\n- [ ] x' });
    expect(dod.kind).toBe('markdown');

    const progress = selectSectionContent('progress', {
      progress: { pct: 50, current_node: 'evaluate' },
    });
    expect(progress.kind).toBe('markdown');

    const report = selectSectionContent('report', { reportContent: '# Report\n\n结论' });
    expect(report.kind).toBe('markdown');

    // decisions 空数组 → 占位，且文案为「暂无决策」语义化（≠ 未到该步 ≠ 取数失败）
    const noDec = selectSectionContent('decisions', { decisions: [] });
    expect(noDec.kind).toBe('placeholder');
    if (noDec.kind === 'placeholder') expect(noDec.text).toContain('决策');

    // decisions 有行 → markdown
    const dec = selectSectionContent('decisions', {
      decisions: [{ id: 'd1', decision: '采用 DB 读取' }],
    });
    expect(dec.kind).toBe('markdown');
  });

  it('取数失败与未到该步占位分流', () => {
    // Risk(a)/(b)：取数失败必须用专属文案「取数失败」，与「未到该步」字面分离，
    // 否则接线错误（如 /initiative/:id/detail 404）会被静默伪装成正常占位。
    const sources: LifecycleSources = {
      contractContent: '## Contract 本应有内容',
      errors: { contract: true },
    };
    const c = selectSectionContent('contract', sources);
    expect(c.kind).toBe('placeholder');
    if (c.kind === 'placeholder') {
      expect(c.text).toBe(FETCH_FAILED);
      // 关键断言：两类占位字面不相等，接线失败不可伪装成「未到该步」
      expect(c.text).not.toBe(NOT_REACHED);
    }

    // 对照：取数成功但无内容 → 仍是「未到该步」
    const ok = selectSectionContent('contract', {});
    expect(ok.kind).toBe('placeholder');
    if (ok.kind === 'placeholder') expect(ok.text).toBe(NOT_REACHED);
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

  it('DoD 不从 contract 字符串切段冒充（Risk c）', () => {
    // Risk(c) mitigation：selectSectionContent 是纯映射（key → 专属 source 字段），
    // 只给 contractContent、不给 dodContent 时，dod 分区必须是占位，
    // 绝不从 contract 大块文本里正则抠 DoD 段冒充内容。
    const dod = selectSectionContent('dod', { contractContent: '## Contract\n### DoD\n- [ ] a' });
    expect(dod.kind).toBe('placeholder');
    if (dod.kind === 'placeholder') expect(dod.text).toBe(NOT_REACHED);

    // 同理 report 不从 contract/其他字段偷
    const report = selectSectionContent('report', { contractContent: '## Contract' });
    expect(report.kind).toBe('placeholder');
  });
});
