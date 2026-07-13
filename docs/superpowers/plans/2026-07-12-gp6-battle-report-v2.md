# GP6/T6 晨报军师节 v2 五段渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 battle-report.js 第⑤段军师决策 v1 升级为 v2 五段（圈选/批审/报备/水位，验货台范围外）+ 需动作条目 ≤7 硬截断。

**Architecture:** 照第⑥段「未确认动作」三处对称模式：buildBattleReportData 增 `goldenPathMode` 取数块（整块 try/catch 降级 null）→ renderBattleReportMarkdown 替换 v1 段为 v2 五段渲染（含优先级截断）→ __tests__ 契约断言（B1/B4/B7）。设计 SSOT：`docs/superpowers/specs/2026-07-12-gp6-battle-report-v2-design.md`。

**Tech Stack:** Node.js ESM + vitest（mock pool，无真库）。

---

### Task 1: 减肥——删 v1 军师决策段（notes 明细）

**Files:**
- Modify: `packages/brain/src/battle-report.js`（删行 137-153 取数、229-247 渲染、54 JSDoc、9 头注释）
- Modify: `packages/brain/src/__tests__/battle-report.test.js`（删 describe『军师决策节（T6）』整块 246-302）

- [ ] **Step 1: 删 buildBattleReportData 里 strategistDecisions 取数块**（`// ⑤ 军师决策` 注释到 catch 结束），返回值删 `strategistDecisions`；JSDoc @returns 同步删；文件头注释第⑤条改为『军师决策节 v2 五段（GP 批审桌）』
- [ ] **Step 2: 删 renderBattleReportMarkdown 里『## 军师决策（24h）』整段渲染**（保留其余段与空行结构）
- [ ] **Step 3: 删测试 describe『军师决策节（T6）』**，其余测试里 fixture 的 `strategistDecisions` 字段一并清掉
- [ ] **Step 4: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/battle-report.test.js`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/battle-report.js packages/brain/src/__tests__/battle-report.test.js
git commit -m "refactor(brain): remove old thin 军师决策节 v1（notes 明细，被 v2 五段取代）"
```

---

### Task 2: hasNovelJudgment 判定点解析 helper

**Files:**
- Modify: `packages/brain/src/battle-report.js`（新增导出函数）
- Test: `packages/brain/src/__tests__/battle-report.test.js`

- [ ] **Step 1: 写 failing test**

```js
import { hasNovelJudgment } from '../battle-report.js';

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
```

- [ ] **Step 2: 跑测试确认 FAIL**（`hasNovelJudgment is not a function`）
- [ ] **Step 3: 实现**（battle-report.js，放 formatShanghaiShort 后）

```js
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * 判定 GP 提案是否含新型判定点（批审段排序用，设计文档实现级决策1）。
 * DB 无结构化列，从 proposal_doc 的「判定点登记表」markdown 表格解析：
 * 存在既无先例 decision uuid 又无「先例」字样的登记行 → 新型。
 * 文档缺失/无登记表 → 保守返回 true（排前重点看）。
 * @param {string|null} proposalDoc
 * @returns {boolean}
 */
export function hasNovelJudgment(proposalDoc) {
  if (!proposalDoc) return true;
  const lines = proposalDoc.split('\n');
  const start = lines.findIndex((l) => l.includes('判定点登记表'));
  if (start === -1) return true;
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#/.test(l)) break;
    if (!l.startsWith('|')) continue;
    if (/^\|[\s\-:|]+\|$/.test(l)) continue;           // 分隔行
    if (/判定点/.test(l) && /候选/.test(l)) continue;   // 表头行
    rows.push(l);
  }
  if (rows.length === 0) return true;
  if (rows.every((r) => /N\/A|无接缝/.test(r))) return false;
  return rows.some((r) => !UUID_RE.test(r) && !r.includes('先例'));
}
```

- [ ] **Step 4: 跑测试确认 PASS**
- [ ] **Step 5: Commit**（`feat(brain): 判定点登记表新型/先例解析 hasNovelJudgment`）

---

### Task 3: buildBattleReportData 增 goldenPathMode 取数块

**Files:**
- Modify: `packages/brain/src/battle-report.js`
- Test: `packages/brain/src/__tests__/battle-report.test.js`

- [ ] **Step 1: 写 failing test**

```js
describe('goldenPathMode 取数（GP6/T6）', () => {
  it('发出 golden_paths 四查 + gp_gap_panorama + [自动派工] 台账查询，形状正确', async () => {
    const pool = makePool();
    const data = await buildBattleReportData(pool, new Date('2026-07-13T00:00:00Z')); // 上海周一
    const sqls = pool.query.mock.calls.map(([sql]) => sql);
    expect(sqls.find((s) => /golden_paths/.test(s) && /'candidate'/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /'converged'/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /auto_release/.test(s) && /veto_deadline/.test(s))).toBeTruthy();
    expect(sqls.find((s) => /golden_paths/.test(s) && /GROUP BY status/.test(s))).toBeTruthy();
    const wmCall = pool.query.mock.calls.find(([sql]) => /working_memory/.test(sql) && /\$1/.test(sql) && !/scheduler_job/.test(sql));
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
```

