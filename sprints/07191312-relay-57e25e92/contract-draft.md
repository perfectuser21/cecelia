# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面/api_registry推导）

### Endpoint: GET /api/brain/tasks/:task_id
**Success (HTTP 200)**:
```json
{"id":"<uuid>","task_type":"harness_initiative","payload":{"mode":"headed","executor":"claude","orchestrator":"skill-relay","journey_id":"bb8cc561-b3ee-4fec-b74d-2255694bd963"}}
```
- `id` (string, 必填): 来源--PRD 指定 task `57e25e92-84a3-4599-992c-b4b74ec54acc`；api_registry `/api/brain/tasks/:id` 已在 4bb31ef5/049ebf93/53710094 先例中沿用同一 schema。
- `task_type` (string, 必填): 来源--PRD 假设声明「task_id 已由 Brain 以 task_type=harness_initiative 派发」。
- `payload.mode` (string, 必填): 来源--PRD 字面值 `headed`。
- `payload.executor` (string, 必填): 来源--PRD 字面值 `claude`。
- `payload.orchestrator` (string, 必填): 来源--PRD 字面值 `skill-relay`。
- `payload.journey_id` (string, 必填): 来源--PRD 字面值 `bb8cc561-b3ee-4fec-b74d-2255694bd963`。
**禁用字段名**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]（PRD 边界情况原文四项，字面禁用，不扩展）
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```
**Schema 完整性**：PRD 未要求 `payload` 顶层 keys 精确匹配（未给出禁止之外的完整字段清单），本合同不施加 `keys == [...]` 强匹配，仅验必填字段存在 + 禁用字段不存在（对齐 PRD 字面范围，不超覆盖）。

### DB: initiative_runs
**Success**:
```json
{"initiative_id":"<task_id>","orchestrator_host":"skill-relay-claude-headed","phase":"<非failed合法枚举>","started_at":"<timestamp>"}
```
- `initiative_id` (uuid, 必填): 来源--PRD 当前 task id `57e25e92-84a3-4599-992c-b4b74ec54acc`。
- `orchestrator_host` (string, 必填): 来源--PRD「E2E 验收」第 2 点，`orchestrator_host` 含 `skill-relay-claude-headed`；真实值来自 `packages/brain/src/harness-skill-relay.js` 字面量 `'skill-relay-claude-headed'`（已源码核实，非猜测）。
- `phase` (string, 必填): 来源--PRD 边界情况「`phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL」。合法枚举**以本机 PostgreSQL 当前 `initiative_runs_phase_check` 约束真实定义为准**（已用 `pg_get_constraintdef` 实测，见下方「已知约束」），不复制历史合同里可能过期的子集列表。
- `started_at` (timestamp, 必填): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列，与 4bb31ef5/049ebf93 先例一致。
**DB 列约束**: 只允许使用 `information_schema.columns` 中真实存在的列；本 sprint 不新增/修改 `initiative_runs` schema。

## 已知约束

- [api_registry] `/api/brain/tasks` 已登记为 Brain 任务 CRUD；本 sprint 复用现有 API，不新增端点。
- [db_schema][当前实测] `psql` 直查 `pg_constraint` 得到 `initiative_runs_phase_check` **当前真实完整定义**：
  `CHECK (phase = ANY (ARRAY['A_planning','A_contract','B_task_loop','C_final_e2e','done','failed','planning','gan','generate','evaluate']))`。
  历史先例合同（049ebf93/53710094）使用的枚举子集 `A_planning|planning|gan|generate|evaluate|done` **不含** `A_contract`/`B_task_loop`/`C_final_e2e`，若本任务当前 run 恰好落在这三个阶段会被历史合同误判 FAIL——本合同改用真实 DB 约束的完整合法枚举，不复制过期子集（呼应 PRD Invariant 铁律 id=5775d866「判变基准用生产实体自报，禁用工作区 diff/历史假设」）。
