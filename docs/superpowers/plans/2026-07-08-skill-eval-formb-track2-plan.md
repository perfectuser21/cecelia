# Skill-Evaluator Form B 渲染器折回 + 评估 Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把定稿的 n8n 连线图渲染器（`~/perfect21/skill-eval-formb-assets/render.mjs`）折回 cecelia monorepo，替换掉 `packages/brain` 里的旧"解剖图"渲染器与旧 schema 校验，用真实 fixture 重写测试，并新增一个能单次跑通"查 pending → 解压 zip → 调 claude 评估 → 回写结果"全链路的评估 worker 脚本。让 skill 上传 zip → 拿到报告的链路本地可跑通。

**Architecture:**
- `packages/brain/src/skill-eval-report-render.js` —— 纯函数渲染层，导出 `renderReportHtml` / `renderReportBody` / `renderComparePage`。`routes/eval.js` 只调用 `renderReportHtml`。渲染逻辑内部把 `anatomy.pipeline`（或老 `anatomy.{inputs,kernel}` 回退）解析成统一的 load/judge/gate 步骤序列，画成 n8n 风格横向连线图。
- `packages/brain/src/skill-eval-report-schema.js` —— 纯函数校验层，导出 `validateReportData`，供 render.js 和（未来）上传端点共用。新版本对 `anatomy.pipeline` 和 `anatomy.inputs`（老结构）两种形状都放行，只要求二者至少存在一个 + `outputs` 是数组。
- `packages/brain/scripts/skill-eval-worker.js` —— 单次轮询脚本（非常驻），复用 `src/db.js` 的 pg pool。查一条 `pending` → 解压 zip → 拼 prompt 调本地 `claude` 二进制 → 解析 JSON report_data → 回调 `/api/skill-eval/complete`（失败则直接写库 `status=failed`）。
- 数据流：`POST /upload`（已存在）落 zip 到 `staging_path` → **worker（本次新增）** 消费 pending 记录跑评估 → `POST /complete`（已存在）回写 `report_data` → `GET /report/:task_id` 用 `renderReportHtml` 渲染成页面。

**Tech Stack:** Node.js 25 (ESM, `"type":"module"`), Express, `pg`, `unzipper`（已是 `packages/brain` 现有依赖，解压走它的 `Extract({path})` 流式 API，不需要新装依赖或系统 `unzip`），Vitest。

**范围外（不做）：** mmv 常驻进程化（pm2/systemd）、HK `/eval-api` 反代配置、前端上传页改动——这些留到 PR merge 后单独处理，本计划不产生相关 git diff。

---

### Task 1: 折回渲染器 —— `skill-eval-report-render.js`

**Files:**
- Modify: `packages/brain/src/skill-eval-report-render.js`
- Test: `packages/brain/src/__tests__/skill-eval-report-render.test.js`

**背景与顺序说明：** 本任务只替换渲染逻辑，**不**改 `skill-eval-report-schema.js`（那是 Task 2 的范围）。为了让本任务的 RED/GREEN 独立于 Task 2，测试用的 fixture 会同时带上老 schema 要求的字段（`anatomy.inputs: []`、`anatomy.kernel: { rules: [] }`）和触发新渲染逻辑要用的 `anatomy.pipeline`，这样不管 schema.js 是老版本还是新版本，`validateReportData` 都会判 `valid: true`，测试只专注验证"渲染器是否认识 `pipeline` 并画出新版 n8n 连线图"这一件事。已用真实老 schema.js 逐字模拟验证过这个 fixture 确实能通过老校验（`valid:true`），也已用当前未改动的 render.js 跑过一遍确认 `renderReportHtml` 产物**不**包含 `'SKILL 内部'`（真实 RED，不是假设）。

- [ ] **Step 1: Write the failing test**

把 `packages/brain/src/__tests__/skill-eval-report-render.test.js` 整个替换成：

```js
import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '../skill-eval-report-render.js';

// 同时满足老 schema.js（anatomy.inputs 数组 + anatomy.kernel.rules 数组）
// 和新渲染器要认的 anatomy.pipeline —— 这样这个测试只依赖 Task 1 的渲染器改动，
// 不依赖 Task 2 才会做的 schema.js 改动。
const fixture = {
  skill: { name: '临时skill', area: 'A', line: 'L' },
  verdict: { level: 'pass', text: 'ok' },
  anatomy: {
    input: '输入X',
    loadMode: '全部前置',
    pipeline: ['load|数据A|库|来源A|已接', 'judge|判定Y'],
    inputs: [],
    kernel: { rules: [] },
    outputs: [{ name: '输出Z', kind: '文本' }],
  },
};

describe('renderReportHtml — pipeline 连线图渲染器（折自 render.mjs）', () => {
  it('认识 anatomy.pipeline，画出 n8n 风格三段带（输入/SKILL 内部/输出），不是老解剖图', () => {
    const html = renderReportHtml(fixture);
    expect(html).toContain('SKILL 内部');
    expect(html).toContain('输入');
    expect(html).toContain('输出');
  });

  it('pipeline 里的 load/judge 步骤名称出现在图里', () => {
    const html = renderReportHtml(fixture);
    expect(html).toContain('数据A');
    expect(html).toContain('判定Y');
  });

  it('不落入 fallback 兜底态', () => {
    const html = renderReportHtml(fixture);
    expect(html).not.toContain('报告数据不完整');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-render.test.js`

Expected: FAIL —— 第一个 `it` 断言 `html).toContain('SKILL 内部')` 失败（当前旧 `skill-eval-report-render.js` 渲染的是"解剖图"，SVG 里画的是 `输入`/`内核 · 核心逻辑`/`输出` 三个 `<text class="s-hd">` 标签，不认识 `anatomy.pipeline` 字段，也不产出 `'SKILL 内部'` 这个字符串）。第二个 `it` 大概率也失败（旧渲染器走 `buildAnatomySvg(d.anatomy)`，用 `anatomy.inputs`/`anatomy.kernel.rules`，这里传的是空数组，不会画出 `数据A`/`判定Y`）。

- [ ] **Step 3: Write minimal implementation**

把 `packages/brain/src/skill-eval-report-render.js` 整个替换成（折自 `~/perfect21/skill-eval-formb-assets/render.mjs`，去掉了原来内嵌的 `validateReportData` 定义，改成从 schema.js import 复用；`renderReportBody` / `renderReportHtml` / `renderComparePage` 三个导出函数名与原 `routes/eval.js` 的调用方式完全不变）：

```js
// 渲染 v6：回到原形图（输入盒→圆核→输出盒），盒子只放 名字+类型，去字段；圆核一句话。
// 折自 skill-eval-formb-assets/render.mjs（Track 2 折回，2026-07-08）。validateReportData 移至 ./skill-eval-report-schema.js（Task 2 折入），此处只 import 复用。
import { validateReportData } from './skill-eval-report-schema.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trunc = (s, n) => { const str = String(s == null ? '' : s); return str.length > n ? str.slice(0, n - 1) + '…' : str; };
// 取第一段（遇到分隔符就断），再兜底截断——名字尽量短、少出现「…」
const shortName = (s) => { const seg = String(s == null ? '' : s).split(/[／/（(【、,，·|｜:：\s]/)[0].trim() || String(s == null ? '' : s); return trunc(seg, 6); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const HEALTH_COLOR = { ok: 'var(--pass)', warn: 'var(--warn)', bad: 'var(--fail)', neutral: 'var(--line)' };
const VERDICT_LABEL = { pass: '可以用', partial: '改了能用', fail: '还不能用' };
const SEV_LABEL = { high: '要紧', mid: '次要', low: '小事' };

// 类型元数据：图标 + 颜色（左右同类型同色）。图标用 currentColor 描边。
const ICON = {
  数据库: '<ellipse cx="8" cy="4.2" rx="5.2" ry="2.2"/><path d="M2.8 4.2 V11.8 c0 1.2 2.3 2.2 5.2 2.2 s5.2-1 5.2-2.2 V4.2" fill="none"/><path d="M2.8 8 c0 1.2 2.3 2.2 5.2 2.2 s5.2-1 5.2-2.2" fill="none"/>',
  文档: '<rect x="3.2" y="2" width="9.6" height="12" rx="1.2" fill="none"/><line x1="5.4" y1="5.2" x2="10.6" y2="5.2"/><line x1="5.4" y1="8" x2="10.6" y2="8"/><line x1="5.4" y1="10.8" x2="8.8" y2="10.8"/>',
  上下文: '<path d="M2.6 3.4 h10.8 v7 h-6.4 l-2.8 2.6 v-2.6 h-1.6 z" fill="none"/>',
  文件: '<path d="M4 2 h5 l3.2 3.2 V14 h-8.2 z" fill="none"/><path d="M9 2 v3.2 h3.2" fill="none"/>',
  提示词: '<path d="M4 4 h8 M4 7 h8 M4 10 h5" /><path d="M2 2.5 v11" stroke-width="2"/>',
  API: '<path d="M5.5 4 L2.5 8 L5.5 12 M10.5 4 L13.5 8 L10.5 12" fill="none"/>',
  数据: '<path d="M6 3 c-2 0 -2 2 -2 3 c0 1 -1 2 -2 2 c1 0 2 1 2 2 c0 1 0 3 2 3 M10 3 c2 0 2 2 2 3 c0 1 1 2 2 2 c-1 0 -2 1 -2 2 c0 1 0 3 -2 3" fill="none"/>',
  文本: '<line x1="3.5" y1="4.5" x2="12.5" y2="4.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/><line x1="3.5" y1="11.5" x2="9" y2="11.5"/>',
  修改动作: '<path d="M10.5 2.5 l3 3 l-8 8 h-3 v-3 z" fill="none"/><line x1="9" y1="4" x2="12" y2="7"/>',
  输入: '<circle cx="8" cy="8" r="5.5" fill="none"/>',
};
// 类型只靠图标形状区分，不用颜色（避免彩虹）。颜色只留红=未接。
const svgIcon = (kind) => `<svg class="ticon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${ICON[kind] || ICON['输入']}</svg>`;

