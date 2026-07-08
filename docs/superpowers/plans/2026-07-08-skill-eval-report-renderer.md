# form B 评估报告渲染器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把结构化评估数据（report-data）渲染成「skill 解剖图」验收报告页，接到已合并的 form B 骨架（#3627）。

**Architecture:** 3 单元——(1) report-data schema + fixture；(2) 纯函数渲染模块 `renderReportHtml`/`buildAnatomySvg`（Node 可单测，同输入恒等输出）；(3) 迁移加 `report_data` 列 + `GET /report/:task_id` 端点 + `/complete` 扩展存 report_data。SVG 结构 = 已定稿设计（skill-eval-pages.html 报告页），参数化自 anatomy 数据。

**Tech Stack:** Node ESM, express Router, vitest, postgres (pg pool)。测试命令 `cd packages/brain && npx vitest run <file>`。

**TDD 铁律（cecelia lint-tdd-commit-order）：** 每任务 commit-1 = 失败测试，commit-2 = 实现。

---

### Task 1: report-data schema + fixture

**Files:**
- Create: `packages/brain/src/skill-eval-report-schema.js`
- Create: `packages/brain/src/__fixtures__/daily-report-cs.report.json`
- Test: `packages/brain/src/__tests__/skill-eval-report-schema.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

describe('validateReportData', () => {
  it('fixture 合法', () => {
    const r = validateReportData(fixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('缺 skill.name 报错', () => {
    const r = validateReportData({ verdict:{level:'pass'}, anatomy:{inputs:[],kernel:{rules:[]},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/skill\.name/);
  });
  it('verdict.level 非枚举报错', () => {
    const r = validateReportData({ skill:{name:'x'}, verdict:{level:'maybe'}, anatomy:{inputs:[],kernel:{rules:[]},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/verdict\.level/);
  });
  it('anatomy.kernel.rules 非数组报错', () => {
    const r = validateReportData({ skill:{name:'x'}, verdict:{level:'pass'}, anatomy:{inputs:[],kernel:{rules:'nope'},outputs:[]} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/kernel\.rules/);
  });
  it('fixture 含解剖图三段与 6 维 health', () => {
    expect(fixture.anatomy.inputs.length).toBeGreaterThan(0);
    expect(fixture.anatomy.outputs.length).toBeGreaterThan(0);
    expect(fixture.health.length).toBe(6);
    expect(fixture.anatomy.inputs.some(i=>i.connected===false)).toBe(true); // 状态包未接
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-schema.test.js` → FAIL（模块/fixture 不存在）
- [ ] **Step 3: commit-1（失败测试）**

```bash
git add packages/brain/src/__tests__/skill-eval-report-schema.test.js
git commit -m "test: skill-eval report-data schema 失败测试"
```

- [ ] **Step 4: 写 schema 模块**

```js
// packages/brain/src/skill-eval-report-schema.js
// report-data：一份评估报告的结构化数据。渲染器与端点共用。
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');
  const a = d.anatomy || {};
  if (!Array.isArray(a.inputs)) errs.push('anatomy.inputs 必须是数组');
  if (!a.kernel || !Array.isArray(a.kernel.rules)) errs.push('anatomy.kernel.rules 必须是数组');
  if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组');
  return { valid: errs.length === 0, errors: errs };
}
```

- [ ] **Step 5: 写 fixture**（daily-report-cs 真实结构，取自定稿设计）

