# Learning: pre-flight 读 payload.prd_summary + priority normalize

## 问题现象

最近一周（2026-04-08 ~ 2026-04-15）autonomous /dev 通道产出为 0。Brain API 显示最近 50 个 dev 任务 27 个 canceled、54% cancel 率，其中包括：

- `[内容主理人控制] 选题池 v1`（P0，payload.prd_summary 1237 字符） → `pre_flight_issues: ['Task description is empty']` → canceled
- `Langfuse 可观测接入`（description 423 字符，priority=normal） → `pre_flight_issues: ['Invalid priority: normal']` → canceled

## 根本原因

`packages/brain/src/pre-flight-check.js` 有两个与任务创建方实际写入路径脱节的判定：

1. **PRD 源字段收敛不全**：只读 `task.description || task.prd_content`。autonomous 路径的任务创建器把 PRD 写到 `payload.prd_summary`（task-router/scheduler 消费的字段），pre-flight 看不到，于是整条通路"PRD 明明在、pre-flight 说不在"。

2. **priority 校验过严**：只接受 `P0/P1/P2`，语义化值 `normal/high/low/urgent` 一律 reject 并 cancel 任务。对 autonomous 来说这是"值没规范化 → 直接丢任务"，而不是降级或 normalize。

两个判定独立但叠加后共同造成了上游创建者（autonomous/talk/人工）与 pre-flight 的契约错位 — PRD 在、priority 是合法语义，但任务还是被 cancel，没人看 metadata 也没告警。

## 修复

- `descContent` fallback 增加 `task.payload?.prd_summary`
- 引入 `PRIORITY_NORMALIZE_MAP`（urgent/critical→P0，high→P1，normal/medium/low→P2），在 validPriorities 校验之前规范化 `task.priority`（case-insensitive），不在 map 里的值仍 reject

## 下次预防

- [ ] **pre-flight 契约要覆盖所有 PRD 落地字段**：新增 PRD 源字段（payload.prd_summary 这类）时，pre-flight 的 descContent fallback 必须同步更新；任务创建入口 POST /tasks 未来要做 schema normalize，把所有 PRD 源收敛到 description
- [ ] **校验层与 normalize 层分离**：对有有限取值的字段（priority/status/location），先 normalize 再校验，而不是直接 reject；同一逻辑也要覆盖 POST /tasks 入口
- [ ] **pre-flight 失败要有告警**：连续 3+ 日 failed_count>阈值，走 URGENT 告警；否则 cancel 静默堆积无人看（本次就是一周无人发现）
- [ ] **dev-records 要回填质量字段**：`ci_results/code_review_result/self_score` 目前全 null，导致无法事后评价 autonomous 产出的质量