// 按类型归堆
function groupByKind(items) {
  const m = new Map();
  for (const it of items) { const k = it.kind || '输入'; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.entries()];
}
function typeGroup([kind, items]) {
  const anyBad = items.some((i) => i.connected === false);
  const tiles = items.map((i) => {
    const bad = i.connected === false;
    return `<span class="titem${bad ? ' bad' : ''}">${esc(trunc((i.name || '').split(/[／/（(【、,，·|｜:：\s]/)[0], 6))}</span>`;
  }).join('');
  const flag = anyBad ? '<span class="tflag">未接</span>' : '';
  return `<div class="tgroup${anyBad ? ' bad' : ''}">
    <div class="tghead">${svgIcon(kind)}<span class="tgname">${esc(kind)}</span><span class="tgn">${items.length} 个</span>${flag}</div>
    <div class="tgitems">${tiles}</div>
  </div>`;
}

// 解析 pipeline：兼容新老 schema，产出统一的 steps（load/judge/gate）
function parsePipeline(anatomy) {
  const { inputs = [], kernel = {}, outputs = [] } = anatomy || {};
  if (anatomy.pipeline && anatomy.pipeline.length) {
    return anatomy.pipeline.map((s) => {
      const p = String(s).split('|').map((x) => x.trim());
      const t = p[0];
      // 新格式 load|数据名|来源方式|来源名|接通 ；老格式 load|数据名|类型|接通
      if (t === 'load') {
        if (p.length >= 5) return { type: 'load', name: p[1], mech: p[2], source: p[3], bad: /未接|false|no/i.test(p[4] || '') };
        return { type: 'load', name: p[1], mech: p[2], source: '', bad: /未接|false|no/i.test(p[3] || '') };
      }
      if (t === 'gate') return { type: 'gate', text: p[1], action: p[2] || '闸' };
      return { type: 'judge', text: p.slice(1).join(' ') || p[0] };
    });
  }
  // 老 schema 回退：reads 全放前面（全部前置），再接 kernel.steps
  const reads = (anatomy.reads && anatomy.reads.length) ? anatomy.reads : inputs;
  const loads = reads.map((r) => ({ type: 'load', name: r.name, kind: r.kind, bad: r.connected === false }));
  const judges = (kernel.steps || []).map((s) => {
    const str = String(s).trim();
    const gate = /^闸|转人工|禁止|一票|拦截|不足禁/.test(str);
    const text = str.replace(/^闸[·、\-]?\s*/, '');
    if (gate) return { type: 'gate', text, action: /转人工/.test(str) ? '转人工' : /禁|拦|一票|不足/.test(str) ? '拦截' : /标注/.test(str) ? '标注' : '闸' };
    return { type: 'judge', text };
  });
  return [...loads, ...judges];
}

let _graphId = 0;
// n8n/React-Flow 风格：横向连线节点图，顺着线看懂整个逻辑
function buildAnatomy(anatomy) {
  const { outputs = [] } = anatomy || {};
  const input = anatomy.input || (anatomy.inputs && anatomy.inputs[0] && anatomy.inputs[0].name) || '客户名称';
  const steps = parsePipeline(anatomy);
  const loadCount = steps.filter((s) => s.type === 'load').length;
  const judgeCount = steps.filter((s) => s.type === 'judge').length;
  const gateCount = steps.filter((s) => s.type === 'gate').length;
  const badLoad = steps.filter((s) => s.type === 'load' && s.bad).length;
  const firstJudge = steps.findIndex((s) => s.type !== 'load');
  const lastLoad = steps.map((s) => s.type).lastIndexOf('load');
  const interleaved = anatomy.loadMode ? /穿插/.test(anatomy.loadMode) : (firstJudge >= 0 && lastLoad > firstJudge);
  const uid = ++_graphId;

  const NODEW = 156, NODEH = 48, GAPX = 54, ROWH = 78, PADX = 34, PADTOP = 56, BAND = 60, PADBOT = 36;

  // 来源方式 → 图标（库/文档/API/上下文/文件；兼容老的 数据库 写法）
  const MECH_ICON = { 库: '数据库', 数据库: '数据库', 文档: '文档', API: 'API', 上下文: '上下文', 文件: '文件' };
  // 扁平节点：输入(顶) → skill 内部步骤(中间蛇形折行) → 输出(底)。load 副标=具体来源名
  const stepNodes = steps.map((s, idx) => {
    const seq = idx + 1;
    if (s.type === 'load') return { id: 's' + idx, seq, label: shortName(s.name), sub: s.source || s.mech || '', glyph: MECH_ICON[s.mech] || '数据库', cls: 'gload' + (s.bad ? ' gbad' : ''), bad: s.bad };
    if (s.type === 'gate') return { id: 's' + idx, seq, label: s.text, sub: s.action, shape: 'gate', cls: 'ggate' };
    return { id: 's' + idx, seq, label: s.text, shape: 'judge', cls: 'gjudge' };
  });
  const N = stepNodes.length;
  const perRow = Math.max(4, Math.round(Math.sqrt(N * 1.4)));
  const rows = Math.max(1, Math.ceil(N / perRow));
  const gridW = perRow * NODEW + (perRow - 1) * GAPX;

  const inNode = { id: 'in', label: shortName(input), glyph: '上下文', cls: 'gin' };
  const outNodes = (outputs.length ? outputs : [{ name: '输出' }]).map((o, j) => ({ id: 'o' + j, label: shortName(o.name), sub: o.kind, glyph: o.kind || '文档', cls: 'gout' }));

  const midY0 = PADTOP + NODEH + BAND;
  inNode.px = PADX + gridW / 2 - NODEW / 2; inNode.py = PADTOP + NODEH / 2;
  stepNodes.forEach((n, idx) => {
    const row = Math.floor(idx / perRow); let col = idx % perRow; if (row % 2 === 1) col = perRow - 1 - col;
    n.px = PADX + col * (NODEW + GAPX); n.py = midY0 + row * ROWH + NODEH / 2;
  });
  const outY = midY0 + rows * ROWH + BAND;
  const outTotalW = outNodes.length * NODEW + (outNodes.length - 1) * GAPX;
  const outStartX = PADX + gridW / 2 - outTotalW / 2;
  outNodes.forEach((n, j) => { n.px = outStartX + j * (NODEW + GAPX); n.py = outY + NODEH / 2; });

  const allNodes = [inNode, ...stepNodes, ...outNodes];
  const byId = {}; allNodes.forEach((n) => { byId[n.id] = n; });
  const W = PADX * 2 + Math.max(gridW, outTotalW);
  const H = outY + NODEH + PADBOT;

  // 连线：input→step0 → 逐步 → 末步→各输出（顺着序列）
  const edgeList = [];
  if (N) {
    edgeList.push({ from: 'in', to: stepNodes[0].id, bad: false });
    for (let k = 0; k < N - 1; k++) edgeList.push({ from: stepNodes[k].id, to: stepNodes[k + 1].id, bad: stepNodes[k].bad || stepNodes[k + 1].bad });
    outNodes.forEach((o) => edgeList.push({ from: stepNodes[N - 1].id, to: o.id, bad: false }));
  } else outNodes.forEach((o) => edgeList.push({ from: 'in', to: o.id, bad: false }));

  // 连线路径：有明显上下落差(跨带/跨行)走竖向(下边→上边)，同一行才走横向。与前端 JS 一致
  const edgeD = (a, b) => {
    const dy = b.py - a.py;
    if (Math.abs(dy) > NODEH) {
      const sy = dy >= 0 ? a.py + NODEH / 2 : a.py - NODEH / 2, ey = dy >= 0 ? b.py - NODEH / 2 : b.py + NODEH / 2;
      const sx = a.px + NODEW / 2, ex = b.px + NODEW / 2, my = (sy + ey) / 2;
      return `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`;
    }
    const dx = (b.px + NODEW / 2) - (a.px + NODEW / 2);
    const sx = dx >= 0 ? a.px + NODEW : a.px, ex = dx >= 0 ? b.px : b.px + NODEW, mx = (sx + ex) / 2;
    return `M${sx},${a.py} C${mx},${a.py} ${mx},${b.py} ${ex},${b.py}`;
  };
  const edges = edgeList.map((e) => `<path class="ge${e.bad ? ' ge-bad' : ''}" data-from="${e.from}" data-to="${e.to}" marker-end="url(#${e.bad ? 'arwb' : 'arw'}-${uid})" d="${edgeD(byId[e.from], byId[e.to])}"/>`).join('');

  // 三段横带：输入 / SKILL 内部 / 输出
  const bandRect = (y1, y2, label, cls) => `<rect x="${PADX - 18}" y="${y1}" width="${W - 2 * PADX + 36}" height="${y2 - y1}" rx="16" class="gzone ${cls}"/><text x="${PADX - 12}" y="${y1 + 17}" class="gzt">${label}</text>`;
  const zones = bandRect(PADTOP - 24, PADTOP + NODEH + 16, '输入', 'z-in')
    + bandRect(midY0 - 26, midY0 + rows * ROWH - ROWH + NODEH + 20, 'SKILL 内部', 'z-mid')
    + bandRect(outY - 24, outY + NODEH + 16, '输出', 'z-out');

  const glyphSvg = (n) => (n.glyph ? `<g class="gicon" transform="translate(13,-8)" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[n.glyph] || ICON['输入']}</g>` : n.shape === 'gate' ? '<rect x="13" y="-7" width="14" height="14" rx="3" class="gmk-gate"/>' : '<circle cx="20" cy="0" r="6" class="gmk-judge"/>');
  const nodes = allNodes.map((n) => `<g class="gnode ${n.cls}" data-id="${n.id}" transform="translate(${n.px},${n.py})"><rect x="0" y="${-NODEH / 2}" width="${NODEW}" height="${NODEH}" rx="11"/>${glyphSvg(n)}<text x="36" y="${n.sub ? -2 : 5}" class="gt">${esc(trunc(n.label, 7))}</text>${n.sub ? `<text x="36" y="13" class="gsub">${esc(n.sub)}</text>` : ''}</g>`).join('');

  // 类型图例：按来源方式命名（本图用到哪些就列出：图标 + 友好名）
  const LEGEND_LABEL = { 数据库: '结构化库', 文档: '文件文档', API: '外部API', 上下文: '对话/输入', 文件: '文件', 文本: '文本', 数据: '数据', 修改动作: '修改动作' };
  const kindsUsed = []; const seenK = {};
  allNodes.forEach((n) => { const k = n.glyph; if (k && !seenK[k]) { seenK[k] = 1; kindsUsed.push(k); } });
  const typeLegend = kindsUsed.map((k) => `<span class="tlg"><svg class="tlgi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>${esc(LEGEND_LABEL[k] || k)}</span>`).join('');

  const defs = `<defs><marker id="arw-${uid}" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7.5,3 L0,6 Z" class="arwh"/></marker><marker id="arwb-${uid}" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7.5,3 L0,6 Z" class="arwh-bad"/></marker></defs>`;
  const svg = (cls) => `<svg class="${cls}" data-nw="${NODEW}" viewBox="0 0 ${W} ${H}" role="img" aria-label="skill 逻辑连线图">${defs}<g class="gpan">${zones}${edges}${nodes}</g></svg>`;
  return `<div class="pwrap">
    <div class="pmode"><b>${interleaved ? '穿插判定 · 边判边读' : '全部前置 · 先读完再判'}</b> <span class="pcount">主流程 ${loadCount + judgeCount + gateCount} 步 · ${loadCount}读 ${judgeCount}判 ${gateCount}闸</span>${badLoad ? ` <span class="pbadn">${badLoad} 未接</span>` : ''}<span class="plegend"><span class="lg lg-load">读取</span><span class="lg lg-judge">判定</span><span class="lg lg-gate">闸</span></span><button class="fsbtn" type="button" data-open="fs-${uid}">⛶ 全图</button></div>
    <div class="ptypes"><span class="ptl">类型</span>${typeLegend}<span class="ptsep"></span><span class="pll solid">实线 数据流转</span><span class="pll dash">虚线 未接通</span></div>
    <div class="graphscroll">${svg('gsmall')}</div>
    <dialog class="fsdlg" id="fs-${uid}">
      <div class="fsbar"><span class="fstitle">逻辑全图</span><span class="fshint">拖节点摆放 · 拖空白平移 · 滚轮缩放</span><span class="fsctrl"><button type="button" data-z="out">－</button><button type="button" data-z="reset">复位</button><button type="button" data-z="in">＋</button></span><button class="fsclose" type="button" onclick="this.closest('dialog').close()">关闭 ✕</button></div>
      <div class="fsbody">${svg('gfull')}</div>
    </dialog>
  </div>`;
}