```json
{
  "skill": { "name": "daily-report-cs", "version": "v1.0.0", "source": "ChatGPT", "type": "判断型 · prompt 内核", "area": "ZenithJoy", "line": "Line 04 私域AI接管", "ability": "客服判断", "submitter": "张三", "evaluatedAt": "2026-07-08" },
  "verdict": { "level": "partial", "text": "逻辑·输出·红线达标；主路径输入未接真 DB，上线前必须先接。" },
  "stats": { "功能线": "1", "依赖缺失": "1", "红线": "✓", "成熟度": "thin", "诚实度": "A+", "耗时": "12′" },
  "anatomy": {
    "inputs": [
      { "name": "状态包", "fields": ["上一阶段","风险等级","推进状态","未完成事项","询价背景","禁忌话术","历史缺口","上次下一步"], "status": "red", "connected": false, "note": "8 字段无一真实填充" },
      { "name": "客户最新一句话", "fields": [], "status": "green", "connected": true, "note": "真实测过" }
    ],
    "kernel": { "model": "gpt-5.4-mini", "promptNote": "SKILL.md · 判定逻辑 8 步（按序走）", "redlineGate": true,
      "rules": [
        { "name": "A1–A4 阶段", "hardGate": false }, { "name": "推进信号档", "hardGate": false },
        { "name": "四感缺口", "hardGate": false }, { "name": "询价分级", "hardGate": false },
        { "name": "回复自检", "hardGate": false }, { "name": "生产接入建议", "hardGate": false },
        { "name": "事实边界", "hardGate": true }, { "name": "高风险转人工", "hardGate": true }
      ] },
    "outputs": [
      { "name": "回复正文", "sub": "可直接发给客户", "fields": [] },
      { "name": "判断标签 JSON", "sub": "", "fields": ["stage","signal","inquiry","risk","gap","escalate"] }
    ]
  },
  "findings": [ { "name": "询价分级", "tag": "有缺陷史 47→87%", "severity": "flag" }, { "name": "收口优先", "tag": "向导已定义为第五值", "severity": "ok" } ],
  "redlines": [ { "name": "事实边界", "tag": "一票否决" }, { "name": "回复自检 5 清单", "tag": "" }, { "name": "代码层编造检测", "tag": "" } ],
  "maturity": { "生产接线": "0 条", "真实数据库": "未连接", "已验证": "15×3 遍", "模型选型": "gpt-5.4-mini", "诚实待办": "主动列出" },
  "health": [ { "dim": "是什么", "state": "ok" }, { "dim": "输入", "state": "bad" }, { "dim": "逻辑", "state": "warn" }, { "dim": "输出", "state": "ok" }, { "dim": "红线", "state": "ok" }, { "dim": "成熟", "state": "neutral" } ]
}
```

- [ ] **Step 6: 跑测试确认通过** — 同 Step 2 命令 → PASS
- [ ] **Step 7: commit-2（实现）**

```bash
git add packages/brain/src/skill-eval-report-schema.js packages/brain/src/__fixtures__/daily-report-cs.report.json
git commit -m "feat: skill-eval report-data schema + daily-report-cs fixture"
```

---

### Task 2: 纯函数渲染模块

**Files:**
- Create: `packages/brain/src/skill-eval-report-render.js`
- Test: `packages/brain/src/__tests__/skill-eval-report-render.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect } from 'vitest';
import { renderReportHtml, buildAnatomySvg } from '../skill-eval-report-render.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

describe('buildAnatomySvg', () => {
  const svg = buildAnatomySvg(fixture.anatomy);
  it('未接依赖渲染红断线 stroke-dasharray + 该 input 名', () => {
    expect(svg).toMatch(/stroke-dasharray/);
    expect(svg).toContain('状态包');
  });
  it('已接依赖不用断线（客户一句话为绿实线区）', () => {
    expect(svg).toContain('客户最新一句话');
  });
  it('内核 8 条规则名全部出现', () => {
    for (const r of fixture.anatomy.kernel.rules) expect(svg).toContain(r.name);
  });
  it('硬闸规则带 lock 标记', () => {
    expect(svg).toContain('🔒');
    expect(svg).toContain('事实边界');
    expect(svg).toContain('高风险转人工');
  });
  it('输出字段名出现', () => {
    for (const f of ['stage','signal','inquiry','risk','gap','escalate']) expect(svg).toContain(f);
  });
  it('同输入恒等输出（纯函数）', () => {
    expect(buildAnatomySvg(fixture.anatomy)).toBe(svg);
  });
});

describe('renderReportHtml', () => {
  it('完整 HTML 含裁决文案 + 解剖图三段 + 深入三项 + 6维指纹', () => {
    const html = renderReportHtml(fixture);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(fixture.verdict.text);
    expect(html).toContain('输入'); expect(html).toContain('内核'); expect(html).toContain('输出');
    expect(html).toContain('询价分级');        // 深入·逻辑发现
    expect(html).toContain('回复自检 5 清单');  // 深入·红线
    expect(html).toContain('15×3 遍');          // 深入·成熟度
    // 6 维 health 色码：bad 用 fail 变量
    expect(html).toContain('var(--fail)');
  });
  it('report-data 畸形 → 兜底态，不抛错', () => {
    const html = renderReportHtml({ skill: {} });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('报告数据不完整');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-render.test.js` → FAIL
- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/skill-eval-report-render.test.js
git commit -m "test: skill-eval 渲染模块失败测试"
```

- [ ] **Step 4: 写渲染模块**

实现要点（SVG 结构照搬定稿设计 skill-eval-pages.html 报告页，参数化自 anatomy）：
- 顶部 `esc()` HTML 转义防注入
- `buildAnatomySvg(anatomy)`：viewBox 0 0 1160 380；左列每个 input 一盒（status=red→红盒，green→绿盒）；`connected===false` 的 input → 到内核的连线用 `class="wire-broken"`（`stroke-dasharray:9 6` stroke=红）+ ✕ 断口；否则绿实线。中央圆铺开 `kernel.rules`（2 列），`hardGate` 规则前缀 `🔒` 且红色类；`redlineGate` → 输出侧「红线闸」。右列 outputs 盒 + 字段格。所有颜色走 CSS 变量（主题自适应）。
- `renderReportHtml(reportData)`：先 `validateReportData`，不合法 → 返回含「报告数据不完整」的兜底 HTML（仍 `<!doctype html>`）；合法 → 完整页：内联 CSS（主题 token，同定稿）+ 裁决条 + 6 项数字 stat + `buildAnatomySvg` + 深入三项卡（findings/redlines/maturity）+ 6 维 health 指纹（state→色：ok=pass/warn=warn/bad=fail/neutral=line 变量）。
- 纯函数：禁用 Date.now/random。

```js
// packages/brain/src/skill-eval-report-render.js（骨架，执行时补全 SVG 坐标细节，参照 skill-eval-pages.html）
import { validateReportData } from './skill-eval-report-schema.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEALTH_COLOR = { ok: 'var(--pass)', warn: 'var(--warn)', bad: 'var(--fail)', neutral: 'var(--line)' };

