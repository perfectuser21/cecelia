# staging 验证链全程在生产 brain 容器内用 localhost 访问 staging 容器（不通）

2026-06-26。staging E2E 反复 deploy_failed / STAGING_FAIL，根因是一系列「容器内 localhost 访问 staging 容器」问题，逐层暴露。

### 根本原因（架构性，非单点）
staging 验证链（staging-deploy 健康检查 / staging-verify / e2e scenario 重写）整体在**生产 brain 容器 cecelia-node-brain 内**跑，但都用 `localhost:5222` 访问 staging 容器 —— **容器内 localhost ≠ staging 容器**，全部不通。脚本设计假设"在 host 上跑（localhost）"，brain 容器化后假设失效。

逐层暴露（打地鼠教训）：
1. staging-deploy 健康检查 curl localhost:5222（PR #3435 改 docker inspect health）
2. staging-verify.sh STAGING_URL=localhost:5222（本 PR）
3. staging-e2e-runner runStagingCommand 把 :5221 重写成 localhost:5222（本 PR）

### 下次预防
- [ ] 容器 A 内访问容器 B：绝不用 `localhost:<B端口>`（A 的 localhost 不是 B）。用 `host.docker.internal:<端口>`（容器内访问 host 映射端口）或 docker network 容器名
- [ ] 发现一处"容器内 localhost 不通"，**立刻 grep 全仓所有同类用法一次修完**，别逐处打地鼠（本次 #3435 只修健康检查，漏 staging-verify + e2e 重写，又来一轮）
- [ ] 统一一个 `STAGING_HOST`（默认 host.docker.internal，env 可覆盖）配置点，所有 staging 访问复用（auto-staging-smoke.sh 早有此 pattern，应早跟随）
- [ ] 部署/验证脚本被容器化执行时，先审：脚本里的 localhost / 相对路径 / 文件路径，在容器命名空间下还成立吗（同一批暴露：相对路径 #3433、健康检查 #3435、localhost 本 PR）

### 关联
- 同链路全家桶：相对路径 #3433、健康窗口 #3434(方向错)、docker health #3435、localhost 本 PR；429 误判 #3431