// 下钻式详解：pipeline 主视图已展示 输入/读取/判定，下钻只补输出的「作用」
function buildDetail(anatomy) {
  const { outputs = [] } = anatomy || {};
  if (!outputs.length) return '';
  const outTable = `<table class="dt"><thead><tr><th>名称</th><th>类型</th><th>作用</th></tr></thead><tbody>${outputs.map((o) => `<tr><td class="dtn">${esc(o.name || '')}</td><td class="dtk">${esc(o.kind || '')}</td><td class="dtr">${esc(o.role || '')}</td></tr>`).join('')}</tbody></table>`;
  const chev = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 6 l3 3 l3 -3"/></svg>';
  return `<div class="drills">
    <details class="drill"><summary>输出详情${chev}<span class="dcount">${outputs.length} 份</span></summary>${outTable}</details>
  </div>`;
}

// 报告正文（不含 html 骨架），供单页/多页复用
export function renderReportBody(reportData) {
  const v = validateReportData(reportData);
  if (!v.valid) return `<div class="fallback">报告数据不完整：${esc(v.errors.join('；'))}</div>`;
  const d = reportData;
  const steps = (d.nextSteps && d.nextSteps.length) ? d.nextSteps
    : (d.findings || []).map((f) => ({ issue: f.name, fix: f.tag, severity: f.severity === 'hard' ? 'high' : 'mid' }));
  const rows = steps.length
    ? steps.map((s, i) => `<div class="step sev-${esc(s.severity || 'mid')}"><div class="sn">${String(i + 1).padStart(2, '0')}</div><div class="sc"><div class="si">${esc(s.issue || '')}</div><div class="sf">${esc(s.fix || '')}</div></div></div>`).join('')
    : '<div class="allgood">没有需要改的，可以直接用。</div>';
  return `
    <div class="crumb">${esc(d.skill.area || '')} · ${esc(d.skill.line || '')}</div>
    <div class="head">
      <h1>${esc(d.skill.name)}</h1>
      <div class="vchip v-${esc(d.verdict.level)}"><span class="vdot"></span>${esc(VERDICT_LABEL[d.verdict.level] || d.verdict.level)}</div>
    </div>
    <p class="lead">${esc(d.summary || d.verdict.text)}</p>
    ${buildAnatomy(d.anatomy)}
    ${buildDetail(d.anatomy)}
    <div class="sectitle">要改这几件事</div>
    <div class="steps">${rows}</div>
    <div class="foot">${esc(d.skill.submitter || '')} · ${esc(d.skill.evaluatedAt || '')}</div>`;
}

const PANZOOM_JS = `
(function(){
  function wire(body){
    var svg=body.querySelector('svg.gfull'); if(!svg) return;
    var g=svg.querySelector('.gpan'); if(!g) return;
    var NW=+svg.getAttribute('data-nw')||156, NH=48;
    var s=1,tx=0,ty=0;
    var nodes={};
    g.querySelectorAll('.gnode').forEach(function(n){
      var m=/translate\\(([-0-9.]+),([-0-9.]+)\\)/.exec(n.getAttribute('transform'))||['','0','0'];
      nodes[n.getAttribute('data-id')]={el:n,x:+m[1],y:+m[2]};
    });
    var edges=[];
    g.querySelectorAll('path.ge').forEach(function(p){ edges.push({el:p,from:p.getAttribute('data-from'),to:p.getAttribute('data-to')}); });
    function edgeD(a,b){ var dy=b.y-a.y; if(Math.abs(dy)>NH){ var sy=dy>=0?a.y+NH/2:a.y-NH/2, ey=dy>=0?b.y-NH/2:b.y+NH/2, sx=a.x+NW/2, ex=b.x+NW/2, my=(sy+ey)/2; return 'M'+sx+','+sy+' C'+sx+','+my+' '+ex+','+my+' '+ex+','+ey; } var dx=(b.x+NW/2)-(a.x+NW/2), sx2=dx>=0?a.x+NW:a.x, ex2=dx>=0?b.x:b.x+NW, mx=(sx2+ex2)/2; return 'M'+sx2+','+a.y+' C'+mx+','+a.y+' '+mx+','+b.y+' '+ex2+','+b.y; }
    function redrawEdges(id){ for(var i=0;i<edges.length;i++){ var e=edges[i]; if(id&&e.from!==id&&e.to!==id)continue; var a=nodes[e.from],b=nodes[e.to]; if(a&&b)e.el.setAttribute('d',edgeD(a,b)); } }
    function apply(){ g.setAttribute('transform','translate('+tx+','+ty+') scale('+s+')'); }
    function k(){ var r=svg.getBoundingClientRect(); return r.width?svg.viewBox.baseVal.width/r.width:1; }
    function fit(){ var xs=[],ys=[]; for(var id in nodes){var n=nodes[id];xs.push(n.x,n.x+NW);ys.push(n.y-NH,n.y+NH);} if(!xs.length)return; var minx=Math.min.apply(0,xs),maxx=Math.max.apply(0,xs),miny=Math.min.apply(0,ys),maxy=Math.max.apply(0,ys); var vb=svg.viewBox.baseVal,pad=50; var gw=maxx-minx+pad*2,gh=maxy-miny+pad*2; s=Math.min(vb.width/gw, vb.height/gh, 2.2); tx=(vb.width-(minx+maxx)*s)/2; ty=(vb.height-(miny+maxy)*s)/2; apply(); }
    function zoomAt(f,cx,cy){ var r=svg.getBoundingClientRect(),kk=k(); var mx=(cx-r.left)*kk,my=(cy-r.top)*kk; var ns=Math.max(.2,Math.min(4,s*f)); f=ns/s; tx=mx-(mx-tx)*f; ty=my-(my-ty)*f; s=ns; apply(); }
    var mode=null,px=0,py=0,cur=null;
    svg.addEventListener('mousedown',function(e){ var nd=e.target.closest('.gnode'); px=e.clientX;py=e.clientY; if(nd){mode='node';cur=nodes[nd.getAttribute('data-id')];nd.parentNode.appendChild(nd);} else mode='pan'; body.style.cursor='grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove',function(e){ if(!mode)return; var kk=k(),dx=(e.clientX-px)*kk,dy=(e.clientY-py)*kk; px=e.clientX;py=e.clientY; if(mode==='pan'){tx+=dx;ty+=dy;apply();} else if(cur){ cur.x+=dx/s; cur.y+=dy/s; cur.el.setAttribute('transform','translate('+cur.x+','+cur.y+')'); redrawEdges(cur.el.getAttribute('data-id')); } });
    window.addEventListener('mouseup',function(){mode=null;cur=null;body.style.cursor='grab';});
    svg.addEventListener('wheel',function(e){e.preventDefault();zoomAt(e.deltaY<0?1.12:0.89,e.clientX,e.clientY);},{passive:false});
    body.style.cursor='grab';
    var bar=body.parentNode.querySelector('.fsctrl');
    if(bar)bar.addEventListener('click',function(e){var z=e.target.getAttribute('data-z');if(!z)return;var r=svg.getBoundingClientRect();if(z==='in')zoomAt(1.2,r.left+r.width/2,r.top+r.height/2);else if(z==='out')zoomAt(1/1.2,r.left+r.width/2,r.top+r.height/2);else fit();});
    body._fit=fit;
  }
  document.querySelectorAll('.fsbody').forEach(wire);
  document.querySelectorAll('.fsbtn[data-open]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var dlg=document.getElementById(btn.getAttribute('data-open')); if(!dlg)return;
      dlg.showModal();
      var body=dlg.querySelector('.fsbody');
      requestAnimationFrame(function(){ if(body&&body._fit)body._fit(); });
    });
  });
})();
`;

