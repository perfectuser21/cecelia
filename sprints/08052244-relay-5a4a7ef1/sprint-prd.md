# Sprint PRD — P0 Kernel DevOps 堵点修复（relay 重试）

**Task ID**: `5a4a7ef1-461d-4c3a-b8f5-7ca8c5f638bc`
**Sprint Dir**: `sprints/08052244-relay-5a4a7ef1`
**Journey**: 工厂 · F1 开发闭环（`e6f803f2`，dev_pipeline）
**日期**: 2026-08-05

---

## Invariant 约束

来源：Brain DB decisions（category=invariant，status=active），共 14 条。核心约束摘要：

| ID（前8位） | 铁律要点 |
|---|---|
| `56a0ba9f` | watchdog 对从未启动的进程必须走 never_started 分类兜底，禁止假标签污染 |
| `c6f9e985` | relay 单session 模式必须在各 phase 完成时调 phase-event 接口写 node 级 done 事件 |
| `70bce96e` | PR 处于 CONFLICTING 状态时禁止空等 CI，先 merge main 解冲突 |
| `3b9804e6` | evaluator 临时脚本必须落会话独享路径（含 session id），禁共享 /tmp 固定文件名 |
| `1129ee0d` | 权限/资金/外部发布/生产数据命中任一项，强制真人确认 |
| `a3d7c6e8` | 环境接缝守卫铁律未被 CI 强制时，必须先建机器闸门再声明"接缝安全" |
| `2f11ae25` | envfail(exit 3) 必须让 job 红+触发报警，绝不允许 infra-skip 静默放行 |

---

## 已完成（不重做）

- **Fleet transport 堵点**：PR #4617 已于 2026-08-04T12:36:47Z 合并。`DEFAULT_REMOTE_BRIDGE_START_TIMEOUT_MS=120_000` 已上线。**此项 DONE，本 sprint 不接触。**

---

## 累积 FR

### FR-1：Trusted Artifact 流水线现状审计与缺口记录

**背景**：DEFINITION.md 中存在多处 artifact 相关机制（跨仓 approved-SHA contract artifacts、string artifact 规范化、服务端校验、SHA-256 manifest 绑定）。但代码层面未发现独立的 `trusted_artifact` 模块，相关逻辑分散在 orchestrator 子系统。

**当前状态（查代码确认）**：
- `packages/brain/src/` 中无独立 trusted artifact 模块
- artifact 校验逻辑内嵌于 Kernel orchestrator 各子组件（dispatcher、execution-contract.js）
- PR #4457 branch（`cp-kernel-phase5b-a1-review-fixes`）无法独立获取，分支约 494 commits ahead / 38 behind main，处于 Draft-OPEN 状态

**FR-1 交付物**：
- 在 Brain DB `journey_step_links` 格子账本中，为 F1 开发闭环的"artifact 可验证性"能力新建格子条目（cell_kind=capability），记录当前状态为"分散实现、无独立模块、无可执行 E2E 验收"
- 写入格子坐标：journey=`e6f803f2`，step=kernel-contract-a20，cell_kind=capability，cell_status=gray（纸面）
- **不修改 PR #4457 代码**（mutate_downstream_pr_allowed: false）

**验收断言**：
```sql
SELECT id, cell_kind, cell_status FROM journey_step_links
WHERE step_id IN (
  SELECT id FROM journey_steps WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
    AND name ILIKE '%kernel-contract-a20%'
) AND cell_kind = 'capability'
  AND assertion ILIKE '%artifact%';
-- 期望：返回至少 1 行，cell_status='gray'
```

---

### FR-2：PR #4457 工作映射到 journey_step_links 格子账本

**背景**：PR #4457 是 Kernel Harness 累积分支（Draft），包含 A2-0 原子行为等价合同（11 行为族 S0-S12，43 原子行为，446 探针）。其工作尚未映射到 Brain DB 的格子账本（`docs/current/KERNEL_HARNESS_MAP.md` 第四节已知缺口第 6 条：`journey_step_links` 格子最后写入早于封版拍板，未按 11 要素终版重灌）。

**FR-2 交付物**：将 PR #4457 代表的 A2-0 合同核心维度投影到 `journey_step_links`：

| 格子 | journey | step | cell_kind | 说明 |
|---|---|---|---|---|
| A2-0 schema | `e6f803f2` | kernel-contract | capability | regression-contract.yaml schema_valid=true |
| A2-0 proof | `e6f803f2` | kernel-contract | element | proof_complete=false，0/99 已证明 |
| cutover gate | `e6f803f2` | kernel-contract | element | atomic_cutover_ready=false，manual gate exits 1 |
| 4 Draft 堵点 | `e6f803f2` | kernel-contract | scenario | 4 个堵点（rebase/测试失败/QuickCheck分类器/receipt v2）均处于 open |

投影操作通过 Brain API 写入，不修改 PR #4457 分支。

**验收断言**：
```sql
SELECT cell_kind, cell_status, COUNT(*) FROM journey_step_links
WHERE step_id IN (
  SELECT id FROM journey_steps WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
    AND name ILIKE '%kernel%'
) GROUP BY cell_kind, cell_status;
-- 期望：capability/gray 1行，element/gray 2行，scenario/gray 4行
```

---

### FR-3：journey_step 存在性保障（前置）

**背景**：FR-1/FR-2 的写入需要 `journey_steps` 表中存在 journey `e6f803f2` 的对应骨干步骤（kernel-contract 步骤）。若不存在，需先创建步骤条目。

**FR-3 交付物**：
- 检查 `journey_steps WHERE journey_id='e6f803f2-...'`
- 若缺失 kernel-contract 步骤，通过 Brain API 创建（不直接改 DB schema）
- 步骤元数据：name=kernel-contract-a20，description=A2-0 原子行为等价合同骨干步骤

---

## NFR

- **不修改 PR #4457 代码**：本 sprint 仅做账本写入，不触碰 cumulative branch
- **不重复 Fleet transport 工作**：PR #4617 已合并，跳过
- **Brain API 优先**：所有写入通过 `localhost:5221/api/brain/` 接口，不直接 psql 写入
- **格子状态保守**：当前 PR #4457 proof_complete=false，格子一律标 gray/纸面，不虚报 green
- **行数约束**：本文件 ≤ 160 行

---

journey_type: dev_pipeline
target_environment: brain_db_only
