# Evaluation: Sprint 2 — Round 8

## 验证环境
- 测试端口: N/A（静态代码验证，无需启动服务）
- 测试数据库: N/A
- 验证时间: 2026-04-06 12:07:24 CST
- 验证模式: 文件内容验证（所有 SC 均为文件检查，无运行时 API）

---

## 验证结果

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退

- 状态: **PASS**
- 验证过程:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/lib/devloop-check.sh', 'utf8');
  const harnessIdx = c.indexOf('harness_mode');
  const cleanupIdx = c.indexOf('cleanup_done: true');
  if (harnessIdx > cleanupIdx) process.exit(1);
  console.log('PASS');
  "
  ```
- 实际结果: `PASS, harnessIdx=423 cleanupIdx=1562`
- 分析: `harness_mode` 首次出现（注释行 11，位置 423）在 `cleanup_done: true`（`_mark_cleanup_done` 函数，位置 1562）之前。条件 0 预检（第 80-89 行）在条件 0.1 cleanup_done 检查（第 91-96 行）之前，且非 harness 模式才执行 cleanup_done 快捷退出。实现正确。

---

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径

- 状态: **FAIL**
- 验证过程:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  if (block && !block[0].includes('harness')) {
    console.error('FAIL: cleanup_done exit 0 path has no harness guard'); process.exit(1);
  }
  console.log('PASS');
  "
  ```
- 实际结果: `FAIL: cleanup_done exit 0 path has no harness guard`

- 问题详述:

  正则 `/cleanup_done.*true[\s\S]{0,300}exit 0/` 匹配到的块起点是第 105 行 grep 命令中的 `cleanup_done: true"`：
  ```
  matched: "cleanup_done: true\" \"$DEV_MODE_FILE\" 2>/dev/null; then\n    rm -f...\n    exit 0"
  ```
  该块不包含 'harness'，因为 harness guard（`$HARNESS_MODE_IN_FILE != "true"`）出现在 `cleanup_done: true` **之前**：
  ```bash
  # 当前实现（第 104-108 行）
  HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" ...)
  if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" ...; then
      ...
      exit 0
  fi
  ```
  验证脚本期望 harness 关键字出现在 `cleanup_done` 之后、`exit 0` 之前（即 if 条件的右侧部分或 if body 内）。

- 复现步骤:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  console.log('block[0]:', JSON.stringify(block[0].substring(0, 150)));
  console.log('includes harness:', block[0].includes('harness'));
  "
  ```

- 修复方向: 将 if 条件重写为先检查 `cleanup_done: true`，再在 body 内检查 harness guard，例如：
  ```bash
  if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
      HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
      if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]; then
          rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
          jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
          exit 0
      fi
  fi
  ```
  这样 `cleanup_done.*true[\s\S]{0,300}exit 0` 块内会包含 `HARNESS_MODE_IN_FILE`（含 'harness'）。

---

### SC-3: sprint-evaluator SKILL.md — 包含 evaluation.md 必写规则

- 状态: **PASS**
- 验证过程:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md', 'utf8');
  if (!c.includes('evaluation.md') || !c.includes('CRITICAL') || !c.includes('必须')) process.exit(1);
  if (!c.includes('partial') && !c.includes('兜底') && !c.includes('ERROR')) process.exit(1);
  console.log('PASS');
  "
  ```
- 实际结果: `PASS`
- 分析: SKILL.md 包含 `evaluation.md`、`CRITICAL`、`必须`、`兜底` 等所有必要关键词，错误兜底格式完整。

---

### SC-4: execution.js — nested verdict 读取逻辑

- 状态: **PASS**
- 验证过程:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('resultObj.result') || !c.includes('typeof') || !c.includes('object')) process.exit(1);
  const evalBlock = c.match(/sprint_evaluate[\s\S]{0,3000}verdict.*PASS/);
  if (!evalBlock) process.exit(1);
  console.log('PASS');
  "
  ```
- 实际结果: `PASS`
- 分析: `execution.js` 第 1615-1618 行包含：
  ```javascript
  if (!resultObj.verdict && typeof resultObj.result === 'object' && resultObj.result !== null && resultObj.result.verdict) {
    resultObj.verdict = resultObj.result.verdict;
  }
  ```
  三个关键词（`resultObj.result`、`typeof`、`object`）均存在，sprint_evaluate 块内有 `verdict === 'PASS'` 路由。

---

## 额外发现（主动找茬）

### 发现 1：SC-2 的功能实现与测试期望存在结构差异

代码功能上是正确的（harness 模式确实被正确保护），但 sprint-contract 的验证脚本基于"harness guard 必须在 cleanup_done 检查之后出现"的结构假设，而实现将其放在了 if 条件的左侧（前置短路）。

功能正确但测试失败，测试是契约文件中规定的唯一验证标准，因此按规则判定为 FAIL。

### 发现 2：stop-dev.sh 第 123 行的 HARNESS_MODE_FLAG 变量重复读取 harness_mode

第 104 行已读取 `HARNESS_MODE_IN_FILE`，第 123 行又读取 `HARNESS_MODE_FLAG`，两个变量内容相同，轻微冗余。不构成阻断，不触发 FAIL。

---

## 裁决

- **verdict: FAIL**
- 通过条目: SC-1 ✅, SC-3 ✅, SC-4 ✅
- 失败条目: SC-2 ❌

### Generator 需要修复的具体清单

1. **[SC-2] stop-dev.sh cleanup_done 路径结构不满足验证脚本要求**

   **问题**: 正则 `/cleanup_done.*true[\s\S]{0,300}exit 0/` 匹配的块不包含 'harness'，harness guard 出现在 `cleanup_done` 之前。

   **复现**:
   ```bash
   node -e "
   const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
   const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
   console.log('includes harness:', block[0].includes('harness'));
   "
   # 输出: includes harness: false
   ```

   **修复**: 重构 if 条件，先 grep `cleanup_done: true`，在 body 内做 harness 判断：
   ```bash
   if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
       HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
       if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]; then
           rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
           jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
           exit 0
       fi
   fi
   ```
   修复后 `cleanup_done.*true[\s\S]{0,300}exit 0` 匹配块内将包含 `HARNESS_MODE_IN_FILE`（含 'harness'）。
