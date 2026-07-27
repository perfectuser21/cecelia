# Sprint PRD — Kernel/Engine 测试数据库合同统一与隔离执行能力

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：86%

## 背景

当前 Harness V5 Sprint Tests 在测试数据库合同上存在断裂：workflow 提供 `TEST_DATABASE_URL=.../cecelia_test`，但 migration 曾落到 `cecelia`，导致 `journey_step_links` 缺失；后续修绿又把 env alias、`psql` 探测和隐式 migrate 副作用塞进生产模块 import。此次 sprint 只修复测试执行与 bootstrap 合同，统一 Kernel、Engine、Brain、Vitest 与 dispatcher/worker 在隔离测试库上的行为，不改变业务 Golden Path、生产数据库语义，也不新增 migration。

## Golden Path（核心场景）

可信本地/车队 runner 为一次 Harness 尝试创建或租用 attempt 级 PostgreSQL 测试能力，只把 `TEST_DATABASE_URL` 作为执行环境能力注入给声明 DB-backed B1-B5 的命令；命令从入口拿到同一个 `TEST_DATABASE_URL` → 显式 bootstrap/migration/seed 只作用于该测试库 → 业务模块 import 保持纯净、不会改 env/不会探测 `psql`/不会隐式迁移 → 从出口拿到带回执的隔离执行结果，并在结束时回收短期角色与数据库权限。

具体：
1. 触发一次 Kernel Run 或 fleet worker attempt，系统在真实隔离 PostgreSQL 目标上为本次 `run_id`/`attempt_id` 准备短时测试角色与数据库，并仅向 planner/proposer/reviewer/generator/evaluator 中声明 DB-backed B1-B5 的命令暴露 `TEST_DATABASE_URL`
2. bootstrap 在只设置 `TEST_DATABASE_URL=.../cecelia_test` 或 attempt 白名单测试库时显式迁移该数据库，`current_database()` 与能力中的库名一致，`journey_step_links` 存在，service、migration、seed、Brain 与 Vitest 全部消费同一连接串
3. import `kernel-harness-f1-baseline` 或相关生产模块时不修改 env、不 spawn `psql`、不触发迁移；缺失、过期、串 attempt、复用、指向 loopback/default socket、指向生产库或投递给无关角色的能力必须在 Brain import 前 fail closed
4. attempt 结束、失败、取消、崩溃或恢复后，系统撤销/删除短期角色与数据库租约，并生成不含凭据材料的签名/证明回执，绑定 `run_id`、`attempt_id`、execution surface、数据库名、过期时间与清理结果

## 边界情况

- 旧 workflow 继续使用 `DB_NAME=cecelia` 或非 `TEST_DATABASE_URL` 别名时，必须在共享夹具上按命名业务断言失败，而不是因缺 env、缺依赖或连不上库失败
- 能力缺失、过期、跨 attempt 复用、目标库名不在 harness/test 白名单、`inet_server_addr()` 为空、命中 loopback/default socket、或拥有生产库权限时，必须在任何 Brain import 或写操作前拒绝执行
- runner 被 kill、恢复重跑或 cleanup 中断时，仍必须最终回收短期角色/租约，并拒绝陈旧回执
- judge 与无关角色不得收到数据库能力；local-docker 与 fleet-worker 必须通过真实 dispatcher/transport/attempt-runner 路径表现一致

## 范围限定

**在范围内**：统一 `TEST_DATABASE_URL` 为唯一测试连接串；bootstrap 显式迁移目标测试库；隔离数据库能力的发放、白名单校验、失败前置拒绝、回执与 cleanup；覆盖 local-docker 与 fleet-worker 真链路对等性；补 import-purity 与旧 workflow 负例回归。
**不在范围内**：修改生产业务 Golden Path；新增或改写生产 migration；把凭据写入 task payload、prompt、git、stdout、callback、result、decision log 或普通日志；复用 PR #4372 作为实现分支；变更生产数据库语义或对生产库做任何写入。

