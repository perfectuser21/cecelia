# staging-deploy 健康检查改用 docker inspect health（修网络命名空间根因）

## Bug
staging E2E verdict=FAIL reason=deploy_failed，健康检查全超时，但 staging 容器实际 healthy。

## 根因（实测确认）
`scripts/staging-deploy.sh:164` 用 `curl localhost:${STAGING_PORT}`（:5222）做健康判定。但 staging-e2e-runner 在**生产 brain 容器 cecelia-node-brain 内**跑该脚本，容器内 localhost ≠ staging 容器 → 永远不通。实测：
- 生产 brain 容器内 `curl localhost:5222` → 不通
- 生产 brain 容器内 `curl host.docker.internal:5222` → 通
- 生产 brain 容器内 `docker inspect cecelia-node-brain-staging health` → healthy

上个 PR #3434 加大窗口（60s→180s）是无效修复——localhost 在容器内永远不通，等多久都没用。

## 方案对比
| 方案 | 做法 | 取舍 |
|---|---|---|
| **A（选）** | `docker inspect $STAGING_CONTAINER --format {{.State.Health.Status}}` 轮询直到 healthy | 复用容器 healthcheck（权威+StartPeriod 宽限）；不依赖网络命名空间；host/容器内都对（docker CLI 都能跑，socket 已挂） |
| B | curl 改 host.docker.internal:5222 | host 直跑场景 host.docker.internal 不一定解析（应 localhost），环境脆弱 |
| C | 保持 curl localhost | 错——容器内永远不通 |

## 设计（方案 A）
`staging-deploy.sh` 健康检查循环（line 161-170）把 curl 判定换成 docker inspect：
```bash
HSTATUS=$(docker inspect "${STAGING_CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo "missing")
if [ "$HSTATUS" = "healthy" ]; then HEALTHY=true; break; fi
if [ "$HSTATUS" = "unhealthy" ]; then break; fi   # 提前判失败，不空等
```
- **保留 MAX_TRIES=36**（窗口 180s，不破坏 PR #3434 的窗口守卫；两守卫共存）
- unhealthy 提前 break（容器 healthcheck 已判死，不空等满 180s）

## 测试策略：unit（解析脚本验证检测方式）
vitest 读 `scripts/staging-deploy.sh`：
- 断言健康检查用 `docker inspect` + `State.Health`（容器 healthcheck）
- 断言不再用 `curl` + `localhost:${STAGING_PORT}` 做健康判定（防回退到 localhost）

## 不包含
- staging brain 凭据挂载（account ENOENT，另一层，不阻塞健康判定）
- PR #3434 的窗口守卫测试（保留，MAX_TRIES=36 仍满足）
