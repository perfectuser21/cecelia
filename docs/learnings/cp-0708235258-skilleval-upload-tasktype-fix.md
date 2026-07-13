## 修复 skill-eval upload 建 tasks 行列名错误(2026-07-08)

### 根本原因
`routes/eval.js` 的 `POST /api/skill-eval/upload` 插入 `tasks` 表时写的是 `INSERT INTO tasks (id, type, ...)`，但 `tasks` 表实际列名是 `task_type`（`type` 列根本不存在）。这个错误自该路由合并以来从未被发现，因为：
1. 现有单测（`eval.test.js`）把 `db.js` 整个 mock 掉，mock 的 `pool.query` 不校验真实表结构，任何 SQL 字符串都能"通过"。
2. 没有任何真实调用（无论是自动化测试还是人工验证）真正打到过这个接口，`skill_evals` 表因此长期 0 行，掩盖了这个问题。
3. 即便列名修正，`task_type` 值 `'skill_eval'` 也不在 `tasks_task_type_check` 的枚举白名单里，需要一并新增迁移。

### 下次预防
- [ ] 任何"上传/写入类"接口在合并前，至少手动真实调用一次（哪怕是本地 curl），不能只靠 mock 单测通过就认为"能用"——mock 测试对列名/约束错误完全不设防。
- [ ] 涉及真实 SQL INSERT/UPDATE 的路由，配一个不 mock db.js 的真库集成测试（本仓库已有 `__tests__/integration/*.integration.test.js` 约定目录，跟随即可），至少覆盖一次成功路径。
- [ ] 修改/新增 `tasks.task_type` 枚举值前，先用 `pg_get_constraintdef` 核对真实约束当前的完整列表，不要从某个历史 migration 文件里抄"看起来最新"的版本——本仓库该约束已被 30+ 次 migration 累积追加，随便抄一个旧版本容易漏掉后续加的值（本次漏了 `harness_intervention`/`staging_e2e`，靠 diff 校验才发现）。