- [test_registry] 现有测试风格：`tests/regression/relay-{a85e0582,4bb31ef5,cd0b936c,049ebf93,63db6f8a,53710094}/` 均用 vitest `describe/it` + source-code inspection（非 mock）校验 wrapper 脚本内容，本 sprint 沿用同一位置/风格，新建 `tests/regression/relay-57e25e92/headed-smoke-contract.test.ts`（不放进 `sprints/.../tests/`，因为 test_registry 里这条 journey 的历史测试全部落在 `tests/regression/relay-*/` 永久池，为保持可发现性与 evaluator 既有查找路径一致，遵循既有约定而非 skill 通用默认位置）。
- [context-manifest] `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 当前实测返回 HTTP 404（`Cannot GET ...`），与 PRD「已知情况，非缺陷」一致，无累积 FR 可合并。
- [同类归档][结构镜像] `sprints/07151245-relay-049ebf93`（task 049ebf93，同为 executor=claude）是 PRD 明确指定的镜像结构对象：task 记录只需存在+payload 匹配（不要求 claimed/status=in_progress），initiative_runs 无记录→硬 FAIL（不走 53710094 的 foreground-takeover 软化路径，因为本 PRD 边界情况明确写「`initiative_runs` 无该 initiative_id 记录 → FAIL」，未提供软化例外）。
- [路径核实][重要偏差记录] 历史两例（049ebf93、53710094）合同文档均声称产出 `sprints/<dir>/e2e-verify.sh`，但**实测**两者最终交付物都落在 `scripts/smoke/e2e/relay-<shortid>.sh`（已用 `ls` 核实，`sprints/07151245-relay-049ebf93/e2e-verify.sh` 不存在，`scripts/smoke/e2e/relay-049ebf93.sh` 存在）——这是历史两轮的路径漂移，非本合同应沿用的行为。本 PRD 在「范围限定」与「预期受影响文件」两处**明确且重复**指定路径为 `sprints/07191312-relay-57e25e92/e2e-verify.sh`（PRD 字面优先于历史实现漂移），本合同按 PRD 字面路径固定，不复制历史漂移路径。
- [当前实测] Brain API 返回 task `57e25e92-84a3-4599-992c-b4b74ec54acc`：`status=queued`、`claimed_by=null`、`task_type=harness_initiative`，`payload={mode:headed, executor:claude, orchestrator:skill-relay, journey_id:bb8cc561-b3ee-4fec-b74d-2255694bd963, dispatched_by_orchestrator:true, orchestrator_dispatched_at:"2026-07-19T01:56:28.018Z", dispatched_orchestrator_date:"2026-07-19"}`，无 `token`/`github_token`/`anthropic_token`/`thin_prd` 字段。
- [当前实测] DB `initiative_runs` 对 `initiative_id=57e25e92-84a3-4599-992c-b4b74ec54acc` **暂无行**（本合同起草时点实测为空）。PRD 边界情况要求这是硬 FAIL 条件，本合同遵循 PRD 字面语义；`payload.dispatched_by_orchestrator=true` 表明本任务是 orchestrator 派发（非 foreground takeover），预期该行会在本次 headed relay 流水线推进过程中由 orchestrator 落库，final-e2e 执行时点应已产生。此为已知 concern，登记于下方「接缝清单」。
- [当前实测] `packages/quality/smoke-allowlist.txt` 第 23 行已含 `claude-headed-dispatch-smoke.sh`（已登记，本 sprint 不重复登记）；实跑 `bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 当前 `PASS: 5 FAIL: 0 exit 0`。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为当前 task `57e25e92-84a3-4599-992c-b4b74ec54acc` 生成锚定该 task 的 `sprints/07191312-relay-57e25e92/e2e-verify.sh`：复用（不重实现）`claude-headed-dispatch-smoke.sh`，校验其在 allowlist 登记；查 Brain task API 核对 payload 三元组 + 敏感字段脱敏；查 DB `initiative_runs` 核对当前 initiative_id 的 host/phase。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本地只读校验，同步一次性，无长耗时依赖；断言失败必须打印明确 FAIL 原因并非零退出；不产生新写入；不重复 spawn/kill headed session。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方「Invariant 覆盖条目」对 PRD 31 条铁律逐条映射（12 条 BEHAVIOR + 19 条显式 N/A）。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本合同锚定一次性 task id，是一次性回归证据；`claude-headed-dispatch-smoke.sh` 语义变更由其维护者更新，不影响本文件；`initiative_runs_phase_check` 约束变更（新 migration）时需重新核实合法枚举。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 执行 DoD/E2E 任一命令非 0 即知道；`claude-headed-dispatch-smoke.sh` 在 CI allowlist 中失败会导致棘轮闸红。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain API/DB 不可读、payload shape 不符、`initiative_runs` 缺失或 phase=failed/非法枚举、allowlist 未登记均拦截并 exit 1，不允许无条件 `exit 0` 兜底；验证只读，重跑幂等；无降级路径。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 本 sprint 无对外发布动作；以当前 task 的 Brain API 响应 + DB `initiative_runs`/`information_schema`/`pg_constraint` 定点查询作为唯一外部真相，脚本 exit code 作为最终回执。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| headed relay run 归属当前 task | A. 只看最近一条 run（不限 initiative_id）；B. 用 `initiative_id = TASK_ID` 定点查 DB | B. 用当前 task id 定点查 | PRD 边界情况明确要求「`initiative_runs` 无该 initiative_id 记录 → FAIL」 | 历史其他 task 的 run 冒充当前任务验收，导致假 done |
| `phase` 合法枚举取值来源 | A. 复制历史合同（049ebf93/53710094）里写死的子集枚举；B. 实时 `pg_get_constraintdef` 查真实 CHECK 约束 | B. 真实 DB 约束查询 | 已实测历史子集缺 `A_contract`/`B_task_loop`/`C_final_e2e` 三个合法值，铁律 id=5775d866 要求禁用工作区/历史假设 | 若沿用子集，本任务 run 若恰好处于 `A_contract`/`B_task_loop`/`C_final_e2e` 阶段会被误判 FAIL |
| e2e-verify.sh 产出路径 | A. 沿用历史两例实际落地路径 `scripts/smoke/e2e/relay-<id>.sh`；B. 按 PRD 字面路径 `sprints/07191312-relay-57e25e92/e2e-verify.sh` | B. PRD 字面路径 | PRD「范围限定」与「预期受影响文件」两处重复明确指定该路径，历史路径漂移不构成覆盖 PRD 字面的依据 | 若沿用历史漂移路径，会脱离 PRD 明确指定的交付物位置，PRD 验收无法定点核对 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain task API 不可达/404 | `curl -sf` 非 0，验收失败 | 是，只读重跑 | 不降级为 done |
| task payload 三元组不匹配或含禁用字段 | jq -e 断言失败，非 0 退出 | 是，只读重跑 | 不允许放行 |
| `initiative_runs` 无该 initiative_id 记录 | 显式 FAIL + exit 1 | 是，只读重跑 | 不用历史其他 task 的记录替代 |
| `initiative_runs.phase` = failed 或不在真实 CHECK 约束枚举内 | 显式 FAIL + exit 1 | 是，只读重跑 | 不放行 |
| `claude-headed-dispatch-smoke.sh` 未登记 allowlist 或执行非 0 | 显式 FAIL + exit 1 | 是，只读重跑 | 不静默跳过，不吞错 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

