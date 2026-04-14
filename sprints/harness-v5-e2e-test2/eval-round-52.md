# Eval Round 52 — Feature 1: Health 端点 active_pipelines

**日期**: 2026-04-12T17:47+08:00 (UTC+8: 01:47)
**evaluator**: claude-opus-4-6
**contract_branch**: cp-harness-contract-66540294

---

## 部署状态

- Brain: ✅ 运行中（localhost:5221，uptime=2671s）
- 无需重启，服务已包含 active_pipelines 功能

---

## 测试结果

| Test | 描述 | 结果 | 详情 |
|------|------|------|------|
| Test 1 | active_pipelines 字段存在且为非负整数 | ✅ PASS | active_pipelines=0，类型正确 |
| Test 2 | active_pipelines 值与 DB harness_planner in_progress 计数一致 | ✅ PASS | API=0 == DB=0 |
| Test 3 | 注入 harness_generator 后 API 值不变（强证伪） | ✅ PASS | 注入前=0 注入后=0 == planner_only=0 != all_harness=2 |

---

## Test 3 详细分析

Round 4 合同要求主动注入 `harness_generator` 类型记录来强制证伪。执行结果：

- 注入前 API 值: 0
- 注入 `harness_generator` + `in_progress` 后 API 值: 0（未变化）
- DB planner_only 计数: 0
- DB all_harness 计数: 2（包含注入的 + 已有的其他 harness 记录）
- **关键差异**: `all_harness(2) != planner_only(0)`，证明如果实现错误地统计了所有 `harness_*` 类型，API 会返回 2 而非 0

注意：清理阶段 `psql DELETE` 命令因 TEMP_ID 变量含尾部换行导致 UUID 解析报错，但该记录已在评估后手动清理确认删除。这是测试脚本的 shell 引用问题，不影响功能验证结论。

---

## 裁决

**PASS** — 三项合同验证全部通过。

`active_pipelines` 字段行为符合合同规范：
1. 字段存在，类型为非负整数
2. 值与 DB 中 `harness_planner` + `in_progress` 计数精确一致
3. 强证伪确认：不统计 `harness_generator` 等其他 `harness_*` 类型
