# Learning: Harness v2 M5 — Initiative 级 Final E2E + 失败归因

## 背景

Harness v2 阶段 C 的职责是"所有 Task 合完后，在真实 Brain + Frontend + PG 上跑一次 Initiative 级 E2E"。核心难点是失败归因：E2E 失败时，**如何精确定位到是哪个 Task 引入的 regression？**

PRD §6.3 给出的方案是在合同里预声明每个 scenario 的 `covered_tasks`，scenario 失败即归因到全部 covered_tasks，同 Task 被多 scenario 击中 failureCount 累加。这个信息在 Reviewer APPROVED 合同时已固化，不是 runtime 推断。

## 根本原因

上一代 Harness v1 的"每个 Generator 之后都跑完整 E2E"偏差源于：Task 级和 Initiative 级 QA 职责未分离。v2 把分工定死：

- **CI** = 代码门禁（lint / unit / build）
- **Evaluator** = Task 级对抗 QA（mock / in-memory）
- **Final E2E**（本 PR）= Initiative 级真实 stack（真 PG / 真 Brain / 真 Frontend）

Final E2E 只跑一次，失败归因靠合同预声明而非运行时推断——这是 v2 架构最小机制的典型决策（PRD §6.6 "少一层机制 = 少一层 bug"）。

## 做了什么

1. **`packages/brain/src/harness-final-e2e.js`** — 纯业务逻辑编排（mock-friendly）
   - `runFinalE2E(initiativeId, contract, opts)` — 入口：起环境 → 按 scenarios fail-fast 跑 → verdict 汇总
   - `attributeFailures(failedScenarios)` — 按 covered_tasks 聚合，返回 Map（保留插入顺序）
   - 所有副作用（execSync / docker-compose / bootstrap / teardown）都支持注入替换，便于单元测试

2. **`scripts/harness-e2e-up.sh` / `down.sh`** — 真实环境编排 shell 脚本
   - up: docker compose up -d postgres → pg_isready 轮询 → npm run migrate → Brain 5222 nohup → curl health 轮询 → Frontend 5174 nohup → curl 健康 → exit 0
   - down: compose down -v + pkill（永远 exit 0，清理失败不阻塞）

3. **`docker-compose.e2e.yml`** — 仅 postgres:17，端口 55432:5432，独立数据卷 e2e-pgdata
   - 注：已有 `docker-compose.staging.yml` 给现 staging Brain 用，本 PR 不覆盖，新起 `.e2e.yml`

4. **`harness-initiative-runner.js`** — 新增阶段 C 推进器
   - `checkAllTasksCompleted` / `createFixTask` / `runPhaseCIfReady` 三个导出
   - `runPhaseCIfReady` 五种状态：not_ready / no_contract / e2e_pass / e2e_fail / e2e_failed_terminal
   - fix_round > 3 → initiative_runs.phase='failed' + failure_reason 写 DB

5. **测试** 共 51 个用例（mock-based）
   - `harness-final-e2e.test.js` 34 用例，`harness-final-e2e.js` lines=100% / functions=100% / branches=94.38%
   - `harness-initiative-runner-phase-c.test.js` 17 用例，覆盖所有状态分支

## 踩坑 / 发现

### 1. bootstrap 失败归因空集问题
起 docker-compose 本身失败（端口冲突 / PG 起不来）时，failedScenarios 会是空集——这导致 `attributeFailures` 返回空 Map，runner 找不到任何可疑 Task，陷入死循环（标 FAIL 但无 fix task）。

**解法**：bootstrap 失败时人造一条 `failedScenarios[0]`，covered_tasks 是**全部 scenario 的 covered_tasks 并集**（去重）。这会偶发假阳性（所有 Task 都被归因），但不会死循环。

### 2. PR size 硬门禁 vs 测试充分性权衡
M5 本来可以把 dashboard 阶段 C 可视化、preview 环境、飞书通知一起塞进来（完整收尾），但 PR size < 1500 行硬门禁强制拆分。本 PR 只做 Initiative Runner 阶段 C 的核心机制，Dashboard/Preview/飞书留给 M6。

**收获**：严格遵守 size cap → 测试数量反而提升（单元 51 个，覆盖率 100/94），Reviewer 阅读负担下降，合并风险小。Alex 硬门禁设计是对的。

### 3. parent_task_id 在 payload 里不在列
Brain 的 `tasks` 表没有 `parent_task_id` 列，所有父子关系都走 `payload->>'parent_task_id'`。本 PR 新建 fix task 时继承这个约定，未引入 schema 变化。Integration 测试（M2 的 harness-initiative-runner.integration.test.js）已验证该模式可用。

### 4. runInitiative 的 runPhaseCIfReady 不共享入口
任务描述要求"改 runInitiative 里增加阶段 C"，但 runInitiative 是被 executor.js 在 `task_type='harness_initiative'` 时调用的（阶段 A 入口）。阶段 C 语义上是 tick 发现所有子 task 完成后再触发——要么独立任务 type（`harness_final_e2e`），要么 runner 新函数。

选了**新函数 `runPhaseCIfReady`** 而非 runInitiative 内分支，理由：
- runInitiative 已经很复杂（Planner → parseTaskPlan → upsertTaskPlan → contract → run 全链路），塞阶段 C 会引入状态判断分叉
- 阶段 C 是 tick 层推进的无 LLM 动作，不需要 Docker executor
- 未来 M6 可以让 executor 在 `task_type='harness_final_e2e'` 时直接调 runPhaseCIfReady，改动最小

## 下次预防

- [ ] 新增 Brain runner 时，先检查数据流（谁触发、参数从哪来、副作用是什么）再决定是扩展现有函数还是新建导出
- [ ] bootstrap/teardown 类副作用必须支持 opts.injection，单元测试覆盖 failure path
- [ ] 失败归因机制要考虑"归因空集"边界：保底路径避免死循环
- [ ] PR size 超限前先考虑能否砍能力到下个 milestone，别硬塞
