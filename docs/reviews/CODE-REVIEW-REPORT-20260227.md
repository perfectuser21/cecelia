---
repo: cecelia
review_date: 2026-02-27
scope: full — Initiative 执行循环专项审查
risk_score: 8
mode: deep
decision: CRITICAL_BLOCK
---

## 审查摘要

- 变更文件数：4（decomposition-checker.js、routes.js、task-router.js、decomp/SKILL.md）
- 发现问题：L1: 1, L2: 3, L3: 0
- 安全问题：0
- 决策：**CRITICAL_BLOCK** — 存在 L1 Bug 导致 Initiative 执行循环完全失效

---

## L1 问题（必须修）

### [L1-001] executor.js skillMap 缺少 initiative_plan / initiative_verify / decomp_review

- **文件**：`packages/brain/src/executor.js:858-870`
- **问题**：`getSkillForTaskType()` 函数的 `skillMap` 没有 `initiative_plan`、`initiative_verify`、`decomp_review` 三种 task_type 的映射条目，所有这些类型都 fallback 到 `/dev`。
- **实证**：
  ```
  initiative_plan  → /dev (FALLBACK!)   应该是 /decomp
  initiative_verify → /dev (FALLBACK!)  应该是 /decomp
  decomp_review    → /dev (FALLBACK!)   应该是 /decomp-check
  ```
- **风险**：initiative_plan 任务被 Brain 派发时，agent 收到的是 `/dev\n\n# PRD...`，会启动写代码流程而不是 /decomp Phase 2 规划流程。整个 Initiative 执行循环在 dispatch 阶段就断裂，无法工作。
- **根因**：`task-router.js` 的 `SKILL_WHITELIST` 是完整的（含 initiative_plan → /decomp），但 `executor.js` 维护了一套独立的 `skillMap`，两者长期失同步。
- **建议修复**：
  ```javascript
  // executor.js:858 skillMap 补充三条：
  'initiative_plan': '/decomp',
  'initiative_verify': '/decomp',
  'decomp_review': '/decomp-check',
  ```
  同时在 `preparePrompt` 中为 `initiative_plan` 添加专用处理分支，将任务的 description（含 Initiative ID、KR ID）直接作为 /decomp 的上下文注入，而不是生成通用 PRD。

---

## L2 问题（建议修）

### [L2-001] execution-callback 5e 节不处理 completed_no_pr 状态

- **文件**：`packages/brain/src/routes.js:2894`
- **问题**：5e 节仅检查 `newStatus === 'completed'`，不处理 `completed_no_pr`。
  - `completed_no_pr` 出现场景：dev 任务以 `AI Done` 回调但未提供 `pr_url`（如跳过 PR 的 hotfix 场景）。
  - 这类任务完成后，Initiative 里没有活跃任务，但不会触发下一个 initiative_plan，循环在此中断。
  - 虽然 Check B 会在下一 tick（约 5 分钟后）检测到该 Initiative 无活跃任务并重新创建 initiative_plan，但属于被动恢复，存在最长 5 分钟延迟。
- **建议修复**：
  ```javascript
  // 将 5e 判断扩展为：
  if (newStatus === 'completed' || newStatus === 'completed_no_pr') {
  ```

### [L2-002] initiative_plan 任务描述引用的 API 端点不存在

- **文件**：`packages/brain/src/decomposition-checker.js:77`，`packages/brain/src/routes.js:2936`
- **问题**：createInitiativePlanTask 和 5e 节生成的任务描述中指示 agent 调用：
  ```
  GET /api/brain/projects/<initiative_id>   ← 404，端点不存在
  ```
  实测：`curl localhost:5221/api/brain/projects/some-id` → `Cannot GET /api/brain/projects/some-id`

  正确端点应为 `GET /api/brain/projects/<id>`（如果存在）或通过其他 Brain API 查询。

  `/api/brain/tasks?project_id=...&status=completed` 端点存在且工作正常。
- **影响**：即使 L1-001 修复后，initiative_plan session 在 Step 1 读取 Initiative 信息时会遇到 404。
- **建议修复**：确认 Brain 查询单个 project 的正确端点，更新两处描述。参考：`GET /api/brain/projects/{id}` 是否已注册路由。

### [L2-003] KR → Project → Initiative 链路依赖 project_kr_links，/decomp 创建时需显式写入

- **文件**：`packages/brain/src/decomposition-checker.js`（Check B 查询逻辑）
- **问题**：Check B 查询：
  ```sql
  INNER JOIN project_kr_links pkl ON pkl.project_id = parent.id
  WHERE pkl.kr_id = $1
  ```
  要求 parent Project 已在 `project_kr_links` 表中关联对应 KR。但 /decomp Phase 1（秋米拆解）创建 Project 时，是否每次都正确写入 `project_kr_links` 取决于秋米的实现。若秋米遗漏此步骤，对应 Initiative 永远不会被 Check B 发现，执行循环静默失效。
- **建议修复**：在 Check A 创建拆解任务的描述中明确要求秋米必须创建 `project_kr_links`；或在 Check B 失败时输出警告日志帮助诊断。（现有的任务描述已有此要求，但缺少验证机制）

---

## AI 免疫发现

- **幻觉 API**：L2-002 中的 `/api/brain/projects/<id>` 端点看起来是 AI 在生成描述时凭逻辑推断的端点，实际不存在。典型的 AI 代码幻觉模式。
- **两套并行 skillMap**：`task-router.js` 的 `SKILL_WHITELIST` 和 `executor.js` 的 `skillMap` 是两个独立维护的相同概念映射表，这是 AI 生成代码常见的"上下文割裂"模式——在不同文件分别实现同一语义，没有单一真实源。

---

## 测试缺口

- `decomposition-checker.test.js` 有针对 Check B 的测试，但没有覆盖"initiative_plan 任务被派发后实际调用正确 skill"的集成路径。
- `executor.js` 的 `getSkillForTaskType` 没有 initiative_plan 类型的单元测试。

---

## 修复优先级

| 优先级 | 问题 | 操作 |
|--------|------|------|
| P0 | L1-001 executor.js skillMap 缺失 | 立即修复，阻断整个循环 |
| P0 | L2-002 API 端点不存在 | 同批修复 |
| P1 | L2-001 completed_no_pr 不触发循环 | 下一批修复 |
| P2 | L2-003 project_kr_links 验证 | 观察期，暂不强制 |
