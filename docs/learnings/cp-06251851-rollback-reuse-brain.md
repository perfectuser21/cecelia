# 回档收口：brain 子步复用 brain-rollback.sh（拆平行路径）

> 分支：cp-06251847-cp-rollback-reuse-brain
> 收口对象：PR #3422（部署生命周期阶段1）

## 做了什么

把 `rollback-cecelia.sh` 的 brain 子步从"自己 `git checkout <tag>` + `brain-deploy.sh` 源码重建"
改成**复用现有 `brain-rollback.sh`**（image-tag 账本回退）。采用清单法（manifest）对齐两套版本号：
- `promote-dashboard.sh`：写 `.production-release` 时多记一条 `manifest=<tag> brain_image=<当时 .brain-versions head>`。
- `rollback-cecelia.sh`：从目标 tag 的 manifest 取 `brain_image` → pre-flight 校验它仍在 `.brain-versions`
  账本（被 prune 出账本 → 报错退出，生产/指针不动，不偷偷 git 重建）→ 委托 `brain-rollback.sh <镜像版本>`。
- dashboard 留存/换回逻辑不动；migration 守护保留。
- rollback 指针回拨时**必须保留 `manifest=` 行**（否则回档后该 tag 清单丢失，下次回档查不到 brain_image）。

## 根本原因

PR #3422 我没先盘点 cecelia 现有部署原语就按 spec"brain 回档不存在"的错误前提，给 brain 写了
`git checkout + brain-deploy.sh` 的回档路径——而 cecelia 早有 `brain-rollback.sh`（image-tag +
`.brain-versions` 账本 + 健康检查）和 `rolling-update.sh`（蓝绿）。结果同一个 brain 回档有了两套原语，
且我那套从源码重建、不如现有的换镜像稳。spec 的现状表把 brain 写成"tag 未用/无回档"，我照单全收没验证。

## 下次预防

- [ ] 动任何 deploy/promote/rollback 前**先 grep 现有原语**（`scripts/ .github/workflows/ packages/`
      找 deploy-lib/rollback/blue-green/releases/.backups），证明"真没有"再写新代码；spec 写的现状也要验，别照单全收。
- [ ] 统一 release tag 用**清单法**：tag 是面向人的清单（记录各产物版本），不重造各产物自己的回档原语，
      委托给现有原语执行。
- [ ] 回档/promote 改写 `.production-release` 时，**保留所有累积型行**（`manifest=` / `history=`），
      只覆盖 `current=` 等单值字段——漏保留 manifest 会让"下次回档查不到 brain_image"。
- [ ] 目标产物版本不在账本/留存 → 报错退出，不 fallback 偷偷重建（与"不在留存内就报错不猜"一致）。
