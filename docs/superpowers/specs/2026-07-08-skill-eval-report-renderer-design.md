# form B 评估报告渲染器 — 设计

日期 2026-07-08 · 分支 cp-0708110455-skill-eval-report-renderer · 加厚 ability 907eb57f（thin→medium）

## 目标
给已合并的 form B 骨架（cecelia #3627：/upload、/status、/complete、skill_evals 表）补上员工最终要看的**验收报告页**：把一份结构化评估数据（report-data）渲染成「skill 解剖图」报告。设计已定稿：https://docs.zenjoymedia.media/skill-eval-pages

## 边界（本 PR 做什么 / 不做什么）
做：report-data schema + 存储列 + 渲染模块（纯函数）+ 渲染端点 + fixture + 测试。
不做：真实 skill-evaluator 结构化输出（下个 PR，本 PR 用 daily-report-cs fixture 证明渲染器端到端）；5 种 skill 类型专属图；报告页交互；上传页/向导页重构。

## 架构（3 个单元，各自单一职责、可独立测试）

### 1. report-data schema + fixture
一份评估报告的结构化 JSON（`packages/brain/src/skill-eval-report-schema.js` 导出 JSDoc typedef + `validateReportData(obj)` 轻校验；`packages/brain/src/__fixtures__/daily-report-cs.report.json` 为样本）：
```
{
  skill: { name, version, source, type, area, line, ability, submitter, evaluatedAt },
  verdict: { level: 'pass'|'partial'|'fail', text },
  stats: { 功能线, 依赖缺失, 红线: '✓'|'✗', 成熟度, 诚实度, 耗时 },
  anatomy: {
    inputs: [{ name, fields:[...], status:'red'|'green', connected:bool, note }],
    kernel: { model, promptNote, rules:[{ name, hardGate:bool }], redlineGate:bool },
    outputs: [{ name, sub, fields:[...] }]
  },
  findings: [{ name, tag, severity:'flag'|'ok'|'hard' }],      // 深入·逻辑发现
  redlines: [{ name, tag }],                                    // 深入·红线
  maturity: { 生产接线, 真实数据库, 已验证, 模型选型, 诚实待办 }, // 深入·成熟度
  health: [{ dim, state:'ok'|'warn'|'bad'|'neutral' }]          // 6 维健康指纹
}
```

### 2. 渲染模块（纯函数，Node 可单测）
`packages/brain/src/skill-eval-report-render.js` 导出 `renderReportHtml(reportData) -> string`（完整 HTML，内联 CSS + SVG，无外链、主题自适应）。子函数：`buildAnatomySvg(anatomy)` 产出解剖图 SVG——
- inputs：每个 input 一个盒子；`connected=false` → 到内核圈的连线为**红断线**（`stroke-dasharray`）+ ✕ 断口，盒子红；`green` → 绿实线
- kernel：中央圆，铺开 `rules`，`hardGate:true` 的规则标红；`redlineGate` → 输出侧红线闸
- outputs：盒子 + 字段格
纯函数：同一 reportData 恒等输出（无 Date.now/random），便于快照断言。

### 3. 渲染端点 + 存储
- 迁移 `319_skill_eval_report_data.sql`：`ALTER TABLE skill_evals ADD COLUMN report_data jsonb`（可空，向后兼容）
- `/complete`（既有）扩展：body 可选 `report_data`，有则写入该列（不破坏现有只传 report_url 的调用）
- 新端点 `GET /api/skill-eval/report/:task_id`：读 report_data → `renderReportHtml` → 返回 `text/html`。`?format=json` 返回原始 report-data JSON。无 report_data → 404「报告未就绪」
- `report_url` 约定指向 `/api/skill-eval/report/<task_id>`（服务端渲染，比静态 report.html+客户端 fetch 更省、更好测——本设计对 PrepPRD「返回JSON+report.html渲染」的精化）

## 数据流
上传→评估（下个PR产出 report_data）→ /complete 存 report_data → status 给 report_url → 员工打开 report_url → 端点服务端渲染解剖图 HTML。本 PR 用 fixture 灌入 report_data 走通「存→取→渲染」。

## 错误处理
- report_data 缺失/畸形 → 端点 404 或渲染兜底态（不 500）；`validateReportData` 挡畸形
- task_id 不存在 → 404
- 未接 DB 类依赖 → 正是 red/断线要表达的内容（数据里 connected=false），非错误

## 测试策略（逻辑接缝 → CI test 足够；TDD 先红后绿）
- **unit**（`skill-eval-report-render.test.js`）：`renderReportHtml(fixture)` 断言——依赖缺失项含 `stroke-dasharray`（红断线）+ 该 input 名；kernel 全部 rules 名出现、hardGate 规则带红标记；outputs 字段名出现；verdict.text 出现；6 维 health 色码对应。`validateReportData` 对残缺对象报错。
- **endpoint**（`eval-report.test.js`）：seed 一条 skill_evals(report_data=fixture) → `GET /report/:id` 返回 200 text/html 含解剖图三段关键元素；`?format=json` 返回等值 JSON；无 report_data 的任务 → 404。
- **smoke**（`packages/brain/scripts/smoke/skill-eval-report-smoke.sh`）：node 调 renderReportHtml(fixture) grep 校验「输入/内核/输出」+断线+8规则在。
- proven-to-fire：commit-1 先写测试（renderer 不存在 → 红），commit-2 实现变绿。

## 验收
report-data schema+fixture 齐 / GET /report 返回完整数据与 HTML / 渲染含解剖图三段+红断线+内核8规则2硬闸+深入三项+裁决+6维指纹 / 单测先红后绿 / smoke 过 / CI 绿。
