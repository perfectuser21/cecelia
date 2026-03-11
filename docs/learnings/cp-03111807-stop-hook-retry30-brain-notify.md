### 根本原因

Stop Hook 重试 15 次上限在某些长时间任务（大 PR、慢 CI）中过低，导致任务未完成就被强制关闭。同时，失败时没有通知 Brain，导致 Brain 无法感知任务失败状态。

### 下次预防

- [ ] 修改 stop-dev.sh 重试上限时，同步更新注释中的 "N 次重试上限" 字样
- [ ] Brain API 通知使用 `|| true` + `--max-time 5` 双重保险，确保网络问题不阻塞 stop hook
- [ ] engine 版本 bump 是 6 个文件：package.json、package-lock.json(engine 独立)、根 package-lock.json(engine 条目)、VERSION、.hook-core-version、regression-contract.yaml
- [ ] feature-registry.yml changelog 条目必须在第一次 push 前写好（CI L2 Impact Check 检查）

**失败统计**：CI 失败 0 次，本地测试失败 0 次
**影响程度**：Low（流程顺畅，无意外问题）
