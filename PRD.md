# PRD: brain-deploy.sh 幂等检查

**日期**：2026-04-24
**分支**：cp-0424122436-brain-deploy-idempotent-check
**Brain 任务**：27814ab1-8e25-4f38-94cc-66c6b9ff1662

## 问题

scripts/brain-deploy.sh 无条件 `docker compose up -d`，即使 image SHA 未变也 recreate 容器，中断 Brain 长跑 Initiative（SIGTERM）。每 3 小时一次，P0。

触发路径：/dev cleanup 合并 Brain PR 后自动跑 brain-deploy.sh，`docker compose up -d` 无视 image SHA 未变，触发 recreate，长跑 Initiative 被 SIGTERM 中断。

## 方案

在 `[7/8]` 块内、`docker compose up -d` 前加 image SHA 比对：

- `docker inspect cecelia-node-brain --format '{{.Image}}'` 取当前容器 image ID
- `docker inspect cecelia-brain:${VERSION} --format '{{.Id}}'` 取目标 tag image ID
- 两者相同 → `DEPLOY_SUCCESS=true; exit 0` 跳过 recreate

## 做

1. scripts/brain-deploy.sh 在 `[7/8] Starting container...` 与 `if [[ "$DRY_RUN" == true ]]` 之间插入 7 行幂等检查
2. 写 Learning 文档 `docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md`

## 不做

- 不改 launchd 模式代码块（launchctl kickstart -k 本身就是重启，不在本次修复范围）
- 不拆 `[7/8]` 块里后续的健康检查 / 步骤 8/9/10（保持原有 launch 路径不变，同 SHA 时直接 `exit 0`，host 脚本自更新下次真版本变更再补）

## 成功标准

- scripts/brain-deploy.sh 包含 `docker inspect cecelia-node-brain --format '{{.Image}}'`
- 包含 SHA 比较分支 `CURRENT_IMG == TARGET_IMG` 并 `exit 0`
- launchd 模式代码块未修改
- Learning 文档存在
