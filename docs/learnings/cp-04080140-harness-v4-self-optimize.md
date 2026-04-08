### 根本原因

Harness v4.0 流程存在 5 个断点：
1. CI watch 超时直接 fail 导致链路中断
2. GitHub API 每 5s tick 暴力轮询，无节流
3. task-router.js TASK_REQUIREMENTS 缺所有 harness_* 类型
4. execution-callback 不检查 planner 是否已取消
5. harness SKILL.md 包含 localhost:5221 调用，agent 远程访问不到

### 下次预防

- [ ] 新增 watch 类型任务时，超时路径必须创建后续任务而不是直接 fail
- [ ] 新 API 调用模块必须加节流（Map + timestamp 模式）
- [ ] 新增 task_type 时同步更新 TASK_REQUIREMENTS（3处：VALID_TASK_TYPES/SKILL_WHITELIST/LOCATION_MAP/TASK_REQUIREMENTS）
- [ ] 链路派生子任务前检查 planner 状态（cancelled 静默终止）
- [ ] SKILL.md 中不写依赖本地服务的 curl 命令，上下文由 prompt 注入
