# Sprint PRD — [W29] Walking Skeleton P1 终验

## OKR 对齐

- **对应 KR**：KR-Walking Skeleton（Brain 调度可信度基线）
- **当前进度**：P1 7 项 bug 修复（B1–B7）已全部合并到 main，每项有独立 smoke 脚本
- **本次推进预期**：从"单项 smoke 全绿"推进到"端到端 Golden Path 全绿"，作为 P1 阶段的终验闭环；推进进度至 100%（P1 关账）

## 背景

Walking Skeleton P1 修了 7 个 dispatch→execute→report→settle 全链路 bug：

| Bug | PR | 修的洞 |
|-----|----|----|
| B1 | #2903 | reportNode 不回写 tasks.status，任务永远停在 in_progress |
| B2 | #2905 | hang 住的 in_progress 没人清，占 slot 永远 |
| B3 | #2909 | slot accounting 跟 in_progress 数量漂移 |
| B4 | — | guidance 投递 stale decision 误导调度 |
| B5 | #2911 | dispatcher HOL blocking：队首派不出整个队列卡住 |
| B6 | #2904 | dispatch_events 表没真写，诊断断盲 |
| B7 | — | fleet heartbeat 误判 worker 在线 |

每个 bug 都有自己的 smoke 脚本（`packages/brain/scripts/smoke/*-smoke.sh`），单跑都绿。但**没有一条 e2e Golden Path** 把"投递 → 派发 → 扣 slot → 执行 → 回写 → 释放 slot → guidance 不毒化下一轮 → 异常路径有 reaper 兜底 → heartbeat 不误判"在同一次运行里全部串起来验证一遍。本次终验补的就是这个空缺：一条贯通的 e2e smoke，是 P1 关账的功能证据；同时也是 P2 阶段开工前的回归 baseline。

## Golden Path（核心场景）

**系统从 [一条测试任务被投递到 task queue] → 经过 [dispatcher 完成派发 → worker 执行回调 → reportNode 回写状态 → slot 释放 → guidance/heartbeat 无毒化] → 到达 [任务进入 terminal status (completed) 且全链路 invariant 全部满足]**

具体（一条整合 e2e smoke 脚本一次跑通，全部断言全绿才算终验通过）：

### 主路径（happy path — B1/B3/B5/B6 同时验）

1. **种子**：通过 Brain API 投递 1 条 type=walking_skeleton_1node 的测试 task 到 tasks 表（pending 状态）
2. **dispatch tick 触发**：dispatcher 选中该 task 派发
   - **invariant**：dispatch_events 表多 1 行 outcome=dispatched 的记录（B6 验）
   - **invariant**：slot 计数 in_progress +1，available 同步 -1（B3 验）
3. **worker callback**：测试 worker 在 5 s 内通过 callback API 回报 completed
4. **reportNode 处理**：
   - **invariant**：tasks.status 从 in_progress 变 completed，updated_at 刷新（B1 验）
   - **invariant**：task_events 表多 1 行 'task_completed' 事件
5. **slot 结算**：
   - **invariant**：slot 计数 in_progress -1，available +1（B3 验）

### 队列分支（B5 HOL skip 验）

6. **多任务投递**：再投 3 条 task（task_A、task_B、task_C），其中 task_A 故意构造成"无可派 worker"（例如指定一个不存在的 location）
7. **dispatch tick**：dispatcher 不应被 task_A 阻塞
   - **invariant**：task_B 或 task_C 被派发，dispatch_events 含跳过 task_A 的记录（outcome=skipped_hol 或等价）（B5 验）

### 异常分支（B2 zombie reaper 验）

8. **构造僵尸**：投递 1 条 task 并让它派发后**不发 callback**（worker 假死）
9. **过 zombie reaper 阈值（ZOMBIE_REAP_AGE_MIN）**：
   - **invariant**：reaper 跑后，该 task 状态从 in_progress 变 failed 并标 reaper_reaped=true（B2 验）
   - **invariant**：被它占的 slot 被释放，slot 计数回到正确值（B3 复验）

### Guidance/Heartbeat 防毒化分支（B4/B7 验）

10. **B4 guidance TTL**：构造 1 条超过 DECISION_TTL_MIN 的旧 decision 写入 guidance 表
    - **invariant**：consciousness-loop 调 getGuidance 时不返回该 stale decision，dispatcher 不被毒化
11. **B7 fleet heartbeat**：模拟 1 个 worker 最后 heartbeat 超过 HEARTBEAT_OFFLINE_GRACE_MIN
    - **invariant**：fleet-resource-cache 标记该 worker offline 且 offline_reason 非空、可读

### 出口（终验 PASS 信号）

