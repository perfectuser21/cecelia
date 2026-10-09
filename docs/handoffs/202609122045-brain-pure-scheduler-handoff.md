# Handoff — 2026-09-12 · us-vps 全天排查收官 + 「Brain 纯调度器化」立项交接

task_id: unknown（交互 session，未预注册 Brain task）
verdict: PASS（当日修复目标全部完成；新立项移交下一 session）

## 一句话

追查"task feef7d3f 为什么跑不起来"一路挖穿了 4 层独立问题：修掉了 3 个真实 Brain bug（全部生产验证），第 4 层查明是架构级根因——**us-vps 上调度器和执行体挤在同一台 2 核机器上**。Alex 已拍板铁律（decision `96054a8b`，category=invariant）：**us-vps 上的 Brain（和 OpenClaw）只当纯任务调度器，所有真实执行下放到 Mac worker 机器（us-mac-m4 / xian-mac-m4 / xian-mac-m1）**。下一 session 的任务：把这个原则立项成 Golden Path 并写出实施方案。

## 今天完成了什么（done）

### 修复一：github_token_unavailable（PR #5287，已合并+生产验证）
- 根因：`packages/brain/Dockerfile` 烙入 `ENV HOME=/Users/administrator`（macOS 专属），`docker-compose.us-vps.yml` 覆盖了 REPO_ROOT/HOST_HOME 却漏了 HOME 本身 → Linux 容器内 `os.homedir()` 解析到不存在的路径 → `harness-credentials.js` 读不到 `/root/.credentials/github.env`
- 修法：compose environment 段加 `HOME=/root`；TDD 先红后绿（factory-f2-deploy-smoke.sh 新断言，24/24）
- 生产验证：`docker exec` 直接跑 `resolveGitHubToken()` → SUCCESS

### 修复二：CPU 压力信号读错对象（PR #5290，已合并+镜像重建+生产验证，Brain 1.286.5）
- 根因：`checkServerResources()` 用 `/proc/stat` 算 CPU 压力，**Docker 不隔离 /proc/stat**（容器内外逐字节比对相同）→ Brain 读到的是宿主机全局 CPU。同机 openclaw-gateway 占 100%+ CPU 时，Brain 自己 0.11% 也被判 `pool_c_full` 全局拒发
- 修法：`platform-utils.js` 新增 `sampleBrainCpuUsage()`（process.cpuUsage() 自测）+ `evaluateCpuHealth()`，复刻 memory pivot（2026-04-18）三态模型：系统忙但 Brain 闲 → warn 不 halt；Brain 自己忙（≥50%）→ 照样 halt
- 途中 CI 抓到 11 个测试文件的 platform-utils 纯字面量 mock 缺新导出，全部补齐
- 生产验证：`dispatch_allowed` false→true，`brain_cpu_pct`/`cpu_health_action` 字段上线可观测；影子部署时两个 Brain 抢 CPU 正确保持 halt（双向验证）

### 修复三：disk_pressure 闸（配置/清理，无 PR）
- 第 3 层拦截：`harnessSlotCheck` 的盘水位闸（>85% 拒发 harness 任务，07-15 盘满事故案底，设计正确非 bug）。当时实测 88%
- Alex 拍板清理：孤儿 `cecelia-backups-offsite/`（595MB，零引用）+ AFFiNE 全套（`affine-backups` 760MB + `affine-us` 211MB 含 pgdata，Alex 确认已废弃）+ 两条 AFFiNE cron（backup/monitor）已从 crontab 移除
- 结果：88% → 82%，闸解除。附带发现：AFFiNE 备份脚本 09-10 起产出 20 字节空文件（早已静默坏死，佐证可删）

### 计划外：生产 Brain 容器崩溃 + 恢复
- openclaw 把宿主机拖到 load 5.9 期间，Brain 容器进入僵尸态（docker 认为 running，容器内进程已死，`docker exec` 报 containerd task not found，HTTP 无响应）
- `docker compose up -d --force-recreate` 恢复，健康验证通过。非当日代码改动所致，是宿主过载连锁反应

### 第 4 层查明：openclaw-gateway 长期 100%+ CPU（未修，属第三方系统）
- `tasks audit`：0 个卡死任务，19 条陈年 delivery_failed 警告（另一回事）
- 真因：**多个并发 codex app-server 子进程全在本机跑**（`codex sessions` 实测 23 个 agent 的执行全部 `gateway:local`，零下放）+ 互抢同一个 SQLite 锁（`slow SQLite transaction hold` / `slow agent database open` 刷屏）
- `docker restart` 无效（重启后立刻回到 100%+，非退化型）
- 官方文档查证：OpenClaw 设计理念是"每台机器各跑一个 Gateway"，**没有**现成的"中央调度+远程 worker"开关

## 拍板与登记（decision_refs）

