import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { battleEffects, resetBattleEffects } from './helpers/battle-report-effects.js';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { buildBattleReportData, renderBattleReportMarkdown, renderBattleReportHTML, ADMISSION_DENY_REASONS } from '../battle-report.js';

beforeEach(() => {
  resetBattleEffects();
  expect(execFileSync).toBe(battleEffects.execFileSync);
  expect(writeFileSync).toBe(battleEffects.writeFileSync);
});
afterEach(() => { expect(battleEffects.unexpected).not.toHaveBeenCalled(); });

describe('军师节 v2 渲染（GP6/T6）', () => {
  const base = { mergedPrs: [], journeyRuns: [], userDecisions: [], sentinel: { jobs: [], expected: null, healthy: false }, unconfirmedActions: [] };
  const emptyGp = { isMonday: true, candidates: [], converged: [], autoReleases: [], firstRelease: false, stock: [], dispatchLedger: [], gapPanorama: null };

  it('B1: 四段标题恒在，空态各渲染暂无，验货台段不存在', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: emptyGp });
    expect(md).toContain('## 军师决策节 v2');
    expect(md).toMatch(/### 方向圈选段[^\n]*\n暂无/);
    expect(md).toMatch(/### GP 批审段\n暂无/);
    expect(md).toMatch(/### 报备段[^\n]*\n暂无/);
    expect(md).toMatch(/### GP 库存水位段\n暂无/);
    expect(md).not.toContain('验货台');
    // v1 军师决策节（notes 明细）已被 v2 取代，不再渲染
    expect(md).not.toContain('## 军师决策（24h）');
  });

  it('B1 兜底: goldenPathMode=null / 缺省（旧形状）四段仍渲染暂无且不炸', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: null });
    expect(md).toMatch(/### GP 库存水位段\n暂无/);
    expect(() => renderBattleReportMarkdown(base)).not.toThrow();
  });

  it('非周一：圈选段渲染每周一更新，候选不列出、不计入需动作', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp, isMonday: false, candidates: [{ id: 'c1', title: '候选甲', one_liner: 'x' }] } });
    expect(md).toContain('本段每周一更新');
    expect(md).not.toContain('候选甲');
  });

  it('周一：候选带编号 + 缺口全景列出', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      candidates: [{ id: 'c1', title: '候选甲', one_liner: '一句话', est_scale: '约1周' }],
      gapPanorama: { generated_at: 't', gaps: [{ kr_id: 'k1', kr_title: 'KR甲', reason: '本周无候选覆盖' }] },
    } });
    expect(md).toMatch(/【圈选 1】候选甲 — 一句话（约1周）/);
    expect(md).toContain('OKR 缺口全景');
    expect(md).toContain('KR甲：本周无候选覆盖');
  });

  it('批审段：新型排前逐行、全先例折叠为一行', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      converged: [
        { id: 'g1', title: '先例GP', demo_url: null, has_novel: false },
        { id: 'g2', title: '新型GP', demo_url: 'http://d/2', has_novel: true },
      ],
    } });
    expect(md.indexOf('新型GP')).toBeLessThan(md.indexOf('先例GP'));
    expect(md).toMatch(/【批审·新型判定点】新型GP — http:\/\/d\/2/);
    expect(md).toMatch(/【批审·全先例】先例GP（1 条快速过）/);
  });

  it('报备段：否决窗倒计时（被动知情）+ 昨日自动派工台账', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      autoReleases: [{ id: 'g3', title: '报备GP', veto_deadline: new Date('2026-07-13T06:00:00Z') }],
      firstRelease: false,
      dispatchLedger: [{ title: '[自动派工] 修复X', status: 'queued', created_at: new Date('2026-07-12T02:00:00Z') }],
    } });
    expect(md).toMatch(/报备GP（否决窗至 07-13 14:00，不否决即生效）/);
    expect(md).toMatch(/\[自动派工\] 修复X（queued，07-12 10:00）/);
  });

  it('B4: 9 条需动作 → 恰 7 条 + 溢出顺延 2 条（截掉最低优先级圈选尾部），报备被动条目不占 7', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      converged: [1, 2, 3].map((i) => ({ id: `n${i}`, title: `新型${i}`, demo_url: null, has_novel: true })),
      autoReleases: [1, 2].map((i) => ({ id: `r${i}`, title: `首放${i}`, veto_deadline: new Date('2026-07-13T06:00:00Z') })),
      firstRelease: true,
      candidates: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, title: `候选${i}`, one_liner: 'x' })),
    } });
    // 9 条需动作：新型3 + 首次放行2 + 圈选4 → 保 7（新型3+首放2+圈选1/2），截圈选3/4
    expect(md).toContain('【圈选 2】');
    expect(md).not.toContain('【圈选 3】');
    expect(md).not.toContain('【圈选 4】');
    expect(md).toMatch(/2 条顺延次日（堆积水位 2）/);
    expect((md.match(/【圈选|【批审|【首次放行/g) || []).length).toBe(7);
  });

  it('首次放行条目被 ≤7 截断 → 回落为被动否决窗行，时间敏感信息不丢失', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      converged: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `n${i}`, title: `新型${i}`, demo_url: null, has_novel: true })),
      autoReleases: [{ id: 'r1', title: '首放GP', veto_deadline: new Date('2026-07-13T06:00:00Z') }],
      firstRelease: true,
    } });
    // 8 条新型占满 7 席（截 1），首次放行动作被截 → 不出现【首次放行】但被动行仍在
    expect(md).not.toContain('【首次放行】');
    expect(md).toMatch(/首放GP（否决窗至 07-13 14:00，不否决即生效）/);
    expect(md).toMatch(/2 条顺延次日/);
  });

  it('≤7 未超限时无顺延行', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      candidates: [{ id: 'c1', title: '候选甲', one_liner: 'x' }],
    } });
    expect(md).not.toContain('顺延次日');
  });

  it('B7: 水位段计数与 GROUP BY fixture 一致，rejected/blocked_gate 带原因', () => {
    const md = renderBattleReportMarkdown({ ...base, goldenPathMode: { ...emptyGp,
      stock: [
        { status: 'candidate', count: 2, latest_reason: null },
        { status: 'converged', count: 1, latest_reason: null },
        { status: 'rejected', count: 1, latest_reason: '与现有GP重复' },
        { status: 'blocked_gate', count: 1, latest_reason: '闸门X卡住' },
      ],
    } });
    expect(md).toMatch(/candidate 2 · converged 1 · rejected 1（与现有GP重复） · blocked_gate 1（闸门X卡住）/);
  });
});

