# Sprint PRD — headed-smoke-test 回归证据脚本（relay-14a11fd8）

## OKR 对齐

- **对应 OKR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%），无独立编号 KR
- **本次推进预期**：新增一条锚定本次 task_id 的可重跑回归证据，不改变整体进度百分比

## 背景

Cecelia Harness Pipeline 需要持续证明"Brain headed 派发 → controller 认领 → 落
`initiative_runs` → 走完整条链路"通路无回归。本次 `headed-smoke-test`
（task_id=14a11fd8-0d2f-49e2-885b-9286fc1d76f7，journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963）
是该 journey 第 6 次同结构冒烟回归，前 5 次（a85e0582/cd0b936c/049ebf93/63db6f8a/4bb31ef5）均已
合并。controller 已查证 payload 三元组齐全，`initiative_runs` 已真实落行
（`orchestrator_host=skill-relay-claude-headed`，`phase=A_planning`），走标准判定路径。

## Golden Path（核心场景）

Brain 派发一次 headed 冒烟任务 → controller 产出锚定证据脚本 → 脚本验证全链路无回归

1. Brain 已向本 task_id 派发 `mode=headed/executor=claude/orchestrator=skill-relay`，payload
   不含 token/github_token/anthropic_token/thin_prd 敏感字段
2. `initiative_runs` 已为本 task_id 落行，`orchestrator_host` 匹配
   `*skill-relay-claude-headed*`，`phase` 落在合法枚举且非 `failed`，`started_at` 非空
3. controller 产出 `e2e-verify.sh`，复用（不重新实现）已有的
   `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`
4. e2e-verify.sh 依次校验：smoke 脚本已在 allowlist 登记 → payload 三元组齐全不泄漏 →
   `initiative_runs` 记录存在且字段合法
5. 可观测结果：脚本以非零退出码+原因文本报告 FAIL，全部通过输出 PASS

## 边界情况

- `initiative_runs` 无本 task_id 记录 → 脚本判定 FAIL 并打印缺失的具体表/字段
- payload 中出现 token/github_token/anthropic_token/thin_prd 字段 → 判定 FAIL（敏感字段泄漏）
- `phase` 落在 `failed` 或不在合法枚举内 → 判定 FAIL
- smoke 脚本已在 allowlist 登记时，脚本跳过重复登记，不报错

## 范围限定

**在范围内**：
- `sprints/07172014-relay-14a11fd8/e2e-verify.sh`（新增，复用已有 smoke 脚本）
- `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts`（新增 vitest [BEHAVIOR] 用例）
- `sprints/07172014-relay-14a11fd8/contract-dod.md` 的 manual:bash 验收命令

**不在范围内**：
- 重新实现或修改 `claude-headed-dispatch-smoke.sh` 本体
- 修改 `.github/workflows/*.yml` 或 `packages/quality/smoke-allowlist.txt`（4bb31ef5 先例已锁定该范围）
- 任何 CI workflow 扩权

## 假设

- [ASSUMPTION: `claude-headed-dispatch-smoke.sh` 已存在且逻辑正确，本任务只复用调用，不做行为验证]
- [ASSUMPTION: `initiative_runs` 记录已在派发时真实写入（`orchestrator_host=
  skill-relay-claude-headed`/`phase=A_planning`），无需脚本额外等待]

## 预期受影响文件

- `sprints/07172014-relay-14a11fd8/e2e-verify.sh`：新增回归证据脚本，复用 smoke 脚本 + 校验
  payload/初始化落库
- `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts`：新增契约测试，锚定校验
  e2e-verify.sh 文本包含上述校验点
- `sprints/07172014-relay-14a11fd8/contract-dod.md`：DoD 验收命令（由 Proposer 阶段产出）

## NFR 约束

<!-- 来源: PrepPRD 显式声明（无 decisions 表 nfr 记录，golden-path-decisions?category=nfr 与
     ability-decisions 均为空，PrepPRD 主源优先） -->
- 超时/延迟：N/A（纯回归证据脚本，无性能新增面）
- 频控：N/A
- 版本要求：无
- 可观测：e2e-verify.sh 校验失败必须打印明确原因，禁止静默吞错（`|| true` / `MOCK_` 模式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions 表 category=invariant，PrepPRD task 级 + area 级合并去重（step/journey_feature
     级经 API 查证为空，因本 task 无 ability_id） -->