- `96054a8b`（**invariant 铁律**）：us-vps 上 Brain+OpenClaw 都只当任务调度器，禁止本机跑真实任务，执行全部下放 us-mac-m4 / xian-mac-m4 / xian-mac-m1
- `e5741ccc`（bug-fix）：HOME 误配根因
- `ace20d89`（bug-fix）：CPU 压力读宿主机根因
- issue `2fcd657c`：task 派发不动的追踪 issue（今日已两次更新，最终归因到 disk_pressure + openclaw 负载，非筛选逻辑 bug——早期"tick 不选中"的猜测已被推翻，实际是 harnessSlotCheck admission 拒绝）

## 下一 session 要干什么（next_steps — 按序）

**主任务：「Brain 纯调度器化」立项**。按 CLAUDE.md 路由走 `/golden-path`（第一动作装 journeys 地图判定归位），把以下 4 个已查实的缺口写成有序实施方案：

1. **kernel-v1 远程化**（最大头）：`harness-skill-relay.js` 的 `launchKernelProcess()` 写死本机 `nodeSpawn`（detached Node 子进程跑 `orchestrator/run.js`），与既有 Fleet Worker 远程机制（`orchestrator/production-transport.js`）完全不通。需要把 kernel-v1 执行接到 fleet transport 上（要设计：worktree 如何到达远程机、凭据 broker、回调链路）。受影响 task_type：`golden_path_proposal`、`harness_initiative`（kernel runtime）
2. **机器身份纠偏**：us-vps 的 compose 写着 `CECELIA_MACHINE_ID=us-mac-m4`——VPS 在冒充美国 M4，fleet 账本里"us-mac-m4 在线（2核/压力0.92）"实际是 VPS 照镜子。需给 us-vps 独立身份（如 `us-vps-scheduler`），真正的美国 M4 作为独立 worker 注册
3. **worker 侧服务起齐**：实测 xian-mac-m4 worker 在线（16核/7槽），xian-mac-m1 离线，美国 M4 的 `FLEET_WORKER_US_MAC_M4_URL` 还是打不通的 `host.docker.internal:5231` 占位符（compose 注释里自己标了是已知遗留）。需在美国 M4/mmv 上起 Fleet Worker（端口 5231）并在 `.env.docker` 填真实 Tailscale 地址
4. **LOCATION_MAP 语义改造**：`task-router.js` 里几十个 task_type 映射 `'us'`（语义="US 本机"），brain-local/codex-review-local 等 executor_kind 也都是本地 spawn。需逐类改成机器定向派发，并加 fail-closed 守卫（Brain 在 vps 身份下拒绝本地执行，防回归）
5. **OpenClaw 侧**（独立轨道，非 Brain 代码）：按官方"每机一 Gateway"模式，方案大概率是把重的 agent 搬到 Mac 上各自跑 Gateway，us-vps 只留路由/channel 接入。需要单独设计，别和 Brain 改造混在一个 PR 流

**注意事项**：
- 高风险——动的是唯一生产 Brain 的派发主干，沿用今天的老规矩：影子验证（BRAIN_PORT 换端口 + `CECELIA_TICK_ENABLED=false`！）→ 打基线镜像 tag → 人工切换 → 容器内直接验证
- Brain 代码改动 = 镜像重建才生效（`feedback_brain_pull_before_reload`），us-vps 盘紧（现 82%，闸线 85%），build 前先 `docker image prune`
- task `feef7d3f`（GP 提案任务本体）仍是 failed 态，等纯调度器改造落地后作为端到端验证靶子重跑

## 数据源（data_sources）

- 本文件 + `docs/handoffs/202609121006-handoff-home-env-fix.md` + `docs/handoffs/202609121205-handoff-cpu-pivot.md`（今日三份连续交接）
- `decisions` 表：`96054a8b` / `e5741ccc` / `ace20d89`
- issue `2fcd657c`
- 关键代码坐标：`packages/brain/src/harness-skill-relay.js:149`（launchKernelProcess 本机 spawn）、`packages/brain/src/orchestrator/production-transport.js`（既有远程机制）、`packages/brain/src/task-router.js:226`（LOCATION_MAP）、`packages/brain/src/executor-contracts.js:36`（EXECUTOR_KIND_FOR）、`docker-compose.us-vps.yml`（CECELIA_MACHINE_ID + FLEET_WORKER_* 占位符）
- us-vps 现状：`cecelia-node-brain` 跑 `cecelia-brain:1.286.5`，回滚镜像 `baseline-20260912-pre-1.286.5`，盘 82%

## 产物（artifacts）

- PR：#5287 / #5289 / #5290 / #5292（全部已合并）
- Brain 版本：1.286.5 已上产（含镜像重建）
- memory：`brain-linux-deploy-pipeline-gap.md` 系列待下一 session 追加本日进展
