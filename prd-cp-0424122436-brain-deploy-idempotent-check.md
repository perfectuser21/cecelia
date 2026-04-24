# PRD: brain-deploy.sh 幂等检查

## 问题

scripts/brain-deploy.sh 无条件 `docker compose up -d`，即使 image SHA 未变也 recreate 容器，中断 Brain 长跑 Initiative（SIGTERM）。每 3 小时一次，P0。

触发路径：/dev cleanup 合并 Brain PR 后自动跑 brain-deploy.sh，`docker compose up -d` 无视 image SHA 未变，触发 recreate，长跑 Initiative 被 SIGTERM 中断。

## 方案

在 `[7/8]` 块内、`docker compose up -d` 前加 image SHA 比对：

- `docker inspect cecelia-node-brain --format '{{.Image}}'` 取当前容器 image ID
- `docker inspect cecelia-brain:${VERSION} --format '{{.Id}}'` 取目标 tag image ID
- 两者相同 → `DEPLOY_SUCCESS=true; exit 0` 跳过 recreate

## 成功标准

- scripts/brain-deploy.sh 包含 `docker inspect cecelia-node-brain --format '{{.Image}}'`
- 包含 SHA 比较分支 `CURRENT_IMG == TARGET_IMG` 并 `exit 0`
- launchd 模式代码块未修改
- Learning 文档 `docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md` 存在
