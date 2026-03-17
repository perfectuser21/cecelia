# Learning: cp-03171550-fix-l2-concurrency-group

## 任务

修复 L2 concurrency group — 去掉 `run_number`，恢复正确并发取消语义。

## 根本原因

`run_number` 是当初绕过 pending 死锁的临时方案（当时 `cancel-in-progress: false`，固定 group 名导致新 run 排在旧 pending run 后面永远不启动）。修复死锁的正确方案是 `cancel-in-progress: true`，这样新 run 会直接取消旧 run。

加了 `cancel-in-progress: true` 之后 `run_number` 就变成了反效果：每次 run 都有唯一 group，`cancel-in-progress` 从来找不到"同 group 的旧 run"来取消，并发控制完全失效。

### 下次预防

- [ ] 添加 CI 配置的 concurrency 注释，解释 `cancel-in-progress` 与 group 名之间的语义关系
- [ ] 临时 workaround 在 comment 中标注"TODO: 此处是临时方案，根本修复后须还原"
- [ ] 修复 `cancel-in-progress` 值后，同步检查 group 名是否仍包含 `run_number`

## 影响

- L2 CI 并发控制从"完全失效"恢复正常
- 同分支多次 push 时，新 run 取消旧 run，节省 runner 资源，避免冗余等待
