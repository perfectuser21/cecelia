# Eval Round 2 — FAIL

**评估时间**: 2026-04-07 (Asia/Shanghai)
**评估轮次**: 2
**总体结论**: FAIL
**Sprint**: Sprint 2 — Harness Pipeline 端到端修复
**合同文件**: `sprints/sprint-2/sprint-contract.md`

---

## 功能验证结果

| SC | 功能 | 验证维度 | 硬阈值 | 实际结果 | 结论 |
|----|------|---------|-------|---------|------|
| SC-1 | devloop-check.sh harness guard | 代码结构顺序 | harness_mode 检查在 cleanup_done 检查之前 | harness_mode 检测在第 80 行，cleanup_done 在第 91 行，顺序正确 | ✅ PASS |
| SC-2 | stop-dev.sh harness guard | 代码结构 + cleanup 路径保护 | cleanup_done 早退路径含 harness 判断 | HARNESS_MODE_IN_FILE 变量读取 + `[[ "$HARNESS_MODE_IN_FILE" != "true" ]]` 条件守卫 | ✅ PASS |
| SC-3 | sprint-evaluator SKILL.md 必写规则 | 文件内容检查 | 包含 `evaluation.md` + `CRITICAL` + `必须` + 错误兜底格式 | `evaluation.md` 关键字不存在（已改为 `eval-round-N.md`），CRITICAL + 必须存在 | ❌ FAIL |
| SC-4 | execution.js nested verdict 读取 | 代码逻辑检查 | 含 `resultObj.result`、`typeof`、`object`、sprint_evaluate verdict 块 | 第 1778 行含完整嵌套处理逻辑，sprint_evaluate PASS 分支存在 | ✅ PASS |

---

## 详细报告

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退

**合同要求**: harness_mode 检查必须在 cleanup_done 检查之前（行号更小）

**验证方式**: 读取文件内容，比较两个关键字的字符偏移量

**实际代码**:
```
# 第 80 行注释: ===== 条件 0 (预检): 读取 harness_mode（必须在 cleanup_done 之前）=====
# 第 84 行: local _harness_mode="false"
# 第 87 行: _harness_mode 读取逻辑

# 第 91 行注释: ===== 条件 0.1: cleanup_done（跳过 harness 模式）=====
# 第 92 行: if [[ "$_harness_mode" != "true" ]] && grep -q "cleanup_done: true"
```

**结论**: ✅ PASS — harness_mode 检测在前，cleanup_done 判断在后，且 cleanup_done 路径有 `$_harness_mode != "true"` 守卫

---

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径

**合同要求**: cleanup_done 快捷路径必须含 harness 判断

**实际代码** (第 104-105 行):
```bash
HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
```

**结论**: ✅ PASS — `HARNESS_MODE_IN_FILE` 在 cleanup_done 快捷路径前读取并守卫

---

### SC-3: sprint-evaluator SKILL.md — evaluation.md 必写规则

**合同要求**: SKILL.md 包含 `evaluation.md`、`CRITICAL`、`必须` 三个关键字，且有错误兜底格式

**实际状态**:
- `CRITICAL`: ✅ 存在（第 224 行: `Step 5: 写入 eval-round-N.md（CRITICAL — 无论成功失败必须执行）`）
- `必须`: ✅ 存在（第 226 行: `无论任何情况（验证失败、命令报错、环境问题），必须写入 eval-round-N.md`）
- `evaluation.md`: ❌ **不存在**
- 错误兜底格式: ✅ 存在（`ERROR（partial evaluation）` 兜底模板）

**根本原因**:
SKILL.md 已从 v3.x 升级至 **v4.0.0**（2026-04-07 更新），输出文件从 `evaluation.md` 改为 `eval-round-${EVAL_ROUND}.md`。Sprint 2 合同的 SC-3 验证命令检查 `evaluation.md` 关键字，但该字段在 v4.0.0 中已不存在。

**影响分析**:
- 精神层面：Bug 2 的实际修复意图（确保输出文件必定写入）**已满足** — v4.0.0 SKILL.md 确实有 CRITICAL 必写规则
- 合同层面：SC-3 验证命令**字面失败**，`c.includes('evaluation.md')` = `false`
- Brain 侧一致性：execution.js 第 1826 行已改用 `eval-round-${harnessPayload.eval_round}.md`，与 v4.0.0 SKILL.md 匹配

**需要修复**: Sprint 2 合同 SC-3 的验证命令需更新为检查 `eval-round-N.md` 而非 `evaluation.md`，或 SKILL.md 需在文件中保留 `evaluation.md` 的向后兼容引用。

**结论**: ❌ FAIL — 合同验证命令字面失败

---

### SC-4: execution.js — nested verdict 读取逻辑

**合同要求**: 含 `resultObj.result`、`typeof`、`object` 关键字，且在 sprint_evaluate 处理块内有 `PASS`

**实际代码** (第 1778 行):
```javascript
// Bug fix: 先检查 nested result.result.verdict（对象嵌套场景）
if (!resultObj.verdict && typeof resultObj.result === 'object' && resultObj.result !== null && resultObj.result.verdict) {
  resultObj.verdict = resultObj.result.verdict;
}
```

**同时存在** `extractVerdictFromResult` 函数 (第 1563-1580 行)，处理 `res?.result?.verdict` 嵌套路径。

**结论**: ✅ PASS — nested verdict 提取逻辑完整实现

---

## FAIL 汇总

### Bug SC-3: sprint-evaluator SKILL.md 与合同验证命令不同步

**现象**: SC-3 验证命令检查 `c.includes('evaluation.md')`，返回 `false`

**预期 vs 实际**:
- 预期：SKILL.md 包含字符串 `evaluation.md`
- 实际：SKILL.md v4.0.0 改用 `eval-round-N.md`，文件中无 `evaluation.md`

**修复方案（二选一）**:

**方案 A（推荐）**: 更新 Sprint 2 合同 SC-3 验证命令，将 `evaluation.md` 替换为 `eval-round`：
```javascript
if (!c.includes('eval-round') || !c.includes('CRITICAL') || !c.includes('必须')) {
  console.error('FAIL: CRITICAL always-write rule not found'); process.exit(1);
}
```

**方案 B**: 在 SKILL.md 中保留一个对 `evaluation.md` 的说明性引用（向后兼容注释），满足合同字面检查。

**影响范围**: 仅 SC-3 合同验证命令，不影响实际运行时行为（Brain 已与 SKILL.md v4.0.0 同步）
