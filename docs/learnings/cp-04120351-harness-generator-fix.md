### 根本原因

Sprint Contract Test 3 需要向 tasks 表插入 `harness_generator` 类型的探针任务，但 DB check constraint（migration 222）只包含 `harness_generate`，不含 `harness_generator`，导致 INSERT 失败，进而 ALL_HARNESS = PLANNER_ONLY，强证伪条件无法满足，Evaluator 判定 FAIL。

### 下次预防

- [ ] 合同草案包含 DB INSERT probe 时，在 contract propose/review 阶段验证被插入的 task_type 是否在约束中存在
- [ ] 新增 harness_* task_type 前检查 migration 222（或最新）中的 ARRAY 列表，确保所用类型已注册
- [ ] migration 编号须与 selfcheck.js EXPECTED_SCHEMA_VERSION 同步更新（本次：231 → 232）