（本任务 `e2e-verify.sh` 不对外暴露 agent 接口，只读调用内部 Brain API 与本地 DB，N/A）

## 真实调用方请求 shape

本任务真实调用方是 Brain task API 中已存在的 `harness_initiative` task payload，不是新增客户端请求。DoD 和 `e2e-verify.sh` 必须按以下 shape 定点读取当前 task，不得构造另一个 task 代替：

```json
{
  "task_type": "harness_initiative",
  "payload": {
    "mode": "headed",
    "executor": "claude",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963",
    "dispatched_by_orchestrator": true
  }
}
```

- 认证方式：本地 Brain API `localhost:5221`，当前 smoke 不新增鉴权路径。
- 必须逐字段一致：`mode=headed`、`executor=claude`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
- 验收对象必须是 `TASK_ID=57e25e92-84a3-4599-992c-b4b74ec54acc`；禁止新建任务或查询最近任务冒充。

## 禁 mock 边清单

（本单纯新增只读验证脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 全部断言真实 curl Brain API + 真实 psql PostgreSQL + 真实执行 `claude-headed-dispatch-smoke.sh`）

## 接缝清单

- Brain API 接缝：本机 `http://localhost:5221` 必须真实返回当前 task（已实测：`payload.mode=headed`/`payload.executor=claude`/`payload.orchestrator=skill-relay`/`payload.journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963` 且无禁用字段），不接受 mock 或 404-acceptable。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID=57e25e92-84a3-4599-992c-b4b74ec54acc` 定点读取；**已实测当前无该行**（`status=queued`/`claimed_by=null`，尚未进入 orchestrator 落库阶段）。这是 `logic-done-pending` 状态：本合同的 Golden Path/DoD 断言逻辑已就绪，但「run 行真实存在且 host/phase 合法」这一接缝点**尚未在真目标上验证通过**，需等 final-e2e 执行时点（generator 实现完成、orchestrator 已推进该 headed relay 至落库阶段）才能真验，不得提前标 done。该外部时序依赖已正式登记为风险，见下方 `## Risks` R1。
- smoke/allowlist 接缝：`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已存在且已在 `packages/quality/smoke-allowlist.txt` 登记（已实测 `PASS: 5 FAIL: 0`），本次只校验存在性与登记状态，不重新实现/不重复登记。

## Risks

**（round 2 新增 — reviewer 第一轮反馈风险登记维度 3/10 分，本段补齐）**

| # | 风险 | 说明 | Mitigation |
|---|------|------|------------|
| R1 | `initiative_runs` 落库存在外部时序依赖，sprint 代码无法控制 | Golden Path Step 3 依赖 Brain orchestrator 在本次 headed relay 推进到落库阶段（即 generator 完成实现之后）才把 `initiative_id=57e25e92-84a3-4599-992c-b4b74ec54acc` 的行写入 `initiative_runs`。已核实（round 1 起草时点）该 initiative_id 在 `initiative_runs` 中确无任何行（`SELECT count(*) FROM initiative_runs WHERE initiative_id='57e25e92-84a3-4599-992c-b4b74ec54acc'` = 0）。这不是本 sprint 代码的 bug，而是流水线阶段尚未推进到位；若 final-e2e 执行时点仍未到该阶段，`e2e-verify.sh` 会合法 FAIL，不代表 e2e-verify.sh 或 headed relay 实现本身有误。 | `e2e-verify.sh`（`## E2E 验收` 唯一权威脚本 `# GP-STEP-3` 段）在该行缺失时打印明确可诊断的 FAIL 信息（原文含「已知外部时序依赖：该行由 Brain orchestrator 在 headed relay 推进到落库阶段后才写入」「不是 e2e-verify.sh 自身逻辑缺陷」字样），使 evaluator/judge/人工复核者能一眼区分「orchestrator 尚未推进」与「Brain API/DB 连不上」「payload 字段不匹配」等其他真实故障，不会被误判为代码缺陷去回滚或重写实现；确需验收通过，需等待 orchestrator 推进该 run 至落库阶段后重跑本脚本。 |

