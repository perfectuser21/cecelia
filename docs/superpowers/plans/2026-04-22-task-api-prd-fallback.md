# POST /api/brain/tasks prd 字段 fallback + 清 pre-flight 存量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** POST /api/brain/tasks 接受 `prd` 字段作为 description 第三层 fallback，migration 243 清 151 条 pre_flight_failed metadata 存量。

**Architecture:** 单行 JS fallback 扩展 + 幂等 SQL migration + 3 场景单测。总代码量 ~10 行改动 + ~20 行测试 + 1 SQL。

**Tech Stack:** Node.js + pg + vitest

---

## File Structure

| 文件 | 动作 |
|---|---|
| `packages/brain/src/routes/task-tasks.js` | Modify（destructure + 3 行 fallback） |
| `packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql` | Create |
| `packages/brain/src/__tests__/task-api-prd-fallback.test.js` | Create |
| `.dod` + `docs/learnings/cp-0422084553-task-api-prd-fallback.md` | Create |

---

## Task 1: prd fallback + migration + 测试（TDD 一轮）

**Files:**
- Modify: `packages/brain/src/routes/task-tasks.js` L29-56
- Create: `packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql`
- Create: `packages/brain/src/__tests__/task-api-prd-fallback.test.js`

- [ ] **Step 1.1: 写单测（TDD Red）**

新建 `packages/brain/src/__tests__/task-api-prd-fallback.test.js`：

```javascript
/**
 * task-api-prd-fallback.test.js
 *
 * 测试 POST /api/brain/tasks 的 description fallback 链：
 *   description > payload.prd_summary > prd
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

async function buildApp(capturedInserts) {
  // Mock pg pool：捕获 INSERT 的参数（$2 = description）
  const mockPool = {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('INSERT INTO tasks')) {
        capturedInserts.push({ sql, params });
        return { rows: [{ id: 'test-id', title: params[0], status: 'queued', task_type: params[3], priority: params[2] }] };
      }
      return { rows: [] };
    }),
  };

  vi.doMock('../db.js', () => ({ default: mockPool }));
  vi.resetModules();
  const router = (await import('../routes/task-tasks.js')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', router);
  return app;
}

describe('POST /api/brain/tasks — description fallback 3 层', () => {
  it('场景 1: prd 字段 fallback → description', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        prd: '这是通过 prd 字段传入的 PRD 内容，至少 20 字符。',
      });
    expect(res.status).toBe(201);
    expect(inserts.length).toBe(1);
    // INSERT $2 = description
    expect(inserts[0].params[1]).toContain('prd 字段传入');
  });

  it('场景 2: description 显式传入时优先于 prd', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        description: 'EXPLICIT_DESC',
        prd: 'SHOULD_NOT_WIN',
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('EXPLICIT_DESC');
  });

  it('场景 3: payload.prd_summary fallback 原路径无回归', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        payload: { prd_summary: 'FROM_PAYLOAD' },
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('FROM_PAYLOAD');
  });

  it('场景 4: prd_summary 优先于 prd（中间层优先）', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        payload: { prd_summary: 'WINS' },
        prd: 'LOSES',
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('WINS');
  });
});
```

- [ ] **Step 1.2: 跑测试确认红**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback/packages/brain
npx vitest run src/__tests__/task-api-prd-fallback.test.js --no-coverage 2>&1 | tail -12
```

**预期**：场景 1 fail（description 为 null 或空，`prd` 被 destructure 忽略），场景 2/3 可能绿（原逻辑已支持），场景 4 绿。

**若 supertest 未装**：查 `packages/brain/package.json` 确认。没装的话切换到直接测 handler（需要 router 内部结构改造，复杂）。supertest 普遍装了，这里假设有。

- [ ] **Step 1.3: 修 task-tasks.js**

Read 确认 L29-56 段。用 Edit 改两处：

**第 1 处：destructure 加 prd 字段**（L29-44 段）

`old_string`：
```javascript
    let {
      title,
      description = null,
      priority = 'P2',
      task_type = 'dev',
      project_id = null,
      area_id = null,
      goal_id = null,
      location = 'us',
      payload = null,
      metadata = null,
      trigger_source = 'auto',
      domain: domainInput = null,
      okr_initiative_id = null,
    } = req.body;
