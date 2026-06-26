# Harness 独立 release 阶段设计（staging → release → deploy）

**Goal:** 在 harness 内部线 staging PASS 与 production deploy 之间，插入一个**独立的 release 阶段**：把 staging 验过的产物冻结进产物库 `.dist-releases/<vX>` + 打 git tag vX + 登记 manifest，然后 deploy 阶段从产物库把 vX 上线到 5211。让 release 成为一等公民（可见、可审计、就是回档单位）。

**Architecture:** 产物库 `.dist-releases/<tag>` 作为唯一真相源——release 阶段把验过的产物冻进去，deploy 与 rollback 都从它 `cp` 到 live（对称）。

**Tech Stack:** bash 部署脚本，Node ESM（staging-promote.js / staging-e2e-runner.js），vitest。

---

## 背景：现状没有独立 release 阶段

`promote-dashboard.sh` 现在的顺序是 **先 deploy（mv staging→live 5211）→ 再打 tag/写 .production-release**（step 2 在 step 3 前）。问题：
1. tag 是部署后的副作用，不是独立阶段；
2. 新版本产物**没进 `.dist-releases/`**（只有被顶下来的旧版才进库），当前线上版本在被取代前不在产物库里；
3. 没有"staging 过了 → 这是 release vX → 再部署"的显式生命周期。

回档真相（已读 `rollback-cecelia.sh`）：回档是 `cp -R .dist-releases/<tag> → live` + 读 `.production-release` 的 `manifest=<tag> brain_image=...`。即产物库 + manifest 是回档契约，**本设计必须保持兼容**。

---

## 设计：promote-dashboard.sh 拆三模式 + staging-promote.js 两步显式

### promote-dashboard.sh（一个脚本，三模式，向后兼容）
- `--release-only`：
  1. `RELEASE_TAG=$(next_release_tag)`
  2. **冻结**：`cp -R <staged_dist> .dist-releases/<RELEASE_TAG>`（验过的产物进库，不可变）
  3. `git tag RELEASE_TAG`（可 `CECELIA_SKIP_GIT_TAG` 跳）
  4. 写 `.production-release` 的 `manifest=<RELEASE_TAG> brain_image=... dashboard_release=<RELEASE_TAG> commit=...` + `history=`（**不动 current**，因为还没部署）
  5. 输出 `RELEASE_TAG=<vX>`（供 deploy 步取）
  6. 不碰 live dist/、不碰 brain。`prune_releases` 保留 5 份。
- `--deploy <RELEASE_TAG>`：
  1. 源 = `.dist-releases/<RELEASE_TAG>`（不在则报错退，不猜——与 rollback 一致）
  2. **原子换入** live dist/（旧 live 先 mv 到 `.dist-releases/<旧 current tag>` 留存，再 `cp -R` 库版本进 live；失败回滚）
  3. 写 `.production-release` `current=<RELEASE_TAG>` + `commit` + `promoted_at`（覆盖；manifest/history 已由 release 步写，保留）
  4. brain-deploy（除非 `CECELIA_SKIP_BRAIN_PROMOTE`）
  5. 停 staging slot + 清 `.staging-pending`
- 无参（向后兼容，手动用 + 现有测试）：= `--release-only` 取 tag → `--deploy <tag>`。读 `.staging-pending` 拿 staged_dist（不变）。

### staging-promote.js
- 新增 `defaultReleaseExec(repoRoot)` → 跑 `promote-dashboard.sh --release-only`，解析输出 `RELEASE_TAG`；`defaultDeployExec(repoRoot, tag)` → 跑 `--deploy <tag>`。两者都注入 `CECELIA_SKIP_BRAIN_PROMOTE=1`（沿用接缝修复，不自杀）。
- `runInternalPromote({releaseExec, deployExec})`：先 release 拿 tag → 再 deploy(tag)。任一步失败 → promote_failed，**release 已切但未部署**也记录（release 是独立产物，留库不丢）。
- 测试必注入 mock，绝不打真 5211。

### staging-e2e-runner.js handlePromote
- 内部线 PASS：`runInternalPromote({releaseExec, deployExec})`（生产注入 default*；测试注入 mock）。
- 落库分两个可见状态：`released`（已切 release，tag 已打）→ `auto_promoted`（已部署）。`promote_status` 增 `released` 态（在 PROMOTE_STATUS 加 `RELEASED='released'`）。report 带 release_tag。

---

## 数据流
staging_e2e PASS → **release**（冻结 .dist-releases/<vX> + tag vX + manifest，promote_status=released）→ **deploy**（cp <vX> → live 5211，promote_status=auto_promoted）→ report（含 release_tag + production_version + rollback_anchor）。

## 错误处理
- release 失败 → promote_failed，未切 tag/未动生产。
- deploy 失败 → promote_failed，但 release（tag + 库产物）已在——下次可重试 deploy 同一 vX（幂等）。
- 回档不变：`rollback-cecelia.sh` 从 `.dist-releases/<tag>` + manifest 取，本设计喂的正是它要的。

## 测试策略（vitest，RED-first）
- **bash 行为**（用 CECELIA_DEPLOY_ROOT 隔离根 + SKIP_GIT_TAG/SKIP_BRAIN_PROMOTE）：
  - `--release-only`：产物进 `.dist-releases/<vX>`、写 manifest、**不动 live dist/**、不动 current。
  - `--deploy <vX>`：live dist/ = 库版本、current=<vX>、旧版留存。
  - 无参：= release+deploy（向后兼容，现有 promote-dashboard 测试仍绿）。
  - 反例：`--deploy <不存在 tag>` → 报错退，不动生产。
- **staging-promote.js**（注入 mock exec）：runInternalPromote 先 releaseExec 后 deployExec；release 成功 deploy 失败 → promote_failed 且 release_tag 已记。
- **回归**：现有 promote-dashboard / staging-promote / rollback 测试全绿；新增 release 阶段测试。
- 真跑验收（spec 外）：点火内部线 dashboard run，看 promote_status 走 released → auto_promoted，5211 生效，`.dist-releases/<vX>` 有产物，`git tag` 有 vX。

## 不包含
- 客户线（zenithjoy）release 阶段（本次只内部线；客户线仍 pending_promote）。
- release 的人工放行闸（内部线自动 release+deploy；人工闸是另一议题）。
