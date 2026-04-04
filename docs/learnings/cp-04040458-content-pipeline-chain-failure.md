# Learning: 内容生成链路三重失效根因

**Branch**: cp-04040458-448791a8-7c53-4f54-9c13-d96548  
**Task ID**: 448791a8-7c53-4f54-9c13-d96548  
**Date**: 2026-04-04

---

### 根本原因

**问题 1：CONTENT_KR_GOAL_ID 指向已取消的 Objective**

`topic-selection-scheduler.js` 硬编码的 `CONTENT_KR_GOAL_ID = 'fedab43c-...'` 指向 `objectives` 表中一个已取消的条目（不是活跃的 `key_result`）。结果：

- `tick.js` 的 `allGoalIds` 只从 `key_results` 表构建，不含 cancelled objectives
- 所有 content-pipeline 任务的 `goal_id` 指向不存在于 `allGoalIds` 的值
- `autoFailTimedOutTasks` 永远找不到这些任务（dispatch 查询过滤掉了它们）
- timeout 超时保护对 content-pipeline 失效

**问题 2：Parent pipeline 被 liveness probe 误杀**

content-pipeline 父任务由 `orchestrateContentPipelines()` 在 Brain 内部编排，无 OS 进程。liveness probe 无法找到对应进程 → 标记 SUSPECT → DEAD → requeue → `startup-sync` 重置 `watchdog_retry_count` → 无限循环 → 最终 quarantine。

**问题 3：Review 阶段使用 LLM 严格审查，标准过高**

`executeCopyReview` 和 `executeImageReview` 都调用 LLM 进行内容质量审查，review_rules 全部是 `severity: blocking`（数据有来源、有3条可操作建议等）。AI 生成内容几乎无法达到这些标准 → 所有 review 返回 `review_passed: false` → 达到 `MAX_REVIEW_RETRY=3` → pipeline 永久终止 → content-export 从未被创建。

---

### 下次预防

- [ ] **OKR ID 变更时必须更新所有引用**：凡代码里硬编码 goal_id/kr_id 的地方，在 OKR 调整时必须同步更新。建议在 `DEFINITION.md` 或独立配置文件中管理这类 ID，避免散落在代码中。

- [ ] **Brain 内部编排任务必须豁免 liveness probe**：任何由 Brain tick 直接管理（非 OS 进程）的任务，在创建时都应在 payload 中标记 `pipeline_orchestrated: true`，或通过 task_type 豁免。

- [ ] **LLM review 标准上线前须用真实内容测试**：review prompt 写完后，先用真实 AI 生成内容手动跑一次，确认通过率 > 0。`quality_score >= 6` 策略（而非 issues.length === 0）是更合理的通过标准。

- [ ] **内容链路需端到端冒烟测试**：从 topic-selection → research → copywriting → copy-review → generate → image-review → export，需要一条完整的集成测试路径，否则链路断裂数天都不会被发现。

- [ ] **Pipeline 失败后需可观测**：Brain context API 或 dashboard 应展示 content-pipeline 的每日通过率，不能只看总任务数。KR 进度 1% 连续多天无变化是明显的告警信号。