（本合同仅识别到该条外部时序依赖风险；其余风险面已在「判定点登记表」「失败语义声明」「接缝清单」覆盖，此处不重复列入）

## Invariant 覆盖条目（PRD 铁律 1:1 映射，来源: area，共 31 条）

以下按 PRD Invariant 段原文逐条映射，12 条判定为本 sprint 适用并落到下方 contract-dod.md 的 `[BEHAVIOR] INV-N` 可执行条目，19 条判定不适用并显式 N/A（理由随附，禁止无声消失）：

**适用（12 条，编号 INV-1 ~ INV-12，可执行断言见 contract-dod.md）**：

| INV# | 来源 id | 铁律摘要 | 落地方式 |
|---|---|---|---|
| INV-1 | 9202c14e | 失败路径禁止 warning 降级，必须显式 FAIL + exit 非零 | 校验 `e2e-verify.sh` 所有失败分支都是 `echo "FAIL: ..."; exit 1`，无 warning-only 继续跑的分支 |
| INV-2 | 5775d866 | 判变基准用生产实体自报，禁用工作区 diff/历史假设 | 校验脚本里 phase 合法枚举与当前 `pg_get_constraintdef(initiative_runs_phase_check)` 真实值一致（子集） |
| INV-3 | 6414193b | 读源码用 readFileSync 必须包 async function | 校验 `tests/regression/relay-57e25e92/headed-smoke-contract.test.ts` 用 async 函数包裹文件读取 + 含 `await` 调用 |
| INV-4 | 14ed5336 | Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹 | 校验 contract-draft.md `## Test Contract` 表格式合规 |
| INV-5 | c674ab49 | 回归测试用 source-code inspection 优于 mock | 校验测试文件不含 `vi.mock`/`jest.mock`/`sinon.stub` |
| INV-6 | 72890f7c | tmux 子 shell 不继承父进程 env，需显式传递 | 校验 `e2e-verify.sh` 所有关键变量都走 `${VAR:-default}` 显式默认值，不依赖隐式继承 |
| INV-7 | 8d92f7b1 | Proposer 复用历史合同前必须核对真实派发/执行历史 | 校验 contract-draft.md「已知约束」含「当前实测」记录（本合同已执行，见上文） |
| INV-8 | 1100cb8f | 禁止改共享 CI 基础设施文件（workflows/allowlist 等跨 sprint 共享文件） | 校验本 sprint 不修改 `.github/workflows/*.yml`、`packages/quality/smoke-allowlist.txt` |
| INV-9 | 7ccfa168 | 单 slot 串行，不 spawn/kill 并发会话 | 校验脚本不含 `tmux new-session`/`tmux kill`/`killall`/`pkill` |
| INV-10 | 5e125909 | 禁写死环境假设值（端口/路径/DB 等） | 校验 `BRAIN_URL`/`DATABASE_URL` 走 env 默认，脚本不含真实凭据/写死路径 |
| INV-11 | 3c30394c | 真环境验证才算 done，未真验标 logic-done-pending | 校验脚本真打 curl/psql/真实 smoke 脚本，无 mock/stub/吞错；见上文「接缝清单」logic-done-pending 登记 |
| INV-12 | 564802ee | secrets 不硬编码、不进 git、不进日志 | 校验 payload 禁用字段（token 等）检查存在，脚本本身不含硬编码 secret |

**不适用（19 条，显式 N/A，逐条列出理由）**：