- [ ] **Step 2: 跑测试确认 FAIL**
- [ ] **Step 3: 实现**：battle-report.js 增

```js
/** 上海时区是否周一 */
function isShanghaiMonday(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(now) === 'Mon';
}
```

`buildBattleReportData(pool)` 签名改为 `buildBattleReportData(pool, now = new Date())`；在第⑥段后新增（整块 try/catch，照⑤⑥段降级先例）：

```js
  // ⑦ 军师节 v2 · GP 批审桌取数（golden_paths + gp_gap_panorama + [自动派工] 台账；
  //    整块降级 null——golden_paths 表缺失/查询失败不拖垮整份日报）
  let goldenPathMode = null;
  try {
    const { rows: candidates } = await pool.query(
      `SELECT id, title, one_liner, est_scale, kr_id
       FROM golden_paths WHERE status = 'candidate' ORDER BY created_at ASC`
    );
    const { rows: convergedRows } = await pool.query(
      `SELECT id, title, demo_url, proposal_doc
       FROM golden_paths WHERE status = 'converged' ORDER BY created_at ASC`
    );
    const converged = convergedRows.map((g) => ({
      id: g.id, title: g.title, demo_url: g.demo_url,
      has_novel: hasNovelJudgment(g.proposal_doc),
    }));
    const { rows: autoReleases } = await pool.query(
      `SELECT id, title, veto_deadline, demo_url
       FROM golden_paths
       WHERE auto_release = TRUE AND veto_deadline IS NOT NULL AND veto_deadline > NOW()
         AND status NOT IN ('rejected','superseded')
       ORDER BY veto_deadline ASC`
    );
    const { rows: priorReleased } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM golden_paths
       WHERE auto_release = TRUE AND approved_at IS NOT NULL`
    );
    const { rows: stock } = await pool.query(
      `SELECT status, COUNT(*)::int AS count,
              (ARRAY_AGG(status_reason ORDER BY updated_at DESC)
                 FILTER (WHERE status_reason IS NOT NULL))[1] AS latest_reason
       FROM golden_paths GROUP BY status ORDER BY status`
    );
    const { rows: gapRows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`, ['gp_gap_panorama']
    );
    const { rows: dispatchLedger } = await pool.query(
      `SELECT title, status, created_at FROM tasks
       WHERE title LIKE '[自动派工]%' AND created_at >= NOW() - interval '24 hours'
       ORDER BY created_at DESC`
    );
    goldenPathMode = {
      isMonday: isShanghaiMonday(now),
      candidates, converged, autoReleases,
      firstRelease: (parseInt(priorReleased[0]?.n, 10) || 0) === 0 && autoReleases.length > 0,
      stock, dispatchLedger,
      gapPanorama: gapRows[0]?.value_json ?? null,
    };
  } catch (err) {
    console.warn(`[battle-report] 军师节 v2 取数失败（降级 null）: ${err.message}`);
  }
```

返回对象加 `goldenPathMode`，JSDoc 同步。

- [ ] **Step 4: 跑测试确认 PASS**（含既有全部）
- [ ] **Step 5: Commit**（`feat(brain): 军师节 v2 goldenPathMode 取数块（golden_paths 四查+缺口全景+自动派工台账）`）

---

### Task 4: 渲染层——v2 五段 + ≤7 截断（B1/B4/B7）

**Files:**
- Modify: `packages/brain/src/battle-report.js`
- Test: `packages/brain/src/__tests__/battle-report.test.js`

- [ ] **Step 1: 写 failing tests**

```js
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
```

- [ ] **Step 2: 跑测试确认 FAIL**
- [ ] **Step 3: 实现渲染**（renderBattleReportMarkdown 用户决策段后插入；哨兵段前）

```js
/** 需 Alex 动作条目硬上限（规格 v2 解法⑤） */
const MAX_ALEX_ACTIONS = 7;

/**
 * 汇总需 Alex 动作条目并按优先级排序（新型判定点 > 首次放行 > 全先例批审折叠 > 圈选；
 * 抽检=优先级4，棘轮范围外本期恒空。报备段否决窗条目属被动知情不在此列）。
 */
function buildGpActionItems(gp) {
  const items = [];
  for (const g of gp.converged.filter((x) => x.has_novel)) {
    items.push({ priority: 1, segment: 'review', text: `【批审·新型判定点】${g.title}${g.demo_url ? ` — ${g.demo_url}` : ''}` });
  }
  if (gp.firstRelease) {
    for (const r of gp.autoReleases) {
      items.push({ priority: 2, segment: 'release', text: `【首次放行】${r.title}（否决窗至 ${formatShanghaiShort(r.veto_deadline)}）` });
    }
  }
  const precedent = gp.converged.filter((x) => !x.has_novel);
  if (precedent.length > 0) {
    items.push({ priority: 2.5, segment: 'review', text: `【批审·全先例】${precedent.map((x) => x.title).join('、')}（${precedent.length} 条快速过）` });
  }
  if (gp.isMonday) {
    gp.candidates.forEach((c, i) => {
      items.push({ priority: 3, segment: 'selection', text: `【圈选 ${i + 1}】${c.title} — ${c.one_liner}${c.est_scale ? `（${c.est_scale}）` : ''}` });
    });
  }
  items.sort((a, b) => a.priority - b.priority);
  return items;
}
```

渲染主体（军师节 v2）：

```js
  lines.push('');
  lines.push('## 军师决策节 v2 · GP 批审桌');
  const gp = data.goldenPathMode || null;
  const actions = gp ? buildGpActionItems(gp) : [];
  const survivors = new Set(actions.slice(0, MAX_ALEX_ACTIONS));
  const overflow = actions.length - Math.min(actions.length, MAX_ALEX_ACTIONS);
  const pick = (segment) => actions.filter((a) => survivors.has(a) && a.segment === segment);

  lines.push('');
  lines.push('### 方向圈选段（每周一）');
  if (!gp) {
    lines.push('暂无');
  } else if (!gp.isMonday) {
    lines.push('本段每周一更新');
  } else {
    const sel = pick('selection');
    if (sel.length === 0 && !gp.gapPanorama) {
      lines.push('暂无');
    } else {
      for (const a of sel) lines.push(`- ${a.text}`);
      const gaps = gp.gapPanorama?.gaps || [];
      if (gaps.length > 0) {
        lines.push('OKR 缺口全景（本周无候选覆盖的空白）：');
        for (const g of gaps) lines.push(`- ${g.kr_title ?? g.kr_id}：${g.reason ?? ''}`);
      }
    }
  }

  lines.push('');
  lines.push('### GP 批审段');
  const review = gp ? pick('review') : [];
  if (review.length === 0) {
    lines.push('暂无');
  } else {
    for (const a of review) lines.push(`- ${a.text}`);
  }

  lines.push('');
  lines.push('### 报备段（24h 否决窗）');
  const releaseActions = gp ? pick('release') : [];
  const passiveReleases = gp && !gp.firstRelease ? gp.autoReleases : [];
  const ledger = gp?.dispatchLedger || [];
  if (releaseActions.length === 0 && passiveReleases.length === 0 && ledger.length === 0) {
    lines.push('暂无');
  } else {
    for (const a of releaseActions) lines.push(`- ${a.text}`);
    for (const r of passiveReleases) {
      lines.push(`- ${r.title}（否决窗至 ${formatShanghaiShort(r.veto_deadline)}，不否决即生效）`);
    }
    if (ledger.length > 0) {
      lines.push('昨日自动派工台账：');
      for (const t of ledger) lines.push(`- ${t.title}（${t.status ?? '?'}，${formatShanghaiShort(t.created_at)}）`);
    }
  }

  lines.push('');
  lines.push('### GP 库存水位段');
  const stock = gp?.stock || [];
  if (stock.length === 0) {
    lines.push('暂无');
  } else {
    lines.push(stock.map((s) => {
      const reason = ['rejected', 'blocked_gate'].includes(s.status) && s.latest_reason ? `（${s.latest_reason}）` : '';
      return `${s.status} ${s.count}${reason}`;
    }).join(' · '));
  }

  if (overflow > 0) {
    lines.push('');
    lines.push(`⏳ 需动作条目超限（>${MAX_ALEX_ACTIONS}），${overflow} 条顺延次日（堆积水位 ${overflow}）`);
  }
```

- [ ] **Step 4: 跑全部 battle-report 测试确认 PASS**
- [ ] **Step 5: Commit**（`feat(brain): 军师节 v2 五段渲染+需动作≤7硬截断（B1/B4/B7）`）

---

### Task 5: 版本 bump + 全量校验

- [ ] **Step 1:** `packages/brain/package.json` version minor bump（新功能）
- [ ] **Step 2:** `node --check packages/brain/src/battle-report.js`（brain deploy 冒烟铁律）
- [ ] **Step 3:** `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh`（DevGate）
- [ ] **Step 4:** `cd packages/brain && npx vitest run src/__tests__/battle-report.test.js src/__tests__/scheduler-jobs*.test.js`
- [ ] **Step 5: Commit**（`chore(brain): version bump`）
