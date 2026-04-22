# Brain 容器 compose cgroup 限额生效 修复

**日期**: 2026-04-22
**分支**: cp-0422152015-brain-compose-cgroup-fix
**Task**: 30d0fc90-05e5-406f-a69f-e369896f69bd

## Bug

PR #2523 在 `docker-compose.yml` 给 node-brain 设 `deploy.resources.limits: memory: 1G / cpus: '2'`，但该字段**只在 Docker Swarm 模式生效**，docker-compose standalone 模式忽略。

实测 `docker inspect cecelia-node-brain`：
- `Memory: 0 bytes`（无 cgroup 内存限额）
- `NanoCpus: 0`（无 CPU 限额）
- 容器实际可用整个 OrbStack VM 5.84 GB 内存

违背 PR #2523 设计意图（硬预留保护 Brain 免受兄弟容器挤压）。

## 修复

加 compose 顶层字段（standalone 生效），保留 `deploy.resources`（swarm 兼容）：

```yaml
    mem_limit: 1g
    mem_reservation: 512m
    cpus: 2.0
    deploy:                    # 保留，swarm 模式才读
      resources:
        limits:
          memory: 1G
          cpus: '2'
        reservations:
          memory: 512M
```

## 成功标准

- `docker inspect cecelia-node-brain` → `Memory: 1073741824`（1 GB）
- `NanoCpus: 2000000000`（2 CPUs）
- Brain 容器重启后仍 healthy

## 范围

- 仅改 `docker-compose.yml` node-brain service 3 行
- `brain-docker-up.sh` `--force-recreate` 让新配置生效
- 冒烟：docker inspect 前后对比 + curl 5221

不改 Dockerfile、脚本、Brain 代码。