```

`new_string`：
```javascript
    let {
      title,
      description = null,
      prd = null,
      priority = 'P2',
      task_type = 'dev',
      project_id = null,
      area_id = null,
      goal_id = null,
      location = 'us',
      payload = null,
      metadata = null,
      trigger_source = 'auto',
      domain: domainInput = null,
      okr_initiative_id = null,
    } = req.body;
```

**第 2 处：C2 段 fallback 扩 3 层**（L50-56 段）

`old_string`：
```javascript
    // ─── C2: Schema normalize at entry point ────────────────────────
    // 1. PRD fallback: payload.prd_summary → description
    //    上游创建者（Brain scheduler / talk / 人工）把 PRD 写在不同字段。
    //    入口层统一收敛到 description，使 pre-flight 和下游消费者只看一个字段。
    if (!description && payload?.prd_summary) {
      description = payload.prd_summary;
    }
```

`new_string`：
```javascript
    // ─── C2: Schema normalize at entry point ────────────────────────
    // 1. PRD fallback: description > payload.prd_summary > prd
    //    上游创建者（Brain scheduler / talk / 人工 / 外部 API）把 PRD 写在不同字段。
    //    入口层统一收敛到 description，使 pre-flight 和下游消费者只看一个字段。
    //    优先级：显式 description > payload.prd_summary > 顶层 prd。
    if (!description && payload?.prd_summary) {
      description = payload.prd_summary;
    }
    if (!description && prd) {
      description = prd;
    }
```

- [ ] **Step 1.4: 跑测试确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback/packages/brain
npx vitest run src/__tests__/task-api-prd-fallback.test.js --no-coverage 2>&1 | tail -6
```

**预期**：4 passed。

- [ ] **Step 1.5: 建 migration 243**

新建 `packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql`：

```sql
-- 清理 pre_flight_failed metadata 标记，让 alertOnPreFlightFail 的 24h COUNT 降到 0。
-- 只移除 metadata 的 pre_flight_failed / failed_at 两个 key，保留 task 原 status/title/description
-- （审计痕迹保留，title/description 仍可用于人工排查）。
--
-- 幂等：已经没有这两个 key 的 task 不受影响（WHERE 过滤）。
--
-- 根因（由前置 PR 根治）：POST /api/brain/tasks 的 prd 字段 fallback 漏写，
-- 手工/Agent 注册 task 传 prd 被 destructure 丢弃 → description=null →
-- pre-flight 拒 → 24h 累积 ≥ 3 → P0 pre_flight_burst 飞书轰炸。
--
-- 本 migration 清理存量 ~151 条（实测：24h 内 21 条触发当前 P0 burst）。

UPDATE tasks
SET metadata = metadata - 'pre_flight_failed' - 'failed_at'
WHERE metadata->>'pre_flight_failed' = 'true';
```

- [ ] **Step 1.6: 手工跑 migration + 确认存量归零**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
echo "=== 跑前 ==="
psql cecelia -c "SELECT COUNT(*) FROM tasks WHERE metadata->>'pre_flight_failed' = 'true';"

echo "=== 执行 migration ==="
psql cecelia -f packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql

echo "=== 跑后 ==="
psql cecelia -c "SELECT COUNT(*) FROM tasks WHERE metadata->>'pre_flight_failed' = 'true';"
```

**预期**：跑前 = 151（或近似），跑后 = 0。

- [ ] **Step 1.7: smoke 测 prd 字段经过 API 真落 DB**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-prd-fallback","task_type":"dev","priority":"P2","prd":"smoke 测试 prd 字段 fallback 是否落到 description 字段，至少 20 字符。"}' \
  | python3 -m json.tool
echo "=== 查 DB ==="
psql cecelia -c "SELECT id, title, LEFT(description, 50) AS desc_head FROM tasks WHERE title = 'smoke-prd-fallback' ORDER BY created_at DESC LIMIT 1;"
echo "=== 清理 smoke task ==="
psql cecelia -c "DELETE FROM tasks WHERE title = 'smoke-prd-fallback';"
```

**预期**：DB 里 description 非空，含 "smoke 测试 prd 字段 fallback" 开头。

