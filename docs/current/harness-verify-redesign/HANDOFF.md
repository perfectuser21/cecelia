# HANDOFF — Harness 验证模型重构（2026-07-01）

> 新会话从这里接手。全部上下文自包含。先读本文件，再看同目录 8 份方案。

## 0. 一句话
把 harness 从"每次 evaluator 都炸 + 客服一会儿好一会儿坏"修好：让 generator 连真机、让验收标准冻结成常驻回归、让 CI 无条件复跑。拆成 8 处（A1/A2/A3/B1/C1/D1/E1/E2），**B1 已合并**。

---

## 1. 病根（为什么做）
两个**独立**的病：
- **炸**（evaluator 每次炸）= generator 在虚拟容器写、evaluator 在真机 rog 第一次碰真相 → **环境错位**。修法 = generator 开发时也连 rog（A2）。
- **一会儿好一会儿坏**（回归）= 验收一次性、没沉淀成常驻套件；且 CI 有**路径门**（改 brain 打坏 apps 但 apps test 被跳过）+ 空回归契约 + 客服零测试。修法 = promotion 冻结（A3）+ 无条件回归（B1）+ 动态加载整条线（A1）。

**关键原理**：真相只在真实环境暴露；LLM 判官只在第一次验收出场一次，之后冻成**确定性脚本**（读卡机，非 LLM）永久复跑。

## 2. 概念模型（已锁定，别再纠结）
- 能力（journey_features）= 永久锚点。挂三样，都永久：**FR**=做什么 / **NFR**=做多好(可调阈值) / **invariant**=永远不准破(二元红线)。
- `process`=另一条轴（怎么干活，含 TDD 纪律，从 feedback 自动沉淀），不挂能力。
- 要往里写的表就 2 张：**decisions**（invariant/nfr/… 靠 category 分）+ **test_registry**（守卫）。FR 不是表。
- 现存 19 条 invariant，5 条是 Line04 客服红线（不进群/不回自己/防假成功…），挂 journey_feature 级。

## 3. 8 处修复地图 + 分期（详见同目录 8 份 `<ID>-*.md`）
| ID | 治 | 一句话 | 归属 |
|---|---|---|---|
| A1 | 孤岛 | planner 新增 Step 0.4，每 sprint 拉整条 line 的累积FR+invariant 注入合同 | zenithjoy-skills/harness-planner |
| A2 | 炸 | generator Step 6.5 自验经 session-1 通道在 rog 真跑（env_blocked 与 BEHAVIOR_FAIL 分流） | zenithjoy-skills/harness-generator |
| A3 | 验完即焚 | reportNode(harness-initiative.graph.js:1406) PASS 分支挂 promoteToRegression | packages/brain |
| **B1** | 跨服务回归漏过 | **✅ 已合并 PR #3494** 无条件 core-regression + 删假绿灯 | cecelia |
| C1 | CI 测不了真机 | tests/rog + session-1 runner + 发版闸（卡铺货不卡合并） | cecelia + rog |
| D1 | 客户机运行时反复坏 | agent checks.py 一份两用（runtime 自愈 + gate） | zenithjoy(跨仓) |
| E1 | 随手松守卫 | reviewer 加第8维 invariant_compliance(harness-gan.graph.js:248) | zenithjoy-skills |
| E2 | 删/维护缺口 | test_registry 加 status+feature_id(migration 311)+tick 孤儿巡检 | packages/brain |

**分期**：P0 补 2 个 Brain 端点(按 journey_id 聚合 golden_path + 按 area 取 invariant，A1 依赖) → P1 垂直切片(B1✅ + A1 + A3) → P2 真机簇(先 D1 后 C1 后 A2) → P3 治理(E1+E2)。
**依赖链**：A1→A3→B1(消费)；E1 消费 A1 产物；D1→C1→A2 共用 session-1 通道。

## 4. 已完成
- ✅ **B1 合并**（PR #3494 → main）：无条件 core-regression job（无路径门、接入 ci-passed、skipped 也判失败）+ `scripts/ci/run-core-regression.sh`(空契约守卫) + `regression-contract.yaml` 播种 P0 种子 + 删假绿灯 regression-smoke。
- ✅ **T3 = E2 合并**（PR #3495 → main，2026-07-01）：`test_registry` 生命周期治理。migration 311（status/feature_id软引用UUID/orphan_reason/lifecycle_checked_at + test_lifecycle_alerts表）+ `test-lifecycle-patrol.js`（file_missing自动收敛/feature_deleted告警建issue/stale_scan弱告警/自愈复位/同日去重）+ tick-runner 10.24 挂载 + smoke脚本。**关键坑**：原方案 feature_id 加 `ON DELETE SET NULL` FK 会让 feature_deleted 检测变死代码（能力删除瞬间被自动置空），实现时改为不加FK的软引用；smoke脚本第4步真实调用 patrol 曾在本地误删50行 test_registry（因 worktree 文件树落后 main），已改用事务 BEGIN...ROLLBACK 规避。design doc 见 `2026-07-01-test-lifecycle-governance-design.md`（含"实施后修正"节）。
- ✅ 架构决策 `decisions` id **cdf028cc**（全图）+ **3940dbc8**（B1 feature）。
- ✅ 8 份方案 in `docs/current/harness-verify-redesign/`；设计+计划已随 PR 进 main（docs/superpowers/）。
- ✅ **Brain 版本漂移已修**（PR #3498 → main，2026-07-02）：根因是 `scripts/check-version-sync.sh` 用 `grep -oP`（PCRE `\K`）接管道 `| head -1`，BSD grep（macOS）遇到不支持的 `-P` 报错退出，但管道退出码由 `head -1` 决定（成功），`set -e` 抓不到，DEFINITION.md 漂移被误判成"没找到该行"而放行。改用 `sed -nE` 可移植写法；顺带同步了实际漂移的 4 处版本号（package-lock.json / .brain-versions / DEFINITION.md / 根 package-lock.json workspace 引用）到 1.237.0。回归测试 `tests/check-version-sync.test.js`。`node scripts/facts-check.mjs` 现全绿。

