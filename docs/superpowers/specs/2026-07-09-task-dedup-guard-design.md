# task-tasks.js POST /tasks 补服务端去重护栏

## 背景

2026-07-09 当天实测发现 3 组任务被跨时间窗口独立重复点火（同一功能需求在不同时刻分别注册成新
task，各自走完 `/dev` 流程产出完全独立的 PR）：

1. `nightly-real-machine-staging` 在 00:00/16:22/17:00 三个独立时刻分别点火，产出 #3679/#3677/#3680
2. `skill-eval-4page` 在 16:22（两次）和 18:20 又点一次，#3676/#3675/#3683 前 4 个 commit 逐字节相同
3. `decomp-check合并` 在 16:22 同一分钟内被点两次火，#3672/#3673 内容相同

已关闭 5 个冗余 PR，登记 issue `655691d2`（P1）追踪根因。

根因排查确认：`packages/brain/src/routes/task-tasks.js` 的 `POST /` 路由（供 `/architect` Phase 5
和外部 agent 注册任务用的通用入口）**全程没有任何去重逻辑**，直接 `INSERT INTO tasks`。对比同代码库
`packages/brain/src/actions.js` 的 `createTask()`（第94-155行）早就有 title + goal_id/project_id
精确匹配 + 状态窗口的去重查询，`task-tasks.js` 这个路由是完全裸露的。

这比今天已经修复的两处更底层：
- `/dev` skill Phase 2.5（GitHub 撞车检查）——只在调用方走 `/dev` 交互流程时生效
- `/dev` skill Phase 0（--task-id 立即 claim）——同样是 skill 层客户端纪律

这两处都依赖"调用方老实走 `/dev` 流程"，绕过 skill 直接 curl 这个 API 的调用方（人工手滑/外部
agent/自动化脚本）完全不受这两道防线约束。本次要把去重下沉到 API 本身。

## 目标

`POST /api/brain/tasks` 在建任务前，检查是否已存在 title 完全相同、`goal_id`/`project_id` 相同、
且状态仍是 `queued`/`in_progress` 的任务；命中则返回已有任务（不新建），不命中才走原有 INSERT 逻辑。

## 设计

### 插入位置

在 `packages/brain/src/routes/task-tasks.js` 的 `POST /` handler 里，第131行"B51: harness_initiative
任务缺 journey_id"的 warning 判断之后、第133行 `INSERT INTO tasks` 之前，插入去重查询。

### 去重逻辑（仿 `actions.js` `createTask()` 模式）

```js
// C3: 服务端去重护栏（issue 655691d2）——title 精确匹配 + goal_id/project_id 一致
// + 仍是活跃状态，命中则直接返回已有任务，不重新 INSERT。
// 防止外部 agent/人工反复对同一意图重新注册 task（2026-07-09 实测 5 个重复 PR 的根因）。
const dedupResult = await pool.query(
  `SELECT id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, payload, created_at
   FROM tasks
   WHERE title = $1
     AND (goal_id IS NOT DISTINCT FROM $2)
     AND (project_id IS NOT DISTINCT FROM $3)
     AND status IN ('queued', 'in_progress')
   LIMIT 1`,
  [title.trim(), goal_id, project_id]
);
if (dedupResult.rows.length > 0) {
  return res.status(200).json({ ...dedupResult.rows[0], deduplicated: true });
}
```

`IS NOT DISTINCT FROM` 处理 `goal_id`/`project_id` 为 `null` 的情况（`actions.js` 已验证的写法，
`=` 运算符在 SQL 里 `NULL = NULL` 为 `NULL` 不是 `true`，必须用 `IS NOT DISTINCT FROM`）。

### 响应格式

命中去重返回 `200`（不是 `409`），带 `deduplicated: true` 标记——与 `actions.js` 的
`{ success: true, task: existing, deduplicated: true }` 语义一致（软去重，不是硬拒绝），调用方
可以直接读返回的任务 id 继续用，不需要额外错误处理分支。

## 非目标（已知不完整，本次不做）

- **语义/模糊匹配**：只做精确 title 匹配。2026-07-09 实测的 3 组重复里，部分标题文案彼此不完全
  一致（如"刀A: nightly-real-machine-staging..." vs "ROG 真机每晚回归闸"），精确匹配拦不住这类
  情况。更宽松的匹配需要语义相似度或人工维护关键词表，风险（误伤不同任务）和复杂度都更高，留作
  后续独立评估。
- **数据库层原子锁**：不加 unique constraint + `ON CONFLICT`。两个几乎同一毫秒的并发请求理论上
  仍可能都通过 SELECT 检查后各自 INSERT（TOCTOU 竞态）。2026-07-09 实测的重复案例都是分钟到
  小时级的独立重新点火，不是亚秒级并发，当前方案已覆盖真实发生过的场景；真正的原子锁需要 DB
  migration，超出本次"补去重逻辑"的最小范围。

## 测试策略

Unit test（`packages/brain/src/routes/__tests__/`，新文件，mock `pool.query`）：

1. 已存在同 title + 同 goal_id(null) + 同 project_id(null) + status=queued 的任务 → 返回 200 +
   `deduplicated: true`，且没有调用 INSERT（mock query 调用次数只有 1 次 SELECT）
2. 已存在同 title 但 status=completed（非 queued/in_progress）→ 正常走 INSERT，不去重
3. title 不同 → 正常走 INSERT，不去重
4. goal_id 不同（两者都非 null 但值不同）→ 正常走 INSERT，不去重
5. 现有 `task-tasks.js` 相关测试全部无回归

这是纯逻辑接缝（SQL 查询 + 条件分支），CI unit test 覆盖已经足够。

## 验收标准

- [ ] 新增 unit test（TDD：先写失败测试）
- [ ] 去重查询插入到位，命中返回已有任务不新建，未命中走原逻辑
- [ ] 全部新旧测试通过
- [ ] CI 全绿
