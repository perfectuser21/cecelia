# Learning: Brain 部署流程可观测性补齐

## 任务
为 Brain deploy webhook 添加 in-memory 状态追踪和 GET /api/brain/deploy/status 端点。

### 根本原因
deploy webhook 是 fire-and-forget（返回 202 后异步执行），GitHub Actions CI 无法感知部署是否真正成功，只能验证 HTTP 响应码。

### 下次预防
- [ ] 任何 fire-and-forget 异步操作都应有对应的 status 查询端点
- [ ] CI poll 步骤应设合理超时（300s）和 idle 豁免逻辑（部署跳过场景）
- [ ] in-memory 状态跟踪足够部署观测需求（无需 DB，进程重启重置属预期）