describe('renderBattleReportHTML — PPT 卡片式 HTML 渲染', () => {
  const baseData = {
    mergedPrs: [],
    journeyRuns: [],
    userDecisions: [],
    sentinel: { jobs: [], expected: null, healthy: false },
    unconfirmedActions: [],
    goldenPathMode: null,
  };
  const day = '2026-07-14';

  it('输出完整 HTML 文档（含 doctype、title、统计区）', () => {
    const html = renderBattleReportHTML(baseData, day);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('作战日报 2026-07-14');
    expect(html).toContain('class="hero"');
    expect(html).toContain('class="stats-row"');
  });

  it('各线战况：有 run 时渲染进度条 chip，成功率着色正确', () => {
    const data = {
      ...baseData,
      journeyRuns: [
        { journey_name: 'Line 05', runs: 4, done: 4, failed: 0, success_rate: 1, last_failure: null },
        { journey_name: 'Line 07', runs: 3, done: 1, failed: 2, success_rate: 0.33, last_failure: 'timeout' },
      ],
    };
    const html = renderBattleReportHTML(data, day);
    expect(html).toContain('class="line-chip"');
    expect(html).toContain('ok-bg');
    expect(html).toContain('bad-bg');
    expect(html).toContain('100%');
    expect(html).toContain('33%');
  });

  it('空 run 时渲染 empty 占位', () => {
    const html = renderBattleReportHTML(baseData, day);
    expect(html).toContain('24h 内无 run 记录');
  });

  it('哨兵：健康 job 渲染 s-ok pill，过期 job 渲染 s-warn', () => {
    const data = {
      ...baseData,
      sentinel: {
        healthy: true,
        expected: 2,
        jobs: [
          { name: 'arch-review', ok: true, age_seconds: 100 },
          { name: 'daily-backup', ok: true, age_seconds: 2000 },
        ],
      },
    };
    const html = renderBattleReportHTML(data, day);
    expect(html).toContain('s-ok');
    expect(html).toContain('s-warn');
    expect(html).toContain('arch-review');
    expect(html).toContain('daily-backup');
  });

  it('XSS 转义：PR 标题含 HTML 字符时安全输出', () => {
    const data = {
      ...baseData,
      mergedPrs: [{ pr_title: '<script>alert(1)</script>', pr_url: null }],
    };
    const html = renderBattleReportHTML(data, day);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('用户决策超 8 条时显示折叠按钮', () => {
    const data = {
      ...baseData,
      userDecisions: Array.from({ length: 10 }, (_, i) => ({
        topic: `决策 ${i + 1}`,
        created_at: new Date('2026-07-14T00:00:00Z'),
      })),
    };
    const html = renderBattleReportHTML(data, day);
    expect(html).toContain('hiddenDecs');
    expect(html).toContain('展开另外 2 条');
  });

  it('GP 批审桌：有 converged GP 时渲染 tag-review 标签', () => {
    const data = {
      ...baseData,
      goldenPathMode: {
        isMonday: false,
        candidates: [],
        converged: [{ id: 'g1', title: '新型GP', demo_url: null, has_novel: true }],
        autoReleases: [],
        firstRelease: false,
        stock: [],
        dispatchLedger: [],
        gapPanorama: null,
      },
    };
    const html = renderBattleReportHTML(data, day);
    expect(html).toContain('tag-review');
    expect(html).toContain('新型GP');
  });

  it('暗色主题 CSS 变量存在', () => {
    const html = renderBattleReportHTML(baseData, day);
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('--bg:#0f1520');
  });
});

describe('admission 吞吐段（T2，de6d3582）', () => {
  it('buildBattleReportData：派发数/拒发原因/容器峰值 落到 data.admission', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/dispatch_events/.test(sql) && /event_type = 'dispatched'/.test(sql)) {
          return { rows: [{ n: 12 }] };
        }
        if (/dispatch_events/.test(sql) && /failed_dispatch/.test(sql)) {
          return { rows: [{ reason: 'cap_reached', count: 3 }] };
        }
        if (/working_memory/.test(sql) && /machine_vitals_daily_peak/.test(sql)) {
          return { rows: [{ value_json: { date: '2026-07-17', peak: 4 } }] };
        }
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);

    expect(data.admission.dispatched_24h).toBe(12);
    expect(data.admission.denies).toEqual([{ reason: 'cap_reached', count: 3 }]);
    expect(data.admission.peak).toEqual({ date: '2026-07-17', peak: 4 });
    expect(data.admission).toHaveProperty('vitals');

    // 拒发原因白名单必须走 SQL IN 参数，用导出常量断言
    const denyCall = pool.query.mock.calls.find(([sql]) => /failed_dispatch/.test(sql));
    expect(denyCall[1]).toEqual([ADMISSION_DENY_REASONS]);
  });

  it('render 有数据：段标题 + 派发次数 + 拒发原因明细 + 容器峰值', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [], journeyRuns: [], userDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
      admission: {
        dispatched_24h: 12,
        denies: [{ reason: 'cap_reached', count: 3 }],
        peak: { date: '2026-07-17', peak: 4 },
        vitals: null,
      },
    });
    expect(md).toContain('## Harness admission 吞吐（24h）');
    expect(md).toMatch(/派发 12 次/);
    expect(md).toMatch(/cap_reached: 3/);
    expect(md).toMatch(/容器峰值 4/);
  });

  it('render 全空（dispatched=0/denies=[]/peak=null）→ 段内渲染暂无', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [], journeyRuns: [], userDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
      admission: { dispatched_24h: 0, denies: [], peak: null, vitals: null },
    });
    const idx = md.indexOf('## Harness admission 吞吐（24h）');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(md.slice(idx)).toMatch(/^## Harness admission 吞吐（24h）\n暂无/);
  });
});
