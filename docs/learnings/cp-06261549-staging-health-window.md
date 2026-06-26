# staging-deploy 健康检查窗口 60s 太短，误判 staging 慢启动为 deploy_failed

2026-06-26。staging-deploy 路径修复后真跑，staging 容器真起来了，但 staging_e2e 仍 verdict=FAIL reason=deploy_failed。

### 根本原因
- `scripts/staging-deploy.sh` 健康检查 `MAX_TRIES=12` × `sleep 5` = 60s 窗口。staging brain 启动需 >60s（migration 全扫 + scanner/monitor init），脚本 60s 超时退出报 [FAIL]。
- 但容器其实成功了（实证：staging 容器 `Up healthy` + `curl :5222/api/brain/tick/status` 正常 + `curl :5222/api/brain/harness-selftest` 返回 `{"ok":true,"service":"harness"}`）。
- 误判 deploy_failed → verdict=FAIL → 内部线 promote 不触发，阻断闭环。

### 下次预防
- [ ] staging / 部署健康检查窗口要容许慢启动（staging 是"加分项"，宁可多等 180s 也别误判 FAIL 阻断 promote）
- [ ] 健康检查超时 ≠ 部署失败：判失败前应看容器最终状态（`docker ps` Up healthy）；窗口太短是常见误判源
- [ ] 真跑暴露分层 bug：路径（No such file）→ 健康检查窗口（60s 太短），每修一层露下一层——这正是坚持真跑别 mock 的价值
- [ ] 守卫：vitest 解析 staging-deploy.sh 断言 `MAX_TRIES × sleep >= 180`，窗口退回会报红

### 关联
- 同链路修复：staging-deploy 相对路径（PR #3433）、429 误判（PR #3431）
- staging brain account 凭据没挂（ENOENT，另一层，不阻塞部署但影响 staging LLM 任务）
