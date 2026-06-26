# staging-deploy 健康检查 curl localhost:5222 在生产 brain 容器内永远不通

2026-06-26。staging E2E verdict 一直 FAIL deploy_failed，健康检查全超时，但 staging 容器实际 healthy + host 能 curl 到 :5222。

### 根本原因
- `scripts/staging-deploy.sh` 健康检查用 `curl localhost:${STAGING_PORT}`（:5222）。但 staging-e2e-runner 在**生产 brain 容器 cecelia-node-brain 内**跑这个脚本，**容器内 localhost ≠ staging 容器** → curl 永远不通。
- 实测铁证：生产 brain 容器内 `curl localhost:5222` 不通 / `curl host.docker.internal:5222` 通 / `docker inspect cecelia-node-brain-staging health` = healthy。
- **上个 PR #3434 加大健康检查窗口（60s→180s）是无效修复**——localhost 在容器内永远不通，等多久都没用。真根因是网络命名空间，不是窗口太短。

### 下次预防
- [ ] 跨容器健康检查：在容器 A 内判断容器 B 是否 ready，不能用 `curl localhost:<B端口>`（A 的 localhost 不是 B）。用 `docker inspect B --format {{.State.Health.Status}}`（复用 B 自己的 healthcheck，权威 + StartPeriod 宽限 + 不依赖网络），或 host.docker.internal:<端口>
- [ ] "健康检查超时" 先怀疑**连不上**（地址/网络命名空间），别急着加大窗口——窗口治标且可能根本不通
- [ ] 分层 bug 真跑才暴露：脚本路径（#3433）→ 窗口（#3434 修错方向）→ 网络命名空间（本 PR 真根因）。每层都靠真跑+实测推翻上一层假设
- [ ] 容器跑部署脚本前先想：脚本里的 localhost / 相对路径 / 文件路径，在容器命名空间下还成立吗

### 关联
- 同链路：staging-deploy 相对路径（#3433）、健康窗口（#3434，方向错但无害保留）、429 误判（#3431）
- 容器自刷顶 token（issue 9d17392c）
