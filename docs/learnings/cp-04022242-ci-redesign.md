# Learning: CI 重设计 v14.0.0

**日期**: 2026-04-02

## 背景
slim-engine-heartbeat 后 /dev 极简化，但 CI 还是 4 层 32 job 的旧架构。devgate 脚本检查的是 /dev 不再要求的东西（DoD 格式、RCI 条目、覆盖率强制）。

### 根本原因
CI 是为旧的 Planner/Generator/Sprint Contract subagent 架构设计的——那时候不信任 AI 输出，需要层层检查。现在主 agent 直接写代码，CI 只需要验证代码正确性（测试 + 类型）。

### 下次预防
- [ ] CI 设计原则：只检查机器能客观判断的事（测试/类型/secrets），不检查流程/格式/文档
- [ ] 架构简化时，CI 必须同步简化，否则形成矛盾（/dev 不要求但 CI 检查）
