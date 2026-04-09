# Contract Review Feedback (Round 1)

**审查任务 ID**: 055606c9-57bd-4aff-af51-6ecf7ab53c84  
**被审草案**: 14882ce6-7284-434f-a1ba-0cb26a2412d4 (Round 1)  
**结论**: REVISION — 4 个必须修改项  

---

## 必须修改项

### 1. [参数错误] Feature 2 — devloop-check.sh 调用参数顺序反了

**问题**: 合同中 4 条 Feature 2 验证命令均使用：
```bash
bash packages/engine/lib/devloop-check.sh "$TMPDIR/.dev-mode" "test-branch"
```
但 devloop-check.sh 实际函数签名为 `devloop_check BRANCH DEV_MODE_FILE`（`$1=branch`, `$2=dev_mode_file`）。参数顺序完全相反，脚本会把路径当 branch name，把 "test-branch" 当文件路径，4 条测试全部会错误失败或误判。

**影响**: Feature 2 所有 4 个验证命令无法正确执行，实现正确也无法 PASS，错误实现也无法被检出。  
**修复**: 改为 `bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode"`

---

### 2. [缺少命令] Feature 2 — stop-dev.sh 行为有硬阈值但无验证命令

**问题**: 合同硬阈值明确写了 "stop-dev.sh 在 Harness 模式 + 上述正常条件下，稳定返回 exit 0（可重复执行 3 次均 exit 0）"，但验证命令段完全没有 stop-dev.sh 的任何测试命令。Evaluator 无法机械化验证这个阈值。

**影响**: stop-dev.sh 的 Harness 退出行为无法自动验证，合同形同虚设。  
**修复**: 新增验证命令，模拟有 .dev-lock + harness_mode 条件下调用 stop-dev.sh，断言 exit code = 0。

---

### 3. [阈值错误] Feature 3 — 测试数量阈值低于 PRD 要求

**问题**: 合同验证命令用 `if (itMatches < 26)` 作为阈值，但当前测试基线实测为 22 个（非合同预估的 ~20 个）。PRD 要求新增 ≥ 6 个用例，正确阈值应为 `22 + 6 = 28`，即 `itMatches < 28`。当前阈值 `< 26` 只需新增 4 个就能通过，低于 PRD 要求。

**影响**: 错误实现（只新增 4 个用例）能蒙混过关，无法保证 6 个用例的覆盖要求。  
**修复**: 改为 `if (itMatches < 28)` 或先 grep 基线数量后动态计算 `baseline + 6`。

---

### 4. [缺少命令] Feature 1 — `steps/02-code.md` 在合同范围内但无验证命令

**问题**: 合同范围明确列出 `packages/engine/skills/dev/steps/02-code.md` 为交付物，但 Feature 1 验证命令段没有任何对 `02-code.md` 的检查。`01-spec.md` 有命令，`02-code.md` 完全空白。

**影响**: 实现可以完全忽略 `02-code.md` 的修改，Evaluator 也无从验证。  
**修复**: 新增对 `steps/02-code.md` 的节点验证命令，至少检查文件包含 Harness 相关描述（如 `step_2_code` 或 `PR 创建`）。

---

## 可选改进

- **Feature 1 stop-dev.sh 验证过弱**：当前命令只检查 stop-dev.sh 中是否含 "harness" 字符串（`content.toLowerCase().includes('harness')`），一行无关注释即可通过，无法验证与 SKILL.md 的实质一致性。建议改为检查 stop-dev.sh 含与 SKILL.md 一致的特定条件描述（如 `step_2_code` + `pr_url` 关键词）。

- **Feature 3 测试命令不一致**：验证命令第一条用 `npm run test -- --run ...`，但合同通过标准里写的是 `npx vitest run ...`。建议统一为 `node --experimental-vm-modules node_modules/.bin/vitest run ...` 或与 `package.json` test script 保持一致。
