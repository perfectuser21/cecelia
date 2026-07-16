# Contract DoD — judge PASS@L 分级判定

## 任务信息

- **TASK_ID**: 750f5f5b-401a-4379-91c0-948a30327271
- **Sprint**: 07161400-pass-at-level-judge

## DoD 条目

### [BEHAVIOR] L3 声明 + 纯 curl 证据 → FAIL mechFail=level_evidence_mismatch

**描述**：当 brainResult 顶层或 behavior_tests 条目声明 `verification_level: 'L3'`，但对应 log_tail 仅含 curl 命令输出（无真机设备路径/UIA 标识/截图路径），`runMechanicalPreflightChecks` 必须返回 `{ verdict: 'FAIL', mechFail: 'level_evidence_mismatch' }`。

**现状（修复前）**：当前版本无等级校验，L3 声明 + 纯 curl 证据仍可 PASS（即这是一个 red failing test）。

**验收命令**：
```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|level_evidence_mismatch|✓|✗|×)"
```

---

### [BEHAVIOR] 存量无 verification_level 字段 → 行为不变（L2 兼容回归）

**描述**：当 brainResult 无 `verification_level` 字段时，`runMechanicalPreflightChecks` 行为与修复前完全一致——不因缺失等级字段而 FAIL，不产生 level_evidence_mismatch。

**验收命令**：
```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js -t "兼容回归" --reporter=verbose 2>&1 | tail -20
```

---

### [BEHAVIOR] L3 + 真机指纹关键词证据 → PASS（不过度拦截）

**描述**：当 brainResult 声明 `verification_level: 'L3'`，且 behavior_tests 条目的 log_tail 含真机指纹关键词（如 `adb shell`、`UiSelector`、`/data/` 设备路径、截图绝对路径），`runMechanicalPreflightChecks` 必须返回 `null`（通过）。

**验收命令**：
```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js -t "真机指纹" --reporter=verbose 2>&1 | tail -20
```

---

### [BEHAVIOR] 条目级 verification_level 优先于顶层声明

**描述**：当顶层 `verification_level: 'L2'` 但 `behavior_tests[0].verification_level: 'L3'`，且该条目 log_tail 仅含 curl 输出，必须按条目级 L3 执法——判 FAIL mechFail=level_evidence_mismatch（条目级覆盖顶层）。

**验收命令**：
```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js -t "条目级优先" --reporter=verbose 2>&1 | tail -20
```

---

### [BEHAVIOR] curl 前缀但同时含设备路径关键词 → PASS（边界不过度拦截）

**描述**：当 log_tail 含 `curl` 前缀但同时含设备路径关键词（如 `curl` 命令从设备拉取日志），不视为"纯 curl 输出"，允许通过。PRD 边界情况明确要求此场景 PASS。

**验收命令**：
```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js -t "curl混合设备路径" --reporter=verbose 2>&1 | tail -20
```

---

## 整体验收命令

```bash
# manual:bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-level.test.js --reporter=verbose 2>&1
```

## 约束

- 禁 mock 证据解析路径（测试必须调用真实的 `runMechanicalPreflightChecks` 函数）
- failing test 先于 fix 存在（红绿流程）
- 测试文件必须永久进 CI（regression guard）
- 不新建数据库表
