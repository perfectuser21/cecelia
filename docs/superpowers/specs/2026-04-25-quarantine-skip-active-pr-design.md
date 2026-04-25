# Design — quarantine 识别有 PR 的 task 跳过拉黑（hasActivePr 第三个 guard）

## 背景

Harness v6 闭环验证发现 quarantine 过激问题：
- task `a930d4dd` 已产出 PR（`tasks.pr_url` 填充 + `pr_status='ci_pending'`）
- Brain tick 仍把它当 queued 重派 → quarantine 看到 `failure_count >= 5` → 拉黑
- shepherd 过滤 `status NOT IN ('quarantined')` 永远跳过该 task → PR 永远不 merge
- 死循环

PR #2576 已加两个守卫到 `handleTaskFailure`：
- `hasActiveCheckpoint(taskId)` — LangGraph checkpoints 表命中 → skip
- `hasActiveContainer(taskId)` — `docker ps` 命中 `cecelia-task-<12hex>` → skip

本任务加第三个并列守卫：`hasActivePr(taskId)` — task 表 `pr_url IS NOT NULL` 且 `pr_status IN ('open','ci_pending','merged')` → skip。

## 目标

`packages/brain/src/quarantine.js::handleTaskFailure` 在 active_container 守卫之后增 `hasActivePr` 预检。命中即返回 `{ quarantined:false, skipped_active:true, failure_count:0, reason:'active_pr' }`，不累加 failure_count、不进 quarantine。

## 设计

### 文件改动

**`packages/brain/src/quarantine.js`**

新增导出函数：
```js
async function hasActivePr(taskId) {
  try {
    const result = await pool.query(
      `SELECT pr_url, pr_status FROM tasks WHERE id = $1`,
      [taskId]
    );
    const r = result.rows[0];
    if (!r) return false;
    return r.pr_url != null && ['open', 'ci_pending', 'merged'].includes(r.pr_status);
  } catch (err) {
    console.warn(`[quarantine] hasActivePr query failed for ${taskId}: ${err.message}`);
    return false;
  }
}
```

`handleTaskFailure` 中，紧跟 `hasActiveContainer` 守卫之后插入：
```js
// 活跃信号守卫 (3/3)：task 表已有 PR 且处于 in-flight 状态（open/ci_pending/merged）
// → 说明本任务实质已产出 deliverable（PR 等 CI/合并），不应再拉黑导致 shepherd 永远跳过。
const hasPr = await hasActivePr(taskId);
if (hasPr) {
  console.log(`[quarantine] Task ${taskId} has active PR, skipping failure/quarantine`);
  return {
    quarantined: false,
    failure_count: 0,
    skipped_active: true,
    reason: 'active_pr',
  };
}
```

`hasActivePr` 加入 exports。

### 守卫顺序（按现有 pattern）
1. `hasActiveCheckpoint` — LangGraph 类
2. `hasActiveContainer` — Generator 容器类
3. `hasActivePr` — 已产出 PR 的任务（无论是否走 LangGraph）

每个守卫独立，命中即 short-circuit return。

### 测试文件

**`packages/brain/src/__tests__/quarantine-skip-active-pr.test.js`**

仿 `quarantine-skip-active-container.test.js` 结构：

1. `hasActivePr` 单元测试：
   - pr_url + pr_status='open' → true
   - pr_url + pr_status='ci_pending' → true
   - pr_url + pr_status='merged' → true
   - pr_url + pr_status='closed' → false（已关闭，可重派）
   - pr_url=NULL → false
   - 任务不存在 → false
   - DB 报错 → false（保守 fallback）

2. `handleTaskFailure` 集成测试：
   - 活跃 PR 命中 → quarantined:false, reason:'active_pr', failure_count:0；不调 UPDATE
   - 无 PR → 走原 failure 逻辑，failure_count 累加为 1
   - checkpoint 守卫优先（命中时不查 PR）
   - container 守卫优先（命中时不查 PR）

## 影响面

- 仅 `quarantine.js` + 一个新测试文件
- 无 schema 变更（pr_url/pr_status 字段已存在）
- 不影响其他 quarantine 路径（quarantineTask/releaseTask/checkSuspiciousInput 等）
- 不动现有两个守卫，纯加法

## 风险

- pr_status 取值范围：需确认 `'open' | 'ci_pending' | 'merged' | 'closed' | NULL`。仅命中前三个，其他状态走原逻辑（含 closed → 让 shepherd 重派合理）。
- 如果 task 在 `created` 阶段还没 PR（pr_url=NULL），守卫返回 false，不影响新任务。

## 成功标准

- [ARTIFACT] `quarantine.js` 新增 `hasActivePr` 函数（grep 验证）
- [ARTIFACT] `handleTaskFailure` 调用 `hasActivePr` 并 early return（grep `'active_pr'`）
- [BEHAVIOR] `cd packages/brain && npm test -- --run quarantine-skip-active-pr` 全绿
- [BEHAVIOR] 新增测试覆盖 hasActivePr 真值表 + handleTaskFailure 集成