## 假设

- [ASSUMPTION: 本 sprint 锚定现有 `origin/main` 在 2026-07-27 已达到 `d37a5e57827900be2651fe39655690238513128f` 或更新基线]
- [ASSUMPTION: `journey_id` 已提供，但当前 line 暂无已完成/working 的 golden path 可注入累积 FR]
- [ASSUMPTION: 兼容 alias 仅允许出现在 workflow 或 test helper，不要求生产模块保留任何 env fallback]

## 预期受影响文件

- `packages/brain/src/`: runner 能力发放、回执、失败前置闸与 bootstrap 调度入口
- `packages/brain/src/__tests__/integration/`: attempt 级 PG 隔离、cleanup、receipt、负例与 import-purity 集成验证
- `packages/engine/tests/skills/`: Harness V5 workflow/fixture 合同与旧 workflow 失败夹具验证
- `tests/regression/` 或 `tests/live/`: 消费 `TEST_DATABASE_URL` 的 Sprint fixture 与 local/fleet parity 回归
- `sprints/0727184802-harness-v5-test-db-bootstrap/`: 本 sprint 合同、验收脚本与执行产物

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: attempt 级数据库能力必须短时有效，过期后立即失效并在下一次使用前 fail closed
- 频控: 每次 attempt 只允许租用或创建一个隔离测试库能力，禁止多角色共享或跨 attempt 复用
- 版本要求: PostgreSQL 目标需支持 `current_database()`、`inet_server_addr()` 与显式 migration/bootstrap 校验；不要求新增业务 schema 版本
- 可观测: 需要输出不含凭据的签名/证明回执，绑定 `run_id`、`attempt_id`、execution surface、数据库名、expiry 与 cleanup outcome；禁止凭据进入普通日志、stdout、git、payload、callback、result 或 decision log

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [环境假设] 禁止写死环境假设值；测试库地址、端点与执行表面必须从能力或真实环境推导，不得写死默认库/默认 socket（来源: area）
- [真环境验证] 依赖真实 PostgreSQL 接缝的断言必须在真目标上验证过才算 done，未真验只能停在 pending（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志；本 sprint 延伸为数据库凭据材料不得进入普通日志与回执（来源: area）
- [租户隔离] 触及多租户数据的查询/写入必须保持隔离；本 sprint 的测试与夹具默认至少验证隔离数据库能力不会串租户/串 attempt（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只框定必须验到的端到端结果；proposer 需按 `local_api` 生成可执行脚本，并分别覆盖 local-docker 与 fleet-worker 真链路。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 启动真实隔离 PostgreSQL 目标，只设置 TEST_DATABASE_URL 指向 attempt 白名单测试库
# 2. 通过实际 dispatcher/transport/attempt-runner 发放能力并执行 bootstrap；校验 current_database() 命中该测试库、inet_server_addr() 非空且非 loopback/default socket、journey_step_links 存在
# 3. 运行消费 TEST_DATABASE_URL 的 Sprint fixture，证明 service/migration/seed/Brain/Vitest 共用同一连接串；旧 workflow/旧 alias 在同夹具上以命名业务断言失败
# 4. 在 PATH 无 psql、仅设置 TEST_DATABASE_URL 的前提下 import kernel-harness-f1-baseline，不得改 env、不得 spawn、不得迁移
# 5. 逐项验证缺失/过期/跨 attempt/复用/误投/生产库/default socket/loopback/stale receipt 全部 fail closed，且在成功/失败/取消/kill/recovery 后清理角色、租约并产出无凭据回执
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 Kernel/Engine/Brain 的后端测试执行合同与 runner 能力控制，不涉及 dashboard 或远端 agent UI。
## target_environment: local_api
## target_environment_reason: payload 已显式指定 `local_api`，验收应在本地 evaluator 上通过真实 dispatcher/transport/attempt-runner 与本地/车队 PostgreSQL 目标完成。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 1a738e05-99a7-421c-a52d-c2bb80bf19be
