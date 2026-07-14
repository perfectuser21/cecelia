import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

vi.mock('../receipt-collector.js', () => ({
  getUnconfirmedReceipts: vi.fn().mockResolvedValue([]),
}));

import {
  isInBattleReportWindow,
  alreadyGeneratedToday,
  buildBattleReportData,
  renderBattleReportMarkdown,
  renderBattleReportHTML,
  generateBattleReport,
  maybeGenerateBattleReport,
  hasNovelJudgment,
} from '../battle-report.js';
import { sendFeishu } from '../notifier.js';
import { getUnconfirmedReceipts } from '../receipt-collector.js';

/** mock pool：INSERT design_docs 返回 id，其余空行 */
function makePool({ insertedId = 'doc-1' } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/INSERT INTO design_docs/i.test(sql)) {
        return { rows: [{ id: insertedId }] };
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isInBattleReportWindow — UTC 22:00-22:05 = 北京 06:00-06:05', () => {
  it('UTC 21:59 → false', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 21, 59)))).toBe(false);
  });
  it('UTC 22:00 → true', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 0)))).toBe(true);
  });
  it('UTC 22:04 → true', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 4)))).toBe(true);
  });
  it('UTC 22:05 → false', () => {
    expect(isInBattleReportWindow(new Date(Date.UTC(2026, 6, 7, 22, 5)))).toBe(false);
  });
});

describe('alreadyGeneratedToday — design_docs 20h 去重', () => {
  it('20h 内已有 battle_report → true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyGeneratedToday(pool)).resolves.toBe(true);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/design_docs/);
    expect(sql).toMatch(/battle_report/);
    expect(sql).toMatch(/20 hours/);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyGeneratedToday(pool)).resolves.toBe(false);
  });
});

describe('buildBattleReportData — 24h 窗口四段', () => {
  it('发出四段查询且形状正确', async () => {
    const pool = makePool();
    const data = await buildBattleReportData(pool);

    const sqls = pool.query.mock.calls.map(([sql]) => sql);

    // ① merged PR：dev_records + 24h 窗口
    const prSql = sqls.find((s) => /dev_records/.test(s));
    expect(prSql).toBeTruthy();
    expect(prSql).toMatch(/merged_at/);
    expect(prSql).toMatch(/24 hours/);

    // ② 按线 run：JOIN journeys 排孤儿 + smoke-% 过滤 + 24h 窗口
    const runSql = sqls.find((s) => /initiative_runs/.test(s));
    expect(runSql).toBeTruthy();
    expect(runSql).toMatch(/JOIN journeys/);
    expect(runSql).toMatch(/smoke-%/);
    expect(runSql).toMatch(/24 hours/);

    // ③ 用户决策：made_by='user' + 24h 窗口
    const decSql = sqls.find((s) => /FROM decisions/.test(s));
    expect(decSql).toBeTruthy();
    expect(decSql).toMatch(/made_by\s*=\s*'user'/);
    expect(decSql).toMatch(/24 hours/);

    // ④ 哨兵：working_memory + scheduler_job_last_run 前缀参数
    const sentinelIdx = sqls.findIndex((s) => /working_memory/.test(s));
    expect(sentinelIdx).toBeGreaterThanOrEqual(0);
    const sentinelParams = pool.query.mock.calls[sentinelIdx][1];
    expect(sentinelParams).toContain('scheduler_job_last_run:%');

    expect(data).toMatchObject({
      mergedPrs: [],
      journeyRuns: [],
      userDecisions: [],
    });
    expect(data.sentinel).toHaveProperty('jobs');
    expect(data.sentinel).toHaveProperty('healthy');
  });

  it('哨兵 ok&&age<=1800 口径（同 routes/sentinel.js）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/working_memory/.test(sql)) {
          return {
            rows: [
              { key: 'scheduler_jobs_expected', value_json: { count: 2 }, age_seconds: 10 },
              { key: 'scheduler_job_last_run:a', value_json: { ok: true, at: 't' }, age_seconds: 100 },
              { key: 'scheduler_job_last_run:b', value_json: { ok: true, at: 't' }, age_seconds: 2000 },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.sentinel.expected).toBe(2);
    expect(data.sentinel.jobs).toHaveLength(2);
    // b 过期（age 2000 > 1800）→ 整体不健康
    expect(data.sentinel.healthy).toBe(false);
  });
});

