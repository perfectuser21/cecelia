# Learning: Stop Hook 超时静默放行无后续诊断

## 发现

Stop Hook 在 MAX_RETRIES=30 次重试后 exit 0 放行，虽然 PATCH 了任务状态为 failed，但没有创建后续诊断任务。卡住的任务就此静默消失，无人跟进。

### 根本原因

设计缺陷：超时退出只做了"标记失败"，没做"自愈闭环"。Brain 知道任务 failed，但不会自动派发诊断任务去分析卡住原因。

### 下次预防

- [ ] 任何 exit 0 放行路径都需要考虑：谁来跟进这个失败？
- [ ] 失败处理必须包含两步：1) 标记失败 2) 创建后续任务
- [ ] hooks/stop-dev.sh 和 packages/engine/hooks/stop-dev.sh 是硬链接同一文件，不需要手动同步
