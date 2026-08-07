# Sprint PRD — 裁决与分流 D4a（后端）：adjudication API + hard 格 P0 + 聚合分流建单 + 熔断 + SAVEPOINT 覆盖

## OKR 对齐

- **对应 KR**：O2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（验收一体两面 D4 后端核心落地，裁决→分流→熔断闭环贯通）

## 背景

GP 7790f728（发版验收一体两面，v7 定案）D1 数据层已于 cecelia 1.270.0（migration 392-393）上主干：AI 四列、7 值状态机、`computeCellState` 九组合、`computeGateVerdict`、36 格建单生成器、`POST /api/brain/acceptance/ai-results`（AI token 只写 AI 列）、收单闸（scenarios_observed 5 个 mandatory 码）、reason 域校验（`scenario_not_triggered` 任何格 400）均已就绪。

本 sprint（D4a）交付纯后端部分：
①裁决 API（`adjudication` 字段写入 + 四字段齐全校验）；
②hard 格裁决绿自动开 P0（`unverifiable_this_version` 格例外，只计数不开 P0，例外绑 `scenario_class` 不硬编码格号）；
③分流建任务触发时点锁定在 run 转 `adjudicated` 之后（每 run ≤1 bug + ≤1 追查，聚合式，查重谓词加 `acceptance_bucket` 维度，anchor 三件套携带被验收业务 GP 锚）；
④非绿格占比 >1/3 熔断改开「规程/数据源疑似分叉」P0；
⑤AI 整轮哑火走独立 `ai_run_infra_error` 路径不进熔断；
⑥恢复 SAVEPOINT 不毒化外层事务的回归覆盖（D1 休眠的 23505 保护，在新聚合链路重新覆盖）；
⑦`abandon` 端点补前态守卫（`adjudicated`/`stale` 禁被覆盖成 `abandoned`）。

规格 SSOT：Brain golden_paths `7790f728-f490-4243-b166-03f3250a0938` 的 proposal_doc（v7-final），参见 D4 节。

## 真机边界声明

本 sprint PrepPRD 含以下真机相关名词引用，均来自规格 SSOT 背景上下文，**本 sprint 零真机动作**：

- `android`（GP 场景代码 S4-c2、S5-c3/c4 涉及安卓设备掉线/恢复，属 D2 打表器范围，本 sprint 不触及）
- `真机`（GP proposal_doc 中多处出现，描述 D2 采证层的物理设备边界，本 sprint 仅操作纯后端 cecelia `packages/brain`）
- `staging`（GP 规格中 staging 后台 URL 属 D2 Playwright 采证范围，本 sprint 无任何 staging 动作）

本 sprint 全部代码变更落在 `packages/brain/src/routes/acceptance.js`、`packages/brain/src/acceptance-state.js` 及相关测试，接触对象为 Brain 本地 PostgreSQL，无真机、无 UI、无 staging 操作。

## Golden Path（核心场景）

系统从 [员工提交人列完成、run 达到 human_complete] → 经过 [adjudication API 裁决 → run 转 adjudicated → 聚合式分流建单] → 到达 [裁决可查、bug/追查任务已建、熔断/哑火走独立 P0、SAVEPOINT 保护外层事务]

具体步骤（FR，逐条可验证）：

1. **FR-裁决 API**：`PATCH /api/brain/acceptance/runs/:run_key/adjudicate` 接受 `{verdict, by, reason, at}` 四字段写入 `acceptance_checks.adjudication` JSONB（只允许对 `human_only` 或 `unverifiable_this_version` 类型格发起裁决）；任一字段缺失返回 400；verdict 必须为 `绿` 或 `红`，否则 400；写入成功后原子地将 run.status 推进到 `adjudicated`；`unverifiable_this_version` 格裁决绿必须经此端点（A6 断言）。

2. **FR-abandon 前态守卫**：`PATCH /api/brain/acceptance/runs/:run_key/abandon` 在前态为 `adjudicated` 或 `stale` 时拒绝请求（409，响应含 `{"error":"forbidden_status","current_status":"adjudicated"}`），仅允许活跃状态（`pending`/`in_review`/`human_complete`/`expired`）被 abandon。

3. **FR-hard 格裁决绿自动开 P0**：run 转 `adjudicated` 后，后端检查所有格的裁决结果：`verifiable_by='human_only'` 且 `adjudication.verdict='红'` 的格触发 P0 Issue（标题格式「验收红线失守：{check_key} 本轮标红，需人工确认根因」）；`scenario_class='unverifiable_this_version'` 的格即使 verdict='绿' **不开 P0**，只做以下两件事：计数（A12 第四项）＋ 写入 `detail.unverifiable_adjudicated[]`（元素结构 `{check_key, by, at}`）。格集合从 yaml 解析 `scenario_class='unverifiable_this_version'` 取数，**禁止** 硬编码格号（r6-P2-2 核销要求）。

