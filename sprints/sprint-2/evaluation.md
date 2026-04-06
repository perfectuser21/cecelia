# Evaluation: Sprint 2 — Round 2

## 验证环境
- 测试端口: N/A（静态代码验证，无需启动服务）
- 测试数据库: N/A
- 验证时间: 2026-04-06 10:53:57 CST
- 验证方式: 直接读取文件内容 + node -e 执行 SC 验证命令

---

## 验证结果

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退
- **状态: PASS**
- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const harnessIdx=c.indexOf('harness_mode');const cleanupIdx=c.indexOf('cleanup_done: true');..."
  ```
- **实际结果**: 输出 `PASS`（harness_mode idx: 423，cleanup_done idx: 1562，顺序正确）
- **问题**: 无

---

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径
- **状态: FAIL**
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!c.includes('HARNESS_MODE_IN_FILE') && !c.includes('harness_mode') ) {
    console.error('FAIL: no harness guard in cleanup_done path'); process.exit(1);
  }
  const block = c.match(/cleanup_done.*true[\s\\S]{0,300}exit 0/);
  if (block && !block[0].includes('harness')) {
    console.error('FAIL: cleanup_done exit 0 path has no harness guard'); process.exit(1);
  }
  console.log('PASS');
  "
  ```
- **实际结果**: 退出码 1，错误信息 `FAIL: cleanup_done exit 0 path has no harness guard`
- **问题分析**:

  验证命令的正则 `/cleanup_done.*true[\s\S]{0,300}exit 0/` 产生了**假阳性（false positive）**：

  stop-dev.sh 第 105 行实现如下：
  ```bash
  HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
  if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
      rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
      jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
      exit 0
  fi
  ```

  正则匹配到的子串从 `cleanup_done: true"` 开始（来自 `grep -q "cleanup_done: true"` 参数），向后 300 字符内找到 `exit 0`。由于 harness guard（`HARNESS_MODE_IN_FILE != "true"`）出现在同一 `if` 条件的前半段，不在正则捕获范围内，导致 `block[0].includes('harness')` 为 false。

  **实际代码逻辑是正确的**：只有当 `HARNESS_MODE_IN_FILE != "true"` 时才进入 cleanup_done 早退路径。但验证命令无法感知这一点。

- **复现**:
  ```bash
  cd /Users/administrator/worktrees/cecelia/7a53956b-c633-4397-8ffc-c7aa19
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  console.log('block found:', !!block);
  if (block) console.log('block[0]:', JSON.stringify(block[0].substring(0,200)));
  console.log('block[0] includes harness:', block ? block[0].includes('harness') : 'N/A');
  "
  ```

---

### SC-3: sprint-evaluator SKILL.md — 包含 evaluation.md 必写规则
- **状态: PASS**
- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md','utf8');..."
  ```
- **实际结果**: 输出 `PASS`（CRITICAL、必须、evaluation.md、ERROR 等关键词均存在）
- **问题**: 无

---

### SC-4: execution.js — nested verdict 读取逻辑
- **状态: PASS**
- **验证命令**:
  ```bash
  node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');..."
  ```
- **实际结果**: 输出 `PASS`
- **验证详情**: execution.js 第 1617-1620 行已实现嵌套 verdict 读取：
  ```javascript
  if (!resultObj.verdict && typeof resultObj.result === 'object' && resultObj.result !== null && resultObj.result.verdict) {
    resultObj.verdict = resultObj.result.verdict;
  }
  ```
- **问题**: 无

---

## 额外发现（主动找茬）

### [轻微] SC-2 验证命令设计缺陷
- **描述**: SC-2 的正则验证命令存在 false-positive，将一个正确实现错误判为 FAIL
- **影响**: 验证命令不准确会导致后续 Evaluator 无法正确裁决
- **建议修复方向**: 改为检查 `HARNESS_MODE_IN_FILE` 变量存在且出现在 cleanup_done 块之前，例如：
  ```javascript
  // 方案1：检查行号
  const lines = c.split('\n');
  const harnessVarLine = lines.findIndex(l => l.includes('HARNESS_MODE_IN_FILE='));
  const cleanupCondLine = lines.findIndex(l => l.includes('cleanup_done: true') && l.includes('grep'));
  if (harnessVarLine === -1 || harnessVarLine > cleanupCondLine) process.exit(1);
  // 方案2：检查 if 条件中 HARNESS_MODE_IN_FILE != true 与 cleanup_done 共现
  if (!c.includes('HARNESS_MODE_IN_FILE') || !c.match(/HARNESS_MODE_IN_FILE.*!= .true.*cleanup_done/)) process.exit(1);
  ```

---

## 裁决

- **verdict: FAIL**
- Generator 需要修复的具体清单:

  **1. SC-2 验证命令假阳性**
  - **问题**: `packages/engine/hooks/stop-dev.sh` 中 stop-dev.sh 实现逻辑正确，但 sprint-contract.md 中的 SC-2 验证命令正则存在 false-positive，导致正确实现被判 FAIL
  - **位置**: `sprints/sprint-2/sprint-contract.md` SC-2 验证命令
  - **复现**:
    ```bash
    cd /Users/administrator/worktrees/cecelia/7a53956b-c633-4397-8ffc-c7aa19
    node -e "
    const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
    const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
    if (block && !block[0].includes('harness')) {
      console.error('FAIL: cleanup_done exit 0 path has no harness guard'); process.exit(1);
    }
    "
    # 输出: FAIL: cleanup_done exit 0 path has no harness guard
    ```
  - **修复方向**: 更新 SC-2 验证命令，改用行号比较或检查 `HARNESS_MODE_IN_FILE` 是否与 cleanup_done 条件共现在同一 if 语句
