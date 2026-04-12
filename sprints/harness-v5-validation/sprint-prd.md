# Sprint PRD — Harness v5.0 核心验证

## OKR 对齐

- **对应 KR**: Cecelia 基础稳固 — Harness 系统可信赖、全流程可追溯

## 问题陈述

Harness v4.0 流水线存在数据链断裂问题：Planner 产出的分支名无法正确传递给下游步骤，导致 pipeline-detail API 返回空内容。需要通过验证确保数据链完整。

## 目标

- Planner 任务完成后，其分支名持久化到 result.branch
- pipeline-detail API 能正确返回各步骤的 input/output 内容
- 数据链从 Planner → Proposer → Generator 完整可追溯

## 功能范围

1. Planner result.branch 持久化
2. pipeline-detail Planner 步骤 output_content 填充
3. pipeline-detail Propose 步骤 input_content 填充

## 成功标准

- 已完成 Planner 任务的 result 字段包含 branch 键
- pipeline-detail API 返回 Planner 步骤的 output_content（>50字符，含 PRD 内容）
- pipeline-detail API 返回 Propose 步骤的 input_content（与 Planner output_content 同源）
