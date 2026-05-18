# SKILL.md 豁免分支保护 + Harness 假阳性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 branch-protect.sh 让 SKILL.md 文件可直接编辑，同时修复 harness pipeline evaluator 的假阳性问题。

**Architecture:** 4 个独立文件改动，无依赖关系，可顺序执行。branch-protect.sh 改豁免逻辑；harness-evaluator SKILL 改严格性；harness-contract-proposer SKILL 删遗留矛盾规则；check-dod-purity.cjs 反转 Rule 1。

**Tech Stack:** bash, Node.js, Markdown

---

### Task 1: 修复 branch-protect.sh — /skills/ 下 .md 文件豁免

**Files:**
- Modify: `hooks/branch-protect.sh:80-84`
- Test: 手动 bash 测试（见步骤）

- [ ] **Step 1: 写失败测试（验证当前行为：.md 文件被拦截）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-branch-protect-skill-md-exemption

# 模拟 Edit 事件，确认当前会拦截 .md 文件
echo '{"tool_name":"Edit","tool_input":{"file_path":"/Users/administrator/perfect21/cecelia/packages/workflows/skills/harness-evaluator/SKILL.md"}}' \
  | bash hooks/branch-protect.sh
echo "exit: $?"
```
预期：exit 2（当前会被拦截）

- [ ] **Step 2: 修改 branch-protect.sh**

将第 80-84 行：
```bash
if [[ "$FILE_PATH" == *"/skills/"* ]] || \
   [[ "$FILE_PATH" == *"/hooks/"* ]] || \
   [[ "$FILE_PATH" == *"/.github/"* ]]; then
    NEEDS_PROTECTION=true
fi
```

改为：
```bash
if [[ "$FILE_PATH" == *"/skills/"* ]]; then
    # .md 文件（SKILL 文档）不需要分支保护
    if [[ "${FILE_PATH##*.}" != "md" ]]; then
        NEEDS_PROTECTION=true
    fi
elif [[ "$FILE_PATH" == *"/hooks/"* ]] || \
     [[ "$FILE_PATH" == *"/.github/"* ]]; then
    NEEDS_PROTECTION=true
fi
```

- [ ] **Step 3: 验证 .md 豁免通过**

```bash
# .md 文件应放行（exit 0）
echo '{"tool_name":"Edit","tool_input":{"file_path":"/Users/administrator/perfect21/cecelia/packages/workflows/skills/harness-evaluator/SKILL.md"}}' \
  | bash hooks/branch-protect.sh
echo "exit: $?"
```
预期：exit 0

- [ ] **Step 4: 验证 .js 文件仍被保护**

```bash
# .js 文件仍需分支保护（非 cp-* 分支应 exit 2）
echo '{"tool_name":"Edit","tool_input":{"file_path":"/Users/administrator/perfect21/cecelia/packages/workflows/skills/some-skill/index.js"}}' \
  | bash hooks/branch-protect.sh
echo "exit: $?"
```
预期：exit 2

- [ ] **Step 5: Commit**

```bash
git add hooks/branch-protect.sh
git commit -m "fix(hooks): exempt .md files in /skills/ from branch protection"
```

---

### Task 2: 修复 harness-evaluator/SKILL.md — rule 4 弱 oracle 改 FAIL

**Files:**
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md:90`

- [ ] **Step 1: 修改 rule 4**

将：
```
4. **缺 jq -e 严匹配视为弱测试**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，记入 `feedback` 但本轮仍按命令 exit code 判（容忍但报告，让 reviewer 下轮严化）
```

改为：
```
4. **缺 jq -e 严匹配直接 FAIL**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，输出 `{"verdict": "FAIL", "feedback": "命令缺 jq -e 严匹配，属弱 oracle，拒绝通过，请补充 jq -e 值校验"}` — 禁止容忍通过
```

- [ ] **Step 2: 更新 changelog**

在 SKILL.md frontmatter changelog 段首行新增：
```yaml
  - 1.5.0: 强化反作弊 rule 4 — 缺 jq -e 从"容忍但报告"改为直接 FAIL，消除弱 oracle 假阳性根因
```

同步把 `version:` 从 `1.4.0` 改为 `1.5.0`，`updated:` 改为 `2026-05-18`。

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/skills/harness-evaluator/SKILL.md
git commit -m "fix(skill): harness-evaluator rule 4 — weak oracle now FAIL not tolerated"
```

---

### Task 3: 修复 harness-contract-proposer/SKILL.md — 删除 v5 遗留矛盾规则

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md:503`（禁止事项 #3）

- [ ] **Step 1: 删除禁止事项 #3**

