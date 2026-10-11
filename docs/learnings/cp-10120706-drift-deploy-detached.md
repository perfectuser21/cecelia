## drift-sentinel 补部署硬超时杀进程 + 容器内 Bark 推送失败（2026-10-12）

### 根本原因
- drift-sentinel 用 `exec(..., { timeout: 300000 })` 跑 brain-deploy.sh：Node 的 exec timeout 到点直接给子进程发 SIGTERM。部署脚本在 ledger begin 之后被杀就留孤儿 pending，与 a80485b3（容器重启 SIGKILL）是同一类"部署进程半路死亡"。部署这种长活不该由调用方用超时杀，超时只能是告警口径。
- 同一处还用相对路径 `scripts/brain-deploy.sh`、cwd 继承 Brain 进程（容器内 /app，只有 packages/brain 内容），脚本根本不存在；另外 loadState 读 `working_memory.value`（真实列是 value_json），状态每轮回到初始值，补部署分支在生产其实从未走到。三个缺陷叠在一起，单测因全 mock 一直是绿的。
- 部署 Bark 推送失败：`_url_encode` 依赖 jq 或 python3，Brain 镜像两者都没有，回退成原样返回，中文+空格进 URL 被 curl 拒收。

### 下次预防
- [ ] 跑部署/构建这类长进程一律 detached + 落盘日志 + 超时只告警；结算交给进程自身 trap 和带外 reconcile，不靠调用方等待
- [ ] 脚本路径一律从 REPO_ROOT 拼绝对路径，别依赖进程 cwd（容器 WORKDIR 与仓库根不同）
- [ ] 容器里跑的 shell 不要假设有 jq/python3；能纯 bash 做的（URL 编码）就纯 bash，测试用收窄 PATH 模拟容器
- [ ] 读写同一张 KV 表的 load/save 要用同一列名，测试至少有一条不 mock 列名的用例
