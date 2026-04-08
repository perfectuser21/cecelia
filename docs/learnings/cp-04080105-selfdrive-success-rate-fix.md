# Learning: SelfDrive 成功率虚低根因修复

**Branch**: cp-04080105-fedbbdc9-6b04-4d47-af7e-dad7ea  
**Date**: 2026-04-08

---

### 根本原因

**Bug 1 — SQL time window 不一致**  
`getTaskStats24h()` 的 `completed` 过滤器只用 `completed_at > 24h`，但 `total` 用 `completed_at OR updated_at > 24h`。存在 `completed_at = NULL` 但 `updated_at` 在窗口内的已完成任务，会被 `total` 计入但不被 `completed` 计入，虚报失败率 ~4-5%。

**Bug 2 — 去重逻辑不覆盖语义相似任务**  
SelfDrive 去重用标题前 30 字符匹配。不同"成功率诊断"任务的标题前缀各异（"诊断最近24h…"、"执行成功率下跌分析…"、"任务质量诊断…"），标题前缀完全不同 → 去重失效 → 在 24h 内反复创建 10+ 个语义相同的诊断任务，全部 quarantined，反而使成功率指标看起来更差 → 正反馈放大循环。

**Bug 3 — 提示词无成功率阈值**  
SelfDrive 提示词规则"任务成功率下降 — 建议修复"没有触发阈值，导致成功率 80%+ 时也会创建诊断任务。

---

### 修复内容

1. `getTaskStats24h()` SQL — `completed` 过滤器改为与 `total` 相同的时间条件：`completed_at OR updated_at > 24h`
2. 在标题去重后，添加关键词级去重（`FAILURE_DIAGNOSIS_KEYWORDS`），若已有含"成功率/失败根因/任务失败"关键词的任务存在（queued/in_progress/最近24h quarantined），则跳过创建
3. SelfDrive 提示词规则增加阈值：`< 60%` 才创建失败分析任务

---

### 下次预防

- [ ] 写 SQL 时，所有聚合维度（completed/failed/total）的时间过滤条件必须一致
- [ ] SelfDrive 创建自我诊断类任务时，去重不能只靠标题前缀，需同时做语义关键词匹配
- [ ] LLM 提示词中的量化规则必须明确写出触发阈值，否则 LLM 会在任何偏低情况下触发
- [ ] 成功率下降 → 先查是否排除了 pipeline_rescue，再看 getTaskStats24h 的 SQL 是否正确
