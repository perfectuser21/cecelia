# Sprint PRD — incidents-layer（刀5-小刀1）

task_id: c11cdec4-c845-447f-80da-9d528753be1d
sprint_dir: sprints/07151515-incidents-layer
journey_id: f5c82f8c-9650-401b-b1ab-8902940607ab
journey_type: local_api
target_environment: local_api
created: 2026-07-15

---

## 背景

探针红散落在 Bark / 飞书 / cecelia_events / tasks 四处，没有"一起事故一条记录"的归一实体。
后续开单（刀5b）/ 验尸（5c）/ 对账（5d）都没有统一挂点。
本刀建立 incidents 表 + reportIncident() 薄封装，作为整条 AI-Native 闭环的第一节骨架。

---

## Invariant 约束

- **I-1**：同一 fingerprint 第二次触发必须累加 recurrence_count，禁止新增记录（幂等去重）
- **I-2**：reportIncident() 调用不得阻塞现有探针主逻辑；失败只 warn，不抛出
- **I-3**：incidents 表必须包含字段：probe_id、fingerprint、severity、evidence（JSONB）、status、task_id（可空）、recurrence_count
- **I-4**：status 状态机：open → triaged → fixing → resolved → postmortem_done（只允许正向流转，不回退）
- **I-5**：migration 编号必须衔接现有最大序号（当前最大 011），使用 012-incidents.sql
- **I-6**：GET /api/brain/incidents 必须在现有路由文件中注册，不新建服务

---

## 累积 FR

- **FR-1**：migration `012-incidents.sql`：建 incidents 表，含 probe_id、fingerprint（唯一索引）、severity（enum: p0/p1/p2）、evidence（JSONB）、status（enum，default=open）、task_id（UUID 可空）、recurrence_count（int default=1）、created_at、updated_at
- **FR-2**：`packages/brain/src/incident-reporter.js`：导出 `reportIncident(probeId, fingerprint, severity, evidence)` — INSERT ON CONFLICT fingerprint DO UPDATE SET recurrence_count=recurrence_count+1, evidence=EXCLUDED.evidence, updated_at=NOW()
- **FR-3**：接入 launchd-patrol：在红触发路径（raise P1 之后）调用 reportIncident()，fingerprint = `launchd-patrol:${daemonName}`
- **FR-4**：接入心跳静默检测器（dept-heartbeat.js）：超时告警后调用 reportIncident()，fingerprint = `heartbeat-silent:${deptName}`
- **FR-5**：接入 circuit-breaker：OPEN 状态变更时调用 reportIncident()，fingerprint = `circuit-breaker-open:${workerKey}`
- **FR-6**：接入 assert-deploy-effect（assert-deploy-effect.js 或同等断言探针）：断言失败时调用 reportIncident()，fingerprint = `assert-deploy-effect:${effectKey}`
- **FR-7**：接入 smoke nightly（com.cecelia.smoke-nightly 红触发路径）：调用 reportIncident()，fingerprint = `smoke-nightly:${runId}`
- **FR-8**：`GET /api/brain/incidents` 端点：返回最近 50 条，按 updated_at DESC，字段含 id、probe_id、fingerprint、severity、status、task_id、recurrence_count、created_at、updated_at、evidence

---

## NFR

- **NFR-1**：reportIncident() 单次调用 P99 < 50ms（异步 pool.query，不等事务）
- **NFR-2**：CI 全绿（brain-ci.yml）；新增 vitest 单元测试覆盖幂等去重逻辑

---

## Final E2E 验收断言

1. `node packages/brain/src/db/migrate.js`（或等效命令）执行后，`\d incidents` 含上述全部字段
2. 手动调用 `reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', {detail:'test'})` → DB 查询 `SELECT * FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge'` 返回 1 行，evidence 非空
3. 同 fingerprint 再次调用 → 仍 1 行，recurrence_count=2
4. `curl localhost:5221/api/brain/incidents` → HTTP 200，body.incidents 含上述记录

---

## 实现边界

- 不改动现有探针的核心告警逻辑，仅追加 reportIncident() 调用
- incidents 表本轮不做 UI（由刀5b/5c 完成）
- task_id 字段本轮留空，由刀5b 开单时回填
