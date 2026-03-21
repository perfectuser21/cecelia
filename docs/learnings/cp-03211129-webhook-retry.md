# Learning: cecelia-run webhook 回调重试

## 变更概述
修复 cecelia-run.sh 的 send_webhook 函数，将 `|| true` 静默吞错改为 3 次重试 + 指数退避 + 本地失败队列。

### 根本原因
send_webhook 使用 `|| true` 吞掉所有 curl 错误，Brain 收不到 execution-callback，导致 task 永久卡在 in_progress 状态。网络抖动、Brain 短暂重启等场景下高概率触发。

### 下次预防
- [ ] 涉及外部调用的关键回调，禁止使用 `|| true` 静默吞错
- [ ] 关键回调必须有重试机制和失败持久化
- [ ] cleanup trap 中应包含最终回调保障，防止异常退出丢失状态更新
