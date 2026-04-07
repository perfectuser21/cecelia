# Sprint PRD

## 产品目标

Harness v3.1 自动化流水线在日常运行中存在三个已知痛点：账号失效导致 dispatch 静默失败、跨 worktree 文件同步依赖人工介入、数据库约束靠手动维护随时可能丢失。本 Sprint 目标是把这三个痛点全部变成系统级保障，让 Harness 在无人值守状态下也能稳定运行。

## 功能清单

- [ ] Feature 1: Dispatch 账号切换为 account1
  用户发起的 sprint 任务，Brain tick 自动 dispatch 时，始终使用有效的 account1 账号，不再因 account3 过期而静默失败。

- [ ] Feature 2: 跨 worktree 文件自动同步
  Generator、Evaluator 等角色在需要读取 contract-draft 或 sprint-prd 时，系统自动完成跨 worktree 文件同步（git fetch），不需要用户手动在 prompt 中嵌入文件内容。

- [ ] Feature 3: task_type 约束 migration 固化
  sprint_report 和 cecelia_event 的 DB task_type 枚举约束以数据库 migration 文件的形式存在，任何新环境部署后约束自动生效，不依赖手动 ALTER 操作。

## 验收标准（用户视角）

### Feature 1
- 用户触发一次 sprint 流程后，Brain 日志中 dispatch 记录显示使用的是 account1，流程正常推进
- 当 account3 相关配置缺失或过期时，dispatch 不报错、不中断，继续使用 account1 完成任务

### Feature 2
- Generator 或 Evaluator 被 Brain 唤起时，能直接读取到最新的 contract-draft 和 sprint-prd 内容，无需用户手动粘贴文件
- 当目标文件在远端已更新但本地落后时，系统自动 fetch 最新版本后继续执行，用户看不到手动操作提示

### Feature 3
- 在全新数据库环境中运行迁移后，sprint_report 和 cecelia_event 对应的 task_type 枚举值自动存在，无需手动执行 ALTER
- 若尝试插入不在约束范围内的 task_type 值，数据库拒绝并返回可读错误，而不是静默接受

## AI 集成点（如适用）

无——本次功能属于基础设施可靠性修复，不引入新 AI 能力。

## 不在范围内

- 修改 Harness 核心 GAN 对抗逻辑
- 新增 sprint 角色或流程阶段
- account1/account3 以外的账号体系改造
- 对其他 task_type 值的枚举扩展
- UI 或 Dashboard 层面的展示变更