- `8dbe91ee`（多设备类型 os_type 字段消解规则）：N/A — 本 sprint 不新增字段，不涉及多设备类型语义重叠。
- `113a9330`（git_sha=unknown 跨脚本语义一致）：N/A — 本脚本不判定/输出 git_sha。
- `26a1d06e`（git rev-parse --verify）：N/A — 本脚本不调用 `git rev-parse`。
- `66f41f70`（smoke 用真实 worktree 当 CECELIA_DEPLOY_ROOT 需核对生产资源触碰）：N/A — 本脚本不使用 `CECELIA_DEPLOY_ROOT`，不做部署，只读 Brain API/DB。
- `755fb846`（Red commit 只 git add 精确路径）：N/A — 该铁律约束 generator 的 TDD red commit 操作，本轮 proposer 自身 commit 已按精确路径 `git add`（见 Step 4），generator 阶段的 red commit 不在本合同 DoD 可机检对象范围内。
- `55cb4cb7`（新增 cron 功能检查 scheduler-jobs.js）：N/A — 不新增 cron 功能。
- `e8230eb5`（禁止 generator 自行 merge PR）：N/A — 约束 generator 角色行为，超出本 sprint 只读验证脚本的 DoD 验证对象。
- `26886b60`（PR 提前合并需核对 head SHA 与 evaluator/judge verdict 锚定 sha 一致）：N/A — 本 sprint 产出物在 evaluator/judge/merge 阶段之前，不涉及 PR 合并时点 SHA 核对。
- `552520d0` / `4b73376c`（`[smoke-invariant-1783]` smoke 铁律 ×2）：N/A — decisions 表实测两条记录 `reason`/`context`/`actions` 均为空，`decision` 字段仅字面 "smoke 铁律" 占位，无可执行语义。
- `3efefc23`（feat+brain/src PR 开 PR 前一次带齐 smoke.sh+allowlist 登记）：N/A — 本 sprint 不新增 `brain/src` feature PR，不新增 smoke 脚本本体，复用已登记脚本。
- `5b91a042`（新 task_type 接线七点清单）：N/A — 不新增 task_type。
- `365d645a`（服务活性双信号判定）：N/A — 不判定常驻服务活性。
- `02e74e46`（禁止用 LaunchAgents 放常驻服务）：N/A — 不涉及 LaunchAgents。
- `b145c74a`（新增常驻宿主服务需入 launchd-patrol.js manifest）：N/A — 不新增常驻服务。
- `55b8eb46`（单元/E2E 默认种 ≥2 租户断言互不串）：N/A — 本 sprint 只读校验单个 task_id 的元数据，不涉及多租户数据模型/隔离场景。
- `459b6ff9`（客户隐私/PII/聊天内容不得明文进日志）：N/A — 校验对象是 Brain task 技术元数据字段（mode/executor/orchestrator/journey_id），不含客户 PII/聊天内容。
- `50954d28`（每个 API 端点必须有 auth）：N/A — 不新增或修改 API 端点。
- `68976b17`（碰租户数据查询/写入必须 scope 当前租户）：N/A — 不查询或修改租户作用域数据。

## Golden Path

Brain 派发 headed relay 任务（task_id=57e25e92）→ e2e-verify.sh 复用调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记 → 查 Brain task API 核对 payload 三元组与敏感字段脱敏 → 查 DB initiative_runs 核对 host/phase → 全部通过则 exit 0 打印 PASS，任一失败则 exit 1 打印 FAIL 原因。

### Step 1: 复用调用 claude-headed-dispatch-smoke.sh 并校验其在 allowlist 登记
**来源**: `[FROM_PRD]` — PRD「E2E 验收」第 3 点与「范围限定」明确要求复用既有脚本、校验其在 `packages/quality/smoke-allowlist.txt` 登记，且「不新增/修改 `claude-headed-dispatch-smoke.sh` 本体」「仅校验存在，不重复登记」。

**可观测行为**: `claude-headed-dispatch-smoke.sh` 在本机 Brain 上全绿（exit 0），且该脚本文件名精确出现在 allowlist 文件中。

**验证命令**: 权威实现**唯一**落在本文档 `## E2E 验收` 脚本的 `# GP-STEP-1 BEGIN` ~ `# GP-STEP-1 END` 标记段——本节及 contract-dod.md 对应 `[BEHAVIOR]` 条目均通过 `awk` 从该标记段原样提取执行，不在此重复粘贴完整命令（round 2 修订：reviewer 第一轮发现同一断言曾在本文件 Golden Path / E2E 脚本 / contract-dod.md 三处独立粘贴且写法已漂移，本轮收敛为单一权威来源）。摘要：调用 `claude-headed-dispatch-smoke.sh` → `grep -Fxq` 校验 allowlist 登记。

**硬阈值**: smoke 脚本 exit 0；allowlist 精确逐行匹配包含该脚本名（`grep -Fxq`，全行匹配防子串误报）。