找到"禁止事项"段落中的第 3 条：
```markdown
3. **在 contract-dod-ws{N}.md 出现 [BEHAVIOR] 条目** → CI `dod-structure-purity` 会 exit 1
```

删除这一整行，并将后续的第 4 条改为第 3 条：
```markdown
3. **禁止在 main 分支操作**
```

- [ ] **Step 2: 更新 changelog**

在 frontmatter changelog 首行新增：
```yaml
  - 7.7.0: 删除禁止事项 #3（v5.0 遗留"禁止 [BEHAVIOR] 出现在 DoD 文件"规则，与 v7.4+ 正面矛盾）
```

同步 `version:` → `7.7.0`，`updated:` → `2026-05-18`。

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "fix(skill): remove stale v5 prohibition of [BEHAVIOR] in DoD files (contradicts v7.4+)"
```

---

### Task 4: 修复 check-dod-purity.cjs — Rule 1 允许 [BEHAVIOR] 出现在 DoD 文件

**Files:**
- Modify: `packages/engine/scripts/devgate/check-dod-purity.cjs:62-71`

- [ ] **Step 1: 写失败测试（验证当前 Rule 1 会拦截 [BEHAVIOR]）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-branch-protect-skill-md-exemption

cat > /tmp/test-dod-behavior.md << 'EOF'
## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /endpoint 返 {result: 42}
  Test: manual:bash -c 'curl -s localhost:3001/endpoint | jq -e ".result == 42"'
  期望: exit 0
EOF

node packages/engine/scripts/devgate/check-dod-purity.cjs /tmp/test-dod-behavior.md
echo "exit: $?"
```
预期：exit 1（当前会报 Rule 1 违规）

- [ ] **Step 2: 修改 check-dod-purity.cjs — 删除 Rule 1 检查**

将第 62-71 行：
```javascript
  // Rule 1: 禁 [BEHAVIOR] 条目
  // 允许的：`## BEHAVIOR 索引`（标题）
  // 禁止的：`- [ ] [BEHAVIOR] ...` 或 `- [x] [BEHAVIOR] ...`
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*\[[\sxX]\]\s*\[BEHAVIOR\]/.test(lines[i])) {
      violations.push(
        `L${i + 1}: 禁止 [BEHAVIOR] 条目 — BEHAVIOR 必须搬到 tests/ws{N}/*.test.ts：\n    ${lines[i].trim()}`
      );
    }
  }
```

改为：
```javascript
  // Rule 1: [BEHAVIOR] 条目必须含 manual:bash 命令（v7.4+ 协议）
  // 禁止：[BEHAVIOR] 条目的 Test: 字段引用 vitest 文件（老格式）
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*\[[\sxX]\]\s*\[BEHAVIOR\]/.test(lines[i])) {
      // 向后找 Test: 行
      let testLine = '';
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(/^\s*Test:\s*(.+)$/);
        if (m) { testLine = m[1].trim(); break; }
      }
      // 如果 Test: 引用 vitest 文件而非 manual:bash → 违规
      if (testLine && /^tests\//.test(testLine) && !/manual:/.test(testLine)) {
        violations.push(
          `L${i + 1}: [BEHAVIOR] Test: 字段不能只引用 vitest 文件，必须用 manual:bash 内嵌命令（v7.4+）：\n    ${lines[i].trim()}`
        );
      }
    }
  }
```

同时更新文件头注释第 6 行：
```javascript
 *   contract-dod-ws{N}.md 必须含 [BEHAVIOR] 条目（v7.4+），Test 字段必须用 manual:bash 内嵌命令
```

- [ ] **Step 3: 验证 [BEHAVIOR] + manual:bash 通过**

```bash
node packages/engine/scripts/devgate/check-dod-purity.cjs /tmp/test-dod-behavior.md
echo "exit: $?"
```
预期：exit 0

- [ ] **Step 4: 验证 [BEHAVIOR] + vitest 引用仍被拦截**

```bash
cat > /tmp/test-dod-vitest.md << 'EOF'
## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /endpoint 正常返回
  Test: tests/ws1/endpoint.test.ts
  期望: pass
EOF

node packages/engine/scripts/devgate/check-dod-purity.cjs /tmp/test-dod-vitest.md
echo "exit: $?"
```
预期：exit 1（vitest 引用仍被拦截）

- [ ] **Step 5: Commit**

```bash
git add packages/engine/scripts/devgate/check-dod-purity.cjs
git commit -m "fix(devgate): check-dod-purity Rule 1 — allow [BEHAVIOR] in DoD, only block vitest-only tests"
```
