# Evaluation: Sprint 2 — Round 5

## 验证环境
- 测试端口: N/A（静态代码验证 + 现有测试套件）
- 测试数据库: N/A
- 验证时间: 2026-04-06 03:16:16 UTC（上海时间 11:16:16）
- Evaluator 轮次: R5

---

## 验证结果

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退

- **状态**: PASS
- **验证命令**: 按 sprint-contract.md SC-1 原文执行
- **实际结果**:
  ```
  PASS: harnessIdx=423 cleanupIdx=1562
  ```
- **分析**: `harness_mode` 预检逻辑（索引 423）出现在 `cleanup_done: true` 检查（索引 1562）之前，符合 Bug 1 修复要求。
  - 条件 0（预检）读取 `_harness_mode`，行号 84-88
  - 条件 0.1（cleanup_done 早退）在 `_harness_mode != "true"` 保护下，行号 92-93

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径

- **状态**: FAIL
- **验证命令**: 按 sprint-contract.md SC-2 原文执行
- **实际结果**:
  ```
  FAIL: cleanup_done exit 0 path has no harness guard
  ```
- **问题根因（对抗性分析）**:

  SC-2 验证脚本使用以下正则匹配：
  ```js
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  if (block && !block[0].includes('harness')) { ... }
  ```

  实际 stop-dev.sh 代码为（第 105 行）：
  ```bash
  HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" ...)
  if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" ...; then
      rm -f ...
      exit 0
  fi
  ```

  **关键问题**：`HARNESS_MODE_IN_FILE` 出现在 `cleanup_done: true` **之前**（同一行 if 条件的前半部分）。正则从 `cleanup_done: true` 开始匹配，到 `exit 0` 结束——这段文本中不包含 `harness` 字样，因此检查失败。

  **逻辑层面**：代码的 harness 保护实际上是正确的——if 条件 `[[ "$HARNESS_MODE_IN_FILE" != "true" ]]` 确保 harness 模式不会触发 `exit 0`。但验证命令的正则无法检测到这一保护，因为 `harness` 关键字出现在 `cleanup_done` 之前而非之后。

- **复现步骤**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  console.log('matched block:', JSON.stringify(block[0].substring(0, 100)));
  console.log('contains harness:', block[0].includes('harness'));
  "
  ```

- **Generator 需要的修复**:

  **选项 A（推荐）**：更新 SC-2 验证命令，使其能检测到 harness 保护在 `cleanup_done` 判断之前的模式：
  ```js
  // 改为检查 HARNESS_MODE_IN_FILE 变量在 cleanup_done 相关 if 语句中
  const hasHarnessVar = c.includes('HARNESS_MODE_IN_FILE');
  const cleanupBlock = c.match(/HARNESS_MODE_IN_FILE.*!=.*true.*cleanup_done/s);
  if (!hasHarnessVar || !cleanupBlock) {
    console.error('FAIL: no harness guard before cleanup_done exit'); process.exit(1);
  }
  ```

  **选项 B**：重构 stop-dev.sh 中的逻辑，使 `harness` 关键字出现在 `cleanup_done: true` 之后（即嵌套 if 结构），以满足原验证命令的检测模式：
  ```bash
  if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]; then  # harness 出现在此处，在 cleanup_done 之后
      exit 0
    fi
  fi
  ```

### SC-3: sprint-evaluator SKILL.md — 包含 evaluation.md 必写规则

- **状态**: PASS
- **验证命令**: 按 sprint-contract.md SC-3 原文执行
- **实际结果**: 输出 `PASS`
- **分析**: SKILL.md 包含 `evaluation.md`、`CRITICAL`、`必须`、`兜底` 等关键词，以及错误兜底格式（partial evaluation）。

### SC-4: execution.js — nested verdict 读取逻辑

- **状态**: PASS
- **验证命令**: 按 sprint-contract.md SC-4 原文执行
- **实际结果**: 输出 `PASS`
- **分析**: `execution.js` 包含 `resultObj.result`、`typeof`、`object` 处理逻辑，且 sprint_evaluate 处理块中有正确的 verdict 提取。

---

## 额外发现（主动验证）

### 测试套件状态

```
总测试数: 318
通过: 316（含 2 个 pending）
失败: 0
失败套件: 1（packages/engine/tests/devgate-fake-test-detection.test.cjs）
```

**注**: `devgate-fake-test-detection.test.cjs` 报 "No test suite found"，但 `git log` 显示此文件来自历史 subtree 合并（commit `beebdbb4a`），与本 sprint 修改无关，属于**预存问题**，不计入本次评估。316 个实际测试全部通过。

### 并发/边界测试

- stop-dev.sh 中 `HARNESS_MODE_IN_FILE` 使用了 shell 子进程读取，存在潜在竞态（多个 stop hook 并发触发时），但这是预存架构问题，不在本 sprint 修复范围内，标注为次要发现。

---

## 裁决

- **verdict**: FAIL
- **通过条目**: SC-1 ✅、SC-3 ✅、SC-4 ✅
- **失败条目**: SC-2 ❌

### Generator 需要修复的清单

1. **[SC-2] stop-dev.sh 验证命令失败**：`cleanup_done.*true[\s\S]{0,300}exit 0` 正则匹配到的文本不包含 `harness` 关键字（因 harness 保护在 cleanup_done 之前，不在正则捕获范围内）。

   **两种修复方式择一**：
   - **方式 A（修验证命令）**：将 SC-2 的 node 验证脚本改为检查 `HARNESS_MODE_IN_FILE.*!=.*true.*cleanup_done`（即 harness 保护在 cleanup_done 之前）
   - **方式 B（改代码结构）**：将 stop-dev.sh 第 105 行改为先 `if grep -q "cleanup_done: true"`，再内嵌 `if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]`，使验证命令能检测到嵌套结构中的 `harness`

   复现：
   ```bash
   node -e "
   const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
   const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
   if (block && !block[0].includes('harness')) {
     console.error('FAIL: cleanup_done exit 0 path has no harness guard'); process.exit(1);
   }
   "
   ```
