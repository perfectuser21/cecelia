task_id: 27814ab1-8e25-4f38-94cc-66c6b9ff1662
branch: cp-0424122436-brain-deploy-idempotent-check

## 任务标题
brain-deploy.sh 加 image SHA 幂等检查，跳过同版本容器 recreate

## 任务描述

解决 Brain 容器每 3 小时被 recreate 导致长跑 Initiative 被 SIGTERM 中断的 P0 问题。
在 scripts/brain-deploy.sh 的 `[7/8] Starting container...` 块内、`docker compose up -d`
前插入 image SHA 比对：当前容器 image ID == 目标 tag image ID 时，跳过 recreate 直接 exit 0。

## DoD

- [x] [ARTIFACT] scripts/brain-deploy.sh 已加 `docker inspect cecelia-node-brain --format '{{.Image}}'` 调用
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes(\"docker inspect cecelia-node-brain --format\"))process.exit(1)"

- [x] [BEHAVIOR] 脚本包含同 SHA 跳过分支（CURRENT_IMG == TARGET_IMG 时设置 DEPLOY_SUCCESS=true 并 exit 0）
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('CURRENT_IMG')||!c.includes('TARGET_IMG'))process.exit(1);if(!/CURRENT_IMG.*==.*TARGET_IMG/.test(c))process.exit(1);if(!c.includes('DEPLOY_SUCCESS=true'))process.exit(1)"

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md')"

## 目标文件

- scripts/brain-deploy.sh
- docs/learnings/cp-0424122436-brain-deploy-idempotent-check.md

## 备注

launchd 模式 `[7/8] Restarting Brain via launchd` 块不改，因为 `launchctl kickstart -k`
本身就是设计为重启语义，不在本次幂等修复范围。