12. **整合 smoke 退出码 0**，且所有上述 invariant 在脚本内被 `set -e` + 显式 `assert_*` 断言覆盖；任意一条 invariant 不满足都让脚本 exit 非 0。
13. 脚本最后打印 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`。

## Response Schema

> 本任务以**整合 smoke 脚本**为主，不增加新的 HTTP 端点；但 smoke 内会调用现有诊断端点 `GET /api/brain/dispatch/recent`（B6 引入），其响应字段名是 oracle 的一部分，需在此 codify。

### Endpoint: GET /api/brain/dispatch/recent

**Query Parameters**:
- `limit` (number-as-string, 可选, 默认 50): 返回最近多少条 dispatch event
- **禁用 query 名**: `count`/`n`/`size`/`max`/`top`/`recent`

**Success (HTTP 200)**:
```json
{
  "events": [
    {
      "id": <number>,
      "task_id": "<string-uuid>",
      "outcome": "<string-enum>",
      "worker_id": "<string-or-null>",
      "reason": "<string-or-null>",
      "created_at": "<string-ISO8601>"
    }
  ],
  "count": <number>
}
```
- 顶层 keys 必须**完全等于** `["events", "count"]`，不允许多余字段
- `events[].outcome` 必须是字面量枚举之一：`dispatched` / `skipped_hol` / `skipped_no_worker` / `failed`（其他值视为 schema 漂移）
- **禁用响应字段名**：`data`/`results`/`payload`/`response`/`list`/`records`/`history`

**Error (HTTP 500)**:
```json
{"error": "<string>"}
```
- 必有 `error` key；禁用 `message`/`msg`/`reason` 作顶层 error key

**Schema 完整性**：所有 7 个 P1 bug 涉及的现有诊断端点（如 `/api/brain/walking-skeleton-1node/status/:threadId`、heartbeat 查询接口）的响应 shape 在本次终验中**不允许任何变更**；smoke 脚本对这些端点的 jq 解析必须用现有 key 名，发现任何 key 漂移就 fail。

## 边界情况

- **测试 worker 不可用**：smoke 脚本必须能 spawn 一个轻量 worker（沿用 walking-skeleton-1node 的 alpine sibling container 思路），不依赖真实 fleet 接入；脚本顶部检查 docker 可用，否则 skip + exit 0 并打印明确 `SKIP: docker not available`（CI 上必须可用，本地无 docker 时不算 fail）
- **DB 状态污染**：smoke 开始前清理 tasks/dispatch_events/task_events 中本次测试 task_id 前缀的所有行，确保幂等可重跑
- **TTL/grace 阈值**：B4 DECISION_TTL_MIN 和 B7 HEARTBEAT_OFFLINE_GRACE_MIN 在测试时必须可通过环境变量覆盖（如 `DECISION_TTL_MIN=0.1` 让阈值变 6 秒），否则一次 smoke 跑十几分钟不可接受
- **并发**：本 smoke 不验并发派发；P1 范围内的 7 项 bug 已在各自 smoke 单测中覆盖并发场景，终验只验"全链路串通"，不重复并发覆盖
- **Brain 重启**：本终验**不包含** Brain kill/restart resilience（那是 walking-skeleton-1node-smoke.sh Phase 2 的职责，跟 P1 7 项 bug 无关），明确划出本次范围

## 范围限定

**在范围内**：
- 新增 1 个整合 smoke 脚本（建议位置 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`），串起 B1–B7 全部 invariant 在一次运行内验证
- smoke 接 CI：在 brain-ci.yml 增加一个 job（或 step）跑这条 smoke，阻塞 main 合并
- smoke 内打印每段 invariant 的 PASS/FAIL，便于断点定位
- 终验 PASS 后写 1 篇短报告（`sprints/w29-walking-skeleton-p1/acceptance-report.md`）汇总 7 项修复的证据 + smoke 输出片段，供下一阶段 P2 立项时引用

**不在范围内**：
- 不动 B1–B7 任何一项的实现代码（已合并，本次只验，不改）
- 不引入新的诊断端点（B6 的 `/dispatch/recent` 已经够用）
- 不动 walking-skeleton-1node graph 本身（与本 P1 批 7 项 bug 解耦）
- 不做性能 benchmark / 不验 throughput（终验目标是"功能闭环全绿"，不是性能）
- 不做 Brain restart 容灾测试（见边界情况说明）
- 不动 Dashboard / 任何前端代码
- 不动 ACTION_WHITELIST / 不动 LOCATION_MAP

## 假设

- [ASSUMPTION: 7 项 P1 修复在 main 上都已稳定，没有未发现的回归——本次终验若发现回归，按"发现即开新 bug"处理，不在本 W29 范围内修]
- [ASSUMPTION: docker 在 CI runner 上可用，alpine sibling container 模式可继续沿用]
- [ASSUMPTION: DECISION_TTL_MIN 和 HEARTBEAT_OFFLINE_GRACE_MIN 这两个阈值在 B4/B7 实现中已经做成可配（env 或 config）；若不是，需要 proposer 在合同 GAN 阶段评估是否允许小幅 patch 让其可测]
- [ASSUMPTION: `/api/brain/dispatch/recent` endpoint 响应 shape 与 PR #2904 实现一致；若有漂移，以代码为准 PRD 同步更新]
- [ASSUMPTION: 本 sprint 不需要新建数据库迁移；现有 schema (含 v270) 已经覆盖所有 invariant 所需字段]

## 预期受影响文件

- `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`（新建，整合 smoke）
- `.github/workflows/brain-ci.yml`（追加一个 step 跑上面这条 smoke）
- `sprints/w29-walking-skeleton-p1/acceptance-report.md`（新建，终验报告）
- `sprints/w29-walking-skeleton-p1/sprint-prd.md`（本文件）

## journey_type: autonomous
## journey_type_reason: 所有改动仅在 packages/brain/scripts/ + CI 配置，验证目标全部是 Brain 内部调度链路的不变量，不涉及 dashboard、不涉及 remote agent 协议、不涉及 dev pipeline hooks
