# Learning: deploy webhook 非阻塞化

## 背景
PR #1319 — `feat(brain): deploy webhook 非阻塞化 — execSync → spawn + 并发保护 + output_tail`

## 根本原因

`POST /api/brain/deploy` 使用 `execSync` 同步执行 deploy-local.sh，导致：
1. Node.js 事件循环在部署期间（最长 10 分钟）完全阻塞
2. Brain 所有 API 请求在部署期间超时
3. exit 137（OOM kill）时子进程报错传播不清晰

## 下次预防

- [ ] 凡需要执行外部长时进程（> 5s）的 API handler，必须用 `spawn`（异步）而非 `execSync`（同步）
- [ ] 对有状态的 webhook（running/idle）必须加并发保护（检查 `status === 'running'` 返回 409）
- [ ] 捕获 stdout/stderr 到 state 对象（output_tail），方便 CI 轮询时调试
- [ ] 更新 `child_process` mock 时需同步新增的方法（`spawn` 需加入 mock）
