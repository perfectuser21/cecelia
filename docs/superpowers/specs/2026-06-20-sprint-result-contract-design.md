# 设计：Sprint 产物契约（闭环边界根 A · Phase 1 骨架）

**日期**: 2026-06-20
**分支**: cp-0620124828-sprint-result-contract
**类型**: 基础设施（直接实现，不走 harness 自跑）
**Decision**: 75b66ad3-498b-490e-95d2-a4c29bf372fd

---

## 背景与目标

harness pipeline 在 **sprint 边界开环**：报告/learning/skill/bug 写而不读 → "非系统性、差一点点"。闭环的钥匙是**一份统一的 Sprint 产物契约（SSOT）**，所有边界读取者（①展示 ②继承 ④立案）都读它这一个。

本 PR = **Phase 1 骨架**：定义契约 + 让 reportNode 产出它。读取者与上游采集器是 Phase 2。

## 组件

### 新建 `packages/brain/src/sprint-result-contract.js`

纯函数模块（不碰 DB），导出：

- `SPRINT_RESULT_CONTRACT_VERSION = 1`
- `buildSprintResultContract(input)` → 从 reportNode 已算好的 locals 组装契约对象。`input` 字段：`{ initiativeId, verdict, failedScenarios, subTasks, stepTiming, wsIssues, wsCosts, costUsd, completedAt }`（均可缺，缺则用安全默认）。
- `validateSprintResultContract(obj)` → 校验四段齐全 + 类型正确，非法抛 `Error`。

### 契约对象结构（四段 + 兼容字段）

```js
{
  contract_version: 1,
  initiative_id: string,

  // ① 结果（现可填）
  verdict: 'PASS' | 'FAIL' | null,
  failed_scenarios: [],
  change_summary: null,        // TODO(Phase2)：从 PR diff/标题归纳
  next_action: null,           // TODO(Phase2)

  // ② 产出资产（Phase2 采集）
  produced_assets: { skills: [], tests: [], decisions: [] },  // TODO(Phase2)
  learning_ref: null,          // TODO(Phase2)

  // ③ 发现（Phase2 采集）
  incidental_bugs: [],         // TODO(Phase2)：路上撞见的非本次 bug
  improvement_items: [],       // TODO(Phase2)：持续改进项（非 bug）
  linked_issues: [],           // TODO(Phase2)：关联 Notion Issue id
  open_issues_with_learnings: [],  // TODO(Phase2)：未解决 issue + 累积 learning

  // ④ 遥测
  node_telemetry: [{ node, start_ts, end_ts, tokens, cost }],  // 现填 node/start_ts/end_ts（从 stepTiming 推）；tokens/cost=null TODO(Phase2)
  total_tokens: null,          // TODO(Phase2)
  total_cost: number,          // 现可填（costUsd 汇总）

  // 兼容字段（保留现有消费者）
  sub_tasks: [],
  ws_issues: [],
  ws_costs: [],
  completed_at: string,
}
```

**字段映射（现可填 vs Phase2 stub）**：
- 现可填：`verdict`(=computedVerdict)、`failed_scenarios`、`total_cost`(=costUsd 汇总)、`node_telemetry` 的 node/start_ts/end_ts（从 stepTiming 的 `{node,started_at,duration_ms}` 推：start_ts=started_at，end_ts=started_at+duration_ms）、兼容字段。
- Phase2 stub（空默认 + 代码注释 `TODO(Phase2-采集器)`）：change_summary、next_action、produced_assets、learning_ref、incidental_bugs、improvement_items、linked_issues、open_issues_with_learnings、node_telemetry 的 tokens/cost、total_tokens。

### 改 `harness-initiative.graph.js` reportNode

现有 `reportContent = JSON.stringify({...})`（约 1459-1469 行）替换为：先 `const contract = buildSprintResultContract({ initiativeId: state.initiativeId, verdict: computedVerdict, failedScenarios: state.final_e2e_failed_scenarios, subTasks: reconciledSubTasks, stepTiming: step_timing, wsIssues: ws_issues, wsCosts: ws_costs, costUsd: (...reduce sum...), completedAt: new Date().toISOString() })`，再 `const reportContent = JSON.stringify(contract, null, 2)`。写库逻辑（UPDATE tasks.result.report_content）不变。

> 兼容性：契约保留 `sub_tasks/ws_issues/ws_costs/completed_at/initiative_id/failed_scenarios` 等现有键，现有 `/detail` 端点与任何读 report_content 的消费者不被破坏；只是**新增**四段字段。

## 数据流

```
reportNode 算出 locals (verdict/sub_tasks/step_timing/ws_*/cost)
  → buildSprintResultContract(locals)  ← 组装四段契约，Phase2 字段留 stub
  → JSON.stringify → 写 tasks.result.report_content（SSOT）
  → [Phase2] ①展示 / ②继承 / ④立案 读这一份
```

## 错误处理

- `buildSprintResultContract` 对缺失输入用安全默认（[]/null/0），永不抛——reportNode 在任何 sub_task 状态下都能产出合法契约。
- `validateSprintResultContract` 是显式校验入口（给测试与未来读取者用），非法结构抛 `Error`。

## 测试策略：unit（vitest）

`packages/brain/src/__tests__/sprint-result-contract.test.js`：
- `buildSprintResultContract`：① 全量 input → 断言四段字段齐全、verdict/total_cost/node_telemetry 正确映射；② 空/缺字段 input → 断言 stub 字段为空默认值且**不抛**；③ stepTiming → node_telemetry 的 start_ts/end_ts 推导正确。
- `validateSprintResultContract`：合法契约通过；缺段/类型错抛 `Error`。
- TDD 两 commit（commit-1 失败测试 / commit-2 实现）。

## 范围红线（不碰）

只动**新建 sprint-result-contract.js + reportNode 的 reportContent 组装那几行**。不碰 pick_sub_task/run_sub_task/advance 循环、不动其他图节点、不改 zenithjoy-skills、不动写库 SQL 逻辑。

## 不在本 PR（Phase 2）

读取者 ①展示 / ②继承 / ④立案；上游采集器（node_telemetry 逐节点 token 埋点 / incidental_bugs 上报 / produced_assets 捕获）；③续跑（待用户定自动起条件）。

## 验收标准

- [ ] TDD 两 commit；契约单测 + 校验单测全绿
- [ ] reportNode 产出含四段的契约，兼容字段保留
- [ ] lint-test-pairing 通过（新 src 有配套 test）
- [ ] DevGate（facts-check / version-sync）+ brain-ci 全绿