4. **FR-聚合式分流建任务**：分流建单在 run 转 `adjudicated` 之后触发（A7 分母口径 = 定案后终态）；每 run 至多建 **1 条 bug 任务**（`acceptance_bucket='bug'`）+ **1 条追查任务**（`acceptance_bucket='trace'`）；查重谓词：`WHERE run_id=$run_id AND acceptance_bucket=$bucket AND status NOT IN ('failed','completed','cancelled')` 有记录则跳过建单；新建任务的 `payload.anchor` 携带三件套 `{journey_id, gp_id, step_id}`（取自 `acceptance_runs.anchor` 字段）。

5. **FR-熔断**：非绿格（`final_state='红'` 或 `'未定'`）占比 > 1/3（分母 = 36 建行格）时，触发熔断改开「规程/数据源疑似分叉」P0（标题格式「验收熔断：{run_key} 非绿格 {count}/36 超阈值，疑似规程/数据源分叉」）；AI 整轮哑火（`detail.ai_status='哑火'`）走独立 `ai_run_infra_error` 路径（开「AI 整轮哑火」P0），**不进** 熔断计数。

6. **FR-SAVEPOINT 回归覆盖**：分流建单内层使用 SAVEPOINT，每条 INSERT 失败（包括 23505 unique violation）仅回滚该单条 INSERT 的 SAVEPOINT，不毒化外层事务；有测试覆盖这一行为：① 单条 23505 → 只跳过该条，外层提交成功；② 两条 INSERT 其中一条失败 → 另一条正常写入。

## 边界情况

- `adjudicate` 端点只接受格级裁决，不允许对整个 run 批量裁决；每格可被多次覆盖裁决（最新值覆盖旧值）
- 分流建单遇到 DB 错误不影响 run 状态（已转 `adjudicated`），错误记入 Brain 日志，不抛给调用方
- 哑火 P0 与熔断 P0 可同轮并存（两路径相互独立）
- `unverifiable_this_version` 格列表从 cells-map yaml 动态解析，若列表为空时 A12 断言失败强制人工干预（r6-P2-2 要求）
- `acceptance_bucket` 字段若数据库中已存在（来自 D1 migration），本 sprint 直接使用；若缺失，需补 migration 394

## 范围限定

**在范围内**：`packages/brain/src/routes/acceptance.js`（adjudicate 端点 + abandon 前态守卫 + 分流建单 + 熔断）、`packages/brain/src/acceptance-state.js`（computeCellState 若有 bug 修复）、`packages/brain/tests/`（SAVEPOINT 回归 + adjudication 端点 + abandon 守卫 + 熔断判定）、如需 migration 394（`acceptance_bucket` 列）

**不在范围内**：D2 AI 打表器（zenithjoy）、D3 背靠背裁剪（D3）、D5 放行闸、合看页 UI（D4b zenithjoy 前端）、员工侧 ack/review-closed 流程（已有，不改）、S13-c4 受控注入（留待后续期）、Gate B 探明清单

## 假设

- [ASSUMPTION: `acceptance_bucket` 列若 migration 392 已含，本 sprint 直接用；若未含，proposer 需建 migration 394 补字段]
- [ASSUMPTION: cells-map yaml 位于 `packages/brain/scripts/acceptance-spec/` 或类似路径，proposer 实施前先确认路径]
- [ASSUMPTION: 分流建单的 P0 Issue 走现有 Brain `issues` 表（`node scripts/notion-create-issue.js` 模式），`priority='P0'`，`sub_area='brain'`]
- [ASSUMPTION: `acceptance_runs.anchor` 字段已在 migration 392 中存在，用于传递 GP 锚三件套]

## 预期受影响文件

- `packages/brain/src/routes/acceptance.js`：新增 `PATCH /runs/:run_key/adjudicate`，修改 `PATCH /runs/:run_key/abandon`（前态守卫），新增分流建单 + 熔断逻辑
- `packages/brain/src/acceptance-state.js`：若 `computeGateVerdict` 需加哑火路径则修改
- `packages/brain/tests/acceptance-adjudication.test.js`（新建）：adjudicate 端点断言、abandon 前态守卫、SAVEPOINT 回归、熔断判定
- `packages/brain/migrations/394_acceptance_bucket.sql`（条件性，仅当 `acceptance_bucket` 列缺失时建）
- DevGate 三件套须通过（`facts-check.mjs` / `check-version-sync.sh` / `check-dod-mapping.cjs`）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（取 active 状态 1 条，PrepPRD 显式约束优先） -->
- DevGate：改动 `packages/brain` 前须通过 `facts-check.mjs` / `check-version-sync.sh` / `check-dod-mapping.cjs`，由 Generator 阶段执行，失败须先修复不得继续
- Bug Fix 流程：先写能复现的 failing test（SAVEPOINT 23505、abandon 前态守卫），修复后测试永久进 CI，不可删
- 隔离性：adjudicate 端点写入 acceptance_checks.adjudication 与 run.status 推进须在同一 DB 事务中完成，不得出现 adjudication 写入成功但 status 仍为 human_complete 的中间态
- 单测租户隔离：测试种 ≥2 个 run，断言裁决/分流不跨 run 污染
- 无真机无 UI：本 sprint 不产生任何 staging 调用、Playwright 脚本、真机动作

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 active 1 条 + capture-triage learning 11 条；
     以下为与本 sprint 域（acceptance adjudication + brain）直接相关者；
     smoke-invariant-* 与 capture-triage learning 噪声行不注入 -->
