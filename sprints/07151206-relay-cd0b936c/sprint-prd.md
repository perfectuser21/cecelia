# Sprint PRD — claude-headed-smoke 回归冒烟（第二轮，扩展 nightly 池覆盖）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：claude-headed relay 全链路已在 PR #3829（4bb31ef5，07-13）验证并合并，产物在 main
- **本次推进预期**：巩固回归覆盖的"时间连续性"，防止 nightly 池只锚定在一次历史快照上

## 背景

本任务是 Cecelia Harness Pipeline（journey_id=bb8cc561）的定期回归冒烟，Brain task
cd0b936c 无 prep_prd_body。调研发现：上一轮同类任务（4bb31ef5，PR #3829）已产出
`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` +
`packages/quality/smoke-allowlist.txt` 登记 + `.github/workflows/ci.yml` claude-headed
判定分支，且已随 sprint 毕业（`scripts/graduate-sprint-tests.mjs`）为
`scripts/smoke/e2e/relay-4bb31ef5.sh`，被 `.github/workflows/smoke-e2e-nightly.yml`
的 nightly 池引用。这部分**已在 main，禁止重复造**。

但 `scripts/smoke/e2e/relay-4bb31ef5.sh` 内部把 `TASK_ID` 默认值硬编成
`4bb31ef5-e140-41f4-9daf-9ca4a9e51216`（07-13 那次历史任务），只验证那一条历史 task 行
在 staging DB 里仍然存在、字段仍然正确。它验证的是"历史快照没被破坏"，不验证"今天的新
派发（cd0b936c）走的是同一条健康链路"。nightly 池目前只有这一个 claude-headed 锚点，
且永远指向 07-13，不会随每轮回归任务增长——这是本轮要补的真实缺口：**新增一条绑定本次
task_id（cd0b936c）的等价回归脚本，让 nightly 池的 claude-headed 覆盖点跟着回归节奏往
前滚动，而不是永远停在第一次**。

## Golden Path（核心场景）

1. [触发条件] Brain 按 journey_id=bb8cc561 定期派发 `claude-headed-smoke` 冒烟任务
   （task_type=harness_initiative, payload.mode=headed, executor=claude,
   orchestrator=skill-relay），本轮 task_id=cd0b936c-2891-4fed-a921-5636ca08d1e8
2. [系统处理] Sprint 产出 `sprints/07151206-relay-cd0b936c/e2e-verify.sh`——内容对齐
   `relay-4bb31ef5.sh` 的验证项（复用既有 `claude-headed-dispatch-smoke.sh` +
   allowlist 登记 + ci.yml 分支优先级断言 + `harness-skill-relay.js` 路由标记 +
   `initiative_runs.orchestrator_host='skill-relay-claude-headed'` 行存在），但
   `TASK_ID`/`SPRINT_DIR` 默认值改绑本轮 cd0b936c，验证**这一次**的派发行在 Brain/DB
   里状态正确、host 标记正确、未回退 codex-headed 分支
3. [可观测结果] Sprint 毕业后，`scripts/smoke/e2e/relay-cd0b936c.sh` 出现在
   nightly 池，`smoke-e2e-nightly.yml` 头部 A2 登记注释同步加上这一行；nightly dry-run
   / 实跑均能发现并执行该脚本，claude-headed 全链路仍端到端 PASS

## 边界情况

- staging DB 里若本轮 task_id 的 `initiative_runs` 行尚未产生（时序早于 tick 派发）→
  脚本按 `relay-4bb31ef5.sh` 现有写法直接 FAIL，不做 sleep/retry 掩盖（保持现有严格度）
- 不修改 `relay-4bb31ef5.sh` 本身（历史锚点保留，不删旧不改旧）

## 范围限定

**在范围内**：新增 `sprints/07151206-relay-cd0b936c/e2e-verify.sh`（对齐既有脚本结构，
改绑本轮 task_id）；毕业后同步更新 `smoke-e2e-nightly.yml` 头部 A2 登记注释列表
**不在范围内**：不重新实现 `claude-headed-dispatch-smoke.sh`、不改 `ci.yml` 判定分支、
不改 `smoke-allowlist.txt` 已有登记（这些已在 main，本轮只复用断言）

## 假设

- [ASSUMPTION: 本轮 task cd0b936c 已在 Brain DB `tasks` 表存在（已确认），且会有对应
  `initiative_runs` 行随 A_planning 阶段写入（已确认 harness/runs 返回该行 phase=A_planning）]

## 预期受影响文件

- `sprints/07151206-relay-cd0b936c/e2e-verify.sh`: 新增，本轮回归验证脚本（毕业前）
- `.github/workflows/smoke-e2e-nightly.yml`: 头部 A2 登记注释追加一行（毕业后由
  report/generator 阶段同步）

## E2E 验收

> 最终可执行脚本由 proposer/generator 落地为 `e2e-verify.sh`，验收点如下：

```bash
# 期望验收点（自然语言）：
# 1. bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh 全部 PASS
# 2. packages/quality/smoke-allowlist.txt 含 claude-headed-dispatch-smoke.sh
# 3. GET /api/brain/tasks/cd0b936c-... 返回 payload.mode=headed / executor=claude / orchestrator=skill-relay
# 4. psql 查 initiative_runs：initiative_id=cd0b936c-... 最新一行 orchestrator_host='skill-relay-claude-headed'，phase 非 failed
# 5. ci.yml 中 claude-headed 精确判定分支行号仍先于 codex 通用兜底分支（不回归 W43/#3829 修复）
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 line 副源为空），PrepPRD 无 prep_prd_body -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用现有 smoke 脚本无显式超时、由 CI job timeout 兜底）
- 频控: 无
- 版本要求: 无
- 可观测: nightly 失败必须触发 Bark 告警（沿用 e2e-nightly.sh 现有机制），不新增

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本任务无 ability_id，为空） -->
- [smoke 登记纪律] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area learning）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算done，未真验只能标 logic-done-pending（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/阈值等环境假设禁止写死，要么从环境推导要么真机校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [单slot串行] 一个 slot/会话内严格串行执行任务，跨 slot 才允许并行（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line golden_path 查询为空（无 ability 挂载记录），退化为最近一次已合并 PR 的产物清单 -->
- claude-headed relay wrapper（PR #3829，4bb31ef5）: claude-headed-dispatch-smoke.sh 新增 → smoke-allowlist.txt 登记 → ci.yml claude-headed 精确判定分支（先于 codex 兜底）→ relay-4bb31ef5.sh 毕业进 nightly 池

## journey_type: dev_pipeline
## journey_type_reason: 涉及 packages/brain/scripts/smoke/ 与 packages/engine 无关，但本 journey（bb8cc561）本体定义即 journey_type=dev_pipeline（GET /journeys/bb8cc561 返回值），沿用 Journey 既定分类而非按路径重新推断
## target_environment: local_api
## target_environment_reason: 验证对象是 Brain API（localhost:5221）+ 本地/CI PostgreSQL，无 UI 交互，沿用 relay-4bb31ef5.sh 现有 curl+psql 验证方式
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