export function buildAnatomySvg(anatomy) {
  const { inputs = [], kernel = { rules: [] }, outputs = [] } = anatomy || {};
  // 左列 inputs（纵向排布）
  const inputEls = inputs.map((inp, i) => {
    const y = 46 + i * 250;
    const cls = inp.status === 'green' ? 's-box-green' : 's-box-red';
    const wire = inp.connected === false
      ? `<path d="M310,${y+90} C360,${y+90} 360,190 420,190" class="s-wire-broken"/><circle cx="360" cy="${y+72}" r="15" class="s-brk"/><text x="360" y="${y+78}" class="s-brkt">✕</text>`
      : `<path d="M310,${y+30} C380,${y+30} 370,232 428,224" class="s-wire-green"/>`;
    const fields = (inp.fields || []).map((f, k) => `<rect x="${54 + (k%2)*128}" y="${y+46+Math.floor(k/2)*38}" width="118" height="32" rx="6"/><text x="${113 + (k%2)*128}" y="${y+66+Math.floor(k/2)*38}">${esc(f)}</text>`).join('');
    return `${wire}<rect x="40" y="${y}" width="270" height="${inp.fields&&inp.fields.length? 210:64}" rx="12" class="s-box ${cls}"/><text x="58" y="${y+28}" class="s-boxh">${esc(inp.name)}</text><g class="s-fld">${fields}</g>${inp.note?`<text x="175" y="${y+ (inp.fields&&inp.fields.length?214:-2)}" class="s-note">${esc(inp.note)}</text>`:''}`;
  }).join('');
  // 中央圆 rules（2 列）
  const ruleEls = kernel.rules.map((r, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 458 + col * 128, y = 132 + row * 32;
    const hard = r.hardGate ? ' s-rule-hard' : '';
    const label = r.hardGate ? `🔒 ${r.name}` : r.name;
    return `<g class="s-rule${hard}"><rect x="${x}" y="${y}" width="116" height="26" rx="6"/><text x="${x+58}" y="${y+17}">${esc(label)}</text></g>`;
  }).join('');
  const gate = kernel.redlineGate ? `<rect x="770" y="170" width="70" height="26" rx="6" class="s-gate"/><text x="805" y="187" class="s-gatet">红线闸</text>` : '';
  // 右列 outputs
  const outEls = outputs.map((o, i) => {
    const y = 70 + i * 94;
    const h = o.fields && o.fields.length ? 176 : 70;
    const fields = (o.fields || []).map((f, k) => `<rect x="${874 + (k%2)*126}" y="${y+ (o.fields.length? 34:0) +Math.floor(k/2)*40}" width="118" height="32" rx="6"/><text x="${933 + (k%2)*126}" y="${y+ (o.fields.length?54:0) +Math.floor(k/2)*40}">${esc(f)}</text>`).join('');
    return `<rect x="858" y="${y}" width="262" height="${h}" rx="12" class="s-box"/><text x="878" y="${y+30}" class="s-boxh">${esc(o.name)}</text>${o.sub?`<text x="878" y="${y+52}" class="s-boxsub">${esc(o.sub)}</text>`:''}<g class="s-fld s-fld-mono">${fields}</g>`;
  }).join('');
  return `<svg viewBox="0 0 1160 380" role="img" aria-label="skill 解剖图"><text x="165" y="30" class="s-hd">输入</text><text x="580" y="30" class="s-hd">内核 · 核心逻辑</text><text x="990" y="30" class="s-hd">输出</text>${gate}<circle cx="580" cy="196" r="158" class="s-hub"/><rect x="512" y="66" width="136" height="30" rx="15" class="s-modelpill"/><text x="580" y="86" class="s-modelt">${esc(kernel.model||'')}</text><text x="580" y="116" class="s-hubsub">${esc(kernel.promptNote||'')}</text>${ruleEls}${inputEls}${outEls}</svg>`;
}

export function renderReportHtml(reportData) {
  const v = validateReportData(reportData);
  const head = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body><div class="wrap">`;
  const tail = `</div></body></html>`;
  if (!v.valid) return `${head}<div class="fallback">报告数据不完整：${esc(v.errors.join('；'))}</div>${tail}`;
  const d = reportData;
  const stats = Object.entries(d.stats || {}).map(([k, val]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(val)}</div></div>`).join('');
  const health = (d.health || []).map((h) => `<span class="hd" style="background:${HEALTH_COLOR[h.state] || 'var(--line)'}" title="${esc(h.dim)}"></span>`).join('');
  const findings = (d.findings || []).map((f) => `<span class="chip">${esc(f.name)}<span class="tag t-${esc(f.severity)}">${esc(f.tag)}</span></span>`).join('');
  const redlines = (d.redlines || []).map((r) => `<span class="chip">${esc(r.name)}${r.tag?`<span class="tag t-hard">${esc(r.tag)}</span>`:''}</span>`).join('');
  const maturity = Object.entries(d.maturity || {}).map(([k, val]) => `<div class="cell"><div class="kk">${esc(k)}</div><div class="vv">${esc(val)}</div></div>`).join('');
  return `${head}
    <div class="crumb">${esc(d.skill.area||'')} › ${esc(d.skill.line||'')} › ${esc(d.skill.ability||'')}</div>
    <div class="rname">${esc(d.skill.name)} · 验收报告</div>
    <div class="rmeta">${esc(d.skill.submitter||'')} · ${esc(d.skill.source||'')} · ${esc(d.skill.version||'')} · ${esc(d.skill.evaluatedAt||'')}</div>
    <div class="verdict v-${esc(d.verdict.level)}"><span class="vbadge">${d.verdict.level==='partial'?'部分通过':d.verdict.level==='pass'?'通过':'不通过'}</span><span class="vtext">${esc(d.verdict.text)}</span></div>
    <div class="fingerprint">健康指纹：${health}</div>
    <div class="statrow">${stats}</div>
    <div class="diagram">${buildAnatomySvg(d.anatomy)}</div>
    <div class="deep"><h3>逻辑发现</h3><div class="chips">${findings}</div></div>
    <div class="deep"><h3>红线</h3><div class="chips">${redlines}</div></div>
    <div class="deep"><h3>成熟度</h3><div class="kv">${maturity}</div></div>
  ${tail}`;
}

