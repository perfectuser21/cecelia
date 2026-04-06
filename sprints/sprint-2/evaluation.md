# Evaluation: Sprint 2 — Round 6

## 验证环境
- 测试端口: N/A（静态文件验证，无需启动服务）
- 测试数据库: N/A
- 验证时间: 2026-04-06 11:38:49 CST
- 验证模式: 静态代码检查 + SC 合约命令逐条执行

---

## 验证结果

### SC-1: devloop-check.sh — harness 模式跳过 cleanup_done 早退
- **状态**: PASS
- **验证过程**: 执行 sprint-contract.md 中的 node -e 命令，检查 harness_mode 字符串位置（423）与 cleanup_done: true 字符串位置（1562）的大小关系
- **实际结果**: 输出 `PASS: harnessIdx=423 cleanupIdx=1562`，harness_mode 检查（index 423）早于 cleanup_done 检查（index 1562），顺序正确
- **问题**: 无

---

### SC-2: stop-dev.sh — harness 模式跳过 cleanup_done 快捷路径
- **状态**: FAIL
- **验证过程**: 执行 sprint-contract.md 中的 node -e 命令。regex `/cleanup_done.*true[\s\S]{0,300}exit 0/` 找到匹配后，检查匹配文本是否含 "harness"
- **实际结果**: 合约测试输出 `FAIL: cleanup_done exit 0 path has no harness guard`，验证命令 exit 1
- **根因分析**:

  stop-dev.sh 第 104-108 行实现如下：
  ```bash
  HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
  if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
      rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
      jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
      exit 0
  fi
  ```

  代码逻辑本身正确（harness guard 在 cleanup_done 检查之前），但 SC-2 合约的验证命令存在设计问题：

  - regex 从 `cleanup_done: true` 开始匹配（cleanup_done 是 `grep -q "cleanup_done: true"` 的参数），向后 300 字符内找 `exit 0`
  - 匹配到的 block 是：`cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then\n    rm -f ...\n    exit 0`
  - "harness" 关键字出现在同一 `if` 行的左侧（`HARNESS_MODE_IN_FILE != "true"` 条件），位于 "cleanup_done" 之前，不在 regex 匹配范围内
  - 因此 `block[0].includes('harness')` 返回 false，测试 FAIL

- **Generator 需要修复**:

  需重构 stop-dev.sh 的 cleanup_done 块，使 "harness" 关键字出现在 cleanup_done 检查之后（即 if 块内部），让合约 regex 能检测到：

  ```bash
  # 推荐结构（harness 在 cleanup_done 块内部）：
  if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    HARNESS_MODE_IN_FILE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
    if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]; then
      rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
      jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成，工作流结束"}'
      exit 0
    fi
    # harness 模式：跳过 cleanup_done 早退，继续正常流程
  fi
  ```

  这样 "harness" 出现在匹配到的 cleanup_done...exit 0 块内，合约测试可通过。

- **复现步骤**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
  console.log('block includes harness:', block && block[0].includes('harness'));
  "
  # 输出：block includes harness: false
  ```

---

### SC-3: sprint-evaluator SKILL.md — 包含 evaluation.md 必写规则
- **状态**: PASS
- **验证过程**: 执行 node -e 命令，检查 SKILL.md 中含 `evaluation.md`、`CRITICAL`、`必须`、错误兜底关键词（partial/兜底/ERROR）
- **实际结果**: 输出 `PASS`。SKILL.md 已包含所有必要规则和错误兜底格式
- **问题**: 无

---

### SC-4: execution.js — nested verdict 读取逻辑
- **状态**: PASS
- **验证过程**: 执行 node -e 命令，检查 `resultObj.result`、`typeof`、`object` 关键字，以及 sprint_evaluate 处理块中含 `verdict.*PASS`
- **实际结果**: 输出 `PASS`。深度查阅 execution.js 第 1601-1631 行，确认：
  - 第 1617 行 `if (!resultObj.verdict && typeof resultObj.result === 'object' && resultObj.result !== null && resultObj.result.verdict)` 正确处理 nested verdict
  - 第 1618 行 `resultObj.verdict = resultObj.result.verdict` 提升嵌套 verdict 到顶层
  - 第 1631 行 fallback 为 `'FAIL'`（防御性设计正确）
- **问题**: 无

---

## 额外发现（主动找茬）

### 发现 1：SC-2 合约验证命令设计缺陷（非 Generator 代码缺陷）

SC-2 的验证 regex 依赖 "harness" 在 `cleanup_done: true` 之后出现。当前 stop-dev.sh 的实现方式（harness 检查在 `if` 条件左侧）虽然功能正确，但不满足合约测试的文本模式检测。这是 Generator 自己写的合约测试和自己写的代码之间的不一致——代码逻辑对，但测试通不过。

**注意**：这个发现说明 Generator 在编写 SC-2 合约测试后，没有用该测试验证自己的实现就提交了。

### 发现 2：devloop-check.sh SC-1 验证有潜在风险

SC-1 通过了，但验证方式是比较字符串首次出现位置。如果 harness_mode 仅在注释中出现（index 423），而非实际功能代码中，测试仍会 PASS。建议 Generator 在 R7 修复时确认 devloop-check.sh 的 harness_mode 检查是在实际 bash 逻辑中（非仅注释）。

（当前已目视确认 devloop-check.sh 第 104-105 行确实是功能代码，此发现为预防性提醒，不影响本次裁决。）

---

## 裁决

- **verdict**: FAIL
- **Generator 需要修复的具体清单**:

  1. **SC-2 FAIL — stop-dev.sh cleanup_done 块结构需重构**
     - **描述**: cleanup_done 块中 harness 检查的位置不在 cleanup_done...exit 0 正则可匹配范围内，导致 SC-2 合约测试失败
     - **位置**: `packages/engine/hooks/stop-dev.sh`，第 104-109 行
     - **复现**:
       ```bash
       node -e "
       const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
       const block = c.match(/cleanup_done.*true[\s\S]{0,300}exit 0/);
       if (block && !block[0].includes('harness')) { console.error('FAIL'); process.exit(1); }
       console.log('PASS');
       "
       # 当前输出: FAIL
       ```
     - **修复方向**: 把 harness_mode 读取和判断移入 `if grep -q "cleanup_done: true"` 块内部，使其出现在匹配文本中
