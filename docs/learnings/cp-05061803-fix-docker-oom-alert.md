# Learning: cp-05061803-fix-docker-oom-alert

## 事件

`docker-executor.js writeDockerCallback` 处理 task container exit_code=137（SIGKILL）时只写 callback_queue 标 failed，**没有 alert**。MJ1 harness graph 多次 sub-task OOM kill 静默失败，主理人无从知晓资源不足，只能盯 brain.log 自己发现。

## 根本原因

**failure mode 不分级**——所有 exit≠0 都按 `docker_nonzero_exit` 处理，但 137（SIGKILL/OOM）跟普通 stderr exit 1 / 2 是完全不同性质：
- exit 1/2: 应用层失败（代码 bug / 输入错），不需要主理人立即介入
- exit 137: 资源/环境问题（OOM / kill），需要调整 tier memory 或拆分任务

将两者混为一谈导致告警噪音 vs 信号失衡。

## 下次预防

- [ ] **failure mode 必须分级**：每个 exit code / signal 对应特定 failure_class，alert 策略按级别决定
- [ ] **资源类失败必须告警**：OOM / disk full / network unreachable 这类外部环境问题不能静默
- [ ] **dedupe 必须按问题类型**：alert key 含 task id 前缀（不每次重复发同 task 的 alert，但允许多 task 同时发）
- [ ] **加厚先减肥**：本 PR 0→thin（首次区分 OOM）。后续若引入完整 failure mode 分类（dev-failure-classifier 现有但偏 dispatch 决策），必须先删本 PR 的 isOomKilled 判断 + 'docker_oom_killed' failure_class，统一到 classifier
- [ ] **Walking Skeleton 视角**：本 PR 是 MJ4 自主神经"任务故障可观测性"加厚段。0→thin。thin→medium 是把所有 docker-executor 异常路径都路由到 alerting + 配套 dashboard
