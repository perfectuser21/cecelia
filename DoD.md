# 回档收口 · brain 子步复用 brain-rollback.sh（清单法）

> 分支：cp-06251847-cp-rollback-reuse-brain
> 收口对象：PR #3422 的平行 brain 回档路径

## 背景
PR #3422 的 `rollback-cecelia.sh` brain 子步是 `git checkout <tag>` + `brain-deploy.sh`（源码重建），
和 cecelia 已有的 `brain-rollback.sh`（image-tag 账本回退 + 健康检查）平行。本 PR 拆掉平行路径，
用清单法让统一 tag 委托给 `brain-rollback.sh`，cecelia 只留一套 brain 回档原语。

## 范围
- `scripts/promote-dashboard.sh`：写 `.production-release` 多记 `manifest=<tag> brain_image=<.brain-versions head>`
- `scripts/rollback-cecelia.sh`：brain 子步改调 `brain-rollback.sh <镜像版本>`（从 manifest 取）；
  pre-flight 校验该版本仍在 `.brain-versions`（被 prune → 报错退出，生产/指针不动）；指针回拨保留 `manifest=` 行
- `packages/engine/tests/integration/deploy-rollback.test.sh`：加断言（manifest 记 brain_image / brain 子步走 brain-rollback.sh / 镜像被 prune 报错退出 / 不含 git checkout）

## 不做
- 不改 dashboard 留存/换回逻辑、不改 migration 守护、不改 `brain-rollback.sh` 本身。不真起 docker、不碰生产。

## ARTIFACT 条目

- [x] [ARTIFACT] rollback-cecelia.sh 不再 git checkout 重建 brain，改调 brain-rollback.sh
  Test: node -e "const c=require('fs').readFileSync('scripts/rollback-cecelia.sh','utf8');if(c.includes('git -C \"$MAIN_ROOT\" checkout')||!c.includes('brain-rollback.sh'))process.exit(1)"

- [x] [ARTIFACT] promote-dashboard.sh 把 brain_image 写进 manifest 行
  Test: node -e "const c=require('fs').readFileSync('scripts/promote-dashboard.sh','utf8');if(!c.includes('manifest=')||!c.includes('brain_image='))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] promote 记 brain_image 进 manifest；rollback brain 子步调 brain-rollback.sh 并传正确镜像版本（非 git checkout）；目标镜像被 prune 出 .brain-versions → 报错退出生产/指针不动；指针回拨保留 manifest 行（23/23 PASS，mock brain-rollback.sh + CECELIA_DEPLOY_ROOT 隔离根，不真起 docker/不碰生产）
  Test: manual:bash packages/engine/tests/integration/deploy-rollback.test.sh
  期望: exit 0

## 成功标准
cecelia 只有一套 brain 回档原语（`brain-rollback.sh`）；统一 `prod-cecelia-vN` tag 退化成指向它的清单；
目标 brain 镜像不在账本时报错退出不偷偷重建；回档 E2E 进 CI 永久回归。
