# Red Evidence — sprint 08052244-relay-5a4a7ef1

**Task ID**: `5a4a7ef1-461d-4c3a-b8f5-7ca8c5f638bc`

TDD Red baseline: 合同测试在格子未写入时全部断言失败（4/4 fail 已验证）

- B-1: `GET /journey_steps?journey_id=e6f803f2-...` 返回列表无 kernel 条目 → `ok` 抛出
- B-2: `GET /journey_step_links?cells=1&cell_kind=capability` 无 artifact 格子 → `ok` 抛出
- B-3: 无 a20 格子（count 0 < 4）→ `ok` 抛出
- B-4: 无 target 格子，前置断言失败 → `ok` 抛出

锚定日期: 2026-08-05
