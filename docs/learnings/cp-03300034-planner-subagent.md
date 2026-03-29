# Learning: Planner subagent — Stage 1 Task Card 生成拆分

**分支**: cp-03300034-planner-subagent
**日期**: 2026-03-30

## 变更摘要

将 /dev Stage 1 的 Task Card + DoD 生成从主 agent 内部执行拆为独立 Planner subagent，与 Stage 2 Generator subagent 模式统一。

### 根本原因

主 agent 在 Stage 1 同时承担 PRD 读取、Brain 上下文处理、Task Card 生成、spec_review 调度等多项职责。拆出 Planner subagent 后：
1. Planner 的 context 只含必要信息（任务描述 + SYSTEM_MAP），不被 coding 规范和代码细节污染
2. 主 agent 保持编排者角色，与 Generator/spec_review/code_review_gate 的 subagent 模式一致
3. Planner 只说 WHAT 不说 HOW，产出的 DoD 更纯粹

### 下次预防

- [ ] 改 Skill markdown 文件时，engine 和 workflows 两处副本必须同步（已在 Generator subagent 的 learning 中提过，再次确认）
- [ ] 隔离规则表中禁止传入的项目需要正确判断：CLAUDE.md 是 HOW（coding 规范），SYSTEM_MAP 是 WHAT（系统概览），两者性质不同
- [ ] Engine 版本 bump 需要 6 个文件同步更新，feature-registry.yml 的 changelog 和 ci-trigger 都需要更新
