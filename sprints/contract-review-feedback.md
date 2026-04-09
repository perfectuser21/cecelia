# Contract Review Feedback (Round 1)

reviewer_task_id: a514c53b-17e4-44b6-9754-a2bddbe1268f
propose_task_id: 7ac36b5e-32bd-42d4-a686-32e709d33db7
date: 2026-04-09
verdict: REVISION

---

## 必须修改项

### 1. [文件错误] Feature 2 — 第一条验证命令检查了错误的文件

**问题**: 验证命令读取的是 `packages/engine/ci/scripts/check-contract-refs.sh`，而 PRD 要求验证的是 `check-dod-mapping.cjs` 的 `manual:` 白名单校验逻辑（含具体命令名报错）。
**影响**: Generator 可以完全不修改 `check-dod-mapping.cjs`，只要 `check-contract-refs.sh` 存在即可通过此验证。
**建议**: 将验证命令改为检查 `check-dod-mapping.cjs`，并验证其中包含白名单数组（如 `ALLOWED_COMMANDS` 或具体命令名列表），同时验证错误信息输出格式含具体命令名：
```bash
node -e "
  const c = require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-mapping.cjs', 'utf8');
  if (!c.includes('manual:')) throw new Error('FAIL: check-dod-mapping.cjs 未处理 manual: 命令');
  if (!c.includes('whitelist') && !c.includes('allowed') && !c.includes('ALLOWED')) {
    throw new Error('FAIL: 未找到白名单定义（whitelist/allowed/ALLOWED）');
  }
  console.log('PASS: check-dod-mapping.cjs 包含 manual: 白名单校验逻辑');
"
```

---

### 2. [PRD遗漏] Feature 1 — 5个边界场景只验证了3个

**问题**: PRD 明确列出5个边界场景，合同验证命令只覆盖3个（lock残留/branch-protect/pre-push DoD），缺失以下两个：
- **场景4**：worktree创建冲突（目标路径已存在时的报错行为）
- **场景5**：Learning同名文件diff context陷阱（提示"请创建新文件"）

**影响**: Generator 可以不处理这两个场景而通过合同验证，违反 PRD 成功标准（≥5个场景）。
**建议**: 补充以下两条验证命令：
```bash
# 场景4: /dev skill 或 worktree 相关脚本包含路径冲突错误提示
node -e "
  const fs = require('fs');
  const devSkill = fs.readFileSync('packages/engine/skills/dev/SKILL.md', 'utf8');
  if (!devSkill.includes('冲突') && !devSkill.includes('already exists') && !devSkill.includes('conflict')) {
    throw new Error('FAIL: /dev skill 未说明 worktree 路径冲突的错误处理');
  }
  console.log('PASS: /dev skill 包含 worktree 冲突场景说明');
"

# 场景5: Learning Format Gate 包含"新文件"或"per-branch"提示逻辑
node -e "
  const fs = require('fs');
  // 查找 Learning 格式检测脚本
  const candidates = [
    'packages/engine/ci/scripts/check-learning-format.sh',
    'packages/engine/scripts/check-learning-format.sh',
    'packages/engine/hooks/pre-push.sh'
  ];
  let found = '';
  for (const p of candidates) {
    try { fs.accessSync(p); found = p; break; } catch(e) {}
  }
  if (!found) throw new Error('FAIL: 未找到 Learning 格式检测脚本');
  const c = fs.readFileSync(found, 'utf8');
  if (!c.includes('根本原因') && !c.includes('per-branch') && !c.includes('新文件')) {
    throw new Error('FAIL: ' + found + ' 未包含同名文件陷阱的提示逻辑');
  }
  console.log('PASS: ' + found + ' 包含 Learning 同名文件提示');
"
```

---

### 3. [PRD遗漏] Feature 2 — Learning Format Gate（不稳定点3）无验证命令

**问题**: PRD Feature 2 的4个不稳定点中，第3个（Learning Format Gate对同名文件diff context陷阱输出明确提示）在合同中完全没有对应验证命令。只有3个不稳定点被覆盖。
**影响**: Generator 可以不修改 Learning Format Gate 相关逻辑，4个不稳定点中有1个修复与否无法被检测。
**建议**: 将上述「场景5」的验证命令移入 Feature 2，专门针对 Learning Format Gate 脚本，验证其包含针对 diff context 陷阱的明确提示（"per-branch" 或 "新文件" 关键词）。

---

## 可选改进

- Feature 1 的硬阈值列出了5个场景的具体要求，但验证命令与硬阈值中的场景编号没有一一对应注释，建议加注释说明每条命令对应哪个场景（便于 Evaluator 执行时核对）
- Feature 3 的验证中 L gate 计数检查（≥3次）依赖字符串匹配 `/L[1-4]/g`，但报告中可能以"L1 stage"或"L1/L2"形式出现，导致误计数；建议改用 `(c.match(/\bL[1-4]\b/g) || []).length` 精确匹配