const STYLE = `/* 主题 token + s- SVG 类，执行时从 skill-eval-pages.html 移植（--pass/--warn/--fail/--line/--accent 等 + s-box/s-wire-broken/s-brk/s-hub/s-rule/s-rule-hard/s-gate/s-fld 等）*/`;
```

> 执行注意：`STYLE` 常量把 skill-eval-pages.html 报告页那套 CSS 变量 + `s-*` SVG 类整段移植进来（含 light/dark 主题、`.s-wire-broken{stroke-dasharray}`、`.s-rule-hard` 红、`.hd`/`.chip`/`.tag`/`.stat`/`.kv` 等）。SVG 坐标已在 buildAnatomySvg 给出，微调以不重叠为准。

- [ ] **Step 5: 跑测试确认通过** — 同 Step 2 → PASS
- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/skill-eval-report-render.js
git commit -m "feat: skill-eval 报告渲染模块 renderReportHtml + buildAnatomySvg"
```

---

### Task 3: 迁移 319 + report 端点 + /complete 扩展 + smoke

**Files:**
- Create: `packages/brain/migrations/319_skill_eval_report_data.sql`
- Modify: `packages/brain/src/routes/eval.js`（加 GET /report/:task_id；/complete 存 report_data）
- Test: `packages/brain/src/__tests__/eval-report.test.js`
- Create: `packages/brain/scripts/smoke/skill-eval-report-smoke.sh`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../skill-eval-validator.js', () => ({
  validateZipBuffer: vi.fn(), computeZipHash: vi.fn(), checkZipDuplication: vi.fn(),
  checkSlotAvailable: vi.fn(), getEvalQueuePosition: vi.fn(),
}));
import router from '../routes/eval.js';
import fixture from '../__fixtures__/daily-report-cs.report.json';

const app = express(); app.use(express.json()); app.use('/api/skill-eval', router);

beforeEach(() => mockPool.query.mockReset());

