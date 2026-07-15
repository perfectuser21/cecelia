# 设计：Gate3 自动部署恢复——green canary 容器内不可达根治 + 变更检测死代码修复

日期：2026-07-15 ｜ Brain task：1c47748a-6087-42df-bd99-03ed424c64ad ｜ 优先级：P1

## 问题（生产日志证实）

Gate3（brain-ci-deploy.yml）webhook 自动部署自 07-14 中午起全红，生产滞留旧版（1.263.0 < main 1.263.1），每次 brain 合并需人工宿主补部署。

主导根因：webhook 链路里 brain-deploy.sh 在 cecelia-node-brain **容器内**执行；`scripts/lib/bluegreen.sh` 的 pre-swap smoke 用 `BRAIN_URL=http://localhost:5223` 探 green canary，但 green 用 `-p 5223:5221` 发布在**宿主**、且起在默认 bridge 网络（blue 在 cecelia_default，跨网络隔离）→ 容器内 localhost:5223 秒拒（0ms），4/5 smoke 必挂（仅不碰端口的 schema-validation 过）→ 保留 blue → 自动部署永远失败。手动宿主跑则 localhost 可达、smoke 全过——这就是"自动全红、手动全绿"的分叉。

次要根因（原立案项，latent）：Gate3 workflow「计算变更路径」step 的
`git diff | grep | tr '\n' ' ' || echo "packages/brain/"` —— 管道退出码取最后命令 `tr`（恒 0），`|| echo` fallback 是死代码；shallow diff 失败时静默送出空列表。

历史误诊：07-14 15:59 的 jq shim 修复只治了上一层症状（容器内 jq 缺失），未治可达性。

## 修法

### 修 A：bluegreen.sh green 可达性（主）

1. 起 green 时解析 blue 所在网络（`docker inspect $blue --format Networks` 第一个），`docker run` 增加 `--network <blue_net>`；blue_net 为空则维持现状（不加）。
2. `GREEN_URL` 双模式解析：health poll 循环内先探 `http://localhost:$TEMP_PORT`（宿主模式），再探 `http://<green_ip>:5221`（容器模式；green_ip 从 `docker inspect $green` 取，IP 在默认/自定义网络都可用，容器名 DNS 在默认 bridge 不可用故不选）；哪个先通锁定哪个。docker inspect health 兜底通过时默认 green_ip。
3. pre-swap smoke 的 `BRAIN_URL` 改用锁定的 `GREEN_URL`。

安全性（已核查）：`BRAIN_DEPLOY_CANARY=1` 时 `tick-recovery.js:154` 早返不起 tick loop，green 与 blue 同 DB 无 double-dispatch（canary-no-tick.test.js 守卫）；容器名不同无 DNS 冲突；`-p` 与自定义网络兼容。

### 修 B：Gate3 变更检测抽脚本（原立案项）

新增 `scripts/ci/gate3-changed-paths.sh`：入参 BEFORE AFTER，git diff + brain 路径过滤；diff 失败或过滤后为空 → 输出 `packages/brain/` + stderr warning。该 job 的 `paths` 过滤器（packages/brain/** + scripts/brain-deploy.sh）保证 fallback 全量 brain 部署安全。workflow step 改为调脚本。

## 测试（TDD，failing test 先行，永久进 CI）

- 修 A：新增 `packages/brain/src/__tests__/bluegreen-green-url.test.js`（仿 bluegreen-swap.test.js 的 PATH mock docker/curl 模式）：
  1. green `docker run` 参数含 `--network <blue_net>`
  2. localhost 探测失败、green_ip 可达 → smoke 收到 `BRAIN_URL=http://<green_ip>:5221`
  3. 宿主模式 localhost 通 → `BRAIN_URL=http://localhost:5223`（回归保护）
  自动进 brain-unit vitest 矩阵。
- 修 B：`scripts/ci/__tests__/gate3-changed-paths.test.sh`（仿 assert-deploy-effect.test.sh）：空 diff / diff 失败 / 正常命中三 case。**必办**：在 `.github/workflows/ci.yml` 显式接线（仿 497 行 assert-deploy-effect 的单行 run），否则不进 CI。

## Proven-to-fire

- 逻辑守卫：两组新测试先在未修复代码上亲眼报红（commit-1），修复后变绿（commit-2）。
- 环境接缝守卫：merge 后的真实 Gate3 run 即为验火——部署效果断言（assert-deploy-effect 版本对比）已存在且已证明会报红（07-14 三连红），本修复后应转绿且生产版本追上 main。

## 不包含

- brain 容器重启杀死 in-flight 部署子进程（16:48Z 那次死法）——部署子进程逃逸容器属架构级改动，另立案。
- 孤儿 index.lock 自愈——本次不做，守卫已能报红。
