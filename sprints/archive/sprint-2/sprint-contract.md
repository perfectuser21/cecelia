# Sprint Contract: Sprint 2 — Harness Pipeline 端到端修复

**生成者**: Generator (Sprint 2 Bug Fix)
**任务 ID**: fd9bea2f-7f86-4904-aaa8-29b34986967f
**目标**: 修复 3 个阻断 Harness v2.0 端到端运行的 Bug

---

## 修复范围

### Bug 1: devloop-check.sh / stop-dev.sh — 残留 .dev-mode 导致 harness 会话早退
**现象**: 前一次 harness 会话结束后留下含 `cleanup_done: true` 的 `.dev-mode.*` 文件。
新会话启动时，stop hook 读到该文件并立即 exit 0，导致 Generator 代码未跑完就退出。

**修复位置**:
- `packages/engine/lib/devloop-check.sh`：在 cleanup_done 检查前先读 harness_mode，harness 模式跳过通用 cleanup_done 早退
- `packages/engine/hooks/stop-dev.sh`：同上，cleanup_done 快捷路径加 harness_mode 判断

### Bug 2: sprint-evaluator/SKILL.md — Evaluator 不一定写 evaluation.md
**现象**: 验证过程中报错时，Evaluator 可能跳过 Step 4（写 evaluation.md），
导致 Brain 收到回调但找不到 evaluation.md，sprint_fix 无法读取问题列表。

**修复位置**: `packages/workflows/skills/sprint-evaluator/SKILL.md`
- 新增 CRITICAL 规则：无论任何情况（验证失败、命令报错、环境问题），Step 4 必须执行
- 新增错误兜底格式（partial evaluation）

### Bug 3: execution.js — sprint_evaluate 未能读取 nested verdict 字段
**现象**: Evaluator 回调 `{ result: { verdict: "PASS" } }` 时，execution-callback
无法从 `resultObj.result.verdict`（对象嵌套）中提取 verdict，默认降级为 "FAIL"。

**修复位置**: `packages/brain/src/routes/execution.js`
- 在 verdict 提取逻辑中，增加对 `resultObj.result` 为对象时的处理

---

## 验收条件

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退

- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  // harness_mode 检测必须在 cleanup_done 检查之前（行号更小）
  const harnessIdx = c.indexOf('harness_mode');
  const cleanupIdx = c.indexOf('cleanup_done: true');
  if (harnessIdx === -1) { console.error('FAIL: harness_mode not found'); process.exit(1); }
  if (cleanupIdx === -1) { console.error('FAIL: cleanup_done not found'); process.exit(1); }
  if (harnessIdx > cleanupIdx) { console.error('FAIL: cleanup_done check is before harness_mode check'); process.exit(1); }
  console.log('PASS');
  "
  ```
- **预期结果**: 输出 `PASS`

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径

- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  // cleanup_done 快捷路径必须含 harness 判断（harness_mode != true 条件）
  if (!c.includes('HARNESS_MODE_IN_FILE') && !c.includes('harness_mode') ) {
    console.error('FAIL: no harness guard in cleanup_done path'); process.exit(1);
  }
  // 确认 cleanup_done 路径有 harness 条件
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  if (block && !block[0].includes('harness')) {
    console.error('FAIL: cleanup_done exit 0 path has no harness guard'); process.exit(1);
  }
  console.log('PASS');
  "
  ```
- **预期结果**: 输出 `PASS`

### SC-3: sprint-evaluator SKILL.md — 包含 evaluation.md 必写规则

- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md', 'utf8');
  if (!c.includes('evaluation.md') || !c.includes('CRITICAL') || !c.includes('必须')) {
    console.error('FAIL: CRITICAL always-write rule not found'); process.exit(1);
  }
  // 检查是否有错误兜底格式关键词
  if (!c.includes('partial') && !c.includes('兜底') && !c.includes('ERROR')) {
    console.error('FAIL: error fallback format not found'); process.exit(1);
  }
  console.log('PASS');
  "
  ```
- **预期结果**: 输出 `PASS`

### SC-4: execution.js — nested verdict 读取逻辑

- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 必须有处理 resultObj.result 为对象的逻辑
  if (!c.includes('resultObj.result') || !c.includes('typeof') || !c.includes('object')) {
    console.error('FAIL: no nested result.verdict handling'); process.exit(1);
  }
  // 确认在 sprint_evaluate 处理块内
  const evalBlock = c.match(/sprint_evaluate[\s\S]{0,3000}verdict.*PASS/);
  if (!evalBlock) { console.error('FAIL: sprint_evaluate verdict block not found'); process.exit(1); }
  console.log('PASS');
  "
  ```
- **预期结果**: 输出 `PASS`

---

## 不验证项

- Harness 完整端到端跑通（Sprint 3+ 验证）
- Evaluator 实际验证结果的正确性
- sprint_fix 完整流程