describe('GET /api/skill-eval/report/:task_id', () => {
  it('有 report_data → 200 text/html 含解剖图三段', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: fixture }] });
    const res = await request(app).get('/api/skill-eval/report/abc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('输入'); expect(res.text).toContain('内核'); expect(res.text).toContain('输出');
    expect(res.text).toContain('stroke-dasharray');
  });
  it('?format=json → 原始 report-data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: fixture }] });
    const res = await request(app).get('/api/skill-eval/report/abc?format=json');
    expect(res.status).toBe(200);
    expect(res.body.skill.name).toBe('daily-report-cs');
  });
  it('无 report_data → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ report_data: null }] });
    const res = await request(app).get('/api/skill-eval/report/abc');
    expect(res.status).toBe(404);
  });
  it('task 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/skill-eval/report/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd packages/brain && npx vitest run src/__tests__/eval-report.test.js` → FAIL（路由不存在 → 404 但 content-type 非 html / 或 500）。确认 supertest 已在 devDeps（否则 `npm i -D supertest` 也算本 commit）。
- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/eval-report.test.js
git commit -m "test: skill-eval report 端点失败测试"
```

- [ ] **Step 4: 写迁移**

```sql
-- packages/brain/migrations/319_skill_eval_report_data.sql
-- 加结构化报告数据列，供报告渲染器读取。向后兼容（可空）。
ALTER TABLE skill_evals ADD COLUMN IF NOT EXISTS report_data jsonb;
```

- [ ] **Step 5: 加 report 端点 + /complete 扩展（改 eval.js）**

在 eval.js 顶部加 `import { renderReportHtml } from '../skill-eval-report-render.js';`

在 status 路由后新增：

```js
// ─── GET /api/skill-eval/report/:task_id ──────────────────────────────────
router.get('/report/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const result = await pool.query(
      `SELECT report_data FROM skill_evals WHERE task_id = $1 LIMIT 1`, [task_id]);
    if (result.rows.length === 0 || !result.rows[0].report_data) {
      return res.status(404).json({ error: '报告未就绪或任务不存在' });
    }
    const reportData = result.rows[0].report_data;
    if (req.query.format === 'json') return res.json(reportData);
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderReportHtml(reportData));
  } catch (err) {
    console.error('[skill-eval] report error:', err.message);
    return res.status(500).json({ error: `internal server error: ${err.message}` });
  }
});
```

在 `/complete` 的 UPDATE skill_evals 里加 report_data 存储——把原 UPDATE 改为同时写 report_data（body 传了才写）：

```js
const { task_id, report_url, report_data } = req.body;
// ...原校验...
await pool.query(
  `UPDATE skill_evals SET status='completed', report_url=$1,
     report_data=COALESCE($2::jsonb, report_data), updated_at=now()
   WHERE task_id=$3`,
  [report_url, report_data ? JSON.stringify(report_data) : null, task_id]);
```

- [ ] **Step 6: 跑测试确认通过** — 同 Step 2 → PASS
- [ ] **Step 7: 写 smoke**

```bash
# packages/brain/scripts/smoke/skill-eval-report-smoke.sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
node --input-type=module -e '
import { renderReportHtml } from "./src/skill-eval-report-render.js";
import fixture from "./src/__fixtures__/daily-report-cs.report.json" assert { type: "json" };
const html = renderReportHtml(fixture);
const must = ["输入","内核","输出","stroke-dasharray","事实边界","高风险转人工","stage","escalate","部分通过"];
const miss = must.filter(m => !html.includes(m));
if (miss.length) { console.error("smoke FAIL, 缺:", miss); process.exit(1); }
console.log("skill-eval-report-smoke PASS");
'
```

- [ ] **Step 8: 跑 smoke 确认通过** — `bash packages/brain/scripts/smoke/skill-eval-report-smoke.sh` → PASS
- [ ] **Step 9: commit-2**

```bash
chmod +x packages/brain/scripts/smoke/skill-eval-report-smoke.sh
git add packages/brain/migrations/319_skill_eval_report_data.sql packages/brain/src/routes/eval.js packages/brain/scripts/smoke/skill-eval-report-smoke.sh
git commit -m "feat: skill-eval report 端点 + 迁移319 + /complete 存 report_data + smoke"
```

---

## 自审
- **spec 覆盖**：schema+fixture(T1) / 渲染模块(T2) / 迁移+端点+/complete+smoke(T3)——spec 三单元全覆盖 ✓
- **占位符**：STYLE 常量注明「移植 skill-eval-pages.html CSS」——执行时必须实际粘入完整 CSS，非占位遗留（已在执行注意标红）✓
- **类型一致**：`renderReportHtml`/`buildAnatomySvg`/`validateReportData` 三处签名跨任务一致 ✓；fixture 字段与 schema 校验、渲染读取一致 ✓
- **依赖**：supertest 若未在 devDeps，T3-Step2 补装（已注明）
