# 设计：brain-deploy.sh 真蓝绿改造（根治每次 merge 生产 Brain outage）

## 背景 / 问题
`scripts/brain-deploy.sh` 是**先删后建、非蓝绿**：line 225-228 `docker rm -f cecelia-node-brain` 删旧 → line 234 `docker compose up -d` 建新。Gate3（brain-ci-deploy.yml）每次 brain 代码 push:main 自动触发它重部署 production 5221。坏镜像/并发中断时旧容器已删、新的起不来 → 5221 长空窗，Brain 控制面（tick/dispatch/watchdog）下线。2026-07-05 #3553 merge 实证 outage。根因 issue：f38f989f。主理人拍板 Option A：保留自动部署，但改真蓝绿。

## 目标
1. **失败零影响**：新版本验证不过时，旧 blue(5221) 原封不动，Bark 告警，退出。杜绝"坏部署把生产打挂"整类故障。
2. staging 与 production compose project 隔离，杜绝跨环境 orphan 误扫。
3. 部署后自检 5221，异常 Bark 告警。

## 非目标（明确排除）
- **真·零 downtime**：production 5221 直接 publish、前面无反代，两容器不能同占 5221 → 切换有 ~秒级窗口。真零 downtime 需引入反代（nginx/traefik 前置 5221），列为后续独立任务，本次不做。

## 架构 / 组件

### 组件 1：brain-deploy.sh canary 蓝绿逻辑（Docker 模式）
流程（替换 line 211-248 的"先删后建"段）：
```
[build image]（既有）
[幂等] 现容器已在 target image SHA → skip（既有，保留）
─── 新增 canary 验证 ───
1. 起 green canary：docker run -d --name cecelia-node-brain-green
     -p <TEMP_PORT=5223>:5221
     -e BRAIN_DEPLOY_CANARY=1   ← 门控：只启动+响应/health，不跑 tick 调度
     <同 blue 的 env/mounts/socket> cecelia-brain:${VERSION}
2. poll green /health（5223）最多 N 秒
3. green 不健康：
     docker rm -f cecelia-node-brain-green
     旧 blue(cecelia-node-brain) 不动
     sendBark("Brain 部署失败：green 镜像 vX 未通过健康检查，已保留旧版")
     exit 1
4. green 健康：docker rm -f green（canary 仅验证用）
─── 切换 ───
5. docker rm -f cecelia-node-brain(blue) + docker compose up -d（既有 rollback 逻辑保留）
6. poll 5221 /health；失败 → 既有 rollback 到 prev version
```
**关键不变量**：任何 `docker rm -f cecelia-node-brain`(blue) 只发生在 green canary 已证明镜像健康之后（step 5）。step 3 失败路径绝不碰 blue。

### 组件 2：canary 门控（server.js / tick 启动处）
`BRAIN_DEPLOY_CANARY=1` 时跳过 tick scheduler / watchdog loop 启动，只起 HTTP server + /health。避免 canary 与 blue 两个 Brain 同 DB double-dispatch。若已有等效 env（如 TICK_DISABLED）则复用，不新造。

### 组件 3：docker-compose.staging.yml 独立 project
顶层加 `name: cecelia-staging`，与生产 project `cecelia` 分离，staging 部署不再把生产容器当 orphan。

### 组件 4：部署后自检 + Bark
brain-ci-deploy.yml / deploy.yml 部署步骤后：curl 5221 /health，非 200 → Bark 告警（sendBark，不走飞书，符合"紧急告警走 Bark"铁律）。

## 数据流 / 关键依赖
- green canary 与 blue 共享同一 cecelia DB。migrations 必须 additive-only（既有约定），additive 迁移不破坏 blue 跑的旧代码。canary 不跑 tick → 不与 blue 抢任务。
- TEMP_PORT 5223 需空闲（部署前检查，占用则报错退出，不静默）。

## 错误处理
- green 起不来 / /health 超时 → 保留 blue + Bark + exit 1。
- 5223 被占 → exit 1（不静默复用）。
- 切换后 5221 /health 失败 → rollback prev version（既有）。

## 测试策略
- **回归测试（逻辑守卫，CI）**：shell/bats 测试，构造"green 会 health 失败"场景（桩镜像或 mock docker），跑 brain-deploy.sh canary 阶段，**断言 blue 容器仍 running**。先 commit failing（当前先删后建逻辑下断言失败=红），改脚本后变绿。这正是能兜住本次 outage 的守卫。
- **环境守卫（proven-to-fire）**：部署后 5221 /health 自检 + Bark。标 done 前故意停 5221 跑自检，亲眼见 Bark 报红一次。
- E2E 档位：integration（shell 级，mock docker CLI），不需真起容器。

## 验收标准
- [ ] failing 回归测试先 commit
- [ ] brain-deploy.sh canary 蓝绿化让测试变绿
- [ ] green 失败时 blue 不被删（测试断言）
- [ ] BRAIN_DEPLOY_CANARY 门控 tick，canary 不 double-dispatch
- [ ] docker-compose.staging.yml 有独立 project name
- [ ] 部署后 5221 自检 + Bark，proven-to-fire
- [ ] CI 全绿
