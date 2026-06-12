# Learning — Brain 容器内存上限 1G → 4G（OOM 重启伪装成灵异问题）

## 运行指标

- 模式：单行级 P0 配置修复（无代码逻辑改动）
- 分支：cp-06121023-brain-memory-4g
- 改动：docker-compose.yml + docker-compose.staging.yml 内存 cap

## 发现的问题

### [INFRA] 容器 memory cap < 运行时堆上限

- **现象**：production Brain 每 ~20-30 分钟"神秘重启"（非 merge 部署），反复打断在飞 harness run。
- **根因**：`docker-compose.yml` brain 服务 `mem_limit: 1g` / `deploy.resources.limits.memory: 1G`，但容器内 node 以 `--max-old-space-size=3072`（3G 堆）运行（`packages/brain/Dockerfile:72`）。3G 堆配 1G cgroup cap，双 LangGraph 负载必然 OOM kill。
- **实证**：docker 事件链 `oom → die → start`，RestartCount=2。
- **修复**：`mem_limit`/`deploy.resources` 双处 1G→4G（4G = 3G 堆 + ~1G 容器/native 开销）；staging 同步对齐。

### [TRAP] standalone compose 真正生效的是 mem_limit，不是 deploy.resources

- compose 文件里 `deploy.resources.limits.memory` **只在 Docker Swarm 模式生效**；`docker compose up`（standalone）实际读 `mem_limit`。
- 若只改 `deploy.resources`（team-lead 初始只点了这一处）而漏改 `mem_limit`，在 standalone 部署下根本不生效。两处必须同改。

## 根本原因

容器 memory cap 设置时未与运行时 node 堆上限（`--max-old-space-size`）对齐。堆能涨到 3G，容器只给 1G，内核在堆触顶前就 OOM kill 进程。OOM 重启会沿调用栈向上"伪装"成各种上层灵异问题（在飞 run 被打断、任务超时、状态丢失），极难从上层定位。

## 下次预防清单

- [ ] 设置容器 `mem_limit` / `deploy.resources.limits.memory` 前，先查容器内进程的堆上限（`--max-old-space-size` / `NODE_OPTIONS`），cap 必须 ≥ 堆上限 + 容器/native 开销余量（经验值 +1G）。
- [ ] standalone `docker compose` 部署下，内存限额以 `mem_limit` 为准，不要只改 `deploy.resources`（那是 Swarm-only）。两处保持一致。
- [ ] 遇到"规律性神秘重启"先查 `docker inspect` 的 `RestartCount` 与 `State.OOMKilled`，以及 docker 事件流 `oom` 事件，再向上层找；OOM 重启常伪装成上层业务异常。