## 5. 下一步（优先级）
1. ✅ **dispatcher bug 已修**（Notion issue **fabf6bd6**，PR #3502 → main，2026-07-02）：根因确认为 `dispatchNextTask()` 原子 claim 成功后无 top-level try/catch，中途异常导致 claim 永久卡死（claimed_by 已设+status=in_progress+initiative_runs=0，graph 从未真正 invoke）；另发现 `execResult.success===false` 路径也漏释放 claim，一并修复。同时给 `harness-watchdog.js::resumeStalledHarnessDrivers()` 加了"区段 C"：覆盖已有心跳机制看不到的"从未起步"（无 initiative_runs 行）僵尸任务。**"schema drift（retry_count 列缺失）"猜测已核实证伪**（`\d checkpoints`/`\d initiative_runs` 均无该列依赖），不需要重建 staging brain 镜像。回归测试：`dispatcher-claim-leak.test.js` + `harness-watchdog-never-started.test.js`。headless harness 派发死锁已解除。
2. ✅ **P0 端点已补**（PR #3504 → main，2026-07-02）：`GET /api/brain/journeys/:journey_id/golden-paths?status=`（按 line 聚合已验收 ability 的 golden_path，三表桥 `golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id`，按 owner_task_id 分组——ability:run=1:N 按 ability 分组会让 order_no 交错）+ `GET /api/brain/invariants?level=&target_type=&target_id=`（读 `decisions` 表 `category='invariant' AND status='active'`，替代读错 decision_log 表的 `GET /decisions?category=`）。配套 real-env smoke `journey-goldenpaths-invariants-smoke.sh`（真容器+真DB 全链路，本机 scratch express 已实测通过：area 铁律 7 条读回、聚合形态正确、6 个边界全对）。注意：`golden_path` 表当前为空（0 行），聚合端点是 A1 读取侧前置基础设施，数据要等 A3（promotion 冻结）落地后才写入。**A1 解除阻塞**。
3. ✅ **A3 已落地**（PR #3507 → main，2026-07-02）：新模块 `packages/brain/src/harness-promote-regression.js` + reportNode PASS 分支 best-effort 接线。三步冻结：golden_path 表覆盖写（事务，步骤解析 sprint-prd.md `## Golden Path`，缺失降级 [BEHAVIOR] 序号）→ commit 校验防假卡（未入库拒冻 yaml 保留 DB + 飞书告警）→ regression-contract.yaml 冻结走**专属 auto-merge PR**（基 origin/main 切分支，pathspec 限定 commit）。**两处以代码为准的修正**（见 spec `2026-07-02-a3-promote-regression-design.md`）：yaml schema 对齐 B1 消费方 run-core-regression.sh 的 `test_command` 字段（方案文档的 checks[] 数组无消费方）；"随 sprint PR 一起 commit"时序不成立（reportNode 时已全 merge）故走专属 PR。冻结幂等（GP-<task8>- 前缀覆盖）。测试：16 单测 + 3 wiring + 真 DB smoke `harness-promote-regression-smoke.sh`。
4. 下一步 **A1**（harness-planner Step 0.4 加载 line 级 invariant+累积FR，SSOT 在 `~/perfect21/zenithjoy-skills/`，走 skill-creator 流程非 /dev；P0 端点 + A3 写入侧均已就绪，A1 的 DoD 5 端到端验证等首个 harness PASS 产生冻结数据后可真验）→ 真机簇 D1→C1→A2 → E1。

## 6. 关键 ground truth（验证过 + 坑）
- **改代码只能走 /dev**（铁律，禁 Agent 直接改推）；harness skill 改动走 skill-creator，SSOT 在 `~/perfect21/zenithjoy-skills/`（**cecelia 仓库里那份是 v8.8.0 过时镜像，别改错**）。
- **headless harness 派发坏了 → 一律走本机 interactive /dev**（engine-worktree → superpowers 自主链 → PR → engine-pr-watchdog）。
- Bash **cwd 每次调用重置回主仓库**，worktree 里操作每条命令都要 `cd <worktree> &&`。
- `decisions?category=nfr|invariant` API **正常返回**（A1 agent 说它坏是误报，已实测）；但 `golden-path-decisions` 端点只 JOIN target_type='golden_path'，抓不到 journey_feature 级的客服 invariant → P0 要补端点。
- Cecelia harness journey_id = `bb8cc561-b3ee-4fec-b74d-2255694bd963`；base_repo=`https://github.com/perfectuser21/cecelia.git`。
- regression-contract schema 对齐 `packages/quality/contracts/regression-contract.template.yaml`（id/priority/trigger/method/test_command）。
- run-core-regression.sh 用 mikefarah yq；本机 bash 3.2 无 mapfile（用 while read）；packages/quality 用 js-yaml 非 yaml。

## 7. 如何恢复（新会话第一条）
```bash
# 感知状态
curl -s localhost:5221/api/brain/context | head -c 400
git -C /Users/administrator/perfect21/cecelia grep -c "core-regression:" origin/main -- .github/workflows/ci.yml  # 应=1，确认 B1 已在
cat docs/current/harness-verify-redesign/E2-test-lifecycle-governance.md   # 下一步 T3 的方案
```
然后按用户指令：做 T3 / 修 dispatcher / 修版本漂移。做代码走 `/dev`。
