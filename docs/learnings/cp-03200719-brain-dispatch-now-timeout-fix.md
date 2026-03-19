# Learning: Brain dispatch-now 端点 + devloop-check 超时修复

### 根本原因

/dev 的 Codex 审查（cto_review/code_quality/prd_audit）注册后依赖 tick loop 派发，
但 Brain 调度器默认关闭，导致审查任务注册了但永远不执行。
同时 devloop-check.sh 的 90 分钟 CI 超时错误地返回 done（应返回 blocked），
导致未完成的工作流无声结束。

### 下次预防

- [ ] 新增的 Brain API 端点必须有配套的 vitest 测试
- [ ] 异步等待逻辑（超时处理）必须返回正确的状态码（blocked 而非 done）
- [ ] dispatch-now 模式下审查任务不再依赖调度器状态
- [ ] DoD 的 [BEHAVIOR] Test 不能依赖网络服务（CI 环境无 Brain），改用文件内容检查
