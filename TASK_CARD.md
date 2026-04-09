# Task Card: Harness GAN v2

**Task ID**: e7c86b2d-3fdc-42f6-8488-a9b526ca14cb  
**Branch**: cp-04092151-harness-gan-v2  
**Priority**: P1

## 目标

升级 Harness Pipeline，解决三个核心问题：
1. GAN 角色使用 Opus 4.6（更强推理能力），Generator 用 Sonnet 4.6（写代码足够）
2. 大任务支持多 Workstream 并行拆分，不再强制一个 PR
3. Contract 直接定义 DoD 条目，Generator 复制使用，消除自评漏洞

## 改动范围

### F1: model-profile.js — 模型分配
- harness_planner / harness_contract_propose / harness_contract_review → claude-opus-4-6
- harness_generate / harness_report → claude-sonnet-4-6

### F2: harness-contract-proposer/SKILL.md — Contract 格式升级
- 输出 Workstreams 区块，每个 workstream 含标题、范围、大小(S/M/L)、DoD条目

### F3: harness-contract-reviewer/SKILL.md — 审查新增 Workstream 验证
- Reviewer 必须验证 workstream 边界清晰、DoD 可机械执行、大小估计合理

### F4: execution.js — APPROVED 后并行拆分
- 解析 contract 中 workstream 数量 N
- 并行创建 N 个 harness_generate，每个携带 workstream_index

### F5: harness-generator/SKILL.md — 按 Workstream 实现
- 读取 workstream_index，只实现对应 workstream 范围
- 直接使用 contract 中该 workstream 的 DoD 条目

## 成功标准

- GAN 任务使用 claude-opus-4-6
- Generator 任务使用 claude-sonnet-4-6  
- 大任务触发多个并行 harness_generate
- Generator DoD 来自 contract，非自行起草
