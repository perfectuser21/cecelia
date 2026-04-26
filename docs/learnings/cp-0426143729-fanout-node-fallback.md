# Learning: fanout node fallback — graph 自己拆 sub_task

## 现象
Sprint 1 (#2640) E2E-v10：架构全对（17 checkpoints in DB, Phase A approved），
但 fanoutSubTasksNode 看 state.taskPlan?.tasks 是空 → 直接走 ['join'] →
Final E2E 找不到 sub_task → fail。

### 根本原因
graph 完全依赖 Planner SKILL stdout 输出合规 task_plan。当 Planner 输出格式
偏差或 parseTaskPlan 静默 fallback 到空 tasks 时，下游 fanout 没有兜底，
整条流水线哑掉。

SKILL ↔ Brain 接缝处缺保护层 — graph 自身没有"我自己也能拆"的能力。

## 修复
新增 inferTaskPlanNode（dbUpsert 与 fanout 之间）：
1. 幂等：state.taskPlan?.tasks?.length >= 1 → passthrough
2. Fallback：spawn docker 跑 LLM，prompt 喂 PRD + Contract，要 task-plan.json
3. 失败容错：LLM exit != 0 / parseTaskPlan 抛 / 缺材料 → 全部 passthrough，
   让 join 走自然 FAIL 路径报告失败，不阻断 graph

### 下次预防
- [ ] graph 接 SKILL 时永远问"如果 SKILL 输出空/格式错怎么办"
- [ ] 每个 fanout/dispatch 节点上游必须有 inferOrFallback 节点保底
- [ ] 失败容错原则：fallback 不抛错；让 graph 自然走 FAIL 路径报告，
      不要 break edge
