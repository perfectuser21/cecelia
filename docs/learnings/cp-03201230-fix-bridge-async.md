# Learning: Bridge execSync 阻塞导致熔断
## 分支
`cp-03201230-fix-bridge-async`
### 根本原因
Bridge 用 execSync 启动 cecelia-run，阻塞 Node.js 事件循环。当 /llm-call 密集调用时，/trigger-cecelia 请求排队超时 → fetch failed → 3 次触发熔断 → 所有派发停止。
### 下次预防
- [ ] Bridge 所有操作必须非阻塞（exec/spawn，不用 execSync）