describe('renderBattleReportMarkdown — L1 Summary 四段', () => {
  it('四段标题齐全，有数据段渲染条目', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [{ pr_title: '修复 X', pr_url: 'https://github.com/p/1' }],
      journeyRuns: [{ journey_name: 'Line 05', runs: 3, done: 2, failed: 1, last_failure: 'boom' }],
      userDecisions: [{ topic: '决定 Y', created_at: new Date('2026-07-07T00:00:00Z') }],
      sentinel: {
        expected: 1,
        healthy: true,
        jobs: [{ name: 'arch-review', ok: true, age_seconds: 60 }],
      },
    });
    expect(md).toMatch(/合并 PR/);
    expect(md).toMatch(/各线战况|按线/);
    expect(md).toMatch(/用户决策/);
    expect(md).toMatch(/哨兵/);
    expect(md).toMatch(/修复 X/);
    expect(md).toMatch(/Line 05/);
    expect(md).toMatch(/决定 Y/);
    // 决策时间渲染为上海短格式 MM-DD HH:mm（UTC 00:00 = 上海 08:00），不泄漏 Date 默认英文串
    expect(md).toMatch(/07-07 08:00/);
    expect(md).not.toMatch(/GMT/);
    expect(md).toMatch(/arch-review/);
  });

  it('空段渲染"暂无"（dev_records 断供容忍）', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [],
      journeyRuns: [],
      userDecisions: [],
      sentinel: { expected: null, healthy: false, jobs: [] },
    });
    expect((md.match(/暂无/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('generateBattleReport — 落库 + 飞书', () => {
  it('INSERT design_docs 参数含 battle_report/上海日 title/area/author，飞书带链接', async () => {
    const pool = makePool({ insertedId: 'abc-1' });
    const result = await generateBattleReport(pool);

    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO design_docs/i.test(sql));
    expect(insertCall).toBeTruthy();
    const [insertSql, params] = insertCall;
    expect(insertSql).toMatch(/RETURNING id/i);
    expect(params).toContain('battle_report');
    expect(params).toContain('cecelia');
    const title = params.find((p) => typeof p === 'string' && p.startsWith('作战日报 '));
    expect(title).toMatch(/^作战日报 \d{4}-\d{2}-\d{2}$/);
    // diary_date 与 title 同一上海日
    const day = title.slice('作战日报 '.length);
    expect(params).toContain(day);

    expect(sendFeishu).toHaveBeenCalledTimes(1);
    expect(sendFeishu.mock.calls[0][0]).toContain(
      'http://perfect21:5211/reports/abc-1?source=design_docs'
    );
    expect(result.id).toBe('abc-1');
  });

  it('sendFeishu reject 不抛不回滚，仍返回 id', async () => {
    sendFeishu.mockRejectedValueOnce(new Error('feishu down'));
    const pool = makePool({ insertedId: 'abc-2' });
    const result = await generateBattleReport(pool);
    expect(result.id).toBe('abc-2');
  });

  it('sendFeishu 返回 false 也不影响结果', async () => {
    sendFeishu.mockResolvedValueOnce(false);
    const pool = makePool({ insertedId: 'abc-3' });
    const result = await generateBattleReport(pool);
    expect(result.id).toBe('abc-3');
  });
});

describe('maybeGenerateBattleReport — 窗口 + 去重自 gate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口外 → skipped，不查库', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 12, 0)));
    const pool = makePool();
    const result = await maybeGenerateBattleReport(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'outside_window' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('窗口内但当日已生成 → skipped already_generated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 22, 1)));
    const pool = {
      query: vi.fn(async (sql) => {
        if (/design_docs/.test(sql) && /SELECT/i.test(sql)) return { rows: [{ '?column?': 1 }] };
        return { rows: [] };
      }),
    };
    const result = await maybeGenerateBattleReport(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'already_generated' });
    expect(sendFeishu).not.toHaveBeenCalled();
  });

  it('窗口内且未生成 → 真生成', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 7, 22, 1)));
    const pool = makePool({ insertedId: 'gen-1' });
    const result = await maybeGenerateBattleReport(pool);
    expect(result.skipped).toBeFalsy();
    expect(result.id).toBe('gen-1');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });
});

describe('未确认动作段（T4）', () => {
  it('buildBattleReportData 调 getUnconfirmedReceipts 并透传结果', async () => {
    const receipts = [
      { kind: 'deploy', target: 'production', receipt_status: 'timeout', sent_at: new Date('2026-07-10T12:00:00Z') },
    ];
    getUnconfirmedReceipts.mockResolvedValueOnce(receipts);
    const pool = makePool();
    const data = await buildBattleReportData(pool);
    expect(getUnconfirmedReceipts).toHaveBeenCalledWith(pool);
    expect(data.unconfirmedActions).toEqual(receipts);
  });

  it('查询抛错 → 降级空数组不炸', async () => {
    getUnconfirmedReceipts.mockRejectedValueOnce(new Error('boom'));
    const pool = makePool();
    const data = await buildBattleReportData(pool);
    expect(data.unconfirmedActions).toEqual([]);
  });

  it('渲染：有未确认动作 → 列出 kind/target/status', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [], journeyRuns: [], userDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
      unconfirmedActions: [
        { kind: 'feishu', target: 'webhook', receipt_status: 'timeout', sent_at: new Date('2026-07-10T12:00:00Z') },
      ],
    });
    expect(md).toContain('## 未确认动作（24h）');
    expect(md).toMatch(/feishu → webhook：timeout/);
  });

  it('渲染：无未确认动作 → 暂无；字段缺省（旧数据形状）不炸', () => {
    const base = {
      mergedPrs: [], journeyRuns: [], userDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
    };
    const md = renderBattleReportMarkdown({ ...base, unconfirmedActions: [] });
    expect(md).toContain('## 未确认动作（24h）');
    expect(() => renderBattleReportMarkdown(base)).not.toThrow();
  });
});

