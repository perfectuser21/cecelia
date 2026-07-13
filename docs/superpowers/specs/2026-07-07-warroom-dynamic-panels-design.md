# Design：warroom 前端动态化四板块（relay-baton4 item2）

- 日期：2026-07-07；Brain task 51c6ba98；分支 cp-07071806-warroom-dynamic
- 审查：Research Subagent APPROVE（四端点实测形状确认、代理三层全通、vitest .tsx 纯函数有先例、无冲突实现）

## 目标
WarRoomPage 从「任务清单板」升级「活的作战室」：四板块接真数据，保留现有三栏 + Line 树结构。

## 新文件 apps/dashboard/src/pages/warroom/WarRoomPanels.tsx

### 纯函数（导出供单测，实测字段为准）
- `journeyStatRows(stats)`：入参 `{journeys:[{journey_id,journey_name,runs,done,failed,success_rate,last_run_at,last_failure}]}`；success_rate 是 0-1 小数 ×100 取整；**last_failure 可能几百字符多行长文本，截断 36 字符 + 完整文本进 title**；容错非对象/缺 journeys → []
- `handoffRows(resp)`：入参 `{handoffs:[...], total}` 包装对象，取 resp.handoffs；每行 {task_id,title,verdict,next_step(next_steps[0]||''),created_at}；容错非数组 → []
- `decisionRows(rows)`：入参**裸数组**（无 .data 包装），每行 {id,topic,date(上海 YYYY-MM-DD)}；容错非数组 → []
- `sentinelLight(job)`：`job.ok === true && job.age_seconds <= 1800` → 'green'，否则 'yellow'（字段名 age_seconds）
- `sentinelRows(resp)`：{lights:[{name,light,age_seconds}], healthy, expected}；**healthy 以前端自算为准**（全部 green 且 lights.length >= expected 且 expected 非 null）——前后端阈值同为 1800s，自算避免后端语义漂移
- `pctLabel(rate)`：0-1 → "80%"；null/NaN → "—"

### 组件（每个独立 fetch + 60s 轮询 + 失败静默返回 null）
- `BattleBanner`：横向条（顶栏下方全宽），左侧 journey chips（线名 + runs 跑/成功率 + 最近一跑 relativeTime + last_failure 红点），右端哨兵灯（每 job 一灯 green/yellow + healthy=false 时红字「哨兵异常」）；接 `/api/brain/harness/stats?by=journey&days=30` + `/api/brain/sentinel/health`
- `HandoffStream`：最近交接单卡片列表（verdict 徽章复用 verdictMeta 风格 + title + next_steps 第一条 + relativeTime）；接 `/api/brain/handoffs?limit=8`
- `DecisionStream`：用户拍板列表（topic + 上海日期）；接 `/api/brain/decisions?made_by=user&limit=8`

样式：深色指挥中心风格与现有一致（slate 系、border-slate-800/60、bg-slate-900/20、text-[12px] 等）；relativeTime/verdictMeta 从 WarRoomPage import 复用。

## WarRoomPage.tsx 集成（三处最小改动）
1. import { BattleBanner, HandoffStream, DecisionStream } from './WarRoomPanels'
2. 顶栏 div（约 1327 行结束）之后插 `<BattleBanner />`
3. 跨线总览分支（!inLineView，约 1511 行 `<>` 内、loading 块之前）插：
   `<div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pt-3"><HandoffStream /><DecisionStream /></div>`

## 已核实的环境事实
- 代理三层全通（vite proxy / apps/api server.ts brainProxy / HK frontend-proxy.js 前缀转发），新端点天然可达
- vite build 无 tsc 类型检查、dashboard 不过 eslint——纯函数单测是唯一质量闸，必须覆盖容错分支
- lint-test-pairing/lint-feature-has-smoke 只管 packages/brain，本 PR 不触发
- DoD/PR body 需含 [BEHAVIOR] 条目（dod-format-check）

## 测试策略
档位：**unit（纯函数）**，惯例照 WarRoomPage.test.ts（vitest，从 .tsx import 纯函数，有先例）。
覆盖：六个纯函数全部 + 容错分支（非数组/缺字段/长 last_failure 截断/age 边界 1800/1801/expected 缺失）。
组件渲染不做 DOM 测（现有页面同惯例，靠部署后 perfect21:5211 截图验收兜行为层）。
TDD：commit-1 失败测试 / commit-2 实现。

## 部署与验收
- Brain webhook 部署（dashboard-deploy skill 流程，双实例）；PWA 强刷
- 验收：perfect21:5211/warroom 四板块真数据截图入 handoff
