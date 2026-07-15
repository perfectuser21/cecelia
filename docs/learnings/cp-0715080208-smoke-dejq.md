# 核心 smoke 去 jq 化——canary 容器内 jq 缺失（2026-07-15）

## 根本原因

蓝绿 pre-swap smoke 在 blue 容器内执行，4/5 核心 smoke 裸调 jq，而 cecelia-brain 镜像运行时层没有 jq。07-14 曾有"镜像补 jq"和"node 兜底 shim"两个修复 PR，产物在 #3914/#3917 的 rebase 混乱中丢失；守卫 brain-image-smoke-deps.test.sh 写了但没接进 CI（scripts/__tests__ 无 glob 自动发现），丢失无人察觉。改 Dockerfile 救不了当前 blue（smoke 在旧容器里跑，鸡生蛋），按决策「容器脚本依赖只许 bash+curl+node」正解是 smoke 去 jq。

## 下次预防

- [ ] 容器内执行的脚本新增外部命令依赖时，先对照容器依赖清单（bash+curl+node）——守卫 smoke-core-no-jq.test.sh 已接 CI 强制
- [ ] 写了守卫测试必须同 PR 接进 CI（scripts/ 下 bash 测试无 glob 自动发现，ci.yml 要显式加行）——本病已两例（brain-image-smoke-deps、gate3-changed-paths 差点）
- [ ] rebase 冲突大 PR 合并后，核对被"版本倒退/误删"波及的修复是否仍在 main
