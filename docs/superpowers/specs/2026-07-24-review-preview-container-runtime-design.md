# Review Preview 容器运行时设计

## 根因

Brain 容器将 `5300-5399` 映射到宿主机。当前
`spawnReviewPreview()` 在容器内却通过 SSH 逃逸到宿主，再让宿主
进程绑定同一端口。宿主端口已经由 OrbStack 代理占用：

- 旧脚本用宽泛 `lsof | kill -9` 误杀代理后“成功”；
- #4309 改为安全清理后，宿主 server 正确收到 `EADDRINUSE`。

## 设计

容器内调用不再 SSH 逃逸，而是在 Brain 容器内直接执行
`/app/scripts/review-preview.sh`。slot server 在容器内监听分配端口，
由现有 Docker `5300-5399` 映射暴露给宿主。静态产物继续读取
`CECELIA_HOST_REPO/apps/dashboard/.dist-staging` 的宿主挂载路径。

宿主直接调用保持现状：执行
`CECELIA_HOST_REPO/scripts/review-preview.sh`。

## 安全边界

- 不修改端口池或 Docker 映射。
- 不修改 kernel derive、审批或 merge 门。
- #4309 的 PID 文件所有权保护继续生效。
- 容器重启会终止 preview，与 Brain 生命周期一致；下一次人审请求会
  按现有幂等逻辑重新创建。

## 验收

1. 现有 container→SSH 测试先红，改为断言 container→本地 bash。
2. host 路径测试保持 bash 调用。
3. 生产 `wait:human_review` 产生 effect，`localhost:<port>` 返回 200。
4. OrbStack 与 Brain 在 preview 创建后保持健康。