describe('hasNovelJudgment — 判定点登记表解析（设计文档实现级决策1）', () => {
  const doc = (rows) => `# 提案\n\n## 判定点登记表\n\n| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n## 下一节\n`;

  it('proposal_doc 为空 → true（保守视为新型）', () => {
    expect(hasNovelJudgment(null)).toBe(true);
    expect(hasNovelJudgment('')).toBe(true);
  });
  it('无判定点登记表 → true', () => {
    expect(hasNovelJudgment('# 提案\n只有正文')).toBe(true);
  });
  it('登记表仅 N/A 行 → false（无接缝判定点）', () => {
    expect(hasNovelJudgment(doc(['| （本任务无接缝判定点，N/A） | | | | |']))).toBe(false);
  });
  it('所有行含先例 decision uuid → false（全先例折叠）', () => {
    expect(hasNovelJudgment(doc([
      '| J1 | A/B | A | 先例 3f2a1b04-0000-4000-8000-000000000001 | 轻 |',
      '| J2 | C | C | 引用先例 | 轻 |',
    ]))).toBe(false);
  });
  it('存在无先例引用的行 → true（新型）', () => {
    expect(hasNovelJudgment(doc([
      '| J1 | A/B | A | 先例 3f2a1b04-0000-4000-8000-000000000001 | 轻 |',
      '| J2 | 新法 | 新法 | 首次出现 | 静默丢数据 |',
    ]))).toBe(true);
  });
});

describe('goldenPathMode 取数（GP6/T6）', () => {
  it('发出 golden_paths 四查 + gp_gap_panorama + [自动派工] 台账查询，形状正确', async () => {
    const pool = makePool();
    const data = await buildBattleReportData(pool, new Date('2026-07-13T00:00:00Z')); // 上海周一
    const sqls = pool.query.mock.calls.map(([sql]) => sql);
    expect(sqls.find((s) => /golden_paths/.test(s) && /'candidate'/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /'converged'/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /auto_release/.test(s) && /veto_deadline/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /GROUP BY status/.test(s))).toBeTruthy();
    // 哨兵查询用 key LIKE $1（scheduler_job 前缀），gap 全景查询用 key = $1，以此区分
    const wmCall = pool.query.mock.calls.find(([sql]) => /working_memory/.test(sql) && /key = \$1/.test(sql));
    expect(wmCall?.[1]).toContain('gp_gap_panorama');
    expect(sqls.find((s) => /FROM tasks/.test(s) && /自动派工/.test(s) && /24 hours/.test(s))).toBeTruthy();
    expect(data.goldenPathMode).toMatchObject({ isMonday: true, candidates: [], converged: [], autoReleases: [], dispatchLedger: [], stock: [] });
  });

  it('非周一 isMonday=false', async () => {
    const data = await buildBattleReportData(makePool(), new Date('2026-07-14T00:00:00Z')); // 上海周二
    expect(data.goldenPathMode.isMonday).toBe(false);
  });

  it('converged 行带 has_novel（proposal_doc 解析）；首次放行=无历史 approved auto_release', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/'converged'/.test(sql)) return { rows: [{ id: 'g1', title: 'GP甲', demo_url: 'http://d/1', proposal_doc: null }] };
        if (/approved_at IS NOT NULL/.test(sql)) return { rows: [{ n: 0 }] };
        if (/veto_deadline/.test(sql) && /auto_release/.test(sql)) return { rows: [{ id: 'g2', title: 'GP乙', veto_deadline: new Date('2026-07-13T06:00:00Z') }] };
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.goldenPathMode.converged[0].has_novel).toBe(true);
    expect(data.goldenPathMode.firstRelease).toBe(true);
  });

  it('goldenPathMode 整块查询抛错 → null，其余段不受影响', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/golden_paths/.test(sql)) throw new Error('relation golden_paths does not exist');
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.goldenPathMode).toBeNull();
    expect(data.journeyRuns).toEqual([]);
  });
});

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
