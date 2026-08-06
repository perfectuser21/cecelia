# Sprint PRD — headed-smoke-test（relay 链路冒烟：smoke-artifact 落地）

## OKR 对齐

- **对应 KR**：O「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（headed 派发链路可信度验证）
- **当前进度**：82%
- **本次推进预期**：+0%（冒烟不推进业务 KR，只验证 relay 派发链路本身连通）

## 背景

Brain 以 headed 模式（payload.mode=headed，orchestrator=skill-relay）派发本任务，payload 无 thin_prd/prep_prd_body——这是 smoke 任务特性。目的：验证「派发 → planner → 后续 relay 各棒」端到端连通，产出一个最小可断言工件即可，不发明业务功能。冒烟锚点为 payload.smoke_tag 字面值 `claude-headed-dispatch-local-31156-4267`。

## Golden Path（核心场景）

系统从 [Brain headed 派发] → 经过 [relay 各棒在 sprint 目录落最小工件] → 到达 [工件可被机械断言，run 走完]

具体：
1. [触发条件] Brain 派发 task b30fe42b（mode=headed，smoke_tag=claude-headed-dispatch-local-31156-4267）
2. [系统处理] 后续棒在 `sprints/08061902-relay-b30fe42b/` 目录写入最小工件 `smoke-artifact.json`，内容包含三个字段：`task_id`（=b30fe42b-86c7-412e-9e05-eb08ac26488e）、`smoke_tag`（=claude-headed-dispatch-local-31156-4267 字面相等）、`mode`（="headed"）
3. [可观测结果] 用 jq 断言该文件存在且三字段字面相等即为冒烟通过；工件随分支 commit 留痕

## 边界情况

- 工件文件缺失或 JSON 不合法 → 冒烟 FAIL
- smoke_tag 字段与 payload 值不字面相等（含大小写/截断）→ 冒烟 FAIL
- 不涉及并发/网络异常场景（本地文件断言，范围外）

## 范围限定

**在范围内**：在 sprint 目录落 `smoke-artifact.json` 一个最小可断言工件；jq 三字段断言。
**不在范围内**：任何 packages/brain、packages/engine、apps/* 代码改动；任何新 API/端点；数据库写入；UI；部署。

## 假设

- [ASSUMPTION: payload 无 thin_prd 属 smoke 任务预期形态，scope 由 smoke_tag + mode 锚定为"最小可断言工件"，不视为缺上下文]
- [ASSUMPTION: 工件放 sprint 目录内即可，无需进入任何产品代码路径]

## 预期受影响文件

- `sprints/08061902-relay-b30fe42b/smoke-artifact.json`: 本 sprint 唯一交付工件（新增）
- `sprints/08061902-relay-b30fe42b/sprint-prd.md`: 本文件

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；step/feature 两级均为空 -->
- NFR: N/A（smoke 任务，step/journey_feature 级 NFR decisions 均为空，PrepPRD 缺省）
- 可观测: 工件随 git commit 留痕，断言脚本落会话独享路径（不占用共享 /tmp 固定文件名）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 级为空，以下均为 area 级 -->
- [进程兜底] watchdog 对「从未启动的进程」必须走 never_started 分类兜底，且不覆盖已有 error_message/failure_class（来源: area）
- [phase回写] relay 单 session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run（来源: area）
- [冲突先解] PR 处于 CONFLICTING 状态时 GitHub 静默不触发 CI：先 merge main 解冲突再等 CI，不得空等（来源: area）
- [建单查重] capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重，同根因已有 open 任务时合并而非裂变新单（来源: area）
- [自指排除] 守卫/探针自产数据用共享常量前缀标记并在统计侧排除，防自指计数污染（来源: area）
- [日历窗口] 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防漂移重复计账/漏计（来源: area）
- [独享路径] evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
- [结构核查] 触发条件窄、真实端到端验证成本高的路径，可用结构性 source-code inspection（零 mock）+ 同机制旁证（来源: area）
- [DB同源] 冒烟/校验类脚本涉及数据库连接时，写入侧与校验侧 DB_NAME 必须来自同一变量/同一解析逻辑（来源: area）
- [核对列名] 涉及 agents 表字段的合同/测试起草前先 psql 核对真实列名，不凭经验假设（来源: area）
- [枚举复查] 测试里 status 枚举硬编码断言，新增状态值时做全仓库 grep 复查（来源: area）
- [安全重跑] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查后从头重跑是安全恢复路径（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿占位；最终可执行脚本由 proposer 按 target_environment=local_api 产出。

```bash
# 占位：proposer 将填入真实脚本（local_api → 本地文件 + jq 断言，无需 curl/psql）
# 期望验收点（自然语言）：sprints/08061902-relay-b30fe42b/smoke-artifact.json 存在、为合法 JSON，
# 且 task_id / smoke_tag / mode 三字段与 task payload 字面相等
# （smoke_tag == "claude-headed-dispatch-local-31156-4267"，mode == "headed"）
```

## journey_type: autonomous
## journey_type_reason: 无 UI/agent 协议/engine 路径线索，纯后台派发链路冒烟，按默认链命中 autonomous
## target_environment: local_api
## target_environment_reason: 工件与断言均在本地 sprint 目录完成（localhost，evaluator 本地 jq），无 playground/前端/远端机器
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