- [端点鉴权] 每个 API 端点必须有 auth；adjudicate 端点须验证调用方身份（`submitted_by` 白名单或 session token），不准无鉴权上线（architecture invariant）
- [租户隔离] 碰 acceptance 数据的查询/写入必须 scope 到当前 run_key，绝不混读/混写（architecture invariant）
- [自产数据排除] 守卫/探针自产数据用共享常量前缀标记并在统计侧排除，防自指计数污染（area invariant）
- [never_started 兜底] watchdog 对已有 error_message 的格不覆盖（56a0ba9f）——适用于 adjudication 不覆盖既有 final_state 语义
- [headed 场景核对] 起草 host/env 白名单断言时强制核对 headed 人工接管场景（9f14c074）——adjudicate 端点须区分 AI token 与人工 token
- [失败分支显式] 调用"失败不抛异常、返回 null/false"契约的函数必须显式写 else 失败分支（e9c7752f）——分流建单失败须显式 catch 且记日志
- [合同验证命令实跑] 合同里的验证命令必须实跑确认 exit code 语义，写进合同前先验证通过（c906dd6c）
- [judge 闸⑤放行] local_api 无 UI smoke 任务需在合同预先声明验证真相形态或对机械闸⑤放行（a0bac43b）——本 sprint 须在 contract-dod.md 中声明 meta_verification 形态

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GP 7790f728 D1 已上 1.270.0（migration 392-393），以下为 D1 已交付的 FR，本 sprint 不得回退 -->
- [D1-FR1] AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`）已存在于 `acceptance_checks`，`ai_verdict` CHECK 约束限 `{通过,不通过,无法验证}`
- [D1-FR2] run.status 7 值状态机（pending/in_review/human_complete/adjudicated/stale/expired/abandoned）CHECK 已在库，新 run 不产生 passed/failed
- [D1-FR3] `computeCellState` 九组合矩阵（acceptance-state.js）、`computeGateVerdict` 均已就绪
- [D1-FR4] `POST /api/brain/acceptance/ai-results` 已上线（AI token 只写 AI 列）
- [D1-FR5] 收单闸：`scenarios_observed[]` 未勾齐 5 个 mandatory 场景码时拒收 AI 回写（409）
- [D1-FR6] reason 域校验：`scenario_not_triggered` 任何格 400

## E2E 验收

> 最终可执行脚本由 proposer 按 target_environment=local_api（curl + psql + node）产出。

```bash
# 期望验收点（自然语言，proposer 翻译成真实命令）：

# 1. [FR-裁决 API 基本路径]
#    建一个 run，推进到 human_complete；调用 PATCH adjudicate（valid 四字段，human_only 格）
#    → 200，run.status = adjudicated，acceptance_checks.adjudication = {verdict,by,reason,at}

# 2. [FR-裁决四字段校验]
#    缺 reason 字段 → 400；verdict='黄' → 400；at 非 ISO 8601 → 400

# 3. [FR-abandon 前态守卫]
#    run 在 adjudicated 状态调 abandon → 409，响应含 current_status=adjudicated
#    run 在 stale 状态调 abandon → 409
#    run 在 pending 状态调 abandon → 200（对照：正常状态仍可 abandon）

# 4. [FR-hard 格裁决绿自动开 P0]
#    对 verifiable_by='human_only' 且 verdict='红' 的格裁决 → psql 查 issues 表有新增 P0 issue
#    对 scenario_class='unverifiable_this_version' 格裁决绿 → psql 查 issues 表无新增 P0
#      且 detail.unverifiable_adjudicated[] 含该格记录

# 5. [FR-聚合式分流建任务]
#    run 转 adjudicated 后 → psql 查 tasks 表：含 acceptance_bucket='bug' 任务 ≤1 条
#    重复触发 → bug 任务仍只 1 条（查重去重验证）
#    任务 payload.anchor 含 {journey_id, gp_id, step_id}

# 6. [FR-熔断]
#    构造 >12 格（36*1/3=12）红/未定格 → 触发熔断 P0（issues 表含「规程/数据源疑似分叉」P0）
#    构造 detail.ai_status='哑火' → ai_run_infra_error P0，不触发熔断

# 7. [FR-SAVEPOINT 回归]
#    模拟两条建单 INSERT，第一条 23505 → 第二条仍成功（外层事务正常提交）
#    Node.js 集成测试验证：先 Red（无 SAVEPOINT 毒化外层），修复后 Green，测试进 CI

# 8. [DevGate 通过]
#    node scripts/facts-check.mjs → exit 0
#    bash scripts/check-version-sync.sh → exit 0
#    node packages/quality/scripts/devgate/check-dod-mapping.cjs → exit 0
```

## journey_type: autonomous
## journey_type_reason: 纯后端 cecelia packages/brain，无 UI、无 staging 操作、无真机依赖
## target_environment: local_api
## target_environment_reason: Brain 本地 evaluator 用 curl localhost:5221 + psql cecelia + npm test 端到端验证，无需浏览器
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
