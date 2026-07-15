# Contract DoD — incidents-layer（刀5-小刀1）

task_id: c11cdec4-c845-447f-80da-9d528753be1d
sprint_dir: sprints/07151515-incidents-layer
contract_round: 1
created: 2026-07-15

---

## Invariant 覆盖

| Invariant | 约束内容 |
|-----------|---------|
| I-4 | status 状态机单向流转：open → triaged → fixing → resolved → postmortem_done，不可逆转 |
| I-5 | migration 编号为 012（衔接现有最大编号 011），文件名 `012-incidents.sql` |
| I-6 | GET /api/brain/incidents 端点必须注册在现有路由文件（packages/brain/src/server.js 或同级路由文件）中 |

---

## [BEHAVIOR] 条目

### [BEHAVIOR] 1. 迁移脚本建表，字段完整

**描述**：执行 `012-incidents.sql` 后，incidents 表存在且含 PRD I-3 规定的全部字段  
**类型**：DB schema  
**验收命令**（manual:bash）：
```bash
node packages/brain/src/db/migrate.js && \
psql $DATABASE_URL -c "\d incidents" | grep -E "probe_id|fingerprint|severity|evidence|status|task_id|recurrence_count|created_at|updated_at"
```
**期望**：每个字段名均出现在输出中（共 9 行以上）

---

### [BEHAVIOR] 2. reportIncident() 首次调用插入记录，evidence 非空

**描述**：reportIncident() 首次调用时向 incidents 表插入 1 行，recurrence_count=1，evidence 为传入的 JSONB  
**类型**：DB write + 幂等基准  
**验收命令**（manual:bash）：
```bash
node -e "
const { reportIncident } = require('./packages/brain/src/incident-reporter.js');
reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'test' })
  .then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" && \
psql $DATABASE_URL -c "SELECT recurrence_count, evidence FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge';"
```
**期望**：返回 1 行，recurrence_count=1，evidence 含 `{"detail":"test"}`

---

### [BEHAVIOR] 3. 同 fingerprint 再次调用累加 recurrence_count，不新增行

**描述**：同一 fingerprint 第二次调用 reportIncident() 后，表中仍只有 1 行，recurrence_count=2  
**类型**：幂等去重（I-1 核心约束）  
**验收命令**（manual:bash）：
```bash
node -e "
const { reportIncident } = require('./packages/brain/src/incident-reporter.js');
reportIncident('launchd-patrol', 'launchd-patrol:com.cecelia.bridge', 'p1', { detail: 'test2' })
  .then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
" && \
psql $DATABASE_URL -c "SELECT COUNT(*) as cnt, MAX(recurrence_count) as rc FROM incidents WHERE fingerprint='launchd-patrol:com.cecelia.bridge';"
```
**期望**：cnt=1，rc=2

---

### [BEHAVIOR] 4. GET /api/brain/incidents 返回 HTTP 200 含 incidents 数组

**描述**：GET /api/brain/incidents 端点返回最近 50 条记录，含所有规定字段  
**类型**：REST API  
**验收命令**（manual:bash）：
```bash
curl -sf localhost:5221/api/brain/incidents | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const inc = d.incidents;
if (!Array.isArray(inc)) throw new Error('incidents not array');
const r = inc.find(x => x.fingerprint === 'launchd-patrol:com.cecelia.bridge');
if (!r) throw new Error('record not found');
const required = ['id','probe_id','fingerprint','severity','status','task_id','recurrence_count','created_at','updated_at','evidence'];
for (const f of required) if (!(f in r)) throw new Error('missing field: '+f);
console.log('PASS');
"
```
**期望**：输出 `PASS`

---

### [BEHAVIOR] 5. reportIncident() 失败不抛出，不阻塞调用方

**描述**：DB 不可达时 reportIncident() 只 warn，不 throw，调用方 Promise 正常 resolve  
**类型**：非阻塞容错（I-2 约束）  
**验收命令**（manual:bash）：
```bash
node -e "
process.env.DATABASE_URL = 'postgresql://invalid:5432/none';
const { reportIncident } = require('./packages/brain/src/incident-reporter.js');
reportIncident('test', 'test:x', 'p2', {}).then(() => { console.log('PASS'); process.exit(0); });
"
```
**期望**：输出 `PASS`（不崩溃），stderr 含 warn 日志

---

### [BEHAVIOR] 6. launchd-patrol 红触发路径调用 reportIncident()

**描述**：launchd-patrol 在 P1 触发后调用 reportIncident()，fingerprint 格式为 `launchd-patrol:${daemonName}`  
**类型**：探针接入  
**验收命令**（manual:bash）：
```bash
grep -n "reportIncident" packages/brain/src/launchd-patrol.js
```
**期望**：输出至少 1 行，且含 `launchd-patrol:` 字符串（fingerprint 格式正确）

---

### [BEHAVIOR] 7. dept-heartbeat 超时告警后调用 reportIncident()

**描述**：dept-heartbeat.js 在超时告警后调用 reportIncident()，fingerprint = `heartbeat-silent:${deptName}`  
**类型**：探针接入  
**验收命令**（manual:bash）：
```bash
grep -n "reportIncident" packages/brain/src/dept-heartbeat.js
```
**期望**：输出至少 1 行，且含 `heartbeat-silent:` 字符串

---

### [BEHAVIOR] 8. circuit-breaker OPEN 时调用 reportIncident()

**描述**：circuit-breaker.js 在状态变为 OPEN 时调用 reportIncident()，fingerprint = `circuit-breaker-open:${workerKey}`  
**类型**：探针接入  
**验收命令**（manual:bash）：
```bash
grep -n "reportIncident" packages/brain/src/circuit-breaker.js
```
**期望**：输出至少 1 行，且含 `circuit-breaker-open:` 字符串

---

## 单元测试覆盖要求

- 幂等去重逻辑（INSERT ON CONFLICT）：vitest mock pool，断言第二次调用不 INSERT 新行
- 非阻塞容错：mock pool.query throw，断言 Promise resolve（不 reject）
- 端点返回格式：mock DB，断言 response.incidents 为数组

---

## CI 门槛

- brain-ci.yml 全绿
- vitest 新增测试通过
- migrate.js 无错退出
