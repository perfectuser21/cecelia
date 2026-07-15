# Contract Draft — incidents-layer（刀5-小刀1）

task_id: c11cdec4-c845-447f-80da-9d528753be1d
sprint_dir: sprints/07151515-incidents-layer
contract_round: 1
created: 2026-07-15

---

## 背景摘要

建立 incidents 表 + reportIncident() 薄封装，作为 AI-Native 闭环第一节骨架。
探针红散落在 Bark / 飞书 / cecelia_events / tasks 四处，本刀归一化为一条 incident 记录。

---

## 交付范围

| 编号 | 交付物 | 路径 |
|------|--------|------|
| D1 | DB 迁移脚本 | `packages/brain/src/db/migrations/012-incidents.sql` |
| D2 | incident-reporter 模块 | `packages/brain/src/incident-reporter.js` |
| D3 | launchd-patrol 接入 | `packages/brain/src/launchd-patrol.js`（追加调用） |
| D4 | dept-heartbeat 接入 | `packages/brain/src/dept-heartbeat.js`（追加调用） |
| D5 | circuit-breaker 接入 | `packages/brain/src/circuit-breaker.js`（追加调用） |
| D6 | assert-deploy-effect 接入 | 断言探针文件（追加调用） |
| D7 | smoke-nightly 接入 | 对应红触发路径（追加调用） |
| D8 | GET /api/brain/incidents 端点 | 注册到现有路由文件 |
| D9 | vitest 单元测试 | `sprints/07151515-incidents-layer/tests/` |

---

## Invariant 约束（不可协商）

- **I-1** 幂等去重：同一 fingerprint 第二次触发累加 recurrence_count，禁止新增行
- **I-2** 非阻塞：reportIncident() 失败只 warn，不抛出，不阻塞探针主逻辑
- **I-3** 字段完整：probe_id、fingerprint、severity、evidence（JSONB）、status、task_id（可空）、recurrence_count
- **I-4** 状态机单向：open → triaged → fixing → resolved → postmortem_done
- **I-5** 迁移编号：012-incidents.sql（衔接现有最大序号 011）
- **I-6** 路由注册：GET /api/brain/incidents 注册到现有路由文件，不新建服务

---

## E2E 验收

### 验收场景 A — 迁移后表结构正确
```bash
node packages/brain/src/db/migrate.js
# 验证：psql cecelia -c "\d incidents" 输出含全部字段
```
断言：`\d incidents` 含 probe_id、fingerprint、severity、evidence、status、task_id、recurrence_count、created_at、updated_at

### 验收场景 B — 首次插入
```bash
node -e "
const { reportIncident } = require('./packages/brain/src/incident-reporter.js');
reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'test' })
  .then(() => process.exit(0));
"
```
断言：
- `SELECT COUNT(*) FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge'` = 1
- `SELECT evidence FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge'` 非空

### 验收场景 C — 幂等去重（同 fingerprint 再次调用）
再次执行场景 B 相同调用  
断言：
- `SELECT COUNT(*) FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge'` 仍 = 1
- `SELECT recurrence_count FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge'` = 2

### 验收场景 D — REST 端点
```bash
curl -s localhost:5221/api/brain/incidents
```
断言：HTTP 200，response body 含 `incidents` 数组，其中包含 fingerprint=`launchd-patrol:com.cecelia.bridge` 的记录，字段含 id、probe_id、fingerprint、severity、status、task_id、recurrence_count、created_at、updated_at、evidence

---

## 不在范围内

- incidents 表的 UI（由刀5b/5c 完成）
- task_id 回填（由刀5b 开单时完成）
- 改动现有探针核心告警逻辑（只追加调用）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|------------|-----------|---------------|
| WS1 | `../../packages/brain/src/__tests__/incident-reporter.test.js` | 应执行 INSERT ON CONFLICT 语句 |
| WS2 | `../../packages/brain/src/__tests__/incident-reporter.test.js` | 两次调用各发一条 SQL |
| WS3 | `../../packages/brain/src/__tests__/incident-reporter.test.js` | DB 抛出异常时 Promise 应 resolve |
| WS4 | `../../packages/brain/src/routes/__tests__/incidents.test.js` | 应返回 HTTP 200 |
| WS5 | `../../packages/brain/src/routes/__tests__/incidents.test.js` | response body 应含 incidents 数组 |
| WS6 | `../../tests/regression/incidents-layer/probe-integration.test.js` | launchd-patrol.js 应包含 reportIncident 调用 |
| WS7 | `../../tests/regression/incidents-layer/probe-integration.test.js` | dept-heartbeat.js 应包含 reportIncident 调用 |
| WS8 | `../../tests/regression/incidents-layer/probe-integration.test.js` | circuit-breaker.js 应包含 reportIncident 调用 |
