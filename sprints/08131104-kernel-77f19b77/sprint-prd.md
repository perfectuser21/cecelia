# Sprint PRD — Harness 入口统一：Session Controller 所有权不变量 + 四档 change_kind 驱动执行 Profile

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：Harness 启动链存在无主 Kernel Run 缺陷（issue 962d399c 已实证）
- **本次推进预期**：+2%（消除无主 Kernel Run + 四档 change_kind 真实驱动执行路径）

## 背景

现状缺陷（实证 issue 962d399c，历史 run 已多次踩到 kernel_process_fatal 无主孤儿 / merged_without_evaluator_gate）：
① `harness-skill-relay.js` 对 `harness_runtime=kernel-v1` 在第 359 行提前 `return _spawnKernelRuntime`，跳过全部 Controller spawn 分支 → Kernel 是 detached 无主进程，fatal 后 Pipeline ownership 消失；
② `initiative_runs` 无 controller_session_id / lease 列；
③ task_type/orchestrator/harness_runtime/gear/mode 全由创建者 payload 控制，可绕过路由层；
④ `orchestrator/derive.js` 只消费 gear，change_kind 零消费 — 四档只是标签不是执行路径。

## Golden Path（核心场景）

系统从 [Dispatcher 请求启动] → 经过 [Controller 先取 ownership 再拉起 Kernel] → 到达 [Kernel 跑完 + Controller 守到 PR merged/report done]。

具体：
1. Dispatcher 收到 harness initiative（含 `harness_runtime=kernel-v1`），**只能请求启动 Session Controller**，不能直接拉起 Kernel；`harness_runtime` 收归路由层派生，payload 直接指定也不得绕过 Controller。
2. Session Controller 启动后**先写入 controller_session_id + controller lease 到 initiative_runs 取得 ownership**，再 spawn 或 resume Kernel；`createKernelRun` 在无有效 Controller identity 时 **fail-closed**（拒绝创建）。
3. Kernel 执行阶段；若 Kernel process fatal，**只结束 Kernel process**，Controller 存活并执行恢复或结构化终止回传（写 Brain log + failure_reason）。
4. `derive.js` 按 `change_kind` 分派执行 Profile：`new_capability`=全链+GAN+人审 / `capability_change`=轻 Planner+合同收敛 / `bugfix`=跳 Planner、跳 GAN / `parameter_only`=最轻档；四档**全部保留 Generate→Evaluate→Judge 与 merge fence**，共用同一条 Controller→Kernel 启动链。
5. Controller 守到 PR merged + report done 才退出；无主历史 / 异常 Kernel Run 一律 fail-closed 进恢复流程。

<!-- INV-1~INV-10 硬不变量全文见 golden_paths 1acd18c9 proposal_doc，为本 sprint 验收基准 -->

## 边界情况

- 调用方 payload 显式带 `harness_runtime=kernel-v1`：不得产生无 Controller 的 run（回归测试 POST 直打）。
- Controller 取 ownership 后自身 fatal：Kernel 不得成为无主 run（lease 兜底）。
- 无主历史 Kernel Run（老数据 / 迁移前）：进入恢复流程，不静默放行。
- 四档默认映射（决策 29ae54ae）：正向默认，可显式覆盖**升档**，禁反向推导降档。
- GAN 轮次无上限，但收敛兜底必须存在（防死循环）。

## 范围限定

**在范围内**：`initiative_runs` schema 加 controller_session_id + lease 列（migration 413）；`harness-skill-relay.js` 启动链收敛（Dispatcher→Controller→Kernel）；`createKernelRun` fail-closed；`derive.js` 按 change_kind 分派 Profile；`change-kind.js` 头注释同步；Controller 生命周期守护 + 恢复；永久回归测试进 CI。

**不在范围内**：PR #4851（已关闭，仅考古参考，禁在其冲突分支续写）；gear 档位语义（保持独立，不与 change_kind 互推导）；UI / Dashboard 变化。

## 假设

- [ASSUMPTION: 新 migration 编号取 413（当前最新为 412_initiative_contract_artifacts.sql）]。
- [ASSUMPTION: Controller 复用现有 relay 单 session 载体，Kernel 作为其子进程/受管进程，而非 detached]。
- [ASSUMPTION: lease 采用 initiative_runs 行级 controller_session_id + 过期时间戳，无需新表]。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均为空数组）+ 任务约束显式项 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 收敛兜底: GAN 轮次无上限，但必须存在收敛兜底机制（禁死循环）
- 可观测: Kernel / Controller fatal 必须写 Brain log + 结构化 failure_reason 回传（[系统]日志脱敏适用）
- 测试隔离: 集成测试真打 spawn 链路的 fake deps 注入层，**禁 mock 被改的边**

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 + journey_feature 级合并去重 -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境done] 真环境验证才算 done（来源: area）
- [多租户] 测试默认多租户（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）
- [凭据安全] 凭据安全（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [evaluator时钟] Kernel 复用既有 PR 时采纳 evaluator validation clock（来源: journey_feature，decision ddca7267）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无已验收历史 — journey golden-paths 现存 ability 均为 planned 态，run 历史多为 failed/无主孤儿，本 sprint 即修复该缺陷）

## 预期受影响文件

- `packages/brain/migrations/413_*.sql`: 新增 — initiative_runs 加 controller_session_id + controller lease 列
- `packages/brain/src/harness-skill-relay.js`: 启动链收敛（改第 205/359 行 `_spawnKernelRuntime` 提前 return，Kernel 须经 Controller 取 ownership 后启动）
- `packages/brain/src/orchestrator/kernel-run-store.js`: `createKernelRun`（第 380 行）无 Controller identity 时 fail-closed
- `packages/brain/src/orchestrator/derive.js`: 新增 change_kind → 执行 Profile 分派（当前只消费 gear）
- `packages/brain/src/impact-contract/change-kind.js`: 同步修订头注释（四档正向默认映射，禁反向推导）
- `packages/brain/src/__tests__/`: 新增四档 + fail-closed + 无主孤儿 + Controller 存活四类永久回归测试

## E2E 验收

> Planner 初稿留空 — 最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest 集成测试 + curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest + curl + psql）
# 期望验收点（自然语言）：
#  1. 四档 change_kind 各启动一次，均先有 Controller ownership（initiative_runs.controller_session_id 非空）再有 Kernel run。
#  2. POST harness_runtime=kernel-v1 直打，不能产生无 Controller 的 run。
#  3. 无 Controller identity 调 createKernelRun → fail-closed（拒绝创建）。
#  4. Controller fatal 后 Kernel 不成为无主 run；Kernel fatal 后 Controller 仍存活并回传结构化终止。
#  5. 四档全部保留 Generate→Evaluate→Judge 与 merge fence。
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/（调度/启动链/schema），无 UI、无远端 agent 协议、非 engine hooks
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，E2E 用本地 evaluator（vitest 集成测试 + curl localhost:5221 + psql）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
