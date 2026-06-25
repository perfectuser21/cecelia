# 部署生命周期 阶段1 · cecelia 回档

> 分支：cp-06251822-cp-deploy-rollback-cecelia
> spec：docs/superpowers/specs/2026-06-25-deploy-lifecycle-tag-rollback-design.md（§1 共享契约 / §2 cecelia 落地 / §5 测试 / §6 成功标准）

## 背景
五条部署路径没有一条能在生产炸了之后回档。cecelia dashboard 现有 promote 成功即 `rm -rf dist.old` 删旧版（回档洞）。
本 PR 给 cecelia（brain + dashboard）装上「生产 release tag + 旧版留存 5 份 + 一键回档」安全网。

## 范围
- `scripts/promote-dashboard.sh`：旧版留存（不删）+ 打统一 `prod-cecelia-vN` tag + 写 `.production-release`
- 新增 `scripts/rollback-cecelia.sh`：无参退上一 tag / 带 tag 从留存挑 / 原子换入 / brain 跨 migration 拦 `--confirm-db`
- 新增 `packages/engine/tests/integration/deploy-rollback.test.sh`：回档 E2E（隔离根，不碰真生产）
- `.gitignore`：忽略 `apps/dashboard/.dist-releases/`

## 不做（阶段2，YAGNI 边界）
- 不建新 staging 环境、不动人工放行 gate、不建 DB migration 向后兼容工具（只在 brain 回档加检测+警告）
- 不真部署生产、不真打 HK

## ARTIFACT 条目

- [x] [ARTIFACT] 新增 `scripts/rollback-cecelia.sh` 回档脚本且语法合法
  Test: manual:bash -n scripts/rollback-cecelia.sh

- [x] [ARTIFACT] promote-dashboard.sh 不再 `rm -rf` 删旧版，改为留存 + 打 tag + 写指针
  Test: node -e "const c=require('fs').readFileSync('scripts/promote-dashboard.sh','utf8');if(!c.includes('.dist-releases')||!c.includes('prod-cecelia-v')||!c.includes('.production-release'))process.exit(1)"

- [x] [ARTIFACT] `.gitignore` 忽略 `apps/dashboard/.dist-releases/`
  Test: node -e "const c=require('fs').readFileSync('.gitignore','utf8');if(!c.includes('apps/dashboard/.dist-releases/'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] promote v1 → promote v2 → rollback → live `dist/` 回到 v1 且 `.production-release` current 回到 v1 tag；留存上限 5 份删最旧；rollback 带不存在 tag 报错退出；brain 回档跨 migration 拦 `--confirm-db`（17/17 PASS，`CECELIA_DEPLOY_ROOT` 隔离根，不碰真生产/真 HK）
  Test: manual:bash packages/engine/tests/integration/deploy-rollback.test.sh
  期望: exit 0

## 成功标准
promote 必打 tag + 留旧版（<=5 份），生产炸了能用一条 `rollback-cecelia.sh [tag]` 秒回上一版或指定留存版；
dashboard 不再 `rm -rf` 删旧版；brain 回档遇 DB migration 有显式 `--confirm-db` 拦截；回档 E2E 进 CI 永久回归。