**注意**：Brain 现在是静默状态（BRAIN_MUTED runtime=true），smoke 不会发飞书。smoke task 创建后要立刻删掉，避免被 tick 派发跑。

- [ ] **Step 1.8: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
git add packages/brain/src/routes/task-tasks.js \
  packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql \
  packages/brain/src/__tests__/task-api-prd-fallback.test.js
git commit -m "fix(brain)[CONFIG]: POST /api/brain/tasks 加 prd 字段 fallback + 清 pre-flight 存量

C2 normalize 段 fallback 链从 2 层扩成 3 层：
  description > payload.prd_summary > prd

手工/Agent 注册 task 传 {title, prd} 时，prd 被 destructure 丢弃 →
description=null → pre-flight 拒 → 24h 累积 ≥ 3 → P0 pre_flight_burst
飞书告警风暴。本 fix 堵源头。

migration 243 清理 151 条存量 metadata.pre_flight_failed 标记
（保留 task status/title/description 审计痕迹）。

配套 4 场景单测：prd fallback / description 优先 / prd_summary 无回归 /
prd_summary 优先于 prd。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DoD + Learning

**Files:**
- Create: `.dod`
- Create: `docs/learnings/cp-0422084553-task-api-prd-fallback.md`

- [ ] **Step 2.1: 写 .dod（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
cat > .dod <<'DOD_EOF'
# DoD — task API prd fallback + 清 pre-flight 存量

- [x] [ARTIFACT] task-tasks.js destructure 含 prd + 3 层 fallback
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-tasks.js','utf8');if(!c.includes('prd = null')||!c.match(/!description && prd/))process.exit(1)"
- [x] [ARTIFACT] migration 243 新文件
      Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql')"
- [x] [BEHAVIOR] task-api-prd-fallback 4 场景单测绿
      Test: tests/brain/task-api-prd-fallback.test.js
- [x] [BEHAVIOR] migration 跑后 pre_flight_failed 存量 = 0
      Test: manual:psql cecelia -tAc "SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM tasks WHERE metadata->>'pre_flight_failed'='true'"
- [x] [ARTIFACT] 设计 + Learning 文档已提交
      Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-task-api-prd-fallback-design.md');require('fs').accessSync('docs/learnings/cp-0422084553-task-api-prd-fallback.md')"