- [复用不重写] 不得重新实现 `claude-headed-dispatch-smoke.sh`，只能复用调用（来源: PrepPRD）
- [CI范围锁定] 不得修改 CI workflow，4bb31ef5 先例已锁定该范围，本次不重复扩权（来源: PrepPRD）
- [禁止吞错] e2e-verify.sh 不得出现 `MOCK_` 或 `|| true` 吞错模式（来源: PrepPRD）
- [async包裹测试] lint-test-quality 要求 await fn() ≥ 1，读源码必须包装 async function，不能直接
  readFileSync（来源: area）
- [Test Contract格式] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3
  列解析路径（来源: area）
- [Red commit范围] Red commit 必须只 `git add` 精确路径（`*.test.ts`），禁止 `git add .` 或
  `git add .harness/`，防非测试文件混入（来源: area）
- [回归验证方法] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron排查路径] 新增 cron 功能首先检查 `scheduler-jobs.js` JOBS，`tick-runner.js` 是 deprecated
  路径（来源: area）
- [merge权归controller] 禁止 generator 自行 merge PR，merge 权归 controller，generator 只推
  branch 并报告 branch ready（来源: area）
- [tmux环境变量] headed relay 的 tmux innerCmd 子 shell 不自动继承父进程环境变量，需要的变量必须
  在 innerCmd 字符串中显式 export（来源: area）
- [Proposer核实历史] Proposer 复用历史合同模板前必须先核对本次任务真实派发/执行历史，不能假设与
  先例路径相同（来源: area）
- [CI基础设施禁区] harness-generator 对共享 CI 基础设施文件（`.github/workflows/*.yml`、
  `smoke-allowlist.txt` 等）默认禁区，未经合同显式授权不可修改（来源: area）
- [PR SHA核对] PR 被 CI 侧兜底机制提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict
  锚定 sha 与实际合并 sha 一致（来源: area）
- [PR前置smoke登记] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等
  CI 两连红（来源: area）
- [新task_type接线清单] 新 task_type 接线用七点清单：CHECK 约束/task-router 四表/
  EXECUTOR_KIND_FOR/executor dispatch 分支/executor override 排除/relay loadSkill 映射/
  dispatcher 三防线（来源: area）
- [服务存活双信号] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [US Mac禁LaunchAgents] 美国 Mac mini 禁止再往 `~/Library/LaunchAgents` 放常驻服务，用系统域
  LaunchDaemon（来源: area）
- [常驻服务登记manifest] 新增常驻宿主服务时必须同步加进 `launchd-patrol.js` 的 manifest（来源: area）
- [单slot串行] 单 slot/会话内严格串行执行任务，需并行用多个 slot；任务内部只读工种可扇出，实现者
  同一时刻只有一个（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA 阈值等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产 env 的接缝断言必须真验证过才能标 done，未真验只能标
  logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）
- [smoke占位] smoke 铁律（系统内部烟雾测试占位条目，非产品约束，仅存在性校验，来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths 查询结果为空
     数组（本 journey 下尚无 ability_status=done/working 的 golden_path 记录），按占位规则处理 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位，最终可执行脚本由 Proposer 在 GAN 阶段按 target_environment=local_api
> 产出（curl + psql 模板），写入 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将填入真实 local_api 校验脚本
# 期望验收点（自然语言）：
# 1. 运行 sprints/07172014-relay-14a11fd8/e2e-verify.sh，退出码为 0
# 2. 脚本输出确认 payload 三元组齐全且不含敏感字段
# 3. 脚本输出确认 initiative_runs 表本 task_id 记录存在且 phase 合法
```

## journey_type: autonomous
## journey_type_reason: 任务本体是校验 Brain 内部派发/落库链路的回归证据脚本（curl localhost:5221 +
  查 initiative_runs 表），不涉及 apps/dashboard/、远端 agent 协议改动或 packages/engine/
  hooks/skills，按 Step 0.5 优先级链归为纯后端 → autonomous（PrepPRD 原文写"regression"为任务分类
  描述，非本 skill 合法枚举，此处按流程重新推断）
## target_environment: local_api
## target_environment_reason: 校验对象是 Brain API（localhost:5221）与其 Postgres 表
  （initiative_runs），执行方式为 curl + psql，与 PrepPRD 原文 target_environment 一致
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
