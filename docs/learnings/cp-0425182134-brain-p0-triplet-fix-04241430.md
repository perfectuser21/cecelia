# Brain P0 三联修 Learning

## 根本原因

1. **cleanupStaleClaims SQL 用 `int[]` 强转 UUID 数组**
   `tasks.id` 是 UUID 列，`WHERE id = ANY($1::int[])` 在 PostgreSQL 启动期 100% 抛 `operator does not exist: uuid = integer`。
   stale claim 永不释放，每次重启累积，dispatcher 选 task 用 `WHERE claimed_by IS NULL` 永远跳过这些任务，形成死锁。

2. **shepherd ci_passed 状态机断链**
   - `ci_passed + MERGEABLE` 分支 `executeMerge()` 后只 UPDATE `pr_status='ci_passed'`，从不读 PR 最新 state。
   - 主 SELECT WHERE 又只查 `pr_status IN ('open','ci_pending')`，不含 `'ci_passed'`。
   两者叠加：squash merge 后 PR 实际已 MERGED，但 task 永远停在 `pr_status='ci_passed' / status='in_progress'`。KR 进度链断。

3. **quarantine.hasActivePr 白名单漏 'ci_passed'**
   `hasActivePr` 只识别 `['open','ci_pending','merged']`。
   ci_passed 阶段 failure_count 累计可被误判 quarantine，shepherd `status NOT IN ('quarantined')` 永远跳过 → quarantined→queued 振荡死循环。

## 下次预防

- [ ] DB schema 改 UUID 后，全局 grep `::int\[\]` cast，单元测试断言 SQL 文本含 `uuid[]`。
- [ ] 状态机字段值改动同步审计：shepherd 写入的任意 pr_status 值必须出现在
  - `shepherd.shepherdOpenPRs` 主 SELECT WHERE
  - `quarantine.hasActivePr` 白名单
  一处加，全链路加。
- [ ] auto-merge 后必须 reload PR state，单纯 UPDATE pr_status='ci_passed' 不能算闭环。
- [ ] CI 加 SQL 类型 lint：`grep -nE "id = ANY\(.*::int\[\]\)" packages/brain/src/*.js` 应为 0。
- [ ] Brain 启动 log 含 "operator does not exist" 视为 P0 告警，需要 self-check 自动报警。
