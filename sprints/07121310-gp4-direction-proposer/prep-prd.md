# 小改动 PrepPRD：[GP4/7] T4 direction-proposer 每周方向菜单 job

## 改什么
新建 `packages/brain/src/direction-proposer.js` + 在 `scheduler-jobs.js` 登记 job（不动 line-strategist 本体）。

**方式选择（任务①要求在 PR 说明理由）**：选「scheduler job 内联生成」而非新 task_type `direction_propose`。
理由：菜单生成 = 确定性聚合（三段 SQL）+ 一次 LLM 汇总，无需完整 dev 会话/worktree/PR 产物；
新 task_type 需要 task-router 四处登记 + executor dispatch 分支 + 并发线，接线面大而收益为零；
ci_patrol 同类先例（每日巡检）也走 scheduler 接线模式。

## 行为规格
- **窗口**：北京周一 05:30（UTC 周日 21:30-21:35），晨报（北京 06:00）前跑完
- **去重**：working_memory `gp_gap_panorama` 20h 内已更新 → skip（照 line-dreaming 20h 先例）
- **输入三源**：
  1. 跨线 KR 缺口：`key_results status IN ('active','in_progress','decomposing')` 逐 KR 读
     `metadata.target_abilities`，join journey_features+advancement_items（复刻
     GET /okr/kr/:id/ability-progress 对账逻辑，job 内直接查库不 HTTP 自调用）。
     缺口判定：未登记 target_abilities / 存在失联引用 / ability thickness=thin 或 advancement 未完
  2. advancement todo 耗尽信号：active journey 下所有 ability 的 items todo+doing=0 → 该线耗尽
  3. 直投池：golden_paths `status='candidate' AND source IN ('alex_direct','capture_triage')`
     （一等公民，已在菜单，作为 LLM 上下文防重复提案 + 计入覆盖）
- **一次 LLM 汇总**（callLLM 'thalamus'，照 capture-triage 注入模式可测）：输出 JSON
  `{candidates:[{title,one_liner,kr_id,journey_id,est_scale}]}`；LLM 失败/不可解析 → 降级只写全景（确定性部分不丢）
- **输出**：
  1. 候选 INSERT golden_paths(status='candidate', source='strategist')，含 one_liner/kr_id/est_scale；
     同 title 已存在活跃态（candidate/proposed/converged/approved/in_dev）→ skip 防重复
  2. 「OKR 缺口全景」upsert working_memory key='gp_gap_panorama'，
     value_json={generated_at, gaps:[{kr_id,kr_title,reason}]}（并行约定钉死，GP6 晨报渲染从此 key 读；
     gaps=本周无候选覆盖的缺口，覆盖=本次新候选或直投池既有 candidate 的 kr_id 命中）

## 为什么改
GP loop（decisions cb6be3f6 七解法）缺"该开哪条新方向"产出口；每周菜单是批审桌（军师节 v2）的上游输入。
设计 SSOT: docs/architecture/2026-07-12-golden-path-mode/architecture.md（已合并）。验收对应 DoD F11。

## 影响范围
新文件 + scheduler-jobs.js 加一行登记。不动 line-strategist / golden-paths 路由 / battle-report（GP6 的事）。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| KR 缺口判定 | LLM 判断 / 确定性规则 | 确定性规则（无登记/失联/thin/未完） | ability-progress 端点既有语义 | 缺口漏列→晨报少一行，人工可捞回，轻 |
| 候选重复判定 | 语义相似 / title 精确匹配活跃态 | title 精确匹配 | 首版从简，LLM 已有直投池上下文防重复 | 重复 candidate→圈选时人工略过，轻 |

## 验收标准
- [ ] failing test 先 commit（窗口/去重/聚合/LLM降级/写库断言，照 line-dreaming.test.js 骨架）
- [ ] 实现代码让 test 变绿
- [ ] 手动触发一次 job 查产物（DoD F11 验证法）：golden_paths 出现 candidate 或 working_memory 有 gp_gap_panorama
- [ ] CI 全绿
