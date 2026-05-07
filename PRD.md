# PRD — fix(brain): docker-executor exit=137 OOM kill 触发 P1 alert

## 背景 / 问题

`docker-executor.js:writeDockerCallback` 当 task container exit_code=137（SIGKILL = 128+9）时，仅写入 callback_queue 标 status=failed，**不发任何告警**。

exit=137 来源典型：
- cgroup memory limit 触发 OOM killer（任务超出 --memory）
- docker kill --signal=KILL（watchdog / 手动 abort）
- container 突破 cgroup 资源上限

实测：MJ1 harness graph 内 sub-task 多次 exit=137（brain.log 历史记录），任务静默失败，dispatcher 看 success=false → recordFailure('cecelia-run') → 累积熔断。**没有任何告警让主理人知道是资源问题**。

## 成功标准

- **SC-001**: writeDockerCallback 检测 exit_code===137 && !timed_out → raise P1 alert
- **SC-002**: alert key 含 task id 前 8 位（dedupe per-task），message 含 task_type + 提示"提高 tier memory 或拆分任务"
- **SC-003**: alert 失败不影响 callback 写入（fire-and-forget catch）
- **SC-004**: timed_out=true 的 137 不重复告警（已有 docker_timeout 信道）
- **SC-005**: failure_class 新增 'docker_oom_killed' 区分于通用 'docker_nonzero_exit'

## 范围限定

**在范围内**：
- docker-executor.js writeDockerCallback 加 exit=137 判断 + raise alert
- failure_class 区分 oom_killed 和 nonzero_exit
- 单元测试覆盖 6 个 case

**不在范围内**：
- 自动 retry 策略（属于 dispatcher 决策层）
- 自动 tier 升级（建议 alert 后人工介入）
- watchdog kill 与 OOM kill 区分（都属于 137，统一告警；细分需要 cgroup metrics）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/docker-executor.js` 含 `EXIT_SIGKILL` 常量 + `import raise from './alerting.js'`
- [x] [ARTIFACT] `packages/brain/src/__tests__/docker-executor-oom-alert.test.js` 创建
- [x] [BEHAVIOR] tests/docker-executor-oom-alert: 6 个 it（exit=137 触发 / exit=0 不触发 / exit=1 不触发 / timed_out 不重复 / callback 仍 insert / alert 抛错不阻塞）

## 受影响文件

- `packages/brain/src/docker-executor.js` — 加 alert 触发 + failure_class 'docker_oom_killed'
- `packages/brain/src/__tests__/docker-executor-oom-alert.test.js` — 新建

## 部署后验证

merge + Brain 重启后：
1. 模拟 OOM（启动 dev task with --memory=1m），应该看到 alert 触发
2. `psql -d cecelia -c "SELECT failure_class, COUNT(*) FROM callback_queue WHERE failure_class='docker_oom_killed' GROUP BY failure_class"` 跟踪 OOM 频次
3. 实际 alert 通过 alerting.js 落到 alerts 表 + Feishu/Bark 通知
