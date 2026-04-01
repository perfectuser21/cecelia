# Learning: Sprint Contract 断点续跑

## 任务
为 sprint-contract-loop.sh 增加 `--resume` 标志，支持上下文压缩后恢复时跳过已收敛的 Sprint Contract。

### 根本原因
上下文压缩发生在 Sprint Contract 两轮之间时，`.sprint-contract-state` 记录了 round，但 agent 上下文丢失，不知道已到哪一轮，重新开始导致重复对抗。

### 下次预防
- [ ] Sprint Contract 每次收敛后 state 文件写盘（已有），但 main agent 重启时需先调 `--resume` 检测
- [ ] `01-spec.md` Step 4 开始前强制调用 `--resume` 检测（已通过本次 PR 添加）
- [ ] 新增 `--resume` 标志与原接口完全向后兼容，调用方无需感知
