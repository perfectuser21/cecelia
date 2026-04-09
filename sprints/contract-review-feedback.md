# Contract Review Feedback (Round 2)

reviewer_task_id: 6b315b69-8f90-43c2-9211-e24c2a6b3540
propose_task_id: c0f87465-8a7e-412f-a5ed-e5982deac57f
date: 2026-04-09
verdict: REVISION

---

## Round 1 修复确认

以下 3 个 Round 1 问题已正确修复 ✅：
- [文件错误] F2 验证命令已改为读 `check-dod-mapping.cjs`
- [PRD遗漏] F1 场景4（worktree路径冲突）已补充验证命令
- [PRD遗漏] F2 不稳定点3（Learning Format Gate）已新增独立验证命令

---

## 必须修改项

### 1. [命令太弱] Feature 1 场景4 — `includes('exist')` 匹配过于宽泛

**问题**: 场景4验证命令中 OR 条件包含 `c.includes('exist')`，该字符串会匹配几乎任何 bash 脚本中常见的 `if [ -f ... ]`、`check if file exists`、`not exist` 等无关内容。Generator 完全不实现 worktree 路径冲突提示，只要目标文件中出现过任何 "exist" 字眼就能通过。

**影响**: 场景4验证形同虚设，假实现可无条件通过。

**建议**: 将 `c.includes('exist')` 替换为更精确的 worktree 冲突相关词，如：
```javascript
if (
  c.includes('冲突') ||
  c.includes('already exists') ||
  c.includes('worktree add') && c.includes('ERROR') ||
  c.includes('FAIL') && (c.includes('路径') || c.includes('conflict'))
) {
  console.log('PASS: ...');
  found = true;
  break;
}
```
或更好地直接检查 `/dev` skill SKILL.md 文件，确保关键词是明确的冲突报错描述（而非泛用的 "if file exists" 逻辑）。

---

### 2. [行为未验证] Feature 1 场景2 — pre-push.sh 可执行性 ≠ hook 失败时输出原因

**问题**: 场景2验证命令只检查 `pre-push.sh` 文件是否存在且可执行（`[ -x ]`），但 PRD 硬阈值要求 "hook 失败场景必须输出 hook 名称与失败原因"。Generator 可以提交一个只有 `#!/bin/bash\nexit 0` 的空 hook，完美通过此验证，却完全没有实现"输出失败原因"行为。

**影响**: 场景2对行为毫无约束，假实现（空 hook）可通过。

**建议**: 改为检查 pre-push.sh 的内容中是否包含错误输出逻辑，例如：
```bash
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/pre-push.sh', 'utf8');
  if (!c.includes('echo') && !c.includes('stderr') && !c.includes('>&2')) {
    throw new Error('FAIL: pre-push.sh 未包含任何错误输出逻辑');
  }
  if (!c.includes('FAIL') && !c.includes('ERROR') && !c.includes('失败')) {
    throw new Error('FAIL: pre-push.sh 未包含失败提示关键词');
  }
  console.log('PASS: pre-push.sh 包含错误输出逻辑');
"
```

---

### 3. [命令不严格] Feature 2 不稳定点1 — 未验证错误信息包含具体命令名

**问题**: PRD F2 硬阈值明确要求 "`check-dod-mapping.cjs` 遇到不在白名单的 `manual:` 命令时，错误信息必须包含具体命令名（如 `grep`、`ls`）"。当前验证命令只检查文件是否包含 `whitelist`/`allowed` 关键词，Generator 可以实现 `const ALLOWED = []`（空白名单）或完全不报告具体命令名，照样通过验证。

**影响**: PRD 最核心的可调试性要求（错误定位到具体命令名）无法被合同检测到。

**建议**: 增加对错误输出格式的验证：
```bash
node -e "
  const c = require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-mapping.cjs', 'utf8');
  if (!c.includes('manual:')) throw new Error('FAIL: 未处理 manual: 命令');
  // 验证白名单包含具体命令名（whitelist 数组里有 node/npm/curl/bash/psql）
  if (!c.includes('node') || !c.includes('curl') || !c.includes('bash')) {
    throw new Error('FAIL: 白名单未包含必要命令（node/curl/bash），无法验证具体命令名报错');
  }
  // 验证错误信息拼接逻辑（含命令名变量引用）
  if (!c.includes('command') && !c.includes('cmd') && !c.includes('命令')) {
    throw new Error('FAIL: 错误信息逻辑未引用命令名变量');
  }
  console.log('PASS: check-dod-mapping.cjs 白名单含具体命令名，错误信息含命令引用');
"
```

---

## 可选改进

- F1 场景5 和 F2 不稳定点3 验证命令高度相似但略有差异（F1场景5额外检查 `'根本原因'`，逻辑不一致），建议统一为 F2 不稳定点3 的更严格版本
- F4 engine-ci.yml 检查中 `c.includes('l0')` 条件过宽（小写 l0 可能匹配任意文本），建议改为 `c.includes('e2e-integrity-check')` 单一精确检查
