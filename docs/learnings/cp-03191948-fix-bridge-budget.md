# Learning: Bridge 崩溃 + 预算算法时间加权

## 分支
`cp-03191948-fix-bridge-budget`

### 根本原因

**Bridge 崩溃**：`/llm-call` 路由中 `child.on('close')` 和 `child.on('error')` 都调用 `res.end()`，当两个事件都触发时 → `ERR_HTTP_HEADERS_SENT` → Bridge 进程崩溃 → 所有后续任务 `no_executor`。

**预算过度节流**：`accountRemainingPct()` 只看"用了多少"不看"离 reset 还有多远"。用了 53%（剩 47%）但明天就 reset，仍然降速到 70%。应该按"剩余额度 / 剩余时间占比"来算有效剩余。

### 下次预防

- [ ] HTTP 服务中所有 response 必须用 guard 防重复发送（safeRespond 模式）
- [ ] 预算/节流算法必须考虑时间维度，不能只看绝对值
