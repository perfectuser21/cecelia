# Review Preview 安全端口清理设计

## 背景

`scripts/review-preview.sh` 在启动 per-PR 预览前执行
`lsof -ti ":${PORT}" | xargs kill -9`。生产 Brain 容器把
`5300-5399` 映射到宿主机，OrbStack 的端口代理因此与宿主 preview
同时出现在 `lsof` 结果中。脚本会误杀 OrbStack Helper，连带终止
Brain 和正在运行的 kernel orchestrator，使
`wait:human_review` 只能留下 intent，无法留下 effect。

## 约束

- 不修改 PR #4308 的一文件 fire-drill diff。
- 不修改 kernel derive、approval 或 merge 门。
- 不杀任何未由本脚本 PID 文件登记的进程。
- 保留同一端口旧 review preview 的幂等重启能力。
- 未知进程占用端口时安全失败，不尝试猜测或强制清理。

## 方案

保留 `/tmp/review-preview-${PORT}.pid` 的定向回收逻辑，删除按端口
枚举并 `kill -9` 所有 PID 的兜底。旧 preview 仍由 PID 文件先行
终止；如果端口被其他进程占用，脚本绝不主动清理未知进程，由操作
系统的地址族/bind 语义和现有 readiness 检查决定新 preview 能否启动。

不采用按命令名过滤，因为命令行匹配存在竞态且仍可能误杀；不改端口
池，因为这会同时扩大 preview-manager、Docker 映射和容量管理的
变更范围。

## 测试

永久回归测试启动一个不写入 review PID 文件的真实 HTTP 监听进程，
再执行真实 `review-preview.sh`：

- 修复前，脚本按端口杀死该进程，测试失败；
- 修复后，未知进程仍存活，测试通过；测试不假定不同地址族的 bind
  是否可以并存。

测试使用 `5300-5399` 之外的临时端口，避免测试自身触碰生产
OrbStack 代理。

## 验收

1. 回归测试完成 Red→Green 实证。
2. 既有 review-preview SSH 路由测试保持绿。
3. DevGate 与 GitHub CI 全绿。
4. hotfix 合入部署后，同一个 fire-drill run 产生
   `effect:human_review_requested`，OrbStack 与 Brain 保持在线。