### Step 2: 当前 task 记录 payload 三元组齐全且不含敏感字段
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「E2E 验收」第 1 点，要求 `GET /api/brain/tasks/57e25e92...` 返回 task，payload 三元组齐全，且不含 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段。

**可观测行为**: Brain task API 返回当前 task，`id` 等于 TASK_ID，`payload.mode/executor/orchestrator/journey_id` 精确匹配，且四个禁用字段均不存在于 payload。

**验证命令**: 权威实现**唯一**落在本文档 `## E2E 验收` 脚本的 `# GP-STEP-2 BEGIN` ~ `# GP-STEP-2 END` 标记段（同 Step 1，通过 `awk` 提取执行，不重复粘贴）。摘要：`curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"` → 依次 `jq -e` 断言 `id`/`task_type`/payload 三元组精确匹配 → `jq -e` 断言四个禁用字段（`token`/`github_token`/`anthropic_token`/`thin_prd`）均不存在。

**硬阈值**: task id 完全匹配；payload 四字段完全匹配；四个禁用字段全部不存在，任一存在即 FAIL。

### Step 3: initiative_runs 记录当前 task 的 headed relay host、合法 phase 与新鲜度
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「边界情况」段：`initiative_runs` 无该 initiative_id 记录 → FAIL；`phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL。新鲜度校验为 `[AI_ADDED]`（round 2）——reviewer 第一轮反馈指出原 `ORDER BY started_at DESC LIMIT 1` 缺时间窗，存在陈旧行冒充本轮证据的理论风险；补充 `started_at >= 对应 tasks.created_at` 校验，防止历史其他轮次残留的 run 行被误判为本轮证据。

**可观测行为**: 当前 `initiative_id=57e25e92-84a3-4599-992c-b4b74ec54acc` 至少一条 run 记录，`orchestrator_host` 含 `skill-relay-claude-headed`，`phase` 处于真实 DB CHECK 约束合法枚举且非 `failed`，且 `started_at` 不早于对应 `tasks.created_at`（新鲜度）。行缺失时的诊断信息见 `## Risks` R1。

**验证命令**: 权威实现**唯一**落在本文档 `## E2E 验收` 脚本的 `# GP-STEP-3 BEGIN` ~ `# GP-STEP-3 END` 标记段（同 Step 1/2，通过 `awk` 提取执行，不重复粘贴）。摘要：单条 `psql` SQL 用 `JOIN tasks` 一次性取回 `orchestrator_host`/`phase`/`started_at`/`is_fresh`（`is_fresh := (ir.started_at >= t.created_at)`，SQL 原生布尔比较，不做跨平台 bash 日期解析，避免 BSD/GNU `date` 格式差异）→ 逐项断言 host 含子串、phase 非 `failed` 且属合法枚举、`started_at` 非空、`is_fresh = true`；行缺失时打印区分性 FAIL 信息（引用 `## Risks` R1，说明是外部时序依赖而非脚本自身逻辑缺陷）。

**硬阈值**: `initiative_runs` 至少一行；`orchestrator_host` 含 `skill-relay-claude-headed`；`phase` 属于真实 DB CHECK 约束的合法枚举（`A_planning|A_contract|B_task_loop|C_final_e2e|planning|gan|generate|evaluate|done`）且非 `failed`；`started_at` 非空且不早于对应 task 的 `created_at`（新鲜度，round 2 新增）。

### Step 4: sprints/07191312-relay-57e25e92/e2e-verify.sh 成为单一可复跑 wrapper
**来源**: `[AI_ADDED]` — 防止 reviewer/evaluator 分散复制命令导致 scope 漂移；把同一 oracle 固化为 generator 可实现、evaluator 可直接执行的脚本，且脚本路径按 PRD 字面「预期受影响文件」段固定。

**可观测行为**: `bash sprints/07191312-relay-57e25e92/e2e-verify.sh` exit 0（内部依次执行 `# GP-STEP-1` ~ `# GP-STEP-4` 全部标记段，是 Step 1-3 逻辑的唯一权威载体）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/07191312-relay-57e25e92}"
TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
bash "${SPRINT_DIR}/e2e-verify.sh"
```

**硬阈值**: exit 0；FAIL 原因必须打印到 stdout/stderr；不得使用 mock/force/stub。

## 验证等级断言

- [BEHAVIOR] verification_level: L3 真目标复核：claude-headed-smoke 的 done 只能由真实 Brain API 与 PostgreSQL `tasks`/`initiative_runs` 接缝命令给出，不接受 mock/stub/fixture 或静态日志替代。
  verification_level: L3
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191312-relay-57e25e92}"; bash "${SPRINT_DIR}/e2e-verify.sh"'

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

后续 generator 必须补 `sprints/07191312-relay-57e25e92/e2e-verify.sh`，内容等价于以下脚本；proposer 本阶段不创建该脚本，以保证 TDD Red。

**本脚本是全合同唯一权威逻辑来源（round 2 修订）**：Golden Path Step 1-3 的「验证命令」与 contract-dod.md 对应 `[BEHAVIOR]` 条目均通过 `# GP-STEP-N BEGIN`/`# GP-STEP-N END` 标记从本脚本原文 `awk` 提取后原样执行，不在别处重复粘贴完整命令，消除三处独立维护导致的写法漂移（reviewer 第一轮反馈第 1 条）。`# GP-STEP-3` 段新增新鲜度校验（reviewer 第一轮反馈第 3 条），行缺失时的 FAIL 信息显式引用 `## Risks` R1（reviewer 第一轮反馈第 2 条）：

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191312-relay-57e25e92}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