function pageShell(inner) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>${inner}<script>${PANZOOM_JS}</script></body></html>`;
}

export function renderReportHtml(reportData) {
  return pageShell(`<div class="wrap">${renderReportBody(reportData)}</div>`);
}

// 对比页：一页放多份报告，各带标题
export function renderComparePage(items) {
  const secs = items.map((it) => `<div class="cmpsec"><div class="cmphd">${esc(it.label)}</div><div class="wrap">${renderReportBody(it.data)}</div></div>`).join('');
  return pageShell(secs);
}

const STYLE = `
:root{--bg:#F6F8FB;--surface:#FFFFFF;--surface2:#EFF2F7;--ink:#181C24;--muted:#5B6575;--line:#E2E6ED;--accent:#2A5DA6;--accent-soft:#E8EFF8;--accent-ink:#204A86;--pass:#1E7D46;--pass-soft:#E5F1EA;--warn:#9A6510;--warn-soft:#FAF0DC;--fail:#BE3A34;--fail-soft:#F9E7E5;--mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;}
@media(prefers-color-scheme:dark){:root{--bg:#0E1219;--surface:#161B24;--surface2:#1E2530;--ink:#E6EAF1;--muted:#8B95A6;--line:#28313E;--accent:#6B9BE0;--accent-soft:#152238;--accent-ink:#A6C6EE;--pass:#5BC97E;--pass-soft:#123020;--warn:#E3A94E;--warn-soft:#33270F;--fail:#EE8177;--fail-soft:#3A1512;}}
:root[data-theme="dark"]{--bg:#0E1219;--surface:#161B24;--surface2:#1E2530;--ink:#E6EAF1;--muted:#8B95A6;--line:#28313E;--accent:#6B9BE0;--accent-soft:#152238;--accent-ink:#A6C6EE;--pass:#5BC97E;--pass-soft:#123020;--warn:#E3A94E;--warn-soft:#33270F;--fail:#EE8177;--fail-soft:#3A1512;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:980px;margin:0 auto;padding:46px 26px 96px}
.crumb{font:600 11px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.head h1{font-size:31px;font-weight:800;letter-spacing:-.022em;margin:0;line-height:1.18}
.vchip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;border-radius:999px;padding:5px 14px}
.vchip .vdot{width:7px;height:7px;border-radius:50%}
.v-partial{background:var(--warn-soft);color:var(--warn)}.v-partial .vdot{background:var(--warn)}
.v-pass{background:var(--pass-soft);color:var(--pass)}.v-pass .vdot{background:var(--pass)}
.v-fail{background:var(--fail-soft);color:var(--fail)}.v-fail .vdot{background:var(--fail)}
.lead{font-size:17.5px;line-height:1.75;color:var(--ink);opacity:.82;margin:18px 0 36px;max-width:60ch}
/* 统一执行序列 */
.pwrap{padding:28px 26px;margin:0 0 44px;background:var(--surface);border-radius:22px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 10px 34px rgba(0,0,0,.045)}
.pends{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.pend{font:600 12px var(--mono);color:var(--muted);white-space:nowrap;display:flex;flex-direction:column;gap:3px}
.pend b{font-size:15px;color:var(--ink);font-family:-apple-system,"PingFang SC",sans-serif}
.pend.in b{color:var(--accent-ink)}
.pflowline{flex:1;text-align:center;font-size:12.5px;color:var(--muted);border-top:1.5px dashed var(--line);padding-top:8px;margin-top:14px}
.pmode{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:16px}
.pmode b{color:var(--ink);font-size:13.5px}
.pcount{font:500 12px var(--mono)}
.pbadn{color:var(--fail);font-weight:700;font-size:12px}
.plegend{margin-left:auto;display:flex;gap:14px}
.lg{font:600 11px var(--mono);color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.lg::before{content:"";width:9px;height:9px;border-radius:50%}
.lg-load::before{background:var(--accent)}
.lg-judge::before{background:var(--muted)}
.lg-gate::before{background:var(--fail)}
.ptypes{display:flex;flex-wrap:wrap;align-items:center;gap:16px;font:600 12px var(--mono);margin:0 0 16px;padding:10px 14px;background:var(--surface2);border-radius:9px}
.ptl{color:var(--muted);letter-spacing:.06em}
.tlg{display:inline-flex;align-items:center;gap:6px;color:var(--ink)}
.tlgi{width:16px;height:16px;color:var(--accent-ink)}
.ptsep{width:1px;height:15px;background:var(--line)}
.pll{display:inline-flex;align-items:center;gap:7px;color:var(--ink)}
.pll::before{content:"";width:24px;border-top:2px solid var(--muted)}
.pll.dash::before{border-top:2px dashed var(--fail)}
.graphscroll{overflow-x:auto;margin:0 -6px;padding:4px 6px}
.graphscroll svg{height:auto;min-width:100%}
.fsbtn{margin-left:14px;cursor:pointer;font:600 12px -apple-system,"PingFang SC",sans-serif;color:var(--accent-ink);background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:5px 12px}
.fsbtn:hover{background:var(--accent);color:#fff}
.fsdlg{border:none;border-radius:16px;padding:0;width:min(94vw,1500px);max-width:94vw;height:88vh;background:var(--surface);color:var(--ink);box-shadow:0 20px 70px rgba(0,0,0,.4)}
.fsdlg::backdrop{background:rgba(0,0,0,.55)}
.fsbar{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line)}
.fstitle{font:700 14px -apple-system,"PingFang SC",sans-serif}
.fshint{font:500 11.5px var(--mono);color:var(--muted)}
.fsctrl{margin-left:auto;display:flex;gap:6px}
.fsctrl button{cursor:pointer;font:600 13px var(--mono);color:var(--ink);background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:5px 12px;min-width:36px}
.fsctrl button:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)}
.fsclose{cursor:pointer;font:600 13px -apple-system,"PingFang SC",sans-serif;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:6px 14px}
.fsclose:hover{color:var(--fail);border-color:var(--fail)}
.fsbody{overflow:hidden;height:calc(88vh - 56px);touch-action:none;background:var(--bg)}
.fsbody svg.gfull{width:100%;height:100%;display:block}
.gpan{transition:none}
.ge{stroke:var(--muted);stroke-width:1.7;fill:none;opacity:.75}
.ge-bad{stroke:var(--fail);stroke-width:1.7;fill:none;stroke-dasharray:6 5;opacity:.8}
.arwh{fill:var(--muted)}
.arwh-bad{fill:var(--fail)}
.gnum circle{fill:var(--accent);stroke:var(--surface);stroke-width:2}
.gload.gbad .gnum circle,.ggate .gnum circle{fill:var(--fail)}
.gnum text{text-anchor:middle;font:700 11px var(--mono);fill:#fff}
.gfull .gnode{cursor:move}
.gzone{fill:var(--surface2);opacity:.5;stroke:none}
.z-mid{fill:var(--accent-soft);opacity:.35}
.gzt{font:700 11px var(--mono);letter-spacing:.08em;fill:var(--muted);text-transform:uppercase}
.gnode rect{fill:var(--surface);stroke:var(--line);stroke-width:1.5}
.gin rect{fill:var(--accent-soft);stroke:var(--accent);stroke-width:2}
.gload rect{fill:var(--surface);stroke:var(--accent);stroke-width:1.5}
.gload.gbad rect{fill:var(--fail-soft);stroke:var(--fail)}
.gjudge rect{fill:var(--surface);stroke:var(--line)}
.ggate rect{fill:var(--fail-soft);stroke:var(--fail);stroke-width:1.5}
.gout rect{fill:var(--surface);stroke:var(--line)}
.gicon{stroke:var(--accent);fill:none}
.gin .gicon{stroke:var(--accent-ink)}
.gload.gbad .gicon{stroke:var(--fail)}
.gout .gicon{stroke:var(--muted)}
.gmk-judge{fill:var(--muted)}
.gmk-gate{fill:var(--fail)}
.gt{text-anchor:start;font:600 13px -apple-system,"PingFang SC",sans-serif;fill:var(--ink)}
.gin .gt{fill:var(--accent-ink)}
.gload.gbad .gt,.ggate .gt{fill:var(--fail)}
.gsub{text-anchor:start;font:500 9.5px var(--mono);fill:var(--muted)}
.gload.gbad .gsub{fill:var(--fail)}
.cmpsec{border-bottom:8px solid var(--surface2)}
.cmpsec:last-child{border-bottom:0}
.cmphd{max-width:980px;margin:0 auto;padding:32px 26px 0;font:700 12px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}
.cmpsec .wrap{padding-top:16px}
/* 下钻式详解：默认收起，点击展开 table */
.drills{margin:0 0 40px;border-top:1px solid var(--line)}
.drill{border-bottom:1px solid var(--line)}
.drill summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:16px 2px;font-size:15px;font-weight:700}
.drill summary::-webkit-details-marker{display:none}
.drill .chev{width:15px;height:15px;color:var(--muted);transition:transform .2s}
.drill[open] .chev{transform:rotate(180deg)}
.dcount{margin-left:auto;font:500 12px var(--mono);color:var(--muted)}
.dt{width:100%;border-collapse:collapse;font-size:13.5px;margin:2px 0 18px}
.dt th{text-align:left;font:600 11px var(--mono);color:var(--muted);letter-spacing:.04em;text-transform:uppercase;padding:6px 12px 8px 0;border-bottom:1px solid var(--line)}
.dt td{padding:11px 12px 11px 0;border-bottom:1px solid var(--line);vertical-align:top}
.dt tr:last-child td{border-bottom:0}
.dtn{font-weight:700;white-space:nowrap}
.dtk{color:var(--muted);font:500 12px var(--mono);white-space:nowrap}
.dtr{color:var(--muted);font-size:13px;line-height:1.5}
.dtg{text-align:right;width:40px}
.dt tr.bad .dtn{color:var(--fail)}
.no{font:700 10.5px var(--mono);color:var(--fail);background:var(--fail-soft);border-radius:5px;padding:2px 7px;white-space:nowrap}
.yes{font:700 10.5px var(--mono);color:var(--muted);white-space:nowrap}
.dess{font-size:14px;font-weight:700;color:var(--accent-ink);margin:6px 0 12px;line-height:1.5}
/* 内核逻辑流程：带编号的顺序管线，一条线连下来，闸标红 */
.kflownote{font-size:12.5px;color:var(--muted);margin:0 0 14px;padding:9px 13px;background:var(--surface2);border-radius:8px;line-height:1.55}
.kflow{position:relative;margin-bottom:6px}
.kstep{display:flex;gap:14px;align-items:flex-start;padding:8px 0;position:relative}
.kstepn{flex:none;width:26px;height:26px;border-radius:50%;background:var(--surface);border:1.5px solid var(--line);color:var(--muted);font:700 12px var(--mono);display:flex;align-items:center;justify-content:center;position:relative;z-index:1}
.kstep.gate .kstepn{background:var(--fail-soft);border-color:var(--fail);color:var(--fail)}
.kstep:not(:last-child)::before{content:"";position:absolute;left:12.5px;top:30px;height:calc(100% - 20px);width:1.5px;background:var(--line)}
.ksteptext{flex:1;font-size:14px;padding-top:4px;line-height:1.5}
.kstep.gate .ksteptext{font-weight:600}
.kgatetag{flex:none;font:700 10px var(--mono);color:var(--fail);background:var(--fail-soft);border:1px solid var(--fail);border-radius:5px;padding:2px 8px;margin-top:5px;white-space:nowrap}
/* 要改这几件事：编号列表 + 细分隔线，编辑感 */
.sectitle{font-size:13px;font-weight:800;letter-spacing:.02em;margin:0 0 4px;display:flex;align-items:center;gap:12px}
.sectitle::after{content:"";flex:1;height:1px;background:var(--line)}
.steps{margin-top:6px}
.step{display:flex;gap:20px;align-items:flex-start;padding:20px 2px;border-bottom:1px solid var(--line)}
.step:last-child{border-bottom:0}
.sn{flex:none;font:800 22px var(--mono);color:var(--line);line-height:1;margin-top:2px;width:32px}
.step.sev-high .sn{color:var(--fail)}.step.sev-mid .sn{color:var(--warn)}.step.sev-low .sn{color:var(--pass)}
.sc{flex:1;min-width:0}
.si{font-size:16.5px;font-weight:700;line-height:1.5}
.sf{font-size:14.5px;color:var(--muted);margin-top:8px;line-height:1.65}
.sf::before{content:"→ ";color:var(--accent-ink);font-weight:700}
.allgood{font-size:15px;color:var(--pass);font-weight:600;padding:18px 2px}
.foot{font:500 11.5px var(--mono);color:var(--muted);letter-spacing:.04em;margin-top:44px}
.fallback{background:var(--fail-soft);border:1px solid var(--fail);color:var(--fail);border-radius:12px;padding:22px;font-weight:600}
@media(max-width:640px){.head h1{font-size:25px}.lead{font-size:15.5px}}
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-render.test.js`

Expected: PASS（3 个 `it` 全绿）。

再补一条不属于本任务但必须确认的回归检查（不改代码，只跑）：

Run: `cd packages/brain && npx vitest run src/__tests__/eval-report.test.js`

Expected: PASS —— 这个文件不在本次改动范围内，用的是老 fixture `src/__fixtures__/daily-report-cs.report.json`（`anatomy.{inputs,kernel,outputs}` 老结构，无 `pipeline`）。新渲染器的 `validateReportData`（此时还是老 schema.js，Task 2 才换）依然认得这个老 fixture（`Array.isArray(a.inputs)` 为真），`buildAnatomy` 走 `parsePipeline` 的老结构回退分支（`reads`/`inputs` + `kernel.steps` —— 注意老 fixture 用的是 `kernel.rules` 不是 `kernel.steps`，所以 `judges` 会是空数组，只有 `loads`，这是预期行为，不影响该测试的断言）。它断言 `res.text` 包含 `'输入'`/`'内核'`/`'输出'`/`'stroke-dasharray'`：`'输入'`/`'输出'` 来自新渲染器的三段带标签；`'内核'` 恰好出现在新 `STYLE` 常量里的 CSS 注释 `/* 内核逻辑流程：... */`（字面量子串命中，非语义相关，但确实存在于输出 HTML 里）；`'stroke-dasharray'` 来自新 `STYLE` 里 `.ge-bad{...stroke-dasharray:6 5...}` 这条 CSS 规则，同样是页面内联样式表的一部分，与传入的数据无关，恒定存在。这几点都已经用真实的新 render.js 跑过验证，不是猜测。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/skill-eval-report-render.js packages/brain/src/__tests__/skill-eval-report-render.test.js
git commit -m "feat(skill-eval): 折回 render.mjs 到 skill-eval-report-render.js（n8n 连线图渲染器）"
```

---

### Task 2: 折回 schema —— `skill-eval-report-schema.js`

**Files:**
- Modify: `packages/brain/src/skill-eval-report-schema.js`
- Test: `packages/brain/src/__tests__/skill-eval-report-schema.test.js`

**背景：** 本任务只改校验规则本身，不依赖 Task 1 的渲染器改动。用一个"老结构但没有 `kernel` 字段"的 fixture 做判别：老 schema.js 强制要求 `anatomy.kernel.rules` 是数组，这个 fixture 没有 `kernel` 字段，老 schema 必然报错；新 schema.js（折自 render.mjs）完全不检查 `kernel`，只要求 `pipeline` 或 `inputs` 二选一存在 + `outputs` 是数组，这个 fixture 满足新规则。已经用真实老 schema.js 逐字模拟验证过这一判别确实成立（`valid:false`，报错信息 `'anatomy.kernel.rules 必须是数组'`）。

- [ ] **Step 1: Write the failing test**

把 `packages/brain/src/__tests__/skill-eval-report-schema.test.js` 整个替换成：

```js
import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import legacyFixture from '../__fixtures__/daily-report-cs.report.json';

describe('validateReportData — 兼容新 pipeline 结构 + 老 inputs/kernel 结构', () => {
  it('老结构但没有 kernel 字段（只有 inputs + outputs）——新规则不查 kernel，应该合法', () => {
    const noKernelLegacy = {
      skill: { name: 'x' },
      verdict: { level: 'pass' },
      anatomy: { inputs: [{ name: 'a' }], outputs: [{ name: 'b' }] },
    };
    const r = validateReportData(noKernelLegacy);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('新 pipeline 结构（无 inputs/kernel）合法', () => {
    const pipelineOnly = {
      skill: { name: 'x' },
      verdict: { level: 'partial' },
      anatomy: { pipeline: ['load|a|库|来源|已接'], outputs: [{ name: 'b' }] },
    };
    const r = validateReportData(pipelineOnly);
    expect(r.valid).toBe(true);
  });

  it('anatomy 既无 pipeline 也无 inputs → 报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pipeline.*inputs|inputs.*pipeline/);
  });

  it('缺 skill.name 报错', () => {
    const r = validateReportData({ verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/skill\.name/);
  });

  it('verdict.level 非枚举报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'maybe' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/verdict\.level/);
  });

  it('anatomy.outputs 非数组报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: 'nope' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/outputs/);
  });

  it('向后兼容：eval-report.test.js 仍在用的老 fixture（inputs/kernel.rules/outputs 全套老结构）依然合法', () => {
    const r = validateReportData(legacyFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-schema.test.js`

Expected: FAIL —— 第一个 `it`（"老结构但没有 kernel 字段"）失败：当前 `skill-eval-report-schema.js` 的 `validateReportData` 里有 `if (!a.kernel || !Array.isArray(a.kernel.rules)) errs.push('anatomy.kernel.rules 必须是数组');`，`noKernelLegacy.anatomy` 没有 `kernel` 字段，`a.kernel` 为 `undefined`，触发这条错误，`r.valid` 是 `false` 不是期望的 `true`。第二个 `it`（"新 pipeline 结构合法"）同样失败，原因相同（没有 `kernel` 字段）。第三个 `it` 的错误消息断言也会失败，因为老 schema 报的是 `anatomy.inputs 必须是数组`（`pipelineOnly` 没有 `pipeline` 概念，老 schema 根本不认识这个字段名，检查的是 `a.inputs`），不匹配 `/pipeline.*inputs|inputs.*pipeline/`。

- [ ] **Step 3: Write minimal implementation**

把 `packages/brain/src/skill-eval-report-schema.js` 整个替换成（折自 `~/perfect21/skill-eval-formb-assets/render.mjs` 里的 `validateReportData`）：

```js
// report-data：一份评估报告的结构化数据。渲染器与端点共用。
// validateReportData 折自 skill-eval-formb-assets/render.mjs（Track 2 折回，2026-07-08）——
// 同时兼容新 anatomy.pipeline 结构和旧 anatomy.{inputs,kernel,outputs} 结构：
// 字段存在哪个就按哪个校验规则走，不强制二选一报错。
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');
  const a = d.anatomy || {};
  const hasPipeline = Array.isArray(a.pipeline) && a.pipeline.length;
  const hasLegacy = Array.isArray(a.inputs);
  if (!hasPipeline && !hasLegacy) errs.push('anatomy 需含 pipeline 或 inputs');
  if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组');
  return { valid: errs.length === 0, errors: errs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-schema.test.js`

Expected: PASS（7 个 `it` 全绿）。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/skill-eval-report-schema.js packages/brain/src/__tests__/skill-eval-report-schema.test.js
git commit -m "feat(skill-eval): 折回 render.mjs 的 validateReportData 到 skill-eval-report-schema.js（兼容 pipeline/legacy 双结构）"
```

---

### Task 3: 用真实 fixture 重写测试（回归/特征化套件）

**Files:**
- Create: `packages/brain/src/__tests__/fixtures/report_data8-real.json`（从 `~/perfect21/skill-eval-formb-assets/report_data8-real.json` 复制，全部前置示例）
- Create: `packages/brain/src/__tests__/fixtures/report_interleaved-example.json`（从 `~/perfect21/skill-eval-formb-assets/report_interleaved-example.json` 复制，穿插判定示例）
- Modify: `packages/brain/src/__tests__/skill-eval-report-render.test.js`（覆盖 Task 1 写的临时 smoke test）
- Modify: `packages/brain/src/__tests__/skill-eval-report-schema.test.js`（覆盖 Task 2 写的临时 smoke test）

**关于本任务 RED/GREEN 的说明（不回避的实话）：** Task 1、2 已经把 `skill-eval-report-render.js` / `skill-eval-report-schema.js` 折成了和 `render.mjs` 逐字一致的生产实现。本任务写的是"用两份真实生产数据锁定行为"的特征化测试（regression/characterization tests），不是驱动新逻辑的行为测试——所以 Step 2 预期结果是 **PASS**，不是经典 TDD 的 FAIL。这是刻意的：所有断言的具体字符串（步数统计、未接数量、图例文案等）已经用真实的 `render.mjs`（等价于折回后的 render.js）跑过一遍验证是真实产物，不是猜测或臆造。如果 Step 2 跑出来是 FAIL，说明 Task 1/2 的折回有偏差（比如漏抄了一行、typo），必须回去修 Task 1/2 的实现文件，而不是改这里的断言去将就一个错误实现。

- [ ] **Step 1: Write the failing/characterizing test**

先复制两份真实 fixture：

```bash
mkdir -p packages/brain/src/__tests__/fixtures
cp ~/perfect21/skill-eval-formb-assets/report_data8-real.json packages/brain/src/__tests__/fixtures/report_data8-real.json
cp ~/perfect21/skill-eval-formb-assets/report_interleaved-example.json packages/brain/src/__tests__/fixtures/report_interleaved-example.json
```

把 `packages/brain/src/__tests__/skill-eval-report-schema.test.js` 整个替换成：

```js
import { describe, it, expect } from 'vitest';
import { validateReportData } from '../skill-eval-report-schema.js';
import legacyFixture from '../__fixtures__/daily-report-cs.report.json';
import realFixture from './fixtures/report_data8-real.json';
import interleavedFixture from './fixtures/report_interleaved-example.json';

describe('validateReportData — 真实 fixture 回归套件', () => {
  it('report_data8-real.json（全部前置，8 类资料源）合法', () => {
    const r = validateReportData(realFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('report_interleaved-example.json（穿插判定）合法', () => {
    const r = validateReportData(interleavedFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('向后兼容：老 anatomy.{inputs,kernel.rules,outputs} 结构（eval-report.test.js 仍在用）依然合法', () => {
    const r = validateReportData(legacyFixture);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('新 pipeline 结构但没有 inputs/kernel 也合法（纯 pipeline 场景）', () => {
    const r = validateReportData({
      skill: { name: 'x' },
      verdict: { level: 'partial' },
      anatomy: { pipeline: ['load|a|库|来源|已接'], outputs: [{ name: 'b' }] },
    });
    expect(r.valid).toBe(true);
  });

  it('anatomy 既无 pipeline 也无 inputs → 报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pipeline.*inputs|inputs.*pipeline/);
  });

  it('缺 skill.name 报错', () => {
    const r = validateReportData({ verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/skill\.name/);
  });

  it('verdict.level 非枚举报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'maybe' }, anatomy: { inputs: [], outputs: [] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/verdict\.level/);
  });

  it('anatomy.outputs 非数组报错', () => {
    const r = validateReportData({ skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { inputs: [], outputs: 'nope' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/outputs/);
  });
});
```

把 `packages/brain/src/__tests__/skill-eval-report-render.test.js` 整个替换成：

```js
import { describe, it, expect } from 'vitest';
import { renderReportHtml, renderComparePage, validateReportData } from '../skill-eval-report-render.js';
import realFixture from './fixtures/report_data8-real.json';
import interleavedFixture from './fixtures/report_interleaved-example.json';

describe('renderReportHtml — report_data8-real.json（全部前置，daily-report-v1-2）', () => {
  const html = renderReportHtml(realFixture);

  it('不落入 fallback 兜底态', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('是完整 HTML 页面', () => {
    expect(html).toMatch(/^<!doctype html>/i);
  });

  it('breadcrumb 含 area/line', () => {
    expect(html).toContain('Line 02 客户智能获客路径');
  });

  it('skill 名称与裁决标签出现', () => {
    expect(html).toContain('daily-report-v1-2');
    expect(html).toContain('改了能用'); // verdict.level === 'partial' 的中文标签
  });

  it('summary 一句话出现在 lead 里', () => {
    expect(html).toContain('规则写得细致老实,但客户数据库这些资料源压根没接通,现在跑不了全自动化。');
  });

  it('识别出 loadMode=全部前置，不是穿插判定', () => {
    expect(html).toContain('全部前置 · 先读完再判');
  });

  it('主流程步数统计：pipeline 共 15 步，7 读 6 判 2 闸；6 个 load 未接', () => {
    expect(html).toContain('7读 6判 2闸');
    expect(html).toContain('6 未接');
  });

  it('输入节点 客户名称 与判定/闸步骤文案原样出现在连线图节点里', () => {
    expect(html).toContain('客户名称');
    expect(html).toContain('判推进信号强弱'); // judge 步骤
    expect(html).toContain('事实越界编造'); // gate 步骤
  });

  it('输出节点名称出现', () => {
    expect(html).toContain('单客户日报');
  });

  it('nextSteps 第一条（issue+fix）原样出现', () => {
    expect(html).toContain('客户数据库等8类资料源全包没有任何真实接口定义');
    expect(html).toContain('补上数据库或API对接方式,或明确改成用户手动贴资料模式');
  });
});

describe('renderReportHtml — report_interleaved-example.json（穿插判定，realtime-reply-cs）', () => {
  const html = renderReportHtml(interleavedFixture);

  it('不落入 fallback 兜底态', () => {
    expect(html).not.toContain('报告数据不完整');
  });

  it('识别出 loadMode=穿插判定', () => {
    expect(html).toContain('穿插判定 · 边判边读');
  });

  it('主流程步数统计：11 步，4 读 5 判 2 闸；1 个 load 未接（历史订单）', () => {
    expect(html).toContain('4读 5判 2闸');
    expect(html).toContain('1 未接');
  });

  it('skill 名称与 summary 出现', () => {
    expect(html).toContain('realtime-reply-cs');
    expect(html).toContain('边判边读逻辑清晰，但历史订单接口没接通');
  });

  it('类型图例含来源方式友好名（结构化库 / 外部API）', () => {
    expect(html).toContain('结构化库');
    expect(html).toContain('外部API');
  });

  it('nextSteps 第一条原样出现', () => {
    expect(html).toContain('历史订单 API 没接，第5步拿不到数据');
  });
});

describe('validateReportData 对两份真实 fixture 均判定合法（不进入 fallback 的前提条件）', () => {
  it('report_data8-real.json valid', () => {
    expect(validateReportData(realFixture)).toEqual({ valid: true, errors: [] });
  });
  it('report_interleaved-example.json valid', () => {
    expect(validateReportData(interleavedFixture)).toEqual({ valid: true, errors: [] });
  });
});

describe('renderComparePage — 导出面保留验证（无新调用方，但需保证可用）', () => {
  it('把两份真实报告放进一页对比，各自 label 与 skill 名称都出现', () => {
    const html = renderComparePage([
      { label: '全部前置示例', data: realFixture },
      { label: '穿插判定示例', data: interleavedFixture },
    ]);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('全部前置示例');
    expect(html).toContain('穿插判定示例');
    expect(html).toContain('daily-report-v1-2');
    expect(html).toContain('realtime-reply-cs');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (characterization, not RED→GREEN)**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-render.test.js src/__tests__/skill-eval-report-schema.test.js`

Expected: PASS，全部 it 通过（render 测试 16 个左右 + schema 测试 8 个）。如果任意一条 FAIL，先去比对 Task 1/2 落地的 `skill-eval-report-render.js` / `skill-eval-report-schema.js` 是否与本计划 Step 3 给出的代码逐字一致（最常见问题：漏了某一行、`ICON` 表打错字、`LEGEND_LABEL` 少了一项），修完 Task 1/2 的实现文件后再回来重跑本命令。

再补一条回归确认：

Run: `cd packages/brain && npx vitest run src/__tests__/eval-report.test.js src/routes/__tests__/eval.test.js`

Expected: PASS —— 确认折回没有破坏 `routes/eval.js` 现有的上传/状态/报告端点测试。

- [ ] **Step 3: (已在 Task 1/2 完成，本任务无需再改实现代码)**

本任务不涉及实现文件改动，`skill-eval-report-render.js` / `skill-eval-report-schema.js` 维持 Task 1/2 落地后的样子不变。

- [ ] **Step 4: Run full brain unit suite once more to catch cross-file regressions**

Run: `cd packages/brain && npx vitest run src/__tests__/skill-eval-report-render.test.js src/__tests__/skill-eval-report-schema.test.js src/__tests__/eval-report.test.js src/routes/__tests__/eval.test.js`

Expected: PASS（4 个测试文件全绿）。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/__tests__/fixtures/report_data8-real.json \
        packages/brain/src/__tests__/fixtures/report_interleaved-example.json \
        packages/brain/src/__tests__/skill-eval-report-render.test.js \
        packages/brain/src/__tests__/skill-eval-report-schema.test.js
git commit -m "test(skill-eval): 用 report_data8-real / report_interleaved-example 两份真实 fixture 重写 render/schema 回归套件"
```

---

### Task 4: 新增评估 worker —— `scripts/skill-eval-worker.js`

**Files:**
- Create: `packages/brain/scripts/skill-eval-worker.js`
- Test: `packages/brain/scripts/__tests__/skill-eval-worker.test.js`

**依赖说明（回答"是否需要新装解压 zip 依赖"）：** `packages/brain/package.json` 已经有 `unzipper: ^0.12.5`（`skill-eval-validator.js` 里已经在用它做 zip 硬校验的流式解析）。本任务复用同一个包做实际解压落盘，用它的 `unzipper.Extract({ path })` 流式 API（`fs.createReadStream(zip).pipe(unzipper.Extract({path:destDir}))`），**不需要新装 `adm-zip` 等新依赖，也不需要 shell 出去调系统 `unzip` 命令**。

**测试运行方式说明：** 本仓库 `packages/brain/vitest.config.js` 的 `include` 列表没有覆盖 `scripts/**`（`scripts/__tests__/harness-report.test.mjs` 这个先例文件目前也不在 `include` glob 里，只能被显式指定文件路径运行，不会被裸 `npx vitest run` 的默认 glob 捡到）。本任务的测试同样按此约定处理：**必须显式传测试文件路径运行**，不依赖默认 include。这不属于本 PR 要修的问题（不在四个任务范围内），如后续要让 CI 自动跑 `scripts/__tests__/**`，需要另开一个改 `vitest.config.js` include 列表的任务。

- [ ] **Step 1: Write the failing test**

创建 `packages/brain/scripts/__tests__/skill-eval-worker.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js';

describe('sanitizeJsonString — 清理字符串值内部未转义的双引号', () => {
  it('把夹在普通字符中间的英文双引号删掉，使原本非法的 JSON 变得可解析', () => {
    const broken = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    expect(() => JSON.parse(broken)).toThrow();
    const cleaned = sanitizeJsonString(broken);
    const parsed = JSON.parse(cleaned);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('结构性引号（紧跟 : , { [ } ] 的）不受影响，正常 JSON 清理后仍然是原样', () => {
    const good = JSON.stringify({ skill: { name: 'ok' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } });
    expect(sanitizeJsonString(good)).toBe(good);
  });
});

describe('extractReportJson — 从 `claude -p ... --output-format json` 的 stdout 解析 report_data', () => {
  it('envelope.result 是合法 JSON 字符串时直接解析成功', () => {
    const reportData = { skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } };
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reportData) });
    expect(extractReportJson(stdout)).toEqual(reportData);
  });

  it('envelope.result 内部 JSON 含未转义双引号时，兜底正则重试后解析成功', () => {
    const brokenResultStr = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    const stdout = JSON.stringify({ type: 'result', result: brokenResultStr });
    const parsed = extractReportJson(stdout);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('stdout 本身不是合法 JSON envelope → 抛错', () => {
    expect(() => extractReportJson('not json at all')).toThrow(/claude stdout 不是合法 JSON envelope/);
  });

  it('envelope 没有 result 字段 → 抛错', () => {
    expect(() => extractReportJson(JSON.stringify({ type: 'result' }))).toThrow(/缺少 result 字段/);
  });

  it('result 字段修完还是解析不了 → 抛错，报错信息带上两次失败原因', () => {
    const stdout = JSON.stringify({ type: 'result', result: '{not json at all' });
    expect(() => extractReportJson(stdout)).toThrow(/report_data JSON 解析失败/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`

Expected: FAIL —— `import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js';` 报模块不存在（`packages/brain/scripts/skill-eval-worker.js` 此时还没创建），vitest 报 `Cannot find module`/`Failed to resolve import` 之类的错误，全部 `it` 因模块加载失败而无法运行。

- [ ] **Step 3: Write minimal implementation**

创建 `packages/brain/scripts/skill-eval-worker.js`：

```js
#!/usr/bin/env node
/**
 * skill-eval-worker.js — Skill Evaluator 单次轮询评估 worker（非常驻）
 * Sprint: skill-eval-formb-track2
 *
 * 单次执行：
 *   1. 查一条 pending 的 skill_evals（复用 ../src/db.js 的 pool，与 API 同一套连接方式）
 *   2. 解压 staging_path 的 zip 到临时目录，定位 SKILL.md 所在目录
 *   3. 拼 eval-prompt.txt + 目标 skill 目录路径，spawn 本地 claude 二进制评估
 *   4. 解析 stdout 中的 report_data JSON（含兜底正则修复）
 *   5. 成功 → POST /api/skill-eval/complete；失败 → 直接写库 status=failed
 *
 * 用法：node packages/brain/scripts/skill-eval-worker.js
 *
 * 本 PR 范围：验证"跑一次能 work"。常驻循环（pm2/systemd）留到 PR merge 后单独配置，不产生 git diff。
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import pool from '../src/db.js';

// ─── 配置 ──────────────────────────────────────────────────────────────────

// claude 在交互 shell 里是函数（alias/shell function），不是可执行文件——
// child_process.spawn 走的是真实 execve，必须给绝对路径，否则报 ENOENT。
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || '/Users/administrator/.claude-account2';
const EVAL_PROMPT_PATH =
  process.env.EVAL_PROMPT_PATH || '/Users/administrator/perfect21/skill-eval-formb-assets/eval-prompt.txt';
// eval-prompt.txt 里硬编码了一个示例路径（daily-report-v1-2 的调研路径），
// 每次真实运行时要把它替换成本次解压出来的目标 skill 目录。
const PROMPT_EXAMPLE_PATH = '/tmp/eval-exp/daily-report-v1-2';

const EVAL_PROXY_TOKEN = process.env.EVAL_PROXY_TOKEN || '';
const BRAIN_BASE_URL =
  process.env.BRAIN_BASE_URL || `http://localhost:${process.env.PORT || process.env.BRAIN_PORT || 5221}`;

// ─── 纯函数：JSON 加固（可脱离 claude 二进制单测）──────────────────────────

/**
 * 兜底正则：清理字符串值内部未转义的双引号（评估 prompt 已要求模型用中文引号「」，
 * 但模型仍可能偶尔吐出英文引号把 JSON 弄坏——这个正则把「夹在普通字符中间」的
 * 双引号直接删掉，不动结构性的引号（紧跟 : , { [ 或 } ] 的引号保留）。
 */
export function sanitizeJsonString(s) {
  return s.replace(/(?<=[^\s:,{[])"(?=[^\s:,}\]])/g, '');
}

/**
 * 从 `claude -p ... --output-format json` 的 stdout 里解析出 report_data。
 * stdout 本身是 claude CLI 的 JSON envelope（{type,result,...}），
 * envelope.result 是模型的最终文本输出，report_data 是这段文本本身应当就是的 JSON。
 * @param {string} claudeStdout
 * @returns {object} report_data
 */
export function extractReportJson(claudeStdout) {
  let envelope;
  try {
    envelope = JSON.parse(claudeStdout);
  } catch (err) {
    throw new Error(`claude stdout 不是合法 JSON envelope: ${err.message}`);
  }

  const resultText = envelope && envelope.result;
  if (typeof resultText !== 'string' || !resultText.trim()) {
    throw new Error('claude envelope 缺少 result 字段或为空');
  }

  try {
    return JSON.parse(resultText);
  } catch (firstErr) {
    const cleaned = sanitizeJsonString(resultText);
    try {
      return JSON.parse(cleaned);
    } catch (secondErr) {
      throw new Error(
        `report_data JSON 解析失败（直接解析: ${firstErr.message}；兜底正则重试后仍失败: ${secondErr.message}）`
      );
    }
  }
}

// ─── zip 解压 + 定位 SKILL.md 目录 ─────────────────────────────────────────

async function extractZip(zipPath, destDir) {
  const { default: unzipper } = await import('unzipper');
  await fs.promises.mkdir(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

/** 广度优先找 SKILL.md 所在目录（zip 可能把 skill 包在一层子目录里），最深搜 4 层。 */
function findSkillDir(rootDir) {
  let queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      return dir;
    }
    if (depth >= 4) continue;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  throw new Error(`解压后未找到 SKILL.md（搜索根目录: ${rootDir}）`);
}

// ─── spawn claude ──────────────────────────────────────────────────────────

function runClaudeEval(skillDir) {
  return new Promise((resolve, reject) => {
    const promptTemplate = fs.readFileSync(EVAL_PROMPT_PATH, 'utf8');
    const prompt = promptTemplate.split(PROMPT_EXAMPLE_PATH).join(skillDir);

    const child = spawn(CLAUDE_BIN, ['-p', prompt, '--model', 'sonnet', '--output-format', 'json'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`claude 进程启动失败: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude 退出码非 0: ${code}, stderr: ${stderr.slice(0, 2000)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// ─── 失败/成功路径写回 ──────────────────────────────────────────────────────

async function markFailed(taskId, reason) {
  await pool.query(
    `UPDATE skill_evals SET status = 'failed', failure_reason = $1, updated_at = now() WHERE task_id = $2`,
    [String(reason).slice(0, 4000), taskId]
  );
}

async function postComplete(taskId, reportData) {
  const reportUrl = `${BRAIN_BASE_URL}/api/skill-eval/report/${taskId}`;
  const res = await fetch(`${BRAIN_BASE_URL}/api/skill-eval/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Eval-Proxy-Token': EVAL_PROXY_TOKEN,
    },
    body: JSON.stringify({ task_id: taskId, report_url: reportUrl, report_data: reportData }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/api/skill-eval/complete 回调失败: HTTP ${res.status} ${body.slice(0, 500)}`);
  }
}

// ─── 主流程：单次轮询一条 pending 任务 ──────────────────────────────────────

export async function runOnce() {
  const { rows } = await pool.query(
    `SELECT task_id::text, staging_path FROM skill_evals WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
  );

  if (!rows.length) {
    console.log('[skill-eval-worker] 没有 pending 任务，退出');
    return null;
  }

  const { task_id: taskId, staging_path: stagingPath } = rows[0];
  console.log(`[skill-eval-worker] 取到任务 ${taskId}，staging_path=${stagingPath}`);

  // 标记 running，防止并发 worker 重复取同一条（也满足 checkSlotAvailable 的槽位统计口径：
  // routes/eval.js 的背压检查按 status='running' 数槽位，worker 取到任务后必须先占位）。
  await pool.query(`UPDATE skill_evals SET status = 'running', updated_at = now() WHERE task_id = $1`, [taskId]);

  const tmpDir = path.join(os.tmpdir(), `skill-eval-worker-${randomUUID()}`);

  try {
    await extractZip(stagingPath, tmpDir);
    const skillDir = findSkillDir(tmpDir);
    const stdout = await runClaudeEval(skillDir);
    const reportData = extractReportJson(stdout);
    await postComplete(taskId, reportData);
    console.log(`[skill-eval-worker] 任务 ${taskId} 完成`);
    return { taskId, reportData };
  } catch (err) {
    console.error(`[skill-eval-worker] 任务 ${taskId} 失败: ${err.message}`);
    // 失败路径直接写库，不经 /api/skill-eval/complete ——
    // 该端点目前只处理成功路径（见 routes/eval.js 的 /complete 实现，只写 status='completed'）。
    await markFailed(taskId, err.message);
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// 直接执行（node scripts/skill-eval-worker.js）时才跑主流程；被测试 import 时不自动执行。
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runOnce()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[skill-eval-worker] 未捕获错误:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`

Expected: PASS（`sanitizeJsonString` 2 个 + `extractReportJson` 5 个，共 7 个 `it` 全绿）。这 7 个断言全部只依赖纯函数 `sanitizeJsonString`/`extractReportJson`，不 spawn 真实 `claude` 进程、不连真实 DB，CI 环境可跑。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/skill-eval-worker.js packages/brain/scripts/__tests__/skill-eval-worker.test.js
git commit -m "feat(skill-eval): 新增单次轮询评估 worker（解压 zip + spawn claude 评估 + 回调/失败写库）"
```

---

### 本地手动验证（非 CI 门禁，验证 worker 端到端跑通）

以下步骤要在真实能跑 `claude` CLI 的机器上手动执行一次，验证 `skill_evals.status` 能从 `pending` 走到 `completed`，且 `report_data` 落库后能被 `renderReportHtml` 正常渲染。**不进 CI，纯本地手工确认。**

```bash
# 0. 准备环境变量（凭据走 1Password，示例）
source ~/.credentials/sync-credentials.sh
export EVAL_PROXY_TOKEN=<从 1Password 取的真实 token>
export BRAIN_BASE_URL=http://localhost:5221

# 1. 准备一个真实评估用的 zip（用 skill-eval-formb-assets 里已经调研过的 daily-report-v1-2 目录）
cd /tmp/eval-exp && zip -r skill.zip daily-report-v1-2

# 2. 确认 Brain 在跑（本机 packages/brain）
curl -s http://localhost:5221/healthz || (cd packages/brain && node server.js &)

# 3. 直接插入一条 pending 记录，跳过 /upload 端点鉴权，只验证 worker 本身
psql "$DATABASE_URL" -c "
  INSERT INTO skill_evals (task_id, zip_hash, skill_name, status, staging_path, created_at, updated_at)
  VALUES (gen_random_uuid(), 'manual-verify-hash', 'daily-report-v1-2', 'pending', '/tmp/eval-exp/skill.zip', now(), now())
  RETURNING task_id;
"
# 记下返回的 task_id，下面用 <TASK_ID> 代入

# 4. 跑 worker 一次
node packages/brain/scripts/skill-eval-worker.js

# 5. 验证状态与报告
psql "$DATABASE_URL" -c "SELECT status, report_url, failure_reason FROM skill_evals WHERE task_id = '<TASK_ID>';"
curl -s "http://localhost:5221/api/skill-eval/report/<TASK_ID>" | head -c 500
```

预期：第 5 步查出 `status = completed`、`report_url` 非空；`curl` 拿到的 HTML 以 `<!doctype html>` 开头且不含 `报告数据不完整`。

---

## 自查（spec coverage / 占位符扫描 / 类型一致性）

1. **占位符扫描**：全文搜索 `TBD` / `TODO` / `add appropriate` / `类似任务` —— 无命中。所有 4 个任务的 Step 1/3 都是完整代码块，没有用省略号代表"和前面一样"。
2. **类型/签名一致性**：
   - Task 1 的 `renderReportHtml(reportData)` / `renderReportBody(reportData)` / `renderComparePage(items)` 三个导出签名与 Task 3 测试里的调用方式（`renderReportHtml(realFixture)`、`renderComparePage([{label,data}, ...])`）逐一核对一致。
   - Task 2 的 `validateReportData(d)` 返回 `{valid, errors}` 形状与 Task 3 测试里 `expect(r.valid)` / `expect(r.errors)` 的用法一致。
   - Task 4 的 `sanitizeJsonString(s)` / `extractReportJson(claudeStdout)` / `runOnce()` 三个导出与测试文件 `import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js'` 的具名导入完全对应。
3. **发现并修正的问题**：
   - 最初设想 Task 3 应该是经典 RED→GREEN，但由于 Task 1/2 已经把实现折成与 `render.mjs` 逐字一致的版本，Task 3 引入真实 fixture 后测试会直接 PASS——已在 Task 3 开头显式说明这是"特征化测试"而非新行为驱动，避免计划执行者按经典 TDD 预期误判"没有真的 FAIL 就是没做对"。
   - Task 1 的测试 fixture 一开始只想用最小 `anatomy.pipeline`，但发现如果不同时带上 `anatomy.inputs`/`anatomy.kernel.rules`，会被**尚未在 Task 1 里修改**的旧 `schema.js` 挡在校验第一关，导致 RED 的原因变成"校验失败"而非"渲染器不认识 pipeline"（推理链混乱）。已改为让 fixture 同时满足新老 schema，把 Task 1 的 RED 原因锁定在渲染器本身；已用真实文件逐字模拟验证过这个判定。
   - Task 2 同理，用一个"合法的老结构但故意不带 `kernel` 字段"的 fixture，把 RED 原因锁定在 schema 校验规则本身，不掺进渲染器的因素（Task 2 的测试完全不 import render.js）。
   - 确认了 `packages/brain/src/__tests__/eval-report.test.js`（不在本计划任何任务的修改范围内）在渲染器/schema 替换后依然全绿：其断言的 `'输入'/'内核'/'输出'/'stroke-dasharray'` 子串在新实现里各自有着落（`'内核'` 恰好命中新 `STYLE` 里的 CSS 注释文本，`'stroke-dasharray'` 命中 `.ge-bad` 规则，均为 `<style>` 常量里恒定存在的字面量，与传入数据无关）——已用真实的折回后 render.js 手工跑过一遍确认，不是猜测。
4. **依赖缺口回答**：`packages/brain/package.json` 已有 `unzipper@^0.12.5`，Task 4 直接复用（`unzipper.Extract({path})` 流式解压 API），**不需要新装任何解压依赖，也不调系统 `unzip` 命令**。
5. **vitest include 缺口**：`vitest.config.js` 的 `include` 不含 `scripts/**`（与仓库里已存在的 `scripts/__tests__/harness-report.test.mjs` 同样情况），Task 4 的测试运行命令因此都显式传文件路径（`npx vitest run scripts/__tests__/skill-eval-worker.test.js`），不依赖默认 glob；这不是本计划范围内要修的问题，已在 Task 4 开头显式注明。