DOD_EOF
cat .dod | head -3
```

- [ ] **Step 2.2: 写 Learning（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
mkdir -p docs/learnings
cat > docs/learnings/cp-0422084553-task-api-prd-fallback.md <<'LEARN_EOF'
# Learning — POST /api/brain/tasks prd 字段 fallback 漏

分支：cp-0422084553-task-api-prd-fallback
日期：2026-04-22
Task：fc6930db-6980-4763-b628-a3aed754d181
前置：#2509（arch-review 源头）+ #2511（runtime muted）+ #2513（Dashboard toggle）

## 背景

P0 pre_flight_burst 飞书轰炸在 PR #2509 后**仍然发生**。Alex 今天发现
夜里到早上一直在推送 "24h 内 21 个任务被 pre-flight 拒绝"。我昨晚
"解锁" plist env 时又忘了让 Alex 切 Dashboard toggle，所以 Brain
muted 回到 false 状态——飞书全程在发。

## 根本原因

PR #2509 只堵了 **arch-review task 源头**（daily-review-scheduler 写
payload.prd_summary），但 **POST /api/brain/tasks handler 本身漏写
prd 字段 fallback**。

当调用方传 `{title, prd}`（常见模式——Claude / Agent / 手工 curl 都
这么写）时，prd 字段被 destructure 丢弃，description=null → pre-flight
拒 → 累积 ≥ 3 条触发 P0 告警。

实测存量：24h 内 21 条（多数是我自己 `curl POST /api/brain/tasks -d '{"title":...,"prd":...}'` 注册的 dev task）。

## 本次解法

两件事一起：

1. **堵源头**：task-tasks.js C2 normalize 段 fallback 链从 2 层扩
   成 3 层（description > payload.prd_summary > prd）。destructure 加
   prd 字段。不改 API 公开契约，只是接受更多输入形式。

2. **清存量**：migration 243 移除 `metadata.pre_flight_failed` 和
   `metadata.failed_at` 两个 key（幂等）。保留 task 原 status/title/
   description 作审计痕迹。清完后 alertOnPreFlightFail 的 24h COUNT
   自然降到 0，P0 告警不再被持续触发。

## 设计决策

**为什么 migration 只清 metadata 不改 status**：
- status='failed' 可能有其他原因（不只 pre-flight）
- 误改 status 会让 Brain 的其他监控（比如 zombie-cleaner）产生副作用
- metadata.pre_flight_failed 是**单一信号**——只服务 alertOnPreFlightFail 的 24h COUNT。清它 = 清那个告警的输入，不碰别的

**为什么不在 INSERT handler 做更激进的 PRD 收敛**：
- 保持 fallback 链清晰（3 层顺序反映调用方约定的优先级）
- 不主动把 prd 存进 payload（保持 payload 语义单纯）
- 兼容未来：如果调用方想同时传 description 和 prd，description 优先

### 下次预防

- [ ] 新加 API 字段时必须同步更新 destructure（不然 req.body 里的
      字段会被 express 丢弃）
- [ ] Pre-flight-check 的 fallback 链任何变更（增删字段）必须同步
      task-tasks.js 的 C2 段（两处要对齐）
- [ ] 任何引入"DB 副作用标记"（如 metadata.pre_flight_failed）的
      功能必须同时提供**清理 migration** 或 GC 策略，否则存量永远堆积
- [ ] "解锁" plist env 后必须提醒用户去 Dashboard 确认开关状态
      （避免默认值让系统回到未预期状态）

## 下一步

- 本 PR 合并后，跑 migration 243 → 存量清零
- Alex 可继续让 BRAIN_MUTED=true（runtime），或 toggle 到 false
  观察不再有 pre_flight_burst
- 更深层的 alerting.js P0 限流持久化（in-memory Map → DB）是另一个
  独立 PR（runtime muted 已挡住，不急）
LEARN_EOF
ls -la docs/learnings/cp-0422084553-task-api-prd-fallback.md
```

- [ ] **Step 2.3: 全量 DoD 验证**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-tasks.js','utf8');if(!c.includes('prd = null')||!c.match(/!description && prd/))process.exit(1);console.log('fallback OK')" && \
  node -e "require('fs').accessSync('packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql');console.log('migration OK')" && \
  node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-task-api-prd-fallback-design.md');require('fs').accessSync('docs/learnings/cp-0422084553-task-api-prd-fallback.md');console.log('docs OK')" && \
  cd packages/brain && \
  npx vitest run src/__tests__/task-api-prd-fallback.test.js --no-coverage 2>&1 | tail -5 && \
  echo "=== migration 已跑后存量 check ===" && \
  psql cecelia -tAc "SELECT COUNT(*) FROM tasks WHERE metadata->>'pre_flight_failed'='true';"
```

**预期**：3 artifact OK + 4 passed + count=0。

- [ ] **Step 2.4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/task-api-prd-fallback
git add .dod docs/learnings/cp-0422084553-task-api-prd-fallback.md
git commit -m "docs[CONFIG]: DoD + Learning for task API prd fallback

5 条 DoD 全勾选。Learning 记录：#2509 只堵 arch-review 源头没堵
task-tasks POST handler 本身 → 手工/Agent 注册 task 持续被拒 →
pre_flight_burst 风暴 + 4 条系统级预防规则（API 字段同步 / fallback
一致性 / 副作用标记必带清理策略 / 解锁 env 后提醒用户）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] **Spec 覆盖**：fallback 扩展 + migration 243 + 4 场景单测（T1）+ DoD/Learning（T2）
- [x] **Placeholder 扫描**：无 TBD；所有 SQL/JS 完整可执行
- [x] **Type 一致性**：`prd` 字段名、`metadata.pre_flight_failed`、`243_clear_pre_flight_rejected_backlog` 文件名全文一致
- [x] **Brain 无 engine 改动**：不需要 engine 三要素
- [x] **Migration 幂等**：`WHERE metadata->>'pre_flight_failed'='true'` 过滤 + `-` 操作符，跑多次结果一样