# GP-STEP-1 BEGIN: 复用调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 登记"
  exit 1
fi
# GP-STEP-1 END

# GP-STEP-2 BEGIN: task payload 三元组齐全且不含敏感字段
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.task_type == "harness_initiative"' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay" and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null
# GP-STEP-2 END

# GP-STEP-3 BEGIN: initiative_runs 记录当前 task 的 headed relay host、合法 phase 与新鲜度（防陈旧行冒充本轮证据，round 2 reviewer 反馈补齐）
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT ir.orchestrator_host, ir.phase, ir.started_at, (ir.started_at >= t.created_at) AS is_fresh FROM initiative_runs ir JOIN tasks t ON t.id = ir.initiative_id WHERE ir.initiative_id='${TASK_ID}' ORDER BY ir.started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无 initiative_id=${TASK_ID} 的任何记录（或对应 tasks 行缺失）—— 已知外部时序依赖：该行由 Brain orchestrator 在 headed relay 推进到落库阶段后才写入（generator 完成实现后才会产生），若此刻仍无记录属预期中的时序未就绪，不是 e2e-verify.sh 自身逻辑缺陷（见 contract-draft.md Risks R1）"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
IS_FRESH=$(printf '%s' "$ROW" | cut -d'|' -f4)

case "$HOST" in
  *skill-relay-claude-headed*) ;;
  *) echo "FAIL: host=$HOST"; exit 1 ;;
esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in
  A_planning|A_contract|B_task_loop|C_final_e2e|planning|gan|generate|evaluate|done) ;;
  *)
    echo "FAIL: phase=$PHASE"
    exit 1
    ;;
esac
if [ -z "$STARTED_AT" ]; then
  echo "FAIL: started_at 为空"
  exit 1
fi
if [ "$IS_FRESH" != "t" ]; then
  echo "FAIL: initiative_runs.started_at=$STARTED_AT 早于对应 task.created_at —— 疑似陈旧行冒充本轮证据（新鲜度校验未通过，round 2 reviewer 反馈补齐）"
  exit 1
fi
# GP-STEP-3 END

# GP-STEP-4 BEGIN: 单一可复跑 wrapper 全部通过
echo "OK headed smoke regression verified for $TASK_ID"
# GP-STEP-4 END
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e-verify.sh 复用 smoke 脚本并校验 allowlist | `../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts` | `e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记` | `e2e-verify.sh` 尚未存在，测试失败 |
| task payload 四字段 + 敏感字段脱敏 | `../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts` | `payload 四字段齐全且禁用 token/github_token/anthropic_token/thin_prd` | `e2e-verify.sh` 尚未存在，测试失败 |
| initiative_runs host/phase 校验 | `../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts` | `initiative_runs 含 skill-relay-claude-headed 且 phase 使用真实 DB 枚举拒绝 failed/unknown` | `e2e-verify.sh` 尚未存在，测试失败 |
| local_api E2E wrapper 完整链路 | `../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts` | `local_api E2E wrapper 完整验证当前 task/run/smoke 外部真相，无 mock/吞错` | `e2e-verify.sh` 尚未存在，测试失败 |

## Notes

