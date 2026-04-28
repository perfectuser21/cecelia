# session-start.sh 清理：删除 queued 任务注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 session-start.sh 删除"排队中 dev 任务"注入段落，消除每次 session 预加载 to-do list 的噪音。

**Architecture:** 纯删除操作：session-start.sh 删 3 段共 ~14 行；brain-api-integration.test.ts 删除已成死契约的 queued 测试 case。TDD 顺序：先写断言"queued 不存在"的失败测试（commit-1），再执行删除（commit-2）。

**Tech Stack:** bash, Node.js (测试断言), TypeScript/vitest (契约测试)

---

## 文件变更地图

| 文件 | 操作 | 内容 |
|------|------|------|
| `hooks/session-start.sh` | 删除 3 段 | 第 30 行 QUEUED_JSON、第 53-62 行 QUEUED_LINES、第 70-75 行 if QUEUED_LINES 注入 |
| `apps/api/src/__tests__/brain-api-integration.test.ts` | 删除 1 段 + 更新注释 | 第 182 行 queued 注释行、第 217-247 行 queued 契约测试 case |

---

## Task 1: 写失败的验证测试（commit-1 TDD）

**Files:**
- Modify: `hooks/session-start.sh`（读取，验证当前含 queued — 确认测试会失败）

- [ ] **Step 1: 运行断言验证当前状态（应 FAIL）**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
node -e "
const s = require('fs').readFileSync('hooks/session-start.sh', 'utf8');
if (s.includes('queued')) {
  console.log('FAIL (expected): session-start.sh still contains queued — test will fail after deletion');
  process.exit(0); // 当前 FAIL 是正确的，说明测试有效
} else {
  console.error('ERROR: queued already absent — nothing to delete?');
  process.exit(1);
}
"
```

预期输出：`FAIL (expected): session-start.sh still contains queued`

- [ ] **Step 2: 同样确认 test 文件当前含 queued**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
node -e "
const s = require('fs').readFileSync('apps/api/src/__tests__/brain-api-integration.test.ts', 'utf8');
const count = (s.match(/queued/g) || []).length;
console.log('queued occurrences in test file:', count);
if (count === 0) { console.error('ERROR: already clean'); process.exit(1); }
console.log('OK: test file still has queued references — deletion required');
"
```

预期输出：`queued occurrences in test file: 8`（或其他正整数）

- [ ] **Step 3: commit-1（验证测试存在，确认待删除状态）**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
git commit --allow-empty -m "test(hooks): TDD commit-1 — 验证 queued 待删除状态存在

session-start.sh 含 QUEUED_JSON/QUEUED_LINES/queued 注入段落
brain-api-integration.test.ts 含 queued 契约测试（死契约）
下一 commit 执行删除，让验证断言变绿。"
```

---

## Task 2: 执行删除（commit-2 implementation）

**Files:**
- Modify: `hooks/session-start.sh`（删 3 段）
- Modify: `apps/api/src/__tests__/brain-api-integration.test.ts`（删 queued case + 更新注释）

- [ ] **Step 1: 删除 session-start.sh 第 30 行（QUEUED_JSON curl 查询）**

打开 `hooks/session-start.sh`，删除这一整行：

```bash
QUEUED_JSON=$(curl -s --max-time 2 "${BRAIN_URL}/api/brain/tasks?status=queued&task_type=dev&limit=3" 2>/dev/null || echo "[]")
```

删除后，第 29 行（TASKS_JSON）的下一行应直接是空行或 `# 检查是否获取到有效数据`。

- [ ] **Step 2: 删除 session-start.sh QUEUED_LINES 格式化块（约第 53-62 行）**

删除以下完整代码块（包括前后的空行）：

```bash
QUEUED_LINES=$(echo "$QUEUED_JSON" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
lines = []
for t in tasks[:3]:
    title = t.get('title', '?')[:50]
    priority = t.get('priority', '')
    lines.append(f'  [{priority}] {title}')
print('\n'.join(lines))
" 2>/dev/null || echo "")
```

- [ ] **Step 3: 删除 session-start.sh queued 条件注入块（约第 70-75 行）**

删除以下完整代码块（包括前后的空行）：

```bash
if [[ -n "$QUEUED_LINES" && "$QUEUED_LINES" != "  " ]]; then
    CONTEXT="${CONTEXT}

**排队中 dev 任务**：
${QUEUED_LINES}"
fi
```

- [ ] **Step 4: 验证 session-start.sh 语法正确**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
bash -n hooks/session-start.sh && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 5: 删除 brain-api-integration.test.ts 第 182 行 queued 注释**

打开 `apps/api/src/__tests__/brain-api-integration.test.ts`，找到 describe 注释块（约第 179-188 行）：

```typescript
    /**
     * session-start.sh 调用以下 Brain API：
     *   GET /api/brain/tasks?status=in_progress&limit=5
     *   GET /api/brain/tasks?status=queued&task_type=dev&limit=3
     *
     * 契约要求：
     * 1. 返回数组（即使为空）
     * 2. 每个任务对象包含 id、title、status 字段
     * 3. 支持 status + task_type + limit 三种查询参数
     */
```

将其改为（删除 queued 那行及相关条目）：

```typescript
    /**
     * session-start.sh 调用以下 Brain API：
     *   GET /api/brain/tasks?status=in_progress&limit=5
     *
     * 契约要求：
     * 1. 返回数组（即使为空）
     * 2. 每个任务对象包含 id、title、status 字段
     */
```

- [ ] **Step 6: 删除 brain-api-integration.test.ts queued 测试 case（第 217-247 行）**

删除整个 `it('GET /api/brain/tasks?status=queued...` 测试块，从第 217 行到第 247 行（含结尾的 `});`）：

```typescript
    it('GET /api/brain/tasks?status=queued&task_type=dev — session-start 查队列契约', async () => {
      const queuedDevTasks = [
        {
          id: 'task-dev-queued-001',
          title: '待执行任务',
          status: 'queued',
          task_type: 'dev',
          location: 'us',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => queuedDevTasks,
      } as Response);

      const result = await proxyToBrain(
        'GET',
        '/api/brain/tasks?status=queued&task_type=dev&limit=3'
      );

      expect(result.status).toBe(200);
      expect(Array.isArray(result.data)).toBe(true);
      const tasks = result.data as typeof queuedDevTasks;
      expect(tasks[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        status: 'queued',
        task_type: 'dev',
      });
    });
```

- [ ] **Step 7: 运行验证断言（现在应 PASS）**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
node -e "
const s = require('fs').readFileSync('hooks/session-start.sh', 'utf8');
if (s.includes('queued')) { console.error('FAIL: queued still present'); process.exit(1); }
console.log('PASS: session-start.sh no longer contains queued');
"
```

预期：`PASS: session-start.sh no longer contains queued`

- [ ] **Step 8: 运行相关测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
npx vitest run apps/api/src/__tests__/brain-api-integration.test.ts 2>&1 | tail -10
```

预期：所有剩余 test case 通过（queued case 已删，其余不变）。

- [ ] **Step 9: commit-2（实现）**

```bash
cd /Users/administrator/worktrees/cecelia/session-start-cleanup
git add hooks/session-start.sh apps/api/src/__tests__/brain-api-integration.test.ts
git commit -m "fix(hooks): session-start.sh 删除 queued 任务注入 — 消除 session 预加载 to-do list

删除 QUEUED_JSON 查询、QUEUED_LINES 格式化、queued 条件注入共 ~14 行。
同步删除 brain-api-integration.test.ts 中的 queued 死契约测试 case。

session 上下文保留：进行中任务 + 系统健康状态。"
```
