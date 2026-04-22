# Brain Compose cgroup 限额修复（2026-04-22）

## 做了什么

修 PR #2523 的 silent bug：`docker-compose.yml` 用 `deploy.resources.limits` 设 Brain 容器内存/CPU 限额，但这字段**只在 Docker Swarm 模式生效**，compose standalone 模式被忽略。

加顶层 `mem_limit: 1g` / `mem_reservation: 512m` / `cpus: 2.0`（compose standalone 标准字段）。保留 `deploy.resources` 块供未来 swarm 兼容。

同步改 `brain-docker-up.sh` 加 `--force-recreate`，因为 `docker-compose up` 对已存在容器默认复用旧配置。

### 根本原因

Docker 社区长期的配置陷阱：
- `deploy.*` 是 Docker Swarm / Stack 的字段，compose standalone 启动忽略
- compose standalone 要用 `mem_limit` / `cpus` / `mem_reservation` 顶层字段（compose v2 新版文档说这些 "deprecated"，但实际仍是 standalone 唯一有效方式）

PR #2523 抄了 Linux VPS 上的 swarm 风格 compose，在本机 compose standalone 下 limit 字段静默失效，没有任何警告。`docker inspect Memory: 0 bytes` 才暴露。

### 下次预防

- [ ] compose 加 cgroup 限额后，必须 `docker inspect CONTAINER -f '{{.HostConfig.Memory}}'` 验证非 0
- [ ] compose standalone 用 `mem_limit` / `cpus` / `mem_reservation`，swarm 才用 `deploy.resources`
- [ ] 两边都写保证兼容
- [ ] `docker-compose up` 对已存在容器默认复用，配置改过必须加 `--force-recreate`
- [ ] 或需要"stop + rm + up"序列（当镜像/网络等也改时）

## 技术要点

- `mem_limit: 1g` 格式（小写 g）= 1 GB = 1073741824 bytes
- `cpus: 2.0` 是浮点，对应 `HostConfig.NanoCpus: 2000000000`
- docker inspect 里 `HostConfig.Memory: 0` = 无限额（用整个宿主可用）
- OrbStack 下"宿主可用"= Linux VM 总量 = 5.84 GB
- `docker-compose up --force-recreate` 会停旧容器 + 起新容器（同名），数据卷保留
- 本次实操 --force-recreate 还是报容器名冲突，是因为旧容器状态不一致，用 `docker stop + rm` 手工清一遍才 up 成功

## 冒烟验证（实测结果）

```bash
# 1. compose config 解析
docker compose -f docker-compose.yml config | grep -E 'mem_limit|cpus:'
# 实测:
#   cpus: 2
#   mem_limit: "1073741824"  ← 1 GB bytes ✓

# 2. 应用 + 验证 cgroup
docker stop cecelia-node-brain && docker rm cecelia-node-brain
docker compose up -d node-brain
docker inspect cecelia-node-brain -f '{{.HostConfig.Memory}} / {{.HostConfig.NanoCpus}}'
# 实测: 1073741824 / 2000000000 ✓

# 3. docker stats 显示新 limit
docker stats --no-stream cecelia-node-brain
# 实测: MEM: 93.64MiB / 1GiB ← 正确的 1GB limit ✓
```