- contract-gate: applicable (cecelia worktree，`packages/brain/src/lib/contract-gate.js` 已实测存在)。
- judgment-pending-user: N/A，本任务只读验证现有 headed relay 证据，无高风险不可逆外部动作，PrepPRD/Sprint PRD 已明确锚定验收点。
- logic-done-pending 登记：`initiative_runs` 当前实测无本 task 行（见「接缝清单」与「Risks」R1），断言逻辑已就绪但真实 run 行尚未产生，final-e2e 执行时点需重新核实；在此之前不得标 done。
- **round 2 修订记录（本轮，针对 reviewer 第一轮 REVISION 三项未达标维度）**：
  1. 内部一致性：task-payload curl+jq 断言与 initiative_runs 查询此前在 Golden Path Step 2/3、`## E2E 验收` 完整脚本、contract-dod.md BEHAVIOR 条目三处独立粘贴且写法已漂移（合并 AND 表达式 vs 拆分 4 条 vs 双引号转义重写）。本轮收敛：`## E2E 验收` 脚本新增 `# GP-STEP-1`~`# GP-STEP-4` BEGIN/END 标记，成为**唯一**权威逻辑来源；Golden Path Step 1-3「验证命令」改为文字引用 + 一句话摘要（不再贴完整代码块）；contract-dod.md 对应 3 条 BEHAVIOR 条目改为用 `awk` 从该脚本原文按标记提取后原样执行（见下方 contract-dod.md 修订），物理上不可能再产生第二份漂移文本。
  2. 风险登记：新增 `## Risks` 段，登记 R1（`initiative_runs` 落库的外部时序依赖，sprint 代码不可控），并给出 mitigation（`# GP-STEP-3` FAIL 分支打印可诊断信息，明确区分「orchestrator 未推进」与其他真实故障）。
  3. Verification Oracle 完整性：`# GP-STEP-3` 的 `psql` 查询由单表 `SELECT ... LIMIT 1` 改为 `JOIN tasks` 一次性取回 `is_fresh := (initiative_runs.started_at >= tasks.created_at)`，SQL 原生布尔比较（已用真实 DB 核实 `tasks.created_at`/`initiative_runs.started_at` 列存在且 JOIN 语义在历史数据上成立，见本轮起草时 psql 实测），避免陈旧行冒充本轮证据；`is_fresh != 't'` 时显式 FAIL。
  - [BEHAVIOR] 条目数：round 1 为 16 条，round 2 收敛后仍为 16 条（3 条从「独立重写」改为「awk 提取执行」，未新增/删减条目数，符合精简纪律 B50 净变化趋近 0）。
- 历史路径漂移记录：049ebf93/53710094 两例文档声称 sprint-local 路径实际都落地在 `scripts/smoke/e2e/relay-<id>.sh`；本合同按当前 PRD 字面重复指定的 `sprints/07191312-relay-57e25e92/e2e-verify.sh` 执行，不复制该漂移。
- phase 合法枚举已用 `pg_get_constraintdef(initiative_runs_phase_check)` 实测更新为完整集合（含 `A_contract`/`B_task_loop`/`C_final_e2e`），比历史合同子集更准确。
- self-check 已知假阳性：Step 2b-check 第 6 项全角标点检测正则 `[（）：，""]\$` 在本机 shell（`LANG`/`LC_ALL` 均未设置）下对任意 `"$VAR` 结尾/含 `"..."$` 的 ASCII 行普遍误报（round 1 复测命中 22 处，round 2 修订后复测命中 21 处，数量变化仅因文本增删，误报性质不变）——已用已毕业先例 `scripts/smoke/e2e/relay-4bb31ef5.sh`（已过 GAN/evaluator/merge 的真实生产脚本）同一正则复测，同样大量误报，且该脚本内实际只有 3 处真实全角标点，证明是环境性假阳性（BSD/无 locale grep 字节范围匹配问题），非本合同脚本真的存在全角标点紧贴 `$VAR`。本合同 E2E 脚本经人工逐行核对不含真实全角标点紧贴 `$VAR`，此项判定为假阳性，不阻塞交付；其余 Step 2b-check round 2 复测全部通过：`[BEHAVIOR]` 行首 checkbox 格式 = 16 条（≥4，与 round 1 持平）、`Test: manual:` = 16/16、E2E bash 代码块 = 1、`bash -n` 语法通过、真执行断言（curl/psql/bash/node 开头）16/16 条（≥2 且占比 100% ≥50%，grep 开头文本自证 0 条）。round 2 额外验证：`# GP-STEP-1/2/3/4` 标记段用 `awk` 独立提取后可分别语法通过（`bash -n`）并在本机真实执行——STEP-1（allowlist）/STEP-2（task payload）均实测 PASS，STEP-3（initiative_runs）实测按预期 FAIL 并打印引用 `## Risks` R1 的诊断信息（因当前 `initiative_runs` 确无本 task 行，与 Risk R1 描述一致，非脚本逻辑缺陷）；contract-dod.md 对应 4 条 BEHAVIOR 断言在临时补入草稿版 `e2e-verify.sh` 后用真实 vitest（`tests/regression/relay-57e25e92/headed-smoke-contract.test.ts`，未改动）复测 4/4 PASS，移除后复测回归 4/4 FAIL（ENOENT），证明 TDD Red 状态未被破坏、测试文件与合同断言逐字段仍然对齐，round 2 全部改动未触碰 tests/ 骨架。
